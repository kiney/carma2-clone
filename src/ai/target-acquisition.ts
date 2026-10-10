import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { findNearestPathSection } from "./path-geometry";
import { NativeProjectedRoute } from "./path-route";
import { NativeTargetSectionSearch } from "./target-search";

export interface NativeTargetSectionCache {
  section: number;
  refreshAtMs: number;
}

export interface NativeTargetAcquisitionQuery {
  nowMs: number;
  position: Vector3;
  velocity: Vector3;
  /** Original ACT matrix row2, pointing backwards for a level car. */
  actorRow2: Vector3;
  targetPosition: Vector3;
  force: boolean;
  cheating: boolean;
  strength: number;
  /** Explicit native opponent flags: slot12 reads their low signed16 bits. */
  opponentFlags: number;
}

const rounded = (v: Vector3) =>
  new Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));

/** Freshseed4aca15–55 keeps displacement differences live and adds the
 * X/Z products before Y. Generic Vector3.dot has a different cancellation. */
export function nativeAcquisitionSeedDirection(
  intersection: Vector3,
  position: Vector3,
  actorRow2: Vector3,
): 0 | 1 {
  const i = rounded(intersection),
    p = rounded(position),
    row = rounded(actorRow2);
  if (![i, p, row].every((v) => v.toArray().every(Number.isFinite)))
    throw new Error("Invalid target-acquisition seed geometry");
  const x = i.x - p.x,
    y = i.y - p.y,
    z = i.z - p.z;
  return x * row.x + z * row.z + y * row.y >= 0 ? 1 : 0;
}

function checkTime(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("Invalid target-acquisition timestamp");
}

function randomBetween(a: number, b: number, random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error("Target-acquisition random sample must be in [0, 1)");
  return a + Math.trunc((Math.floor(sample * 32768) * (b - a + 1)) / 32768);
}

/** Independent installed NewCalcGetNearPlayerRoute4ac780–4acbbd.
 * Shared target cache belongs to the caller; the previous target belongs to
 * this opponent. SearchForSection supplies the native bounded DFS. */
export class NativeTargetAcquisition {
  private readonly nodes: Vector3[];
  private readonly lengths: number[];
  private readonly search: NativeTargetSectionSearch;
  private previousTarget = -1;

  constructor(
    nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
  ) {
    if (!sections.length || sections.length > 32768)
      throw new Error("Target acquisition requires signed16 path sections");
    this.nodes = nodes.map((node) => {
      const point = rounded(node);
      if (!point.toArray().every(Number.isFinite))
        throw new Error("Invalid target-acquisition node");
      return point;
    });
    this.search = new NativeTargetSectionSearch(this.nodes, sections);
    this.lengths = sections.map((section) => {
      const a = this.nodes[section.nodeIndices[0]];
      const b = this.nodes[section.nodeIndices[1]];
      const dx = Math.fround(b.x - a.x);
      const dy = Math.fround(b.y - a.y);
      const dz = Math.fround(b.z - a.z);
      return Math.fround(Math.sqrt(dx * dx + dy * dy + dz * dz));
    });
  }

  get previousTargetSection(): number {
    return this.previousTarget;
  }

  /** Race initialization resets opponent+78 without clearing route backing. */
  resetTarget(): void {
    this.previousTarget = -1;
  }

  acquire(
    route: NativeProjectedRoute,
    query: NativeTargetAcquisitionQuery,
    targetCache: NativeTargetSectionCache,
    random = Math.random,
  ): NativeTargetSectionCache {
    checkTime(query.nowMs);
    checkTime(targetCache.refreshAtMs);
    if (
      !Number.isInteger(targetCache.section) ||
      targetCache.section < -32768 ||
      targetCache.section >= this.sections.length ||
      !Number.isInteger(query.strength) ||
      query.strength < 0 ||
      !Number.isInteger(query.opponentFlags) ||
      query.opponentFlags < 0 ||
      query.opponentFlags > 0xffffffff ||
      ![
        query.position,
        query.velocity,
        query.actorRow2,
        query.targetPosition,
      ].every((v) => rounded(v).toArray().every(Number.isFinite))
    )
      throw new Error("Invalid target-acquisition query");
    const cache = { ...targetCache };
    // Installed capacity return occurs before refreshing the shared cache.
    if (route.entries.length >= 12) return cache;
    const position = rounded(query.position);
    if (cache.section < 0 || query.nowMs > cache.refreshAtMs) {
      cache.refreshAtMs =
        (query.nowMs + 1000 + randomBetween(-100, 100, random)) >>> 0;
      const nearest = findNearestPathSection(
        rounded(query.targetPosition),
        this.nodes,
        this.sections,
      );
      if (!nearest) throw new Error("Target has no nearest path section");
      cache.section = nearest.section;
    }
    if (
      !route.entries.length ||
      query.force ||
      cache.section !== this.previousTarget
    ) {
      const nearest = findNearestPathSection(
        position,
        this.nodes,
        this.sections,
      );
      if (!nearest) throw new Error("Opponent has no nearest path section");
      const intersection = rounded(nearest.intersection);
      let selected = -1;
      for (let slot = 0; slot < route.entries.length; slot++) {
        // 4ac894–97 compares ID with zero, then MOVs it into the entry.
        route.overwriteStoredSection(slot, nearest.section);
        if (nearest.section !== 0) {
          selected = slot;
          break;
        }
      }
      if (selected < 0) {
        route.clear();
        route.append(
          nearest.section,
          nativeAcquisitionSeedDirection(
            intersection,
            position,
            query.actorRow2,
          ),
        );
      } else {
        const velocity = rounded(query.velocity);
        // 4ac8b7–905: live square sum, no intermediate speed/length store.
        let remaining =
          (100 - velocity.lengthSq()) *
          Math.fround(-0.0625) *
          0.14492753623188406;
        if (remaining > 0) {
          // Native intentionally indexes the global section by selected SLOT.
          const section = this.sections[selected];
          if (!section) throw new Error("Missing acquisition slot metadata");
          const direction = route.storedEntry(selected).direction;
          const endpoint = this.nodes[section.nodeIndices[direction]];
          const dx = endpoint.x - intersection.x;
          const dy = endpoint.y - intersection.y;
          const dz = endpoint.z - intersection.z;
          // 4ac953/959 retain live X/Y while storing them for square products.
          let distance = Math.sqrt(
            dx * Math.fround(dx) + dy * Math.fround(dy) + dz * dz,
          );
          while (selected < route.entries.length - 1 && distance < remaining) {
            remaining -= distance;
            selected++;
            distance = this.lengths[route.storedEntry(selected).section];
          }
        }
        route.shift(selected);
      }
    }
    let fallback = false;
    while (route.entries.length < 12 && !fallback) {
      const entries = route.entries;
      const found = this.search.search(
        entries[entries.length - 1],
        cache.section,
        query.cheating,
      );
      if (found.entries.length > 1) {
        const count = Math.min(found.entries.length - 1, 12 - entries.length);
        for (const entry of found.entries.slice(1, count + 1))
          route.append(entry.section, entry.direction);
        const newCount = route.entries.length;
        const nextId =
          newCount === 12
            ? (query.opponentFlags << 16) >> 16
            : route.storedEntry(newCount).section;
        if (nextId === cache.section)
          route.topUpRandom(
            query.strength < 5 ? randomBetween(1, 2, random) : 1,
            query.cheating,
            random,
          );
      } else {
        fallback = true;
        if (route.entries.length < 12)
          route.topUpRandom(query.strength < 5 ? 4 : 2, query.cheating, random);
      }
    }
    this.previousTarget = cache.section;
    return cache;
  }
}

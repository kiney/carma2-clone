import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { findNearestPathSection } from "./path-geometry";
import { NativeProjectedRoute, type ProjectedPathSection } from "./path-route";
import { nativeOpponentProximity } from "./proximity";

export interface NativeYBelowResult {
  /** Original miss is -FLT_MAX; any finite value below-100 is a miss here. */
  y: number;
  materialName: string | null;
}
/** One installed FindYBelow4e4130 traversal, not its eleven-probe wrapper.
 * Select the greatest eligible hit Y; reject names beginning! or>, accept null.
 * The world traversal and its authored track-column selection remain injected. */
export type NativeFindYBelow = (origin: Vector3) => NativeYBelowResult;
export function nativeFallenGroundMaterialEligible(
  name: string | null,
): boolean {
  return name?.[0] !== "!" && name?.[0] !== ">";
}

function stored(value: Vector3): Vector3 {
  const v = new Vector3(
    Math.fround(value.x),
    Math.fround(value.y),
    Math.fround(value.z),
  );
  if (!v.toArray().every(Number.isFinite))
    throw new Error("Invalid native fallen-world position");
  return v;
}

/** Installed FindYVerticallyBelow2 at4e43c0: attempts0..10 inclusive, each
 * followed by an F32+.2 origin store, and first height>=-100 wins. */
export function nativeFindYVerticallyBelow2(
  origin: Vector3,
  findYBelow: NativeFindYBelow,
): NativeYBelowResult {
  const point = stored(origin);
  let result: NativeYBelowResult = {
    y: -3.4028234663852886e38,
    materialName: null,
  };
  for (let attempt = 0; attempt <= 10; attempt++) {
    const hit = findYBelow(point.clone());
    result = { y: Math.fround(hit.y), materialName: hit.materialName };
    if (!Number.isFinite(result.y))
      throw new Error("Invalid native FindYBelow height");
    point.y = Math.fround(point.y + Math.fround(0.2));
    if (result.y >= Math.fround(-100)) return result;
  }
  return result;
}

export interface NativeFallenWorldQuery {
  position: Vector3;
  /** Original ACT row1, obtained from the local+Y basis. */
  actorUp: Vector3;
  driver: number;
  wheelsOnGround: number;
  /** Entire half-open cached face range, not just tyre-contact materials. */
  cachedMaterialNames: readonly (string | null)[];
  carFlying: boolean;
  actionReplay: boolean;
}

/** Installed HasCarFallenOffWorld442020 ->442030. Around probes recurse with
 * checkAround=0, so the check performs at most66 direct FindYBelow queries. */
export function nativeHasCarFallenOffWorld(
  query: NativeFallenWorldQuery,
  findYBelow: NativeFindYBelow,
): boolean {
  if ((query.carFlying && query.driver === 8) || query.actionReplay)
    return false;
  if (
    !Number.isInteger(query.driver) ||
    !Number.isInteger(query.wheelsOnGround)
  )
    throw new Error("Invalid native fallen-world car fields");
  if (query.wheelsOnGround !== 0)
    return query.cachedMaterialNames.some((name) => name?.[0] === "^");
  const actor = stored(query.position),
    up = stored(query.actorUp);
  const check = (
    position: Vector3,
  ): { fallen: boolean; missedBoth: boolean } => {
    const first = position.clone();
    first.y = Math.fround(first.y + Math.fround(0.5));
    const below = nativeFindYVerticallyBelow2(first, findYBelow);
    if (below.y >= Math.fround(-100))
      return { fallen: below.materialName?.[0] === "^", missedBoth: false };
    const tilted = stored(position.clone().add(up));
    const missedBoth =
      nativeFindYVerticallyBelow2(tilted, findYBelow).y < Math.fround(-100);
    return { fallen: missedBoth, missedBoth };
  };
  const initial = check(actor);
  if (!initial.missedBoth) return initial.fallen;
  // Independent+X and+Z probes; native restores X through another F32 store
  // before the Z probe. Preserve this roundtrip in the local query copy.
  actor.x = Math.fround(actor.x + Math.fround(0.05));
  const x = check(actor);
  actor.x = Math.fround(actor.x - Math.fround(0.05));
  if (!x.fallen) return false;
  actor.z = Math.fround(actor.z + Math.fround(0.05));
  return check(actor).fallen;
}

export interface NativeSafeRelocationQuery {
  position: Vector3;
  cachedDirection: Vector3;
  playerPosition: Vector3;
  viewDistance: number;
  nowMs: number;
  /** Native route filtering reads the existing opponent cheating bit. */
  cheating?: boolean;
}
export interface NativeSafeRelocationResult {
  kind: "no-route" | "relocated" | "bound-exhausted";
  position: Vector3;
  route: readonly ProjectedPathSection[];
  endpointVisits: number;
  /** Valid-nearest branches clear all car forces/curvature/gear/revs and
   * collision velocities; preserve orientation and leave physical state off. */
  resetMotion?: true;
  physicsActive?: false;
  playerDistance?: number;
  displacement?: Vector3;
  lastInViewMs?: number;
  diagnostic?: string;
}

/** Installed TeleportOpponentToNearestSafeLocation4a8f20. The native endpoint
 * walk is unbounded;4096 default visits is an explicit browser robustness bound.
 * Bound exhaustion returns a diagnostic and does not claim successful escape. */
export function nativeTeleportOpponentToNearestSafeLocation(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: NativeProjectedRoute,
  query: NativeSafeRelocationQuery,
  random = Math.random,
  maxEndpointVisits = 4096,
): NativeSafeRelocationResult {
  const position = stored(query.position),
    direction = stored(query.cachedDirection),
    player = stored(query.playerPosition),
    limit = Math.fround(query.viewDistance);
  if (
    !Number.isInteger(maxEndpointVisits) ||
    maxEndpointVisits < 1 ||
    !Number.isFinite(limit) ||
    limit < 0 ||
    !Number.isInteger(query.nowMs) ||
    query.nowMs < 0 ||
    query.nowMs > 0xffffffff
  )
    throw new Error("Invalid native safe relocation query");
  const nearest = findNearestPathSection(position, nodes, sections);
  const seedSection = nearest ? (nearest.section << 16) >> 16 : -1;
  if (!nearest || seedSection < 0)
    return {
      kind: "no-route",
      position,
      route: route.entries,
      endpointVisits: 0,
    };
  const dot =
    direction.z * nearest.direction.z +
    direction.y * nearest.direction.y +
    direction.x * nearest.direction.x;
  route.clear();
  route.append(seedSection, dot < 0 ? 1 : 0);
  route.topUpRandom(-1, query.cheating ?? false, random);
  let slot = 1,
    lastInViewMs = 0;
  let proximity = nativeOpponentProximity(
    position,
    player,
    limit,
    query.nowMs,
    0,
  );
  for (let visits = 1; visits <= maxEndpointVisits; visits++) {
    const entry = route.storedEntry(slot),
      section = sections[entry.section];
    if (!section || !nodes[section.nodeIndices[entry.direction]])
      throw new Error("Invalid native safe relocation endpoint");
    position.copy(stored(nodes[section.nodeIndices[entry.direction]]));
    proximity = nativeOpponentProximity(
      position,
      player,
      limit,
      query.nowMs,
      lastInViewMs,
    );
    lastInViewMs = proximity.lastInViewMs;
    const escaped = proximity.playerDistance > limit;
    slot++;
    // The final endpoint's shift/refill precedes the exit flag test too.
    if (slot >= route.entries.length) {
      route.shift(slot - 1);
      route.topUpRandom(-1, query.cheating ?? false, random);
      slot = 0;
    }
    const common = {
      position: position.clone(),
      route: route.entries,
      endpointVisits: visits,
      resetMotion: true as const,
      physicsActive: false as const,
      ...proximity,
    };
    if (escaped) return { kind: "relocated", ...common };
    if (visits === maxEndpointVisits)
      return {
        kind: "bound-exhausted",
        ...common,
        diagnostic: `Native safe relocation exhausted ${maxEndpointVisits} endpoint visits without leaving the view distance`,
      };
  }
  throw new Error("Unreachable native safe relocation state");
}

import { Box3 } from "three";
import {
  BodyBroadphase,
  type BodyBroadphaseDiagnostics,
  type BroadphaseBody,
} from "./body-broadphase";

export interface PairDiscoveryDiagnostics extends BodyBroadphaseDiagnostics {
  pairDiscoveryCalls: number;
  pairDiscoveryHits: number;
  pairDiscoveryChangedSources: number;
  retainedPairCandidates: number;
}

interface SourceSnapshot {
  body: BroadphaseBody;
  version: object;
  immovable: boolean;
  exceptional: boolean;
}

function exceptionalBounds(box: Box3): boolean {
  return (
    !Number.isFinite(box.min.x) ||
    !Number.isFinite(box.min.y) ||
    !Number.isFinite(box.min.z) ||
    !Number.isFinite(box.max.x) ||
    !Number.isFinite(box.max.y) ||
    !Number.isFinite(box.max.z) ||
    box.isEmpty()
  );
}

/** Tick-scoped candidate adjacency over a persistent broadphase index.
 *
 * Create a new instance for each simulation tick. The producer supplies one
 * immutable geometry-version token per roster slot, replacing it whenever any
 * OLD/NEXT bound or collision shape changes, including nonincident sources.
 * Version-stable input geometry must remain immutable; identity of Box3 objects
 * is not a change certificate. Mobility is checked independently on every call.
 * No bound components, contact rows, or response/solver values are retained.
 *
 * Every slot is validated before incident filtering. Dirty sources discover new
 * neighbors against the full roster; the requested incident set only selects
 * output. Duplicate body identities keep their distinct roster-slot semantics.
 */
export class RetainedPairDiscovery {
  private snapshots: SourceSnapshot[] | undefined;
  private adjacency: Set<number>[] = [];
  private candidateCount = 0;

  constructor(private readonly index: BodyBroadphase) {}

  pairs<Body extends BroadphaseBody>(
    bodies: readonly Body[],
    bounds: readonly Box3[],
    versions: readonly object[],
    diagnostics?: PairDiscoveryDiagnostics,
    incidentBodies?: ReadonlySet<Body>,
  ): [number, number][] {
    if (bodies.length !== bounds.length || bodies.length !== versions.length)
      throw new Error(
        "Pair discovery requires one bound and geometry version per body",
      );

    const previous = this.snapshots;
    let rosterChanged = !previous || previous.length !== bodies.length;
    const dirtySlots: number[] = [];
    const dirtyBodies = new Set<Body>();
    const incidentSlots: number[] | undefined = incidentBodies ? [] : undefined;
    let movable = 0;
    let exceptional = 0;
    // Do not stop at an identity change or restrict validation to incident slots.
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const old = previous?.[i];
      const immovable = Boolean(body.properties.immovable);
      if (!immovable) movable++;
      if (incidentBodies?.has(body)) incidentSlots!.push(i);
      if (!old || old.body !== body) rosterChanged = true;
      const changed =
        !old ||
        old.body !== body ||
        old.version !== versions[i] ||
        old.immovable !== immovable;
      if (changed) {
        dirtySlots.push(i);
        dirtyBodies.add(body);
      }
      if (changed ? exceptionalBounds(bounds[i]) : old.exceptional)
        exceptional++;
    }

    if (diagnostics)
      Object.assign(diagnostics, {
        bodies: bodies.length,
        movable,
        immovable: bodies.length - movable,
        exceptionalBounds: exceptional,
        staticRebuilds: 0,
        movingRebuilds: 0,
        qualityRebuilds: 0,
        boundsChanges: 0,
        treeRefits: 0,
        nodeTests: 0,
        candidates: 0,
        boundsTests: 0,
        pairs: 0,
      });

    if (rosterChanged) {
      this.adjacency = bodies.map(() => new Set<number>());
      this.candidateCount = 0;
      this.add(this.index.pairs(bodies, bounds, diagnostics));
    } else if (dirtySlots.length) {
      for (const i of dirtySlots) {
        for (const j of this.adjacency[i]) {
          this.adjacency[j].delete(i);
          this.candidateCount--;
        }
        this.adjacency[i].clear();
      }
      this.add(this.index.pairs(bodies, bounds, diagnostics, dirtyBodies));
    }

    // Store metadata only after discovery has completed successfully.
    if (rosterChanged)
      this.snapshots = bodies.map((body, i) => ({
        body,
        version: versions[i],
        immovable: Boolean(body.properties.immovable),
        exceptional: exceptionalBounds(bounds[i]),
      }));
    else
      for (const i of dirtySlots)
        previous![i] = {
          body: bodies[i],
          version: versions[i],
          immovable: Boolean(bodies[i].properties.immovable),
          exceptional: exceptionalBounds(bounds[i]),
        };

    const result: [number, number][] = [];
    const append = (i: number) => {
      for (const j of this.adjacency[i])
        if (i < j || (incidentBodies && !incidentBodies.has(bodies[j])))
          result.push(i < j ? [i, j] : [j, i]);
    };
    if (incidentSlots) for (const i of incidentSlots) append(i);
    else for (let i = 0; i < bodies.length; i++) append(i);
    result.sort(([ai, aj], [bi, bj]) => ai - bi || aj - bj);
    if (diagnostics)
      Object.assign(diagnostics, {
        pairs: result.length,
        pairDiscoveryCalls: 1,
        pairDiscoveryHits: Number(!rosterChanged && !dirtySlots.length),
        pairDiscoveryChangedSources: rosterChanged
          ? bodies.length
          : dirtySlots.length,
        retainedPairCandidates: this.candidateCount,
      });
    return result;
  }

  private add(pairs: readonly [number, number][]): void {
    for (const [i, j] of pairs) {
      if (this.adjacency[i].has(j)) continue;
      this.adjacency[i].add(j);
      this.adjacency[j].add(i);
      this.candidateCount++;
    }
  }
}

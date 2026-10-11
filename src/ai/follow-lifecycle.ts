import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import {
  enterCheatyPath,
  stepCheatyPath,
  type CheatyPathResult,
  type CheatyPathState,
} from "./cheaty-path";
import { getPathEndpointSpeed } from "./path-geometry";
import {
  NativePhysicalPathFollower,
  type NativePhysicalPathQuery,
  type NativePhysicalPathResult,
} from "./path-follow";
import type { ProjectedPathSection } from "./path-route";

export interface NativeFollowLifecycleQuery extends NativePhysicalPathQuery {
  cheating: boolean;
  physical: boolean;
  /** Projected routes have12 slots; a25-node target trail has24. */
  routeCapacity?: 12 | 24;
}

export interface NativeFollowLifecycleHooks {
  turnPhysicsOff(): void;
  applyCheatyPose(result: CheatyPathResult): void;
  clearCarForces(): void;
  /** Original nonzero result means OK even if placement exhausted into fallback. */
  rematerializeOnSection(sectionSlot: number, speed: number): number;
  rematerializeOnNearestSection(speed: number): number;
}

export type NativeFollowLifecycleResult =
  | { kind: "physical"; status: 0 | 2; follower: NativePhysicalPathResult }
  | { kind: "cheaty"; status: 0 | 1; movement: CheatyPathResult }
  | { kind: "rematerialized"; status: 0 };

/** Installed4b0955–4b0a1b. Authored endpoint bytes override distance fallback.
 * Distance deltas and length cross Float32 stores before the 1..7 speed clamp. */
export function nativeFollowRematerializationSpeed(
  position: Vector3,
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  sectionSlot: number,
): number {
  const entry = route[sectionSlot];
  const section = entry && sections[entry.section];
  if (!section || (entry.direction !== 0 && entry.direction !== 1))
    throw new Error("Invalid native rematerialization route slot");
  const maximum = getPathEndpointSpeed(section, entry.direction, true, "max");
  const minimum = getPathEndpointSpeed(section, entry.direction, true, "min");
  if (
    ![maximum, minimum].every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
  )
    throw new Error("Invalid native rematerialization speed byte");
  if (maximum < 255) return Math.fround(maximum * 0.14492753623188406);
  if (minimum > 0) return Math.fround(minimum * 0.14492753623188406);
  const finish = nodes[section.nodeIndices[entry.direction]];
  if (!finish) throw new Error("Missing native rematerialization endpoint");
  const delta = new Vector3(
    Math.fround(Math.fround(finish.x) - Math.fround(position.x)),
    Math.fround(Math.fround(finish.y) - Math.fround(position.y)),
    Math.fround(Math.fround(finish.z) - Math.fround(position.z)),
  );
  const distance = Math.fround(Math.sqrt(delta.lengthSq()));
  if (!Number.isFinite(distance))
    throw new Error("Invalid native rematerialization distance");
  return Math.fround(Math.min(7, Math.max(1, 2 * distance)));
}

/** ProcessFollowPath's shared physical/nonphysical dispatch. Objective owners
 * must synchronize this cursor after prefix shifts and handle raw status1.
 * World placement and render/physics side effects remain explicit callbacks. */
export class NativeFollowLifecycle {
  private cheating = false;
  private sectionSlot = 0;
  private cheatyState: CheatyPathState | undefined;
  private started = false;

  constructor(readonly physicalFollower = new NativePhysicalPathFollower()) {}

  get snapshot() {
    return {
      cheating: this.cheating,
      sectionSlot: this.sectionSlot,
      movingToIntersection: this.cheatyState?.movingToIntersection ?? false,
      intersection: this.cheatyState?.intersection.clone(),
    };
  }

  start(
    query: NativeFollowLifecycleQuery,
    hooks: NativeFollowLifecycleHooks,
    sectionSlot = 0,
  ): void {
    this.physicalFollower.start(query.nowMs, sectionSlot);
    this.sectionSlot = sectionSlot;
    this.cheating = false;
    // Native START clears cornering/cheating, but preserves the intersection.
    this.started = true;
    if (!query.cheating && !query.physical) {
      const velocity = new Vector3(
        Math.fround(query.velocity.x),
        Math.fround(query.velocity.y),
        Math.fround(query.velocity.z),
      );
      const speed = Math.fround(Math.sqrt(velocity.lengthSq()));
      if (!Number.isFinite(speed))
        throw new Error("Invalid native follow start velocity");
      hooks.rematerializeOnNearestSection(speed);
    }
  }

  setSectionSlot(sectionSlot: number): void {
    this.physicalFollower.setSectionSlot(sectionSlot);
    this.sectionSlot = sectionSlot;
    if (this.cheatyState) this.cheatyState.sectionSlot = sectionSlot;
  }

  syncCarForces(accForce: number, brakeForce: number): void {
    this.physicalFollower.syncCarForces(accForce, brakeForce);
  }

  run(
    nodes: readonly Vector3[],
    sections: readonly TrackPathSection[],
    route: readonly ProjectedPathSection[],
    query: NativeFollowLifecycleQuery,
    hooks: NativeFollowLifecycleHooks,
    random = Math.random,
  ): NativeFollowLifecycleResult {
    if (!this.started)
      throw new Error("Native follow lifecycle has not started");
    if (
      !Number.isInteger(query.dtMs) ||
      query.dtMs < 0 ||
      query.dtMs > 0xffffffff
    )
      throw new Error("Invalid native follow frame period");
    if (query.cheating !== this.cheating) {
      this.cheating = query.cheating;
      if (this.cheating) {
        const movement = enterCheatyPath(
          query.position,
          this.sectionSlot,
          route,
          nodes,
          sections,
          query.dtMs,
          query.routeCapacity ?? 12,
        );
        this.cheatyState = movement.state;
        hooks.turnPhysicsOff();
        hooks.applyCheatyPose(movement);
        return { kind: "cheaty", status: 0, movement };
      }
      const speed = nativeFollowRematerializationSpeed(
        query.position,
        nodes,
        sections,
        route,
        this.sectionSlot,
      );
      const result = hooks.rematerializeOnSection(this.sectionSlot, speed);
      if (!Number.isInteger(result))
        throw new Error("Invalid native rematerialization return value");
      if (result !== 0) {
        hooks.clearCarForces();
        this.physicalFollower.syncCarForces(0, 0);
        // Return immediately; physical motion starts on a later call.
        return { kind: "rematerialized", status: 0 };
      }
      // Installed failed transition restores FOLLOW cheating, not made-it.
      this.cheating = true;
    }
    if (this.cheating) {
      if (!this.cheatyState)
        throw new Error("Missing native cheaty follow record");
      const movement = stepCheatyPath(
        query.position,
        this.cheatyState,
        route,
        nodes,
        sections,
        query.dtMs,
        query.routeCapacity ?? 12,
      );
      this.cheatyState = movement.state;
      this.sectionSlot = movement.state.sectionSlot;
      hooks.applyCheatyPose(movement);
      if (movement.kind === "path-end") {
        hooks.clearCarForces();
        this.physicalFollower.syncCarForces(0, 0);
      }
      return {
        kind: "cheaty",
        status: movement.kind === "path-end" ? 1 : 0,
        movement,
      };
    }
    this.physicalFollower.setSectionSlot(this.sectionSlot);
    const follower = this.physicalFollower.run(
      nodes,
      sections,
      route,
      query,
      random,
    );
    this.sectionSlot = follower.geometry.sectionSlot;
    return {
      kind: "physical",
      status: follower.kind === "given-up" ? 2 : 0,
      follower,
    };
  }
}

/** Objective-owned geometry and flags paired with the shared Follow dispatcher.
 * The physical follower form preserves existing isolated callers; live mode
 * transitions require a NativeFollowLifecycle and explicit engine hooks. */
export interface NativeObjectiveFollowQuery extends NativePhysicalPathQuery {
  cheating: boolean;
  physical?: boolean;
  routeCapacity?: 12 | 24;
  followHooks?: NativeFollowLifecycleHooks;
}
export interface NativeObjectiveFollowResult {
  rawStatus: 0 | 1 | 2;
  follow?: NativeFollowLifecycleResult;
  follower?: NativePhysicalPathResult;
  sectionSlot: number;
}
export class NativeObjectiveFollowBridge {
  constructor(
    private readonly source: NativePhysicalPathFollower | NativeFollowLifecycle,
  ) {}

  get supportsModeTransitions(): boolean {
    return this.source instanceof NativeFollowLifecycle;
  }

  start(query: NativeObjectiveFollowQuery, sectionSlot = 0): void {
    if (this.source instanceof NativeFollowLifecycle) {
      this.source.start(this.query(query), this.hooks(query), sectionSlot);
    } else {
      this.requirePhysical(query);
      this.source.start(query.nowMs, sectionSlot);
    }
  }

  setSectionSlot(sectionSlot: number): void {
    this.source.setSectionSlot(sectionSlot);
  }

  syncCarForces(accForce: number, brakeForce: number): void {
    this.source.syncCarForces(accForce, brakeForce);
  }

  run(
    nodes: readonly Vector3[],
    sections: readonly TrackPathSection[],
    route: readonly ProjectedPathSection[],
    query: NativeObjectiveFollowQuery,
    random = Math.random,
  ): NativeObjectiveFollowResult {
    if (this.source instanceof NativeFollowLifecycle) {
      const follow = this.source.run(
        nodes,
        sections,
        route,
        this.query(query),
        this.hooks(query),
        random,
      );
      return {
        rawStatus: follow.status,
        follow,
        ...(follow.kind === "physical" ? { follower: follow.follower } : {}),
        sectionSlot: this.source.snapshot.sectionSlot,
      };
    }
    this.requirePhysical(query);
    const follower = this.source.run(nodes, sections, route, query, random);
    return {
      rawStatus: follower.kind === "given-up" ? 2 : 0,
      follower,
      sectionSlot: follower.geometry.sectionSlot,
    };
  }

  private query(query: NativeObjectiveFollowQuery): NativeFollowLifecycleQuery {
    return { ...query, physical: query.physical ?? true };
  }
  private hooks(query: NativeObjectiveFollowQuery): NativeFollowLifecycleHooks {
    if (!query.followHooks)
      throw new Error("Native follow lifecycle requires engine hooks");
    return query.followHooks;
  }
  private requirePhysical(query: NativeObjectiveFollowQuery): void {
    if (query.cheating || query.physical === false)
      throw new Error(
        "Cheaty following is not implemented by the physical adapter; use NativeFollowLifecycle for mode transitions",
      );
  }
}

import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import {
  NativePhysicalPathFollower,
  type NativePhysicalPathQuery,
  type NativePhysicalPathResult,
} from "./path-follow";
import { findNearestPathSection } from "./path-geometry";
import { NativeProjectedRoute, type ProjectedPathSection } from "./path-route";

export type NativeRunAwayQuery = Omit<
  NativePhysicalPathQuery,
  "ignoreEnd" | "neverStruggle" | "pursuit"
> & {
  actorDirection: Vector3;
  cheating: boolean;
};

export interface NativeRunAwayHooks {
  objectiveComplete(): void;
}

export interface NativeRunAwayResult {
  transition: "started" | "continue" | "restarted" | "objective-complete";
  route: readonly ProjectedPathSection[];
  follower?: NativePhysicalPathResult;
}

function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function random15(random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error("Native run-away random sample must be in [0, 1)");
  return Math.floor(sample * 32768);
}

/** Installed START/RUN/DIE run-away objective over shared route/follower state.
 * Cheaty following remains owned by the outer objective dispatcher. */
export class NativeRunAwayState {
  private started = false;
  private stopDeadlineMs = 0;
  private followSlot = 0;

  constructor(
    private readonly nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
    private readonly route: NativeProjectedRoute,
    private readonly follower: NativePhysicalPathFollower,
    private readonly random = Math.random,
  ) {}

  get entries() {
    return this.route.entries;
  }

  get deadlineMs(): number {
    return this.stopDeadlineMs;
  }

  /** Synchronize the zero-based public follower cursor with external dispatch. */
  setSectionSlot(sectionSlot: number): void {
    if (!Number.isInteger(sectionSlot) || sectionSlot < 0)
      throw new Error("Invalid native run-away follower section slot");
    this.follower.setSectionSlot(sectionSlot);
    this.followSlot = sectionSlot;
  }

  start(query: NativeRunAwayQuery): NativeRunAwayResult {
    this.rejectCheating(query);
    this.validateQuery(query);
    const seconds = 30 + Math.floor((random15(this.random) * 61) / 32768);
    this.stopDeadlineMs = (query.nowMs + seconds * 1000) >>> 0;
    this.route.clear();
    this.seed(query);
    this.route.topUpRandom(-1, false, this.random);
    this.follower.start(query.nowMs, 0);
    this.followSlot = 0;
    this.started = true;
    return { transition: "started", route: this.entries };
  }

  die(): void {
    // Installed DIE dispatches the native no-op at4aaadf.
  }

  run(
    query: NativeRunAwayQuery,
    hooks: NativeRunAwayHooks,
  ): NativeRunAwayResult {
    if (!this.started) throw new Error("Run-away state has not started");
    this.rejectCheating(query);
    this.validateQuery(query);
    if (query.nowMs > this.stopDeadlineMs) {
      hooks.objectiveComplete();
      return { transition: "objective-complete", route: this.entries };
    }

    if (this.followSlot > 0) this.route.shift(this.followSlot);
    this.followSlot = 0;
    this.follower.setSectionSlot(0);
    if (!this.entries.length)
      throw new Error("Native run-away route became empty before RUN");
    if (this.entries.length < 12)
      this.route.topUpRandom(12 - this.entries.length, false, this.random);
    const followerResult = this.follower.run(
      this.nodes,
      this.sections,
      this.entries,
      this.physicalQuery(query),
      this.random,
    );
    this.follower.syncCarForces(
      followerResult.accForce,
      followerResult.brakeForce,
    );
    this.followSlot = followerResult.geometry.sectionSlot;
    if (followerResult.kind === "given-up") {
      this.route.clear();
      this.seed(query);
      this.route.topUpRandom(-1, false, this.random);
      this.follower.start(query.nowMs, 0);
      this.followSlot = 0;
      return {
        transition: "restarted",
        route: this.entries,
        follower: followerResult,
      };
    }
    return {
      transition: "continue",
      route: this.entries,
      follower: followerResult,
    };
  }

  private seed(query: NativeRunAwayQuery): void {
    const nearest = findNearestPathSection(
      query.position,
      this.nodes,
      this.sections,
    );
    // Native dereferences the nearest result. An empty authored section set is
    // rejected here instead of inventing a route from uninitialized storage.
    if (!nearest)
      throw new Error(
        "Native run-away objective requires a nearest path section",
      );
    const cachedDirection = new Vector3(
      Math.fround(query.actorDirection.x),
      Math.fround(query.actorDirection.y),
      Math.fround(query.actorDirection.z),
    );
    const direction =
      cachedDirection.z * nearest.direction.z +
      cachedDirection.x * nearest.direction.x +
      cachedDirection.y * nearest.direction.y;
    this.route.append(nearest.section, direction < 0 ? 0 : 1);
  }

  private physicalQuery(query: NativeRunAwayQuery): NativePhysicalPathQuery {
    return { ...query, ignoreEnd: false, neverStruggle: false, pursuit: false };
  }

  private rejectCheating(query: NativeRunAwayQuery): void {
    if (query.cheating)
      throw new Error("Cheaty following is not implemented by run-away state");
  }

  private validateQuery(query: NativeRunAwayQuery): void {
    if (
      !uint(query.nowMs) ||
      ![
        ...query.position.toArray(),
        ...query.actorDirection.toArray(),
        ...query.velocity.toArray(),
        query.dtMs,
        query.maxCurve,
        query.mass,
        query.factor,
        query.engineDamage,
        query.transmissionDamage,
        query.currentCurvature,
      ].every(Number.isFinite) ||
      query.dtMs <= 0 ||
      query.mass <= 0 ||
      query.maxCurve < 0
    )
      throw new Error("Invalid native run-away query");
    if (!query.actorDirection.toArray().map(Math.fround).every(Number.isFinite))
      throw new Error("Native run-away actor direction exceeds Float32 bounds");
  }
}

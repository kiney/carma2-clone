import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import {
  NativePhysicalPathFollower,
  type NativePhysicalPathQuery,
  type NativePhysicalPathResult,
} from "./path-follow";
import { findNearestPathSection } from "./path-geometry";
import { NativeRaceRouteState } from "./race-route-state";

export type NativeCompleteRaceQuery = Omit<
  NativePhysicalPathQuery,
  "ignoreEnd" | "neverStruggle" | "pursuit"
> & {
  cheating: boolean;
};

export interface NativeCompleteRaceHooks {
  /** Synchronous objective dispatch. It may replace the shared route and follower. */
  newGetNearPlayer(): void;
  /** Dispatch the currently active objective after get-near has run. */
  objectiveComplete(): void;
}

export interface NativeCompleteRaceResult {
  transition:
    | "started"
    | "continue"
    | "restarted"
    | "get-near-player"
    | "objective-complete"
    | "empty-return";
  route: ReturnType<NativeRaceRouteState["prepare"]>["entries"];
  follower?: NativePhysicalPathResult;
  forces?: { accForce: number; brakeForce: number };
  rawStatus?: number;
}

/** CompleteRace4aa6a0 coordinator over the shared projected route and Follow record.
 * DIE4aa6ca–4aaadf is an intentional no-op. Native empty-route dispatch reads the
 * uninitialized status at4aa728, so callers must provide that raw value. */
export class NativeCompleteRaceState {
  private followSlot = 0;
  private everMoved = false;
  private started = false;
  private readonly random: () => number;

  constructor(
    private readonly nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
    private readonly race: NativeRaceRouteState,
    follower: NativePhysicalPathFollower,
    random = Math.random,
  ) {
    this.follower = follower;
    this.random = random;
  }
  private readonly follower: NativePhysicalPathFollower;

  get entries() {
    return this.race.route.entries;
  }
  get hasEverMoved(): boolean {
    return this.everMoved;
  }

  setSectionSlot(sectionSlot: number): void {
    this.follower.setSectionSlot(sectionSlot);
    this.followSlot = sectionSlot;
  }

  start(query: NativeCompleteRaceQuery): NativeCompleteRaceResult {
    this.rejectCheating(query);
    const nearest = findNearestPathSection(
      query.position,
      this.nodes,
      this.sections,
    );
    const route = this.race.start(nearest?.section);
    this.follower.start(query.nowMs, 0);
    this.followSlot = 0;
    this.started = true;
    return { transition: "started", route };
  }

  die(): void {}

  run(
    query: NativeCompleteRaceQuery,
    hooks: NativeCompleteRaceHooks,
    rawEmptyRouteStatus?: number,
  ): NativeCompleteRaceResult {
    if (!this.started) throw new Error("Complete-race state has not started");
    this.rejectCheating(query);
    if (Math.fround(query.factor) === 0) {
      const forces = {
        accForce: 0,
        brakeForce: Math.fround(15 * Math.fround(query.mass)),
      };
      const follower = this.follower.run(
        this.nodes,
        this.sections,
        this.entries,
        this.physicalQuery(query),
        this.random,
      );
      return { transition: "continue", route: this.entries, follower, forces };
    }

    const prepared = this.race.prepare(this.followSlot);
    this.followSlot = prepared.sectionSlot;
    this.follower.setSectionSlot(prepared.sectionSlot);
    if (!prepared.entries.length) {
      if (rawEmptyRouteStatus === undefined)
        throw new Error(
          "Complete-race empty route requires an explicit raw status",
        );
      this.validateRawStatus(rawEmptyRouteStatus);
      hooks.newGetNearPlayer();
      if (rawEmptyRouteStatus === 0)
        return {
          transition: "empty-return",
          route: this.entries,
          rawStatus: 0,
        };
      if (rawEmptyRouteStatus === 2) {
        const restarted = this.restart(query);
        return { ...restarted, transition: "get-near-player", rawStatus: 2 };
      }
      hooks.objectiveComplete();
      return {
        transition: "objective-complete",
        route: this.entries,
        rawStatus: rawEmptyRouteStatus,
      };
    }

    const follower = this.follower.run(
      this.nodes,
      this.sections,
      prepared.entries,
      this.physicalQuery(query),
      this.random,
    );
    this.everMoved ||= follower.movedOnTask;
    this.follower.syncCarForces(follower.accForce, follower.brakeForce);
    this.followSlot = follower.geometry.sectionSlot;
    if (follower.kind === "given-up") return this.restart(query, follower);
    return { transition: "continue", route: this.entries, follower };
  }

  /** Native result1 is explicit; physical destination geometry never implies it. */
  onPathEnd(
    query: NativeCompleteRaceQuery,
    hooks: NativeCompleteRaceHooks,
  ): NativeCompleteRaceResult {
    if (!this.started) throw new Error("Complete-race state has not started");
    this.rejectCheating(query);
    hooks.newGetNearPlayer();
    hooks.objectiveComplete();
    return { transition: "objective-complete", route: this.entries };
  }

  private restart(
    query: NativeCompleteRaceQuery,
    follower?: NativePhysicalPathResult,
  ): NativeCompleteRaceResult {
    const nearest = findNearestPathSection(
      query.position,
      this.nodes,
      this.sections,
    );
    const route = this.race.start(nearest?.section);
    this.follower.start(query.nowMs, 0);
    this.followSlot = 0;
    return {
      transition: "restarted",
      route,
      ...(follower ? { follower } : {}),
    };
  }

  private physicalQuery(
    query: NativeCompleteRaceQuery,
  ): NativePhysicalPathQuery {
    return { ...query, ignoreEnd: false, neverStruggle: false, pursuit: false };
  }

  private rejectCheating(query: NativeCompleteRaceQuery): void {
    if (query.cheating)
      throw new Error(
        "Cheaty following is not implemented by complete-race state",
      );
  }

  private validateRawStatus(status: number): void {
    if (!Number.isInteger(status) || status < 0 || status > 0xffffffff)
      throw new Error("Invalid complete-race raw empty-route status");
  }
}

import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import {
  NativePhysicalPathFollower,
  type NativePhysicalPathQuery,
  type NativePhysicalPathResult,
} from "./path-follow";
import { NativeProjectedRoute, type ProjectedPathSection } from "./path-route";
import {
  NativeTargetAcquisition,
  type NativeTargetSectionCache,
} from "./target-acquisition";

export type NativeGetNearPlayerQuery = Omit<
  NativePhysicalPathQuery,
  "ignoreEnd" | "neverStruggle" | "pursuit"
> & {
  /** Original ACT matrix row2 used by native route seeding. */
  actorRow2: Vector3;
  targetPosition: Vector3;
  cheating: boolean;
  strength: number;
  /** Packed opponent flags supply the native adjacent-slot read. */
  opponentFlags: number;
};

export interface NativeGetNearPlayerResult {
  transition: "started" | "continue" | "pursue" | "restarted";
  targetCache: NativeTargetSectionCache;
  route: readonly ProjectedPathSection[];
  follower?: NativePhysicalPathResult;
}

function acquisitionQuery(query: NativeGetNearPlayerQuery, force: boolean) {
  return {
    nowMs: query.nowMs,
    position: query.position,
    velocity: query.velocity,
    actorRow2: query.actorRow2,
    targetPosition: query.targetPosition,
    force,
    cheating: query.cheating,
    strength: query.strength,
    opponentFlags: query.opponentFlags,
  };
}

function physicalQuery(
  query: NativeGetNearPlayerQuery,
): NativePhysicalPathQuery {
  return {
    position: query.position,
    velocity: query.velocity,
    dtMs: query.dtMs,
    nowMs: query.nowMs,
    maxCurve: query.maxCurve,
    mass: query.mass,
    factor: query.factor,
    engineDamage: query.engineDamage,
    transmissionDamage: query.transmissionDamage,
    ignoreEnd: false,
    neverStruggle: false,
    pursuit: false,
    currentCurvature: query.currentCurvature,
  };
}

/** Regular-opponent ProcessGetNearPlayer coordinator around the independently
 * reconstructed acquisition and physical-follower components.
 *
 * The caller owns the player-shared target cache, packed opponent flags,
 * objective dispatch, physics force application, and any cheaty follower.
 * Cheaty following is not implemented by this coordinator.
 * `onPathEnd` is for an explicit native result-1 notification; this physical
 * follower never infers path end from distance or route geometry. */
export class NativeGetNearPlayerState {
  private readonly acquisition: NativeTargetAcquisition;
  private readonly random: () => number;
  private followSlot = 0;
  private started = false;

  constructor(
    private readonly nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
    /** Per-opponent backing shared with complete-race and pursuit objectives. */
    private readonly route: NativeProjectedRoute,
    /** Per-opponent Follow record shared across objective transitions. */
    private readonly follower: NativePhysicalPathFollower,
    random = Math.random,
    acquisition?: NativeTargetAcquisition,
  ) {
    this.acquisition =
      acquisition ?? new NativeTargetAcquisition(nodes, sections);
    this.random = random;
  }

  get entries(): readonly ProjectedPathSection[] {
    return this.route.entries;
  }

  /** The external cheaty movement dispatcher advances this same native
   * cursor. Synchronize it before objective prefix shifting or physical reuse. */
  setSectionSlot(sectionSlot: number): void {
    this.follower.setSectionSlot(sectionSlot);
    this.followSlot = sectionSlot;
  }

  /** Installed ProcessGetNearPlayerStart: force acquisition, then Follow Start. */
  start(
    query: NativeGetNearPlayerQuery,
    targetCache: NativeTargetSectionCache,
  ): NativeGetNearPlayerResult {
    const updatedCache = this.acquisition.acquire(
      this.route,
      acquisitionQuery(query, true),
      targetCache,
      this.random,
    );
    this.follower.start(query.nowMs, 0);
    this.followSlot = 0;
    this.started = true;
    return {
      transition: "started",
      targetCache: updatedCache,
      route: this.route.entries,
    };
  }

  /** Run the regular physical GetNearPlayer branch. Native result 2 requests
   * PursuePlayer; result 1 is handled only by the explicit onPathEnd method. */
  run(
    query: NativeGetNearPlayerQuery,
    targetCache: NativeTargetSectionCache,
  ): NativeGetNearPlayerResult {
    if (!this.started) throw new Error("Get-near-player state has not started");
    if (query.cheating)
      throw new Error(
        "Cheaty following is not implemented by this coordinator",
      );

    // The installed outer freeze dispatcher prevents objective advancement.
    // Preserve the cursor and route if this adapter is nevertheless called in
    // that state; the follower emits the native braking force without stepping.
    if (Math.fround(query.factor) === 0) {
      const follower = this.follower.run(
        this.nodes,
        this.sections,
        this.route.entries,
        physicalQuery(query),
        this.random,
      );
      return {
        transition: "continue",
        targetCache: { ...targetCache },
        route: this.route.entries,
        follower,
      };
    }

    // GetNearPlayer shifts a consumed projected prefix before acquisition.
    // Its follow cursor resets even when the native route shift refuses.
    if (this.followSlot > 0) {
      this.route.shift(this.followSlot);
      this.followSlot = 0;
      this.follower.setSectionSlot(0);
    }
    let updatedCache = { ...targetCache };
    if (this.route.entries.length <= 10) {
      updatedCache = this.acquisition.acquire(
        this.route,
        acquisitionQuery(query, false),
        updatedCache,
        this.random,
      );
    }

    const follower = this.follower.run(
      this.nodes,
      this.sections,
      this.route.entries,
      physicalQuery(query),
      this.random,
    );
    this.followSlot = follower.geometry.sectionSlot;
    return {
      transition: follower.kind === "given-up" ? "pursue" : "continue",
      targetCache: updatedCache,
      route: this.route.entries,
      follower,
    };
  }

  /** Handle an externally reported native result 1: force route acquisition,
   * then restart Follow at slot zero. No physical-arrival heuristic is added. */
  onPathEnd(
    query: NativeGetNearPlayerQuery,
    targetCache: NativeTargetSectionCache,
  ): NativeGetNearPlayerResult {
    if (!this.started) throw new Error("Get-near-player state has not started");
    // Native result1 is produced by cheaty following. The external movement
    // dispatcher may notify this handler while the opponent still cheats;
    // acquisition must retain that mode's type2 path eligibility.
    const updatedCache = this.acquisition.acquire(
      this.route,
      acquisitionQuery(query, true),
      targetCache,
      this.random,
    );
    this.follower.start(query.nowMs, 0);
    this.followSlot = 0;
    return {
      transition: "restarted",
      targetCache: updatedCache,
      route: this.route.entries,
    };
  }
}

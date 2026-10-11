import {
  NativeFollowLifecycle,
  NativeObjectiveFollowBridge,
  type NativeFollowLifecycleHooks,
  type NativeFollowLifecycleResult,
  type NativeObjectiveFollowQuery,
} from "./follow-lifecycle";
import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { findNativeTrailSection } from "./trail-nearest";
import {
  NativePhysicalPathFollower,
  type NativePhysicalPathQuery,
  type NativePhysicalPathResult,
} from "./path-follow";
import { NativePathView } from "./path-view";
import {
  nativePursuitPrediction,
  nativePursuitReverse,
} from "./pursuit-motion";

export interface NativePursuitQuery
  extends Omit<
    NativePhysicalPathQuery,
    "pursuit" | "ignoreEnd" | "neverStruggle"
  > {
  targetPosition: Vector3;
  targetVelocity: Vector3;
  targetTrail: readonly Vector3[];
  /** Original world graph retained by the installed trail projection quirk. */
  worldPathNodes: readonly Vector3[];
  worldPathSections: readonly TrackPathSection[];
  trailShifted: boolean;
  /** Installed opponent+18, not recomputed from the predicted target. */
  playerDistance: number;
  grudge: number;
  personality: number;
  playerInView: boolean;
  cheating: boolean;
  physical?: boolean;
  followHooks?: NativeFollowLifecycleHooks;
  /** Bind local route slots to the active direct/trail virtual section IDs. */
  followHooksForView?: (view: NativePathView) => NativeFollowLifecycleHooks;
  /** Explicit result1 notification; physical follower does not infer arrival. */
  pathEnded: boolean;
}

export interface NativePursuitSnapshot {
  state: 0 | 1 | 2 | 3;
  currentSection: number;
  nextVisibilityCheckMs: number;
  backupStartMs: number;
  lastTwattedMs: number;
  lastVisibleMs: number;
  lastAwayMs: number;
  directLength: number;
}

export interface NativePursuitResult {
  kind: "driving" | "get-near-player" | "objective-complete";
  snapshot: NativePursuitSnapshot;
  view?: NativePathView;
  follower?: NativePhysicalPathResult;
  follow?: NativeFollowLifecycleResult;
  rawStatus?: 0 | 1 | 2;
  forces?: { curvature: number; accForce: number; brakeForce: number };
}

export type NativePursuitRay = (origin: Vector3, direction: Vector3) => number;
const deadline = (start: number, duration: number) => (start + duration) >>> 0;
const stored = (v: Vector3) =>
  new Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
function time(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("Invalid native pursuit timestamp");
}

/** Independent installed ProcessPursueAndTwat4aaf30 physical dispatcher.
 * The caller owns the shared follower, trail recorder and objective changes.
 * The shared Follow lifecycle handles physical/cheaty dispatch and placement. */
export class NativePursuitState {
  private data: NativePursuitSnapshot = {
    state: 0,
    currentSection: 20000,
    nextVisibilityCheckMs: 0,
    backupStartMs: 0,
    lastTwattedMs: 0,
    lastVisibleMs: 0,
    lastAwayMs: 0,
    directLength: 0,
  };
  private initialized = false;

  private readonly follower: NativeObjectiveFollowBridge;
  constructor(follower: NativePhysicalPathFollower | NativeFollowLifecycle) {
    this.follower = new NativeObjectiveFollowBridge(follower);
  }

  get snapshot(): NativePursuitSnapshot {
    return { ...this.data };
  }

  /** START4ab5a2 leaves the shared follow record untouched. */
  start(nowMs: number, currentSection: number): void {
    time(nowMs);
    if (
      !Number.isInteger(currentSection) ||
      currentSection < -32768 ||
      currentSection > 32767
    )
      throw new Error("Invalid native pursuit current section");
    this.data = {
      ...this.data,
      state: 0,
      currentSection,
      nextVisibilityCheckMs: 0,
      backupStartMs: 0,
      lastTwattedMs: 0,
      lastVisibleMs: 0,
      lastAwayMs: nowMs,
    };
    this.initialized = true;
  }

  /** DIE2 returns directly at4aaf49; it does not stop the shared trail. */
  die(): void {}

  /** Caller must apply the verified impact-attribution guard before notifying. */
  notifyTwatted(nowMs: number): void {
    time(nowMs);
    this.data.lastTwattedMs = nowMs;
  }

  run(
    query: NativePursuitQuery,
    ray: NativePursuitRay,
    random = Math.random,
  ): NativePursuitResult {
    if (!this.initialized) throw new Error("Native pursuit has not started");
    time(query.nowMs);
    if (
      !this.follower.supportsModeTransitions &&
      (query.cheating || query.physical === false)
    )
      throw new Error(
        "Native nonphysical pursuit requires NativeFollowLifecycle",
      );
    if (Math.fround(query.factor) === 0)
      throw new Error("Native frozen opponents must bypass pursuit dispatch");
    if (
      !Number.isFinite(Math.fround(query.playerDistance)) ||
      query.playerDistance < 0 ||
      !Number.isInteger(query.grudge) ||
      query.grudge < 0 ||
      query.grudge > 255 ||
      !Number.isInteger(query.personality) ||
      ![
        query.position,
        query.velocity,
        query.targetPosition,
        query.targetVelocity,
      ].every((v) => stored(v).toArray().every(Number.isFinite))
    )
      throw new Error("Invalid native pursuit query");
    const now = query.nowMs;
    const distance = Math.fround(query.playerDistance);
    this.data.directLength = Math.max(distance, 3);
    if (distance > 3) this.data.lastAwayMs = now;
    if (query.personality !== 3 && query.grudge < 15)
      return this.result("objective-complete");

    if (this.data.state !== 3) {
      const velocity = stored(query.targetVelocity);
      const targetSpeed = Math.sqrt(
        velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2,
      );
      if (
        now > deadline(this.data.lastTwattedMs, 1000) &&
        now < deadline(this.data.lastTwattedMs, 3000) &&
        targetSpeed < Math.fround(0.043478261679410934)
      )
        this.beginReverse(now);
      else if (
        now > deadline(this.data.lastAwayMs, 7000) &&
        now > deadline(this.data.lastTwattedMs, 7000) &&
        now > deadline(this.data.backupStartMs, 10000)
      )
        this.beginReverse(now);
      else {
        if (query.playerInView) {
          this.data.lastVisibleMs = now;
          this.data.nextVisibilityCheckMs = deadline(now, 900);
        } else if (
          now > this.data.nextVisibilityCheckMs &&
          distance < 35 &&
          this.visible(query.targetPosition, query.position, ray)
        ) {
          this.data.lastVisibleMs = now;
          this.data.nextVisibilityCheckMs = deadline(now, 900);
        }
        if (now < deadline(this.data.lastVisibleMs, 3000)) {
          if (this.data.state !== 2) {
            this.data.state = 2;
            this.data.currentSection = 10000;
            const prediction = nativePursuitPrediction(
              query.position,
              query.targetPosition,
              query.velocity,
              query.targetVelocity,
            );
            const view = NativePathView.direct(
              prediction.start,
              prediction.finish,
            );
            this.follower.start(this.followQuery(query, view, true, false), 0);
          }
        } else {
          if (query.targetTrail.length < 2)
            return this.result("get-near-player");
          if (this.data.state !== 1) {
            this.data.state = 1;
            const view = NativePathView.trail(query.targetTrail);
            if (!this.acquireTrail(query, view, now))
              return this.result("get-near-player");
          }
        }
      }
    }

    if (this.data.state === 3) {
      const forces = nativePursuitReverse(
        now,
        this.data.backupStartMs,
        query.mass,
        query.currentCurvature,
      );
      this.follower.syncCarForces(forces.accForce, forces.brakeForce);
      if (forces.finished) this.data.state = 0;
      return { ...this.result("driving"), forces };
    }
    let view: NativePathView;
    let neverStruggle = false;
    if (this.data.state === 2) {
      const prediction = nativePursuitPrediction(
        query.position,
        query.targetPosition,
        query.velocity,
        query.targetVelocity,
      );
      view = NativePathView.direct(prediction.start, prediction.finish);
      neverStruggle = prediction.distance < 2;
    } else if (this.data.state === 1) {
      view = NativePathView.trail(query.targetTrail);
      //4ab380: shifting is handled only when the target marks this frame.
      if (query.trailShifted) {
        if (this.data.currentSection > 15000) {
          this.data.currentSection--;
          this.follower.setSectionSlot(
            view.localSlot(this.data.currentSection),
          );
        } else {
          const nearest = findNativeTrailSection(
            view.nodes,
            stored(query.position),
            query.worldPathNodes,
            query.worldPathSections,
          );
          if (
            !nearest ||
            nearest.distance > 20 ||
            !this.visible(nearest.intersection, query.position, ray)
          )
            return this.result("get-near-player");
          this.data.currentSection = nearest.section;
          this.follower.start(
            this.followQuery(query, view, false, false),
            nearest.sectionSlot,
          );
        }
      }
    } else
      throw new Error("Native pursuit classification did not select a path");
    const result = this.follower.run(
      view.nodes,
      view.sections,
      view.route,
      this.followQuery(query, view, this.data.state === 2, neverStruggle),
      random,
    );
    this.data.currentSection =
      result.sectionSlot < 0 ? -1 : view.nativeId(result.sectionSlot);
    if (
      this.data.state === 1 &&
      (result.rawStatus === 1 || result.rawStatus === 2 || query.pathEnded)
    )
      return { ...this.result("get-near-player"), view, ...result };
    return {
      ...this.result("driving"),
      view,
      ...result,
      ...(result.follower
        ? {
            forces: {
              curvature: result.follower.curvature,
              accForce: result.follower.accForce,
              brakeForce: result.follower.brakeForce,
            },
          }
        : {}),
    };
  }

  private beginReverse(now: number): void {
    this.data.backupStartMs = now;
    this.data.state = 3;
  }

  private acquireTrail(
    query: NativePursuitQuery,
    view: NativePathView,
    now: number,
  ): boolean {
    const nearest = findNativeTrailSection(
      view.nodes,
      stored(query.position),
      query.worldPathNodes,
      query.worldPathSections,
    );
    if (!nearest || nearest.distance > 20) return false;
    this.data.currentSection = nearest.section;
    this.follower.start(
      this.followQuery(query, view, false, false),
      nearest.sectionSlot,
    );
    return true;
  }

  private followQuery(
    query: NativePursuitQuery,
    view: NativePathView,
    ignoreEnd: boolean,
    neverStruggle: boolean,
  ): NativeObjectiveFollowQuery {
    return {
      ...query,
      pursuit: true,
      ignoreEnd,
      neverStruggle,
      routeCapacity: view.kind === "trail" ? 24 : 12,
      followHooks: query.followHooksForView?.(view) ?? query.followHooks,
    };
  }

  private visible(from: Vector3, to: Vector3, ray: NativePursuitRay): boolean {
    const origin = stored(from),
      destination = stored(to);
    const direction = destination.sub(origin);
    direction.set(
      Math.fround(direction.x),
      Math.fround(direction.y + Math.fround(0.15)),
      Math.fround(direction.z),
    );
    origin.y = Math.fround(origin.y + Math.fround(0.15));
    const fraction = ray(origin, direction);
    if (!Number.isFinite(fraction))
      throw new Error("Invalid native pursuit visibility fraction");
    return fraction > 1;
  }

  private result(kind: NativePursuitResult["kind"]): NativePursuitResult {
    return { kind, snapshot: this.snapshot };
  }
}

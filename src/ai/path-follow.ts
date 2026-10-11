import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import {
  NativeOpponentSpeedController,
  approachOpponentCurvature,
  type OpponentSpeedResult,
} from "../physics/opponent-speed";
import type { ProjectedPathSection } from "./path-route";
import {
  stepNativeFollowGeometry,
  type NativeFollowGeometryState,
} from "./path-follow-geometry";
import { nativeStruggleTiming } from "./path-struggle";

export interface NativePhysicalPathQuery {
  position: Vector3;
  velocity: Vector3;
  dtMs: number;
  nowMs: number;
  maxCurve: number;
  mass: number;
  factor: number;
  engineDamage: number;
  transmissionDamage: number;
  ignoreEnd: boolean;
  neverStruggle: boolean;
  pursuit: boolean;
  currentCurvature: number;
}

export interface NativePhysicalPathResult {
  kind: "ok" | "given-up";
  madeIt: boolean;
  movedOnTask: boolean;
  struggleCount: number;
  geometry: NativeFollowGeometryState;
  curvature: number;
  accForce: number;
  brakeForce: number;
  speed?: OpponentSpeedResult;
}

/** Installed4af7e0–4af91a: infinite-line distance with mixed x87/single
 * stores. The last store is required for the inclusive authored-width test. */
export function nativeBorrowedPathDistance(
  position: Vector3,
  start: Vector3,
  finish: Vector3,
): number {
  if (
    ![position, start, finish].every((v) => v.toArray().every(Number.isFinite))
  )
    throw new Error("Invalid borrowed-time path geometry");
  const sx = Math.fround(start.x),
    sy = Math.fround(start.y),
    sz = Math.fround(start.z);
  const dx = Math.fround(Math.fround(finish.x) - sx);
  const dy = Math.fround(Math.fround(finish.y) - sy);
  const dz = Math.fround(Math.fround(finish.z) - sz);
  const rx = Math.fround(Math.fround(position.x) - sx);
  const ry = Math.fround(Math.fround(position.y) - sy);
  const rz = Math.fround(position.z) - sz;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared === 0 || !Number.isFinite(lengthSquared))
    throw new Error("Degenerate borrowed-time path section");
  const t = (rx * dx + ry * dy + rz * dz) / lengthSquared;
  const residualX = rx - t * dx;
  const residualY = ry - t * dy;
  const residualZ = rz - t * dz;
  return Math.fround(
    Math.sqrt(
      residualX * Math.fround(residualX) +
        residualY * Math.fround(residualY) +
        residualZ * residualZ,
    ),
  );
}

/** Physical ProcessFollowPath state. Objective-specific route transitions and
 * force application remain with the caller. */
export class NativePhysicalPathFollower {
  private readonly controller = new NativeOpponentSpeedController();
  private geometry: NativeFollowGeometryState = {
    sectionSlot: 0,
    desiredSpeed: 0,
    escape: { timeMs: 0, flipped: false },
  };
  private initialized = false;
  private struggleStartMs = 0;
  private lastStruggleFinishMs = 0;
  private borrowedStartMs = 0;
  private lastStruggleSection = -1;
  private struggleCount = 0;
  private movedOnTask = false;
  private madeIt = true;
  private accForce = 0;
  private brakeForce = 0;
  private curvature = 0;

  /** Native Start resets timing and PID fields but preserves desired speed,
   * escape state and the packed struggle count across reused follow records. */
  start(nowMs: number, sectionSlot = 0): void {
    this.checkTime(nowMs);
    if (!Number.isInteger(sectionSlot) || sectionSlot < 0)
      throw new Error("Invalid native follow section slot");
    this.geometry = {
      sectionSlot,
      desiredSpeed: this.geometry.desiredSpeed,
      escape: { ...this.geometry.escape },
    };
    this.movedOnTask = false;
    this.struggleStartMs = 0;
    this.lastStruggleFinishMs = nowMs;
    this.borrowedStartMs = nowMs;
    this.lastStruggleSection = -1;
    this.madeIt = true;
    this.controller.reset();
    this.initialized = true;
  }

  /** Complete-race objective code owns when the persistent cursor advances. */
  setSectionSlot(sectionSlot: number): void {
    if (!Number.isInteger(sectionSlot) || sectionSlot < 0)
      throw new Error("Invalid native follow section slot");
    this.geometry = { ...this.geometry, sectionSlot };
  }

  /** Native forces live on the car, shared with reverse, freeze and wheel
   * processing. Borrowed-time result2 preserves those current car fields;
   * copying them must not change PID history or objective timing. */
  syncCarForces(accForce: number, brakeForce: number): void {
    const acceleration = Math.fround(accForce);
    const braking = Math.fround(brakeForce);
    if (![acceleration, braking].every(Number.isFinite))
      throw new Error("Invalid native shared car forces");
    this.accForce = acceleration;
    this.brakeForce = braking;
  }

  run(
    nodes: readonly Vector3[],
    sections: readonly TrackPathSection[],
    route: readonly ProjectedPathSection[],
    query: NativePhysicalPathQuery,
    random = Math.random,
  ): NativePhysicalPathResult {
    if (!this.initialized)
      throw new Error("Native path follower has not started");
    this.validateQuery(query);
    const { nowMs, mass } = query;

    // The installed outer opponent dispatcher handles freeze before it calls
    // ProcessFollowPath. Emit the native brake command without advancing any
    // path, struggle, escape, or controller state.
    if (Math.fround(query.factor) === 0) {
      return {
        ...this.result("ok", query.currentCurvature),
        accForce: 0,
        brakeForce: Math.fround(15 * Math.fround(mass)),
      };
    }

    // Borrowed time is tested against the full 3D infinite authored line before
    // speed, forces or geometry are changed. The line parameter is unbounded.
    if (!this.madeIt) {
      const retryBegins = (this.borrowedStartMs + 1000) >>> 0;
      const retryEnds = (this.borrowedStartMs + 10000) >>> 0;
      if (!query.ignoreEnd && nowMs > retryBegins && nowMs < retryEnds) {
        const entry = route[this.geometry.sectionSlot];
        const section = entry && sections[entry.section];
        const a = section && nodes[section.nodeIndices[0]];
        const b = section && nodes[section.nodeIndices[1]];
        if (!a || !b) throw new Error("Invalid borrowed-time path section");
        if (nativeBorrowedPathDistance(query.position, a, b) <= section.width)
          this.madeIt = true;
      }
      if (!this.madeIt && nowMs > retryEnds) {
        return this.result("given-up", query.currentCurvature);
      }
    }

    const vx = Math.fround(query.velocity.x);
    const vy = Math.fround(query.velocity.y);
    const vz = Math.fround(query.velocity.z);
    const liveSpeed = Math.sqrt(vx * vx + vy * vy + vz * vz) * 6.9;
    const speed = Math.fround(liveSpeed);
    if (!Number.isFinite(speed))
      throw new Error("Native path speed exceeds Float32 bounds");
    if (liveSpeed > Math.fround(0.2)) this.movedOnTask = true;

    if (this.struggleStartMs !== 0) {
      const timing = nativeStruggleTiming(
        nowMs,
        this.struggleStartMs,
        this.struggleCount,
        mass,
      );
      if (timing.stop) {
        this.madeIt = false;
        this.borrowedStartMs = nowMs;
        this.struggleStartMs = 0;
        this.lastStruggleFinishMs = nowMs;
        this.accForce = 0;
        this.brakeForce = 0;
      } else {
        this.accForce = timing.brake ? 0 : Math.fround(-6 * Math.fround(mass));
        this.brakeForce = timing.brake
          ? Math.fround(15 * Math.fround(mass))
          : 0;
        this.curvature = approachOpponentCurvature(
          query.currentCurvature,
          0,
          query.dtMs,
        );
        return this.result("ok", this.curvature);
      }
    } else if (
      !query.neverStruggle &&
      speed <= Math.fround(query.ignoreEnd ? 2 / 30 : 0.2) &&
      nowMs > (this.lastStruggleFinishMs + 2000) >>> 0 &&
      (query.pursuit || this.movedOnTask)
    ) {
      this.struggleStartMs = nowMs;
      if (
        query.ignoreEnd ||
        this.geometry.sectionSlot !== this.lastStruggleSection
      ) {
        this.lastStruggleSection = this.geometry.sectionSlot;
        this.struggleCount = 0;
      } else if (this.struggleCount >= 3) {
        this.accForce = 0;
        this.brakeForce = 0;
        return this.result("given-up", query.currentCurvature);
      } else {
        this.struggleCount = (this.struggleCount + 1) & 0xff;
      }
    }

    const stepped = stepNativeFollowGeometry(
      nodes,
      sections,
      route,
      this.geometry,
      query,
      random,
    );
    this.geometry = stepped.state;
    this.curvature = approachOpponentCurvature(
      query.currentCurvature,
      stepped.curvature,
      query.dtMs,
    );
    const control = this.controller.update({
      desiredSpeed: this.geometry.desiredSpeed,
      velocity: query.velocity,
      factor: query.factor,
      engineDamage: query.engineDamage,
      transmissionDamage: query.transmissionDamage,
      mass,
      dtMs: query.dtMs,
    });
    this.accForce = control.accForce;
    this.brakeForce = control.brakeForce;
    return { ...this.result("ok", this.curvature), speed: control };
  }

  private result(
    kind: "ok" | "given-up",
    curvature: number,
  ): NativePhysicalPathResult {
    return {
      kind,
      madeIt: this.madeIt,
      movedOnTask: this.movedOnTask,
      struggleCount: this.struggleCount,
      geometry: {
        ...this.geometry,
        escape: { ...this.geometry.escape },
        corner: this.geometry.corner && {
          ...this.geometry.corner,
          center: this.geometry.corner.center.clone(),
        },
      },
      curvature,
      accForce: this.accForce,
      brakeForce: this.brakeForce,
    };
  }

  private checkTime(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error("Invalid native follow timestamp");
  }

  private validateQuery(query: NativePhysicalPathQuery): void {
    this.checkTime(query.nowMs);
    if (
      ![
        ...query.position.toArray(),
        ...query.velocity.toArray(),
        query.dtMs,
        query.maxCurve,
        query.mass,
        query.factor,
        query.currentCurvature,
      ].every(Number.isFinite) ||
      query.dtMs <= 0 ||
      query.mass <= 0 ||
      query.maxCurve < 0 ||
      !Number.isInteger(query.engineDamage) ||
      query.engineDamage < 0 ||
      query.engineDamage > 100 ||
      !Number.isInteger(query.transmissionDamage) ||
      query.transmissionDamage < 0 ||
      query.transmissionDamage > 100
    )
      throw new Error("Invalid native physical path query");
  }
}

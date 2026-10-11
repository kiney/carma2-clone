import { Vector3 } from "three";

export interface NativeLevitateQuery {
  nowMs: number;
  dtMs: number;
  mass: number;
  velocity: Vector3;
  angularVelocity: Vector3;
  actorY: number;
}
export interface NativeLevitateResult {
  settling: boolean;
  accForce: number;
  brakeForce: number;
  angularVelocity?: Vector3;
  /** Zero the native motion/control slots and all collision velocities. */
  stopAndTurnPhysicsOff?: true;
  actorY?: number;
  height?: number;
  finishedForRace?: true;
}
function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function stored(value: Vector3): Vector3 {
  return new Vector3(
    Math.fround(value.x),
    Math.fround(value.y),
    Math.fround(value.z),
  );
}

/** Installed ProcessLevitate4ac2e0. START begins physical settling; RUN then
 * disables physics and raises the stolen car along its original world Y. */
export class NativeLevitateState {
  private settling = true;
  private started = false;
  private startMs = 0;
  private baseY = 0;
  get snapshot() {
    return {
      settling: this.settling,
      startMs: this.startMs,
      baseY: this.baseY,
    };
  }
  start(nowMs: number, mass: number): NativeLevitateResult {
    if (
      !uint(nowMs) ||
      !Number.isFinite(Math.fround(mass)) ||
      Math.fround(mass) <= 0
    )
      throw new Error("Invalid native levitation initialization");
    this.startMs = nowMs;
    this.settling = true;
    this.started = true;
    return {
      settling: true,
      accForce: 0,
      brakeForce: Math.fround(Math.fround(mass) * 15),
    };
  }
  die(): void {}
  run(query: NativeLevitateQuery): NativeLevitateResult {
    const velocity = stored(query.velocity),
      angular = stored(query.angularVelocity),
      mass = Math.fround(query.mass);
    if (
      !this.started ||
      !uint(query.nowMs) ||
      !uint(query.dtMs) ||
      ![
        ...velocity.toArray(),
        ...angular.toArray(),
        mass,
        Math.fround(query.actorY),
      ].every(Number.isFinite) ||
      mass <= 0
    )
      throw new Error("Invalid native levitation query");
    if (this.settling) {
      const stopped =
        Math.sqrt(velocity.lengthSq()) < Math.fround(0.0014492754125967622) &&
        Math.sqrt(angular.lengthSq()) < 1;
      const elapsed = (query.nowMs - this.startMs) >>> 0;
      if (!stopped && elapsed <= 4000) {
        // Each divide retains POW's live result until the F32 component store.
        const decay = Math.pow(2, query.dtMs * 0.001);
        angular.set(
          Math.fround(angular.x / decay),
          Math.fround(angular.y / decay),
          Math.fround(angular.z / decay),
        );
        return {
          settling: true,
          accForce: 0,
          brakeForce: Math.fround(mass * 15),
          angularVelocity: angular,
        };
      }
      this.settling = false;
      this.startMs = query.nowMs;
      this.baseY = Math.fround(query.actorY);
      return { ...this.rising(query.nowMs), stopAndTurnPhysicsOff: true };
    }
    return this.rising(query.nowMs);
  }
  private rising(nowMs: number): NativeLevitateResult {
    const elapsed = ((nowMs - this.startMs) >>> 0) * 0.001;
    const height =
      elapsed < 20
        ? elapsed * elapsed * Math.fround(0.25)
        : (elapsed - Math.fround(20)) * 10 - -100;
    return {
      settling: false,
      accForce: 0,
      brakeForce: 0,
      actorY: Math.fround(this.baseY + height),
      height,
      ...(height > Math.fround(200) ? { finishedForRace: true as const } : {}),
    };
  }
}

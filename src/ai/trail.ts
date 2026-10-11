import { Vector3 } from "three";

const f32 = Math.fround;
const u32 = (value: number) => value >>> 0;
const COS_30 = 0.8660249710083008;
const MIN_HORIZONTAL_LENGTH = 2 ** -22;
const NODE_CAPACITY = 25;

export interface NativeTrailSnapshot {
  nodes: readonly Vector3[];
  baseHeading: Vector3;
  nextRecordingMs: number;
  deviated: boolean;
  shiftedThisFrame: boolean;
  recordingCount: number;
}

export interface TrailRecordResult {
  sampled: boolean;
  added: boolean;
  visible?: boolean;
  distance?: number;
  snapshot: NativeTrailSnapshot;
}

export type TrailRayClear = (from: Vector3, to: Vector3) => boolean;

const storeVector = (v: Vector3) => new Vector3(f32(v.x), f32(v.y), f32(v.z));
const finiteVector = (v: Vector3) => v.toArray().every(Number.isFinite);

function validateVector(v: Vector3, label: string): void {
  if (!finiteVector(v) || !finiteVector(storeVector(v)))
    throw new Error(`Invalid native trail ${label}`);
}

export function nativeTrailSideOffset(from: Vector3, to: Vector3): Vector3 {
  validateVector(from, "side origin");
  validateVector(to, "side endpoint");
  // Installed401fe0 retains live deltas and compares live length, but
  // normalizes using its Float32 spill. Its first side is (+dz,0,-dx).
  const a = storeVector(from),
    b = storeVector(to);
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const length = Math.sqrt(dx * f32(dx) + dz * dz);
  let side: Vector3;
  if (length <= MIN_HORIZONTAL_LENGTH) side = new Vector3(1, 0, 0);
  else
    side = storeVector(new Vector3(dz, 0, -dx).multiplyScalar(1 / f32(length)));
  return storeVector(side.multiplyScalar(f32(0.5)));
}

function dotNativeZyx(a: Vector3, b: Vector3): number {
  // The installed x87 expression accumulates z, then y, then x.
  return a.z * b.z + a.y * b.y + a.x * b.x;
}

/** Player/opponent path trail as recorded by installed MungeOpponents.
 * Visibility is supplied by the caller because it depends on the real world
 * ray query and its FindFace collision semantics. */
export class NativeOpponentTrail {
  private nodes: Vector3[] = [];
  private baseHeading = new Vector3();
  private nextRecordingMs = 0;
  private deviated = false;
  private shiftedThisFrame = false;
  private recordingCount = 0;

  get snapshot(): NativeTrailSnapshot {
    return {
      nodes: this.nodes.map((node) => node.clone()),
      baseHeading: this.baseHeading.clone(),
      nextRecordingMs: this.nextRecordingMs,
      deviated: this.deviated,
      shiftedThisFrame: this.shiftedThisFrame,
      recordingCount: this.recordingCount,
    };
  }

  /** Installed StartRecordingTrail4aa230. Additional pursuers attach without
   * resetting the shared trail data. */
  start(
    actorPosition: Vector3,
    direction: Vector3,
    nowMs: number,
  ): NativeTrailSnapshot {
    validateVector(actorPosition, "actor position");
    validateVector(direction, "heading");
    if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffff)
      throw new Error("Invalid native trail timestamp");

    if (this.recordingCount > 0) {
      this.recordingCount = u32(this.recordingCount + 1);
      return this.snapshot;
    }

    const actor = storeVector(actorPosition);
    const first = actor.clone();
    // Installed binary subtracts -0.2f at 0x589528 from node0.z.
    first.z = f32(first.z + f32(0.2));
    this.nodes = [first, actor.clone()];
    this.baseHeading = storeVector(direction);
    this.nextRecordingMs = u32(nowMs + 500);
    this.deviated = false;
    this.shiftedThisFrame = false;
    this.recordingCount = 1;
    return this.snapshot;
  }

  /** Installed inlined recorder4a9c26–4a9f2e. Deadline comparison is an
   * unsigned absolute comparison and the deadline resets to now+500. */
  record(
    actorPosition: Vector3,
    direction: Vector3,
    nowMs: number,
    rayClear?: TrailRayClear,
  ): TrailRecordResult {
    validateVector(actorPosition, "actor position");
    validateVector(direction, "heading");
    if (
      !Number.isInteger(nowMs) ||
      nowMs < 0 ||
      nowMs > 0xffffffff ||
      this.recordingCount === 0 ||
      this.nodes.length < 2
    )
      throw new Error("Invalid native trail recording state");

    this.shiftedThisFrame = false;
    if (nowMs <= this.nextRecordingMs)
      return { sampled: false, added: false, snapshot: this.snapshot };

    this.nextRecordingMs = u32(nowMs + 500);
    const actor = storeVector(actorPosition);
    const heading = storeVector(direction);
    if (f32(dotNativeZyx(heading, this.baseHeading)) < COS_30)
      this.deviated = true;

    const anchor = this.nodes[this.nodes.length - 2];
    // Installed4a9cce–4a9d0f keeps X/Y differences live while spilling copies
    // for their products; Z is squared live. The early comparison is live,
    // whereas the later spacing comparisons use the stored distance.
    const dx = anchor.x - actor.x,
      dy = anchor.y - actor.y,
      dz = anchor.z - actor.z;
    const liveDistance = Math.sqrt(dx * f32(dx) + dy * f32(dy) + dz * dz);
    const distance = f32(liveDistance);
    if (liveDistance < f32(0.3)) {
      // Native early return leaves the last node untouched.
      return { sampled: true, added: false, distance, snapshot: this.snapshot };
    }
    if (!rayClear && !this.deviated)
      throw new Error("Native trail visibility callback is required");

    let visible = true;
    if (!this.deviated) {
      const side = nativeTrailSideOffset(anchor, actor);
      const plus = storeVector(anchor.clone().add(side));
      const plusEnd = storeVector(actor.clone().add(side));
      visible = rayClear!(plus, plusEnd);
      if (visible) {
        const minus = storeVector(anchor.clone().sub(side));
        const minusEnd = storeVector(actor.clone().sub(side));
        visible = rayClear!(minus, minusEnd);
        if (visible) visible = rayClear!(anchor.clone(), actor.clone());
      }
    }

    let added = false;
    if (this.deviated || !visible) {
      const spacingOk =
        (visible && distance > f32(2.0)) || (!visible && distance > f32(1.5));
      if (spacingOk) {
        if (this.nodes.length < NODE_CAPACITY) this.nodes.push(actor.clone());
        else {
          this.nodes.copyWithin(0, 1);
          this.nodes[NODE_CAPACITY - 1] = actor.clone();
          this.shiftedThisFrame = true;
        }
        this.deviated = false;
        this.baseHeading = heading.clone();
        added = true;
      }
    }

    // Unless the short-distance early return fired, nodeCount's final entry
    // tracks this sample's current position whether or not a node was added.
    this.nodes[this.nodes.length - 1] = actor.clone();
    return {
      sampled: true,
      added,
      visible,
      distance,
      snapshot: this.snapshot,
    };
  }
}

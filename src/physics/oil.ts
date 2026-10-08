import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Texture,
} from "three";
import type { RigidBody } from "./contact";

export const OIL_SPILL_CAPACITY = 32;
export const OIL_INITIAL_HALF_SIZE = 0.2;
export const OIL_WORLD_SCALE = 6.9;
const OIL_MAX_SIZE = [0.35, 0.6] as const;
const OIL_GROWTH_PER_MS = [0.000089, 0.000301] as const;
const OIL_GRIP = [0.01, 0.15] as const;
const OIL_MARK_REMAINING = [1.5, 2.5] as const;
const OWNER_REUSE_DELAY_MS = 5000;
const STOP_DISTANCE_SQUARED = 0.2;
const VERTICAL_TOLERANCE_MODEL = 0.1;
const WHEEL_RADIUS_SQUARED_FACTOR = 0.8;
const UP = new Vector3(0, 1, 0);

export interface OilSurface {
  normal: Vector3;
  /** Nearby face normals from the ground box overlap used by OKToSpillOil. */
  nearbyFaceNormals?: readonly Vector3[];
  /** Result of NormalSideOfPlane for a nearby face when its dot is <= .8. */
  sameSideOfNearbyPlanes?: readonly boolean[];
}

export interface OilSpill {
  /** Actor followed until placement; PissOutOil passes its live car actor here. */
  readonly owner: RigidBody | null;
  /** Native pCar field: absent for PissOutOil, so its spill never stops growing. */
  readonly nativeOwnerCar: RigidBody | null;
  readonly mesh: Group;
  readonly position: Vector3;
  readonly normal: Vector3;
  readonly queuedAt: number;
  readonly fullSize: number;
  readonly growRate: number;
  currentSize: number;
  pending: boolean;
  originalOwnerPosition: Vector3 | null;
  readonly placementSurface?: OilSurface;
  readonly yaw: number;
  stopTime: number;
  spillTime: number;
}

export interface OilWheelTrail {
  frictionMultiplier: number;
  remaining: number;
}

export interface OilRuntimeOptions {
  random?: () => number;
  texture?: Texture;
}

export interface OilQueueOptions {
  /** Optional native `pOil->car`, distinct from the live actor to follow. */
  nativeOwnerCar?: RigidBody | null;
  /** Test/standalone placement when no world projector is supplied. */
  surface?: OilSurface;
}

export interface OilPlacement extends OilSurface {
  position: Vector3;
}

export type OilSurfaceProjector = (
  candidatePosition: Vector3,
  fullSize: number,
  actor: RigidBody | null,
) => OilPlacement | null;

/**
 * Original oil data/geometry behavior from local 0x4a6a20, 0x4a6e50 and
 * 0x4a7570. Times are absolute milliseconds, matching GetTotalTime().
 */
export class OilRuntime {
  private readonly slots: (OilSpill | null)[] = Array(OIL_SPILL_CAPACITY).fill(null);
  private readonly random: () => number;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly wheelTrails = new WeakMap<RigidBody, OilWheelTrail[]>();
  private disposed = false;

  constructor(options: OilRuntimeOptions = {}) {
    this.random = options.random ?? Math.random;
    this.material = new MeshBasicMaterial({
      color: options.texture ? 0xffffff : 0x080808,
      ...(options.texture ? { map: options.texture } : {}),
      transparent: Boolean(options.texture),
      depthWrite: !options.texture,
      side: 2,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.geometry = new PlaneGeometry(2, 2);
  }

  /** Read-only slot-order view; each spill exposes its render group and state. */
  get spills(): readonly (OilSpill | null)[] {
    return this.slots.slice();
  }

  /**
   * Add a slick. Repeated spills from the same owner within five seconds are
   * ignored; a full pool replaces its oldest record, as the 32 native slots do.
   * Position and surface are world-space. Omitting position uses owner origin.
   */
  queueSpill(owner: RigidBody | null, time: number): OilSpill | null;
  queueSpill(
    owner: RigidBody | null,
    position: Vector3 | undefined,
    time: number,
    options?: OilQueueOptions,
  ): OilSpill | null;
  queueSpill(
    owner: RigidBody | null,
    position: Vector3 | undefined,
    time: number,
    surface: OilSurface,
  ): OilSpill | null;
  queueSpill(
    owner: RigidBody | null,
    positionOrTime: Vector3 | number | undefined,
    suppliedTime?: number,
    optionsOrSurface: OilQueueOptions | OilSurface = {},
  ): OilSpill | null {
    const options = "normal" in optionsOrSurface
      ? { surface: optionsOrSurface }
      : optionsOrSurface;
    if (this.disposed) return null;
    const position = positionOrTime instanceof Vector3 ? positionOrTime : undefined;
    const time = typeof positionOrTime === "number" ? positionOrTime : suppliedTime;
    if (time === undefined) return null;
    if (!Number.isFinite(time)) return null;
    const origin = position ?? owner?.state.position;
    if (!origin || !finiteVector(origin)) return null;

    if (
      options.nativeOwnerCar &&
      this.slots.some(
        (spill) =>
          spill !== null && spill.nativeOwnerCar === options.nativeOwnerCar && time >= spill.queuedAt &&
          time - spill.queuedAt < OWNER_REUSE_DELAY_MS,
      )
    ) return null;

    let slot = this.slots.findIndex((spill) => spill === null);
    if (slot < 0) {
      slot = this.slots.reduce((oldest, spill, index, all) =>
        spill!.queuedAt < all[oldest]!.queuedAt ? index : oldest, 0);
      this.slots[slot]!.mesh.removeFromParent();
    }

    const fullSize = randomBetween(this.random, ...OIL_MAX_SIZE);
    const growRate = randomBetween(this.random, ...OIL_GROWTH_PER_MS);
    const mesh = new Group();
    mesh.name = "oil-spill";
    mesh.position.copy(origin);
    mesh.visible = false;
    const plane = new Mesh(this.geometry, this.material);
    plane.name = "oil-spill-surface";
    plane.rotation.x = -Math.PI / 2;
    plane.scale.setScalar(OIL_INITIAL_HALF_SIZE);
    plane.position.y = 0.002;
    mesh.add(plane);
    const spill: OilSpill = {
      owner,
      nativeOwnerCar: options.nativeOwnerCar ?? null,
      mesh,
      position: origin.clone(),
      normal: UP.clone(),
      queuedAt: time,
      fullSize,
      growRate,
      currentSize: OIL_INITIAL_HALF_SIZE,
      pending: true,
      originalOwnerPosition: null,
      stopTime: 0,
      spillTime: time,
      placementSurface: options.surface,
      yaw: this.random() * Math.PI * 2,
    };
    this.slots[slot] = spill;
    return spill;
  }

  /**
   * Advance placement/growth using the original absolute clock. PUP oil stays
   * hidden until the projector succeeds; `null` means the native surface test
   * failed and clears the queued slot.
   */
  update(now: number, projector?: OilSurfaceProjector): void {
    if (!Number.isFinite(now)) return;
    for (let i = 0; i < this.slots.length; i++) {
      const spill = this.slots[i];
      if (!spill) continue;
      if (spill.pending) {
        const candidate = spill.owner?.state.position ?? spill.position;
        let placement: OilPlacement | null | undefined;
        if (projector) placement = projector(candidate.clone(), spill.fullSize, spill.owner);
        else {
          const fallbackSurface = spill.placementSurface;
          if (fallbackSurface) placement = { ...fallbackSurface, position: candidate.clone() };
        }
        if (placement === undefined) continue;
        if (!placement || !finiteVector(placement.position) || !validOilSurface(placement)) {
          spill.mesh.removeFromParent();
          this.slots[i] = null;
          continue;
        }
        spill.position.copy(placement.position);
        spill.normal.copy(placement.normal).normalize();
        spill.mesh.position.copy(spill.position);
        spill.mesh.quaternion.setFromUnitVectors(UP, spill.normal);
        spill.mesh.rotateY(spill.yaw);
        spill.originalOwnerPosition = spill.nativeOwnerCar?.state.position.clone() ?? null;
        spill.spillTime = now;
        spill.pending = false;
        spill.mesh.visible = true;
      }
      if (spill.nativeOwnerCar && spill.originalOwnerPosition && spill.stopTime === 0) {
        const delta = spill.originalOwnerPosition.clone().sub(spill.nativeOwnerCar.state.position);
        if (delta.lengthSq() > STOP_DISTANCE_SQUARED) spill.stopTime = now;
      }
      if (!spill.stopTime || now < spill.stopTime) {
        spill.currentSize = Math.min(
          spill.fullSize,
          OIL_INITIAL_HALF_SIZE + Math.max(0, now - spill.spillTime) * spill.growRate,
        );
      }
      const plane = spill.mesh.children[0] as Mesh;
      plane.scale.setScalar(spill.currentSize);
      spill.mesh.updateMatrixWorld(true);
    }
  }

  /** Native 0x4a7570 test; input points are metric, spill positions model units. */
  tractionAt(point: Vector3): { grip: number; spill: OilSpill } | null {
    if (!finiteVector(point)) return null;
    let hit: OilSpill | null = null;
    for (const spill of this.slots) {
      if (!spill || spill.pending) continue;
      const dx = point.x / OIL_WORLD_SCALE - spill.position.x;
      const dz = point.z / OIL_WORLD_SCALE - spill.position.z;
      const limit = spill.currentSize * spill.currentSize * WHEEL_RADIUS_SQUARED_FACTOR;
      const dy = Math.abs(point.y / OIL_WORLD_SCALE - spill.position.y);
      if (dx * dx < limit && dz * dz < limit && dy < VERTICAL_TOLERANCE_MODEL)
        hit = spill;
    }
    return hit ? { grip: randomBetween(this.random, ...OIL_GRIP), spill: hit } : null;
  }

  /**
   * Per-car wheel factors in LF, RF, LR, RR order. A wheel keeps sampled grip
   * after leaving oil while its skid-trail distance remains, matching native
   * WheelForces and SkidMark state.
   */
  wheelFactors(
    car: RigidBody,
    points: readonly (Vector3 | null)[],
  ): [number, number, number, number] {
    const result: [number, number, number, number] = [1, 1, 1, 1];
    const trail = this.wheelTrails.get(car) ?? Array.from({ length: 4 }, () => ({
      frictionMultiplier: 1,
      remaining: 0,
    }));
    this.wheelTrails.set(car, trail);
    for (let i = 0; i < 4; i++) {
      const point = points[i];
      if (point) {
        const hit = this.tractionAt(point);
        if (hit) {
          trail[i].frictionMultiplier = hit.grip;
          trail[i].remaining = randomBetween(this.random, ...OIL_MARK_REMAINING);
        }
      }
      if (trail[i].remaining > 0) result[i] = trail[i].frictionMultiplier;
    }
    return result;
  }

  /** Native SkidMark subtracts model-space travel distance from wheel oil. */
  consumeOilMark(car: RigidBody, wheel: number, distance: number): number {
    if (!Number.isInteger(wheel) || wheel < 0 || wheel > 3 || !Number.isFinite(distance))
      return 0;
    const trail = this.wheelTrails.get(car)?.[wheel];
    if (!trail) return 0;
    trail.remaining = Math.max(0, trail.remaining - Math.max(0, distance));
    if (trail.remaining === 0) trail.frictionMultiplier = 1;
    return trail.remaining;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const spill of this.slots) spill?.mesh.removeFromParent();
    this.slots.fill(null);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Native near-flat surface and neighboring-plane rejection from OKToSpillOil. */
export function validOilSurface(surface: OilSurface): boolean {
  if (!finiteVector(surface.normal) || surface.normal.lengthSq() === 0) return false;
  const normal = surface.normal.clone().normalize();
  return normal.y >= 0.97 && validNearbyFaces(normal, surface);
}

function validNearbyFaces(normal: Vector3, surface: OilSurface): boolean {
  const faces = surface.nearbyFaceNormals ?? [];
  const sides = surface.sameSideOfNearbyPlanes ?? [];
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    if (!finiteVector(face) || face.lengthSq() === 0) return false;
    const dot = face.clone().normalize().dot(normal);
    if (dot < 0.98 && (dot > 0.8 || sides[i] === false)) return false;
  }
  return true;
}

function randomBetween(random: () => number, low: number, high: number): number {
  const sample = Math.max(0, Math.min(32767, Math.floor(random() * 32768)));
  return low + (sample / 32768) * (high - low);
}

function finiteVector(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

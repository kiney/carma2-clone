import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  Matrix4,
  Box3,
  type Material,
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
  yaw: number;
  stopTime: number;
  spillTime: number;
  /** Explicit native ACT/model provider; absent for the legacy rigid-body API. */
  readonly source?: OilActorFollower;
  readonly nativeCar?: OilNativeCar;
  readonly authored: boolean;
  readonly initialSize: number;
  readonly friction: readonly [number, number];
  readonly smearDistance: readonly [number, number];
  readonly smearMaterial: Material | null;
}

/** The native allocator retains an ACT and MODEL, not a collision point. */
export interface OilActorFollower {
  readonly identity: object;
  readPosition(): Vector3;
  readMatrix(): Matrix4;
  readModelBounds(): Box3;
}

/** Native pCar eligibility/COM fields, independent of source ACT identity. */
export interface OilNativeCar {
  readonly identity: object;
  readonly driver: number;
  readVelocity(): Vector3;
  readPosition(): Vector3;
  readDamage(): { engine: number; transmission: number };
}

export interface AuthoredOilSpill {
  delayMs: number;
  initialHalfSize: number;
  fullSize: readonly [number, number];
  growthPerMs: readonly [number, number];
  friction: readonly [number, number];
  smearDistance?: readonly [number, number];
  /** Borrowed materials remain owned by the asset/scene loader. */
  material: Material;
  smearMaterial?: Material | null;
}

export interface AuthoredOilQueueOptions {
  nativeCar?: OilNativeCar;
  surface?: OilSurface;
}

export interface OilWheelTrail {
  frictionMultiplier: number;
  remaining: number;
  material: Material | null;
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
  /** Authored calls expose source.readMatrix/readModelBounds to the host. */
  spill?: OilSpill,
) => OilPlacement | null;

export interface OilWheelOptions {
  broadphaseMask?: number;
  driver?: number;
}

/**
 * Original oil data/geometry behavior from local 0x4a6a20, 0x4a6e50 and
 * 0x4a7570. Times are absolute milliseconds, matching GetTotalTime().
 */
export class OilRuntime {
  private readonly slots: (OilSpill | null)[] =
    Array(OIL_SPILL_CAPACITY).fill(null);
  /** Invalidated native ownership does not erase numerical wheel fields. */
  private readonly retainedWheelRecords: (OilSpill | null)[] =
    Array(OIL_SPILL_CAPACITY).fill(null);
  private readonly random: () => number;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly wheelTrails = new WeakMap<RigidBody, OilWheelTrail[]>();
  private readonly wheelBroadphaseMasks = new WeakMap<RigidBody, number>();
  /** Native reused rendering actors retain their old pose until placement. */
  private readonly slotMatrices = Array.from(
    { length: OIL_SPILL_CAPACITY },
    () => new Matrix4(),
  );
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
    const options =
      "normal" in optionsOrSurface
        ? { surface: optionsOrSurface }
        : optionsOrSurface;
    if (this.disposed) return null;
    const position =
      positionOrTime instanceof Vector3 ? positionOrTime : undefined;
    const time =
      typeof positionOrTime === "number" ? positionOrTime : suppliedTime;
    if (time === undefined) return null;
    if (!Number.isFinite(time)) return null;
    const origin = position ?? owner?.state.position;
    if (!origin || !finiteVector(origin)) return null;

    if (
      options.nativeOwnerCar &&
      this.slots.some(
        (spill) =>
          spill !== null &&
          (spill.source?.identity ?? spill.owner) === owner &&
          time < (spill.spillTime + OWNER_REUSE_DELAY_MS) >>> 0,
      )
    )
      return null;

    let slot = this.slots.findIndex((spill) => spill === null);
    if (slot < 0) {
      slot = this.oldestSlot(time);
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
      yaw: 0,
      authored: false,
      initialSize: OIL_INITIAL_HALF_SIZE,
      friction: OIL_GRIP,
      smearDistance: OIL_MARK_REMAINING,
      smearMaterial: null,
    };
    this.slots[slot] = spill;
    this.retainedWheelRecords[slot] = spill;
    return spill;
  }

  /** Installed QueueOilSpill2 4a6a20, sharing the charged oil's 32 slots. */
  queueAuthoredSpill(
    source: OilActorFollower,
    config: AuthoredOilSpill,
    timeMs: number,
    options: AuthoredOilQueueOptions = {},
  ): OilSpill | null {
    if (this.disposed) return null;
    validateAuthoredSource(source);
    validateAuthoredConfig(config);
    if (!Number.isFinite(timeMs)) throw new Error("Invalid oil spill time");
    const now = Math.trunc(timeMs) >>> 0;
    const nativeCar = options.nativeCar;
    if (nativeCar) validateNativeCar(nativeCar);
    if (
      nativeCar &&
      this.slots.some(
        (spill) =>
          spill !== null &&
          (spill?.source?.identity ?? spill?.owner) === source.identity &&
          now < (spill.spillTime + OWNER_REUSE_DELAY_MS) >>> 0,
      )
    )
      return null;
    let slot = this.slots.findIndex((spill) => spill === null);
    if (slot < 0) {
      slot = this.oldestSlot(now);
      this.slots[slot]!.mesh.removeFromParent();
    }
    const fullSize = nativeBetween(this.random, config.fullSize);
    const growRate = nativeBetween(this.random, config.growthPerMs);
    const mesh = new Group();
    mesh.name = "authored-oil-spill";
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.slotMatrices[slot]);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.visible = false;
    const plane = new Mesh(this.geometry, config.material);
    plane.name = "oil-spill-surface";
    plane.rotation.x = -Math.PI / 2;
    const initialSize = Math.fround(config.initialHalfSize);
    plane.scale.setScalar(initialSize);
    mesh.add(plane);
    const spill: OilSpill = {
      owner: null,
      nativeOwnerCar: null,
      source,
      nativeCar,
      mesh,
      position: new Vector3().setFromMatrixPosition(mesh.matrix),
      normal: UP.clone(),
      queuedAt: now,
      spillTime: (now + Math.trunc(Math.fround(config.delayMs))) >>> 0,
      // A new JS record has no old stop timestamp. Pending placement clears it
      // before use; native reused slots also retain this unused field meanwhile.
      stopTime: 0,
      fullSize,
      growRate,
      initialSize,
      currentSize: initialSize,
      pending: true,
      originalOwnerPosition: null,
      placementSurface: options.surface,
      yaw: 0,
      authored: true,
      friction: f32Pair(config.friction),
      smearDistance: f32Pair(config.smearDistance ?? [0, 0]),
      smearMaterial: config.smearMaterial ?? null,
    };
    this.slots[slot] = spill;
    this.retainedWheelRecords[slot] = spill;
    return spill;
  }

  private oldestSlot(now: number): number {
    let slot = 0;
    let oldest = now >>> 0;
    for (let i = 0; i < this.slots.length; i++) {
      const timestamp = this.slots[i]!.spillTime >>> 0;
      if (timestamp < oldest) {
        oldest = timestamp;
        slot = i;
      }
    }
    return slot;
  }

  /** Action35 4dde40 uses null pCar, zero delay and the owned oil material. */
  queueChargedSpill(source: OilActorFollower, timeMs: number): OilSpill | null {
    return this.queueAuthoredSpill(
      source,
      {
        delayMs: 0,
        initialHalfSize: 0.2,
        fullSize: OIL_MAX_SIZE,
        // Literal installed pushes 38bcbe62 / 399d4952. Legacy queueSpill's
        // historical .000089/.000301 range remains for standalone compatibility.
        growthPerMs: [0.00009, 0.0003],
        friction: OIL_GRIP,
        smearDistance: OIL_MARK_REMAINING,
        material: this.material,
        smearMaterial: null,
      },
      timeMs,
    );
  }

  /**
   * Advance placement/growth using the original absolute clock. PUP oil stays
   * hidden until the projector succeeds; `null` means the native surface test
   * failed and clears the queued slot.
   */
  update(
    now: number,
    projector?: OilSurfaceProjector,
    options: { replay?: boolean } = {},
  ): void {
    if (!Number.isFinite(now)) return;
    for (let i = 0; i < this.slots.length; i++) {
      const spill = this.slots[i];
      if (!spill) continue;
      const time = spill.authored ? Math.trunc(now) >>> 0 : now;
      if (spill.pending) {
        if (time < spill.spillTime) continue;
        if (spill.nativeCar) {
          const velocity = spill.nativeCar.readVelocity();
          if (!finiteVector(velocity))
            throw new Error("Invalid oil car velocity provider");
          const threshold = Math.fround(1 / 6.9 / 100);
          if (
            Math.abs(velocity.x) >= threshold ||
            Math.abs(velocity.y) >= threshold ||
            Math.abs(velocity.z) >= threshold
          )
            continue;
          if (!options.replay && spill.nativeCar.driver >= 7) {
            const damage = spill.nativeCar.readDamage();
            if (![damage.engine, damage.transmission].every(Number.isFinite))
              throw new Error("Invalid oil car damage provider");
            if (damage.engine < 99 && damage.transmission < 99) {
              spill.mesh.visible = false;
              spill.mesh.removeFromParent();
              this.slots[i] = null;
              continue;
            }
          }
        }
        const candidate =
          spill.source?.readPosition() ??
          spill.owner?.state.position ??
          spill.position;
        if (!finiteVector(candidate))
          throw new Error("Invalid oil ACT position provider");
        // IRandomBetween(0,65535) 4a6cc6 precedes the finite face collector.
        // Failed attempted placements also consume yaw; delayed/velocity exits
        // above do not. Standalone without a provider keeps awaiting placement.
        if (!projector && !spill.placementSurface && !options.replay) continue;
        if (!options.replay)
          spill.yaw = (nativeRandomSample(this.random) * 2 * Math.PI) / 32768;
        let placement: OilPlacement | null | undefined;
        if (options.replay)
          placement = {
            position: spill.position.clone(),
            normal: spill.normal,
          };
        else if (projector)
          placement = projector(
            candidate.clone(),
            spill.fullSize,
            spill.owner,
            spill,
          );
        else {
          const fallbackSurface = spill.placementSurface;
          if (fallbackSurface)
            placement = { ...fallbackSurface, position: candidate.clone() };
        }
        if (placement === undefined) continue;
        if (
          !placement ||
          !finiteVector(placement.position) ||
          !(spill.authored
            ? validNativeOilSurface(placement)
            : validOilSurface(placement))
        ) {
          spill.mesh.visible = false;
          spill.mesh.removeFromParent();
          this.slots[i] = null;
          continue;
        }
        spill.position.copy(placement.position);
        spill.normal.copy(placement.normal);
        if (spill.authored) {
          for (let axis = 0; axis < 3; axis++) {
            spill.position.setComponent(
              axis,
              Math.fround(spill.position.getComponent(axis)),
            );
            spill.normal.setComponent(
              axis,
              Math.fround(spill.normal.getComponent(axis)),
            );
          }
        } else spill.normal.normalize();
        spill.mesh.position.copy(spill.position);
        if (spill.authored) {
          const n = spill.normal;
          spill.mesh.matrix
            .makeBasis(new Vector3(n.y, -n.x, 0), n, new Vector3(0, -n.z, n.y))
            .multiply(new Matrix4().makeRotationY(spill.yaw))
            .setPosition(spill.position);
          for (let element = 0; element < 16; element++)
            spill.mesh.matrix.elements[element] = Math.fround(
              spill.mesh.matrix.elements[element],
            );
        } else {
          spill.mesh.quaternion.setFromUnitVectors(UP, spill.normal);
          spill.mesh.rotateY(spill.yaw);
        }
        spill.originalOwnerPosition =
          spill.nativeCar?.readPosition().clone() ??
          spill.nativeOwnerCar?.state.position.clone() ??
          null;
        spill.spillTime = time;
        spill.stopTime = 0;
        spill.pending = false;
        spill.mesh.visible = true;
        spill.mesh.updateMatrixWorld(true);
        this.slotMatrices[i].copy(spill.mesh.matrix);
        // Source SetInitialOilStuff returns without growth in this pass.
        continue;
      }
      if (
        (spill.nativeOwnerCar || spill.nativeCar) &&
        spill.originalOwnerPosition &&
        spill.stopTime === 0
      ) {
        const delta = spill.originalOwnerPosition
          .clone()
          .sub(
            spill.nativeCar?.readPosition() ??
              spill.nativeOwnerCar!.state.position,
          );
        if (
          delta.lengthSq() >
          (spill.authored
            ? Math.fround(STOP_DISTANCE_SQUARED)
            : STOP_DISTANCE_SQUARED)
        ) {
          spill.stopTime = time;
          continue;
        }
      }
      if (!spill.stopTime || time < spill.stopTime) {
        const elapsed = spill.authored
          ? (time - spill.spillTime) | 0
          : Math.max(0, time - spill.spillTime);
        const size = spill.initialSize + elapsed * spill.growRate;
        if (size < spill.initialSize) {
          spill.mesh.visible = false;
          spill.pending = true;
          continue;
        }
        spill.currentSize = spill.authored
          ? Math.fround(Math.min(spill.fullSize, size))
          : Math.min(spill.fullSize, size);
      }
      const plane = spill.mesh.children[0] as Mesh;
      plane.scale.setScalar(spill.currentSize);
      spill.mesh.updateMatrixWorld(true);
      this.slotMatrices[i].copy(spill.mesh.matrix);
    }
  }

  /** Native 0x4a7570 test; input points are metric, spill positions model units. */
  tractionAt(point: Vector3): { grip: number; spill: OilSpill } | null {
    if (!finiteVector(point)) return null;
    let hit: OilSpill | null = null;
    for (const spill of this.slots) {
      if (!spill || spill.pending) continue;
      if (pointInSpill(point, spill)) hit = spill;
    }
    return hit
      ? {
          grip: hit.authored
            ? nativeBetween(this.random, hit.friction)
            : randomBetween(this.random, ...hit.friction),
          spill: hit,
        }
      : null;
  }

  /**
   * Per-car wheel factors in LF, RF, LR, RR order. A wheel keeps sampled grip
   * after leaving oil while its skid-trail distance remains, matching native
   * WheelForces and SkidMark state.
   */
  wheelFactors(
    car: RigidBody,
    points: readonly (Vector3 | null)[],
    options: OilWheelOptions = {},
  ): [number, number, number, number] {
    const result: [number, number, number, number] = [1, 1, 1, 1];
    if (options.driver !== undefined && !Number.isInteger(options.driver))
      throw new Error("Invalid oil wheel driver");
    if (options.driver !== undefined && options.driver <= 5) return result;
    const trail =
      this.wheelTrails.get(car) ??
      Array.from({ length: 4 }, () => ({
        frictionMultiplier: 1,
        remaining: 0,
        material: null,
      }));
    this.wheelTrails.set(car, trail);
    const retainedMask =
      options.broadphaseMask ?? this.wheelBroadphaseMasks.get(car);
    if (retainedMask !== undefined) validateMask(retainedMask);
    // Standalone compatibility: without the graphics-produced mask, consider
    // placed visible slots. Production supplies a retained mask explicitly.
    const mask =
      retainedMask ??
      this.slots.reduce(
        (bits, spill, slot) =>
          spill && !spill.pending && spill.mesh.visible
            ? bits | (1 << slot)
            : bits,
        0,
      );
    for (let slot = 0; slot < this.slots.length; slot++) {
      const spill =
        this.slots[slot] ??
        (retainedMask === undefined ? null : this.retainedWheelRecords[slot]);
      if (!spill || !(mask & (1 << slot)) || spill.friction[1] === 0) continue;
      for (const wheel of [2, 3, 0, 1]) {
        const point = points[wheel];
        if (!point || !pointInSpill(point, spill)) continue;
        trail[wheel].frictionMultiplier = spill.authored
          ? nativeBetween(this.random, spill.friction)
          : randomBetween(this.random, ...spill.friction);
        trail[wheel].remaining = spill.authored
          ? nativeBetween(this.random, spill.smearDistance)
          : randomBetween(this.random, ...spill.smearDistance);
        trail[wheel].material = spill.smearMaterial;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (trail[i].remaining !== 0) result[i] = trail[i].frictionMultiplier;
    }
    return result;
  }

  /** Host owns MungeCarGraphics' once-per-frame slot overlap calculation. */
  setWheelBroadphaseMask(car: RigidBody, mask: number): void {
    validateMask(mask);
    this.wheelBroadphaseMasks.set(car, mask >>> 0);
  }

  wheelOilMaterial(car: RigidBody, wheel: number): Material | null {
    return this.wheelTrails.get(car)?.[wheel]?.material ?? null;
  }

  /** Native SkidMark subtracts model-space travel distance from wheel oil. */
  wheelOilRemaining(car: RigidBody, wheel: number): number {
    return this.wheelTrails.get(car)?.[wheel]?.remaining ?? 0;
  }
  consumeOilMark(car: RigidBody, wheel: number, distance: number): number {
    if (
      !Number.isInteger(wheel) ||
      wheel < 0 ||
      wheel > 3 ||
      !Number.isFinite(distance)
    )
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
    this.retainedWheelRecords.fill(null);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Native near-flat surface and neighboring-plane rejection from OKToSpillOil. */
export function validOilSurface(surface: OilSurface): boolean {
  if (!finiteVector(surface.normal) || surface.normal.lengthSq() === 0)
    return false;
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

function randomBetween(
  random: () => number,
  low: number,
  high: number,
): number {
  const sample = nativeRandomSample(random);
  return low + (sample / 32768) * (high - low);
}

function nativeRandomSample(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) throw new Error("Invalid oil RNG sample");
  return Math.max(0, Math.min(32767, Math.floor(value * 32768)));
}

function nativeBetween(
  random: () => number,
  pair: readonly [number, number],
): number {
  return Math.fround(
    randomBetween(random, Math.fround(pair[0]), Math.fround(pair[1])),
  );
}

function f32Pair(pair: readonly [number, number]): readonly [number, number] {
  return [Math.fround(pair[0]), Math.fround(pair[1])];
}

function pointInSpill(point: Vector3, spill: OilSpill): boolean {
  if (!finiteVector(point)) return false;
  const scale = spill.authored
    ? Math.fround(1 / OIL_WORLD_SCALE)
    : 1 / OIL_WORLD_SCALE;
  const dx = spill.authored
    ? Math.fround(point.x * scale - spill.position.x)
    : point.x * scale - spill.position.x;
  const dz = point.z * scale - spill.position.z;
  const dy = Math.abs(point.y * scale - spill.position.y);
  const limit =
    spill.currentSize *
    spill.currentSize *
    (spill.authored
      ? Math.fround(WHEEL_RADIUS_SQUARED_FACTOR)
      : WHEEL_RADIUS_SQUARED_FACTOR);
  return (
    dx * dx < limit &&
    dz * dz < limit &&
    dy <
      (spill.authored
        ? Math.fround(VERTICAL_TOLERANCE_MODEL)
        : VERTICAL_TOLERANCE_MODEL)
  );
}

/** Authored/native providers supply source normals, without normalization. */
export function validNativeOilSurface(surface: OilSurface): boolean {
  if (!finiteVector(surface.normal) || surface.normal.y < Math.fround(0.97))
    return false;
  const faces = surface.nearbyFaceNormals ?? [];
  for (let i = 0; i < faces.length; i++) {
    if (!finiteVector(faces[i])) return false;
    const dot = faces[i].dot(surface.normal);
    if (
      dot < Math.fround(0.98) &&
      (dot > Math.fround(0.8) || surface.sameSideOfNearbyPlanes?.[i] === false)
    )
      return false;
  }
  return true;
}

function validateMask(mask: number): void {
  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff)
    throw new Error("Invalid oil spill broadphase mask");
}

function validateAuthoredSource(source: OilActorFollower): void {
  if (
    !source?.identity ||
    typeof source.readPosition !== "function" ||
    typeof source.readMatrix !== "function" ||
    typeof source.readModelBounds !== "function"
  )
    throw new Error("Incomplete oil ACT/model provider");
  const position = source.readPosition();
  const matrix = source.readMatrix();
  const bounds = source.readModelBounds();
  if (
    !finiteVector(position) ||
    !matrix?.elements?.every(Number.isFinite) ||
    !bounds ||
    !finiteVector(bounds.min) ||
    !finiteVector(bounds.max) ||
    bounds.isEmpty()
  )
    throw new Error("Invalid oil ACT/model provider");
}

function validateAuthoredConfig(config: AuthoredOilSpill): void {
  const values = [
    config.delayMs,
    config.initialHalfSize,
    ...config.fullSize,
    ...config.growthPerMs,
    ...config.friction,
    ...(config.smearDistance ?? [0, 0]),
  ];
  if (
    !config.material?.isMaterial ||
    ![config.fullSize, config.growthPerMs, config.friction].every(
      (pair) => pair.length === 2,
    ) ||
    (config.smearDistance && config.smearDistance.length !== 2) ||
    !values.every((value) => Number.isFinite(Math.fround(value))) ||
    (config.friction[1] !== 0 && !config.smearDistance)
  )
    throw new Error("Invalid authored oil spill parameters");
}

function validateNativeCar(car: OilNativeCar): void {
  if (
    !car.identity ||
    !Number.isInteger(car.driver) ||
    typeof car.readVelocity !== "function" ||
    typeof car.readPosition !== "function" ||
    typeof car.readDamage !== "function"
  )
    throw new Error("Incomplete oil car eligibility provider");
}

function finiteVector(value: Vector3): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

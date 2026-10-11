import { Vector3 } from "three";

const f = Math.fround;
const GRAVITY40 = -0.05681159420289855;
const METRIC_GRAVITY = 1.4202898550724639;
const ANGULAR_DRAG_SCALE = f(1 / 47.61); // Installed DWORD5898d0.

export interface NativeFreeVolume {
  /** Retain identity independently of the two numerical fields. */
  identity: object;
  gravity: number;
  viscosity: number;
}
export interface NativeFreeVolumeSnapshot {
  volume: NativeFreeVolume | null;
  depth: number;
}
export interface NativeFreeVolumeStep {
  /** Before and after the source TestAutoSpecialVolume/MungeSpecialVolume pass. */
  before: NativeFreeVolumeSnapshot;
  after: NativeFreeVolumeSnapshot;
}
export interface NativeFreeForcePacket {
  headerState: 0 | 1 | 2;
  doNothing: boolean;
  headerFlags: number;
  gravity: number;
  drag: number;
  levelOut: number;
  mass: number;
  inertia: Vector3;
  /** Native raw world velocity+68 and BODY omega+74, without conversion6.9. */
  worldVelocity: Vector3;
  localOmega: Vector3;
  /** Retained Object+54 vector; a skipped gravity pass does not clear it. */
  gravityIncrement: Vector3;
}
export interface NativeFreeLevelOutContext {
  packet: Readonly<NativeFreeForcePacket>;
  volume: NativeFreeVolume;
  depth: number;
}
export interface NativeFreeForceOptions {
  globalGravity: number;
  /** The caller must query actual source volumes; unknown is not dry air. */
  volumeStep: NativeFreeVolumeStep | "unknown";
  /** Forces do not erase or solve retained Object+18c constraints. */
  retainedJoint2: "absent" | "present" | "unknown";
  /** Installed LevelOutOnSurface4b6d50 needs actual ACT basis and water plane.
   * Return the source BODY-omega delta, without mutating this snapshot. */
  levelOut?: (context: NativeFreeLevelOutContext) => Vector3;
}
export type NativeFreeDragPass = "header" | "volume-entry" | "volume-exit";
export interface NativeFreeForceResult {
  status: "complete" | "skipped" | "provider-required";
  applied: boolean;
  gravityApplied: boolean;
  gravityIncrement: Vector3;
  dragPasses: NativeFreeDragPass[];
  requiredProviders: string[];
  /** Passive headers are marked f0=2 by the generic force traversal. */
  markPassivePhase: boolean;
  /** Separate later constraint stage; complete here means forces only. */
  jointConstraintProviderRequired: boolean;
}

function scalar(value: number): number {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new Error("Invalid native free-body force scalar");
  return result;
}
function vector(value: Vector3): Vector3 {
  return new Vector3(scalar(value.x), scalar(value.y), scalar(value.z));
}
function volumeSnapshot(value: NativeFreeVolumeSnapshot) {
  if (!value || !Object.hasOwn(value, "volume"))
    throw new Error("Native free-body volume snapshot required");
  if (
    value.volume &&
    (!value.volume.identity || typeof value.volume.identity !== "object")
  )
    throw new Error("Native free-body volume identity provider required");
  return {
    depth: scalar(value.depth),
    volume: value.volume
      ? {
          identity: value.volume.identity,
          gravity: scalar(value.volume.gravity),
          viscosity: scalar(value.volume.viscosity),
        }
      : null,
  };
}

/** Installed ProcessGravity4b6c60. The caller supplies the outer header gate's
 * selected scalar, including fallback1 when gravity0 has an enabled volume. */
export function nativeFreeGravity40(
  selectedGravity: number,
  globalGravity: number,
  levelOut: number,
  selectedVolume: NativeFreeVolumeSnapshot,
): Vector3 {
  const g = scalar(selectedGravity),
    G = scalar(globalGravity),
    L = scalar(levelOut),
    { volume, depth } = volumeSnapshot(selectedVolume);
  let y: number;
  if (!volume) y = g * G * GRAVITY40;
  else if (L !== 0 && volume.viscosity > 2)
    y = ((1 - volume.gravity) * depth * L - g * G * METRIC_GRAVITY) * 0.04;
  else y = volume.gravity * depth * g * G * GRAVITY40;
  return new Vector3(0, scalar(y), 0);
}

/** Installed ProcessDrag4b6a80, clamped linear subtraction515d70 and angular
 * subtraction4c2a40. The source coefficient is per40ms, not arbitrary dt. */
export function applyNativeFreeDrag40(
  packet: Pick<
    NativeFreeForcePacket,
    "worldVelocity" | "localOmega" | "mass" | "inertia" | "levelOut"
  >,
  selectedDrag: number,
  selectedVolume: NativeFreeVolumeSnapshot,
): void {
  const mass = scalar(packet.mass),
    inertia = vector(packet.inertia),
    velocity = vector(packet.worldVelocity),
    omega = vector(packet.localOmega),
    L = scalar(packet.levelOut),
    { volume, depth } = volumeSnapshot(selectedVolume);
  if (mass <= 0 || inertia.toArray().some((value) => value <= 0))
    throw new Error("Native free-body drag needs positive mass and moments");
  let k = f(scalar(selectedDrag) * 0.00002);
  if (volume)
    k = scalar(
      depth *
        volume.viscosity *
        k *
        (L !== 0 && volume.viscosity > 2 ? 0.5 : 1),
    );
  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2),
    linearFactor = (k * speed * 6.9) / mass,
    omegaMagnitude = Math.sqrt(omega.x ** 2 + omega.y ** 2 + omega.z ** 2),
    angularFactor = omegaMagnitude * k;
  const nextV = new Vector3(),
    nextOmega = new Vector3();
  for (let i = 0; i < 3; i++) {
    const old = velocity.getComponent(i),
      decrement = scalar(old * linearFactor),
      next = scalar(old - decrement);
    nextV.setComponent(i, old * next <= 0 ? 0 : next);

    const oldOmega = omega.getComponent(i),
      torque = scalar(oldOmega * angularFactor),
      // Installed4c2a8d spills Y's scaled torque; X/Z retain that product live.
      scaled =
        i === 1
          ? scalar(torque * ANGULAR_DRAG_SCALE)
          : torque * ANGULAR_DRAG_SCALE,
      liveNext = oldOmega - scaled / inertia.getComponent(i),
      storedNext = scalar(liveNext),
      // X uses its stored value, Y retains the live subtraction, Z a spill.
      crossingValue = i === 1 ? liveNext : storedNext;
    nextOmega.setComponent(i, oldOmega * crossingValue <= 0 ? 0 : storedNext);
  }
  packet.worldVelocity.copy(nextV);
  packet.localOmega.copy(nextOmega);
}

/** One generic free-leaf force pass4b6538..4b672b. Volume selection and the
 * actual water-plane/ACT level-out operation remain explicit host providers.
 * Missing providers leave the packet unchanged, including retained gravity. */
export function applyNativeFreeForces40(
  packet: NativeFreeForcePacket,
  options: NativeFreeForceOptions,
): NativeFreeForceResult {
  if (
    ![0, 1, 2].includes(packet.headerState) ||
    !["absent", "present", "unknown"].includes(options.retainedJoint2) ||
    typeof packet.doNothing !== "boolean" ||
    !Number.isInteger(packet.headerFlags) ||
    packet.headerFlags < 0 ||
    packet.headerFlags > 0xffff
  )
    throw new Error("Invalid native free-body header or joint provider state");
  const result: NativeFreeForceResult = {
    status: "skipped",
    applied: false,
    gravityApplied: false,
    gravityIncrement: vector(packet.gravityIncrement),
    dragPasses: [],
    requiredProviders: [],
    markPassivePhase: packet.headerState === 1,
    jointConstraintProviderRequired: options.retainedJoint2 !== "absent",
  };
  if (packet.headerState !== 2 || packet.doNothing) return result;
  const volumeEnabled = (packet.headerFlags & 8) !== 0;
  if (
    volumeEnabled &&
    (options.volumeStep === "unknown" ||
      !options.volumeStep ||
      typeof options.volumeStep !== "object")
  ) {
    result.status = "provider-required";
    result.requiredProviders.push("native-special-volume-step");
    return result;
  }
  const dry: NativeFreeVolumeSnapshot = { volume: null, depth: 0 },
    before = volumeEnabled
      ? volumeSnapshot((options.volumeStep as NativeFreeVolumeStep).before)
      : dry,
    after = volumeEnabled
      ? volumeSnapshot((options.volumeStep as NativeFreeVolumeStep).after)
      : dry,
    gravity = scalar(packet.gravity),
    drag = scalar(packet.drag),
    L = scalar(packet.levelOut),
    G = scalar(options.globalGravity),
    levelOutNeeded = !!(
      after.volume &&
      L !== 0 &&
      after.volume.viscosity > 2 &&
      after.depth < 1
    );
  if (levelOutNeeded && !options.levelOut) {
    result.status = "provider-required";
    result.requiredProviders.push("native-water-plane-level-out");
    return result;
  }
  const working: NativeFreeForcePacket = {
    ...packet,
    mass: scalar(packet.mass),
    inertia: vector(packet.inertia),
    worldVelocity: vector(packet.worldVelocity),
    localOmega: vector(packet.localOmega),
    gravityIncrement: vector(packet.gravityIncrement),
  };
  if (gravity !== 0 || after.volume) {
    working.gravityIncrement.copy(
      nativeFreeGravity40(gravity !== 0 ? gravity : 1, G, L, after),
    );
    working.worldVelocity.set(
      scalar(working.worldVelocity.x + working.gravityIncrement.x),
      scalar(working.worldVelocity.y + working.gravityIncrement.y),
      scalar(working.worldVelocity.z + working.gravityIncrement.z),
    );
    result.gravityApplied = true;
  }
  if (drag !== 0 || after.volume) {
    applyNativeFreeDrag40(working, drag !== 0 ? drag : 1, after);
    result.dragPasses.push("header");
  }
  if (volumeEnabled) {
    const currentViscous = !!(after.volume && after.volume.viscosity > 2),
      previousViscous = !!(before.volume && before.volume.viscosity > 2);
    if (
      currentViscous &&
      after.depth === 1 &&
      !(previousViscous && before.depth >= 1)
    ) {
      applyNativeFreeDrag40(working, 1, after); // Literal65bb78=Float32(1).
      result.dragPasses.push("volume-entry");
    } else if (!currentViscous && previousViscous) {
      applyNativeFreeDrag40(working, 1, after); // Literal65bb7c=Float32(1).
      result.dragPasses.push("volume-exit");
    }
    if (levelOutNeeded) {
      const delta = vector(
        options.levelOut!({
          packet: working,
          volume: after.volume!,
          depth: after.depth,
        }),
      );
      working.localOmega.set(
        scalar(working.localOmega.x + delta.x),
        scalar(working.localOmega.y + delta.y),
        scalar(working.localOmega.z + delta.z),
      );
    }
  }
  packet.worldVelocity.copy(working.worldVelocity);
  packet.localOmega.copy(working.localOmega);
  packet.gravityIncrement.copy(working.gravityIncrement);
  result.gravityIncrement.copy(working.gravityIncrement);
  result.status = "complete";
  result.applied = true;
  return result;
}

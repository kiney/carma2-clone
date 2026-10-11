import { Vector3 } from "three";
import type { CarMechanics, MechanicsWheel } from "../mechanics";
import type { RigidState } from "./contact";
import type { SuspensionPowerupValues } from "./upgrades";
import type { SurfaceModifier } from "./surfaces";
import type { RigidBody } from "./contact";
import { nativeTyreSkidRequests } from "./tyre-skid";

/** Local HW binary 0x418870, 0x415320, 0x417600 and 0x41fc80.
 * Independently expressed equations; positions are model units, forces use S=6.9.
 */
export const C2_WORLD_SCALE = 6.9;
const S = C2_WORLD_SCALE;
const S2 = 47.61000061035156;
const INV_S2 = 0.02100399136543274;
const EPS = 2 ** -22;

export interface MotionState extends RigidState {
  /** GENERAL power table value at the current APO power level (car+0x18ac). */
  powerMultiplier?: number;
  /** Timed powerup value assigned directly to source car+0x4d4. */
  engineFactor?: number;
  /** Timed powerup value assigned directly to source car+0x4d0. */
  tyreGripFactor?: number;
  /** Wheel-force slot ownership after a horizontal body split. */
  wheelEnabled?: readonly boolean[];
  curvature: number;
  turnSpeed: number;
  gear: number;
  rpm: number;
  tractionRpm: number;
  brakeForce: number;
  slipping: number;
  wheelLengths: [number, number, number, number];
  componentDamage?: readonly number[];
  /** Model-unit offsets in damage order LF, RF, LR, RR (source car+0x132c). */
  wheelDamageOffsets?: readonly number[];
  /** Crush-derived curvature offset (source car+0x1260). */
  steeringDamageCurvature?: number;
  controlTime?: number;
  steeringFaultEnd?: number;
  steeringFaultLeft?: boolean;
  steeringFaultRight?: boolean;
  transmissionFaultEnd?: number;
  justChangedGear?: boolean;
  tractionControl?: boolean;
  accForce?: number;
  /** Source car+0x12a8: latched crest redistribution of aerodynamic force. */
  crestDownforce?: boolean;
  /** Source car+0x12e8, retained until the next WheelForces tail. */
  groundedWheelCount?: number;
  /** Source car+0x4c0; bouncing cars cannot enter the stationary clamp. */
  bounceRate?: number;
  /** Source car+0x1c4; WheelForces applies this only to driver types above 5. */
  wallClimb?: boolean;
  /** Installed global gravity74b348; wall support gravity intentionally bypasses it. */
  globalGravityMultiplier?: number;
  /** Raw native volume settling divisor; undefined means no volume pointer. */
  settlingVolumeGravity?: number;
  /** Source driver type; ordinary player and opponent cars use 8 and 6. */
  driver?: number;
  /** Original special-volume gravity/viscosity, evaluated before WheelForces. */
  volumeGravityFactor?: number;
  volumeDragFactor?: number;
  volumeSurface?: SurfaceModifier;
  underwaterAbility?: boolean;
}
/** Source static Float32 at 0x677c98. Advance once per WheelForces call, in
 * active-car order; cars whose WheelForces is skipped do not advance it. */
export interface MotionContext {
  stopTimer: number;
  /** Installed gProgram_state.current_car; only this object gets the 20 gate. */
  currentCar?: MotionState;
}
export function createMotionContext(): MotionContext {
  return { stopTimer: 0 };
}
export const sharedMotionContext = createMotionContext();
export interface MotionInput {
  throttle: number;
  /** Positive steers left, negative right. Magnitudes below one use analog input. */
  steer: number;
  brake: number;
  handbrake: boolean;
}
export interface MotionGroundHit {
  distance: number;
  normal: Vector3;
  friction: number;
  rollingResistance: number;
  downforce: number;
  bumpiness?: number;
  body?: RigidBody;
  point?: Vector3;
  velocity?: Vector3;
  surface?: import("../world").Surface;
}
export interface MotionGround {
  wheelRaycast?(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
  ): MotionGroundHit | null;
  raycast(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
  ): MotionGroundHit | null;
  /** Native wheel spring reaction into a drivable physics object418870. */
  springReaction?(hit: MotionGroundHit, impulse: Vector3): void;
  supports?(owners: readonly (RigidBody | undefined)[]): void;
  worldWheelContact?(
    wheels: readonly {
      hit: MotionGroundHit | null | undefined;
      load: number;
      point?: Vector3;
    }[],
  ): void;
  sampleOil?(
    wheelPointsMetric: readonly (Vector3 | null)[],
    grounded: readonly boolean[],
  ): readonly number[];
}
export interface MotionParameters {
  mass: number;
  inertia: Vector3;
  /** Mechanics COM in metric force coordinates, model COM multiplied by 6.9. */
  centerOfMass: Vector3;
  /** COM in model coordinates, suitable for RigidProperties. */
  centerOfMassModel: Vector3;
  wheelPositions: [Vector3, Vector3, Vector3, Vector3];
  spring: [number, number];
  damper: [number, number];
  suspensionLength: [number, number];
  /** Immutable source base values used when temporary suspension is assigned/reset. */
  suspensionBase: {
    give: [number, number];
    damping: number;
    spring: [number, number];
    damper: [number, number];
    rideHeight: number;
  };
  maxCurve: number;
  mu: [number, number, number];
  ellipse: number;
  slipMultiplier: number;
  rolling: [number, number];
  initialBrake: number;
  brakeIncrease: number;
  maxGear: number;
  speedRevsRatio: number;
  forceTorqueRatio: number;
  downforceBalanceSpeed: number;
  /** Gaps excluded from this ordinary-road solver, retained for the fidelity audit. */
  unsupported: readonly string[];
  random?: () => number;
}
export interface MotionDebug {
  /** Exact selected wheel faces at this force step; normals/points are world-space. */
  wheelContacts?: readonly (MotionGroundHit | null)[];
  /** Original material_index[] friction and field_0x195c recovery gates. */
  wheelRoadFrictions: readonly number[];
  /** Retained native wheel material slots for FinishCars smoke/skid consumers. */
  wheelSurfaceModifiers?: readonly (SurfaceModifier | undefined)[];
  dynamicWheelSupport: boolean;
  wheelSpringLoads: [number, number, number, number];
  wheelCapacities: [number, number, number, number];
  wheelTyreForces: [number, number, number, number];
  /** Exact rear/front demand passed to native tyre allocation and mark gates. */
  axleDemands: [number, number];
  skidCurrentCar: boolean;
  /** Force-driven mark requests before native contact/material filtering; not traction flags. */
  skidRequests: [boolean, boolean, boolean, boolean];
  axleForces: [Vector3, Vector3];
  grounded: number;
  force: Vector3;
  torque: Vector3;
  downforce: number;
  oilWheelFactors?: readonly number[];
}
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
function unit(v: Vector3, fallback: Vector3): Vector3 {
  return v.length() > EPS ? v.normalize() : v.copy(fallback);
}

/** Resolver is used for source zero positions and returns model-unit local positions. */
export function createMotionParameters(
  source: CarMechanics,
  resolveWheel?: (
    wheel: MechanicsWheel,
  ) => Vector3 | readonly [number, number, number] | undefined,
): MotionParameters {
  const ordered = new Array<MechanicsWheel>(4);
  const positions = new Array<Vector3>(4);
  let rear: MechanicsWheel | undefined, front: MechanicsWheel | undefined;
  for (const wheel of source.wheels) {
    const resolved = wheel.positionFromActor
      ? resolveWheel?.(wheel)
      : undefined;
    const p =
      resolved instanceof Vector3
        ? resolved.clone()
        : new Vector3(...(resolved ?? wheel.position));
    const index = (wheel.steerable ? 2 : 0) + (p.x > 0 ? 1 : 0);
    if (ordered[index])
      throw new Error(`Duplicate mechanics wheel slot ${index}`);
    ordered[index] = wheel;
    positions[index] = p.multiplyScalar(S);
    if (wheel.steerable) front = wheel;
    else rear = wheel;
  }
  if (
    ordered.some((w) => !w) ||
    !rear ||
    !front ||
    positions.filter(Boolean).length !== 4
  )
    throw new Error("Mechanics requires a left/right wheel on both axles");
  const mass = source.root.mass;
  const com = new Vector3(...source.root.centerOfMass).multiplyScalar(S);
  const inertia = new Vector3(...source.root.inertia);
  let minY = Infinity;
  for (const shape of source.shapes) {
    if (shape.kind === "box") minY = Math.min(minY, shape.bounds.min[1]);
    else if (shape.kind === "sphere")
      minY = Math.min(minY, shape.center[1] - shape.radius);
    else for (const p of shape.vertices) minY = Math.min(minY, p[1]);
  }
  if (!Number.isFinite(minY))
    throw new Error("Mechanics requires root collision bounds");
  const rideHeight = (minY + 0.01) * S;
  for (const p of positions) p.y = rideHeight;
  const zr = positions[0].z,
    zf = positions[2].z;
  const ratio = Math.abs((zr - com.z) / (zf - com.z));
  // The local binary crosses source suspension give between the grouped axles.
  const rearGive = front.suspensionGive * S,
    frontGive = rear.suspensionGive * S;
  const rearMass = mass / (ratio + 1),
    frontMass = mass / (1 / ratio + 1);
  if (
    !(
      mass > 0 &&
      rearGive > 0 &&
      frontGive > 0 &&
      ratio > 0 &&
      inertia.x > 0 &&
      inertia.y > 0 &&
      inertia.z > 0
    )
  )
    throw new Error("Invalid mass, inertia or suspension geometry");
  const damping = source.wheels[3].damping;
  const rearLoad = ((zf - com.z) / (zf - zr)) * mass * 5;
  const frontLoad = ((zr - com.z) / (zr - zf)) * mass * 5;
  const angle = (degrees: number, load: number) =>
    (Math.tan(degrees * (157 / 9000)) / 4) * Math.sqrt(load);
  return {
    mass,
    inertia,
    centerOfMass: com,
    centerOfMassModel: com.clone().multiplyScalar(1 / S),
    wheelPositions: positions as MotionParameters["wheelPositions"],
    spring: [(rearMass * 5) / rearGive, (frontMass * 5) / frontGive],
    damper: [
      rearMass * Math.sqrt(5 / rearGive) * damping,
      frontMass * Math.sqrt(5 / frontGive) * damping,
    ],
    suspensionLength: [rideHeight + rearGive, rideHeight + frontGive],
    suspensionBase: {
      give: [rearGive, frontGive],
      damping,
      spring: [(rearMass * 5) / rearGive, (frontMass * 5) / frontGive],
      damper: [
        rearMass * Math.sqrt(5 / rearGive) * damping,
        frontMass * Math.sqrt(5 / frontGive) * damping,
      ],
      rideHeight,
    },
    maxCurve: 1 / (source.minimumTurningCircle * S),
    mu: [
      angle(rear.frictionAngles[0], rearLoad),
      angle(front.frictionAngles[0], frontLoad),
      angle(rear.frictionAngles[1], rearLoad),
    ],
    ellipse: rear.tractionMultiplier,
    slipMultiplier: source.wheels[3].slippingFrictionReduction,
    rolling: [rear.rollingResistance, front.rollingResistance],
    initialBrake: source.brakeMultiplier * 12 * mass,
    brakeIncrease: source.brakingStrengthMultiplier * 12 * mass,
    maxGear: source.gearCount,
    speedRevsRatio: (source.speedAtRedline * 4) / 9 / source.gearCount / 6000,
    forceTorqueRatio: mass * source.highestGearAcceleration * source.gearCount,
    downforceBalanceSpeed: source.root.downforceBalanceSpeed,
    unsupported: ["native groove interruption"],
  };
}

/** Original 0x41fc80 derives give/damping from file values and axle mass from
 * the current wheel/COM geometry. Extra lengths are already metric force units.
 * Its bb2.minY write changes auxiliary overall bounds, not collision vertices.
 */
export function setMotionSuspension(
  p: MotionParameters,
  values: SuspensionPowerupValues,
): void {
  const base = p.suspensionBase;
  const multipliers = [values.rearGiveMultiplier, values.frontGiveMultiplier];
  if (
    multipliers.some((v) => !Number.isFinite(v) || v <= 0) ||
    !Number.isFinite(values.dampingMultiplier)
  )
    throw new Error("Invalid source suspension powerup");
  const extra = [values.rearExtraLength, values.frontExtraLength];
  const ratio = Math.abs(
    (p.wheelPositions[0].z - p.centerOfMass.z) /
      (p.wheelPositions[2].z - p.centerOfMass.z),
  );
  const axleMass = [p.mass / (ratio + 1), p.mass / (1 / ratio + 1)];
  for (let axle = 0; axle < 2; axle++) {
    const give = base.give[axle] * multipliers[axle];
    p.spring[axle] = (axleMass[axle] * 5) / give;
    p.damper[axle] =
      axleMass[axle] *
      Math.sqrt(5 / give) *
      base.damping *
      values.dampingMultiplier;
    p.suspensionLength[axle] =
      base.rideHeight + base.give[axle] * multipliers[axle] + extra[axle];
  }
}

/** BendWheels and structural repair invoke 0x41fc80 with default modifiers
 * after changing wheel positions, resetting temporary suspension settings. */
export function resetMotionSuspension(p: MotionParameters): void {
  setMotionSuspension(p, {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    dampingMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
  });
}

export function initializeMotion(
  state: RigidState,
  p: MotionParameters,
): MotionState {
  return Object.assign(state, {
    curvature: 0,
    turnSpeed: 0,
    gear: 0,
    rpm: 0,
    tractionRpm: 0,
    brakeForce: 0,
    slipping: 0,
    tractionControl: true,
    accForce: 0,
    crestDownforce: false,
    groundedWheelCount: 0,
    bounceRate: 0,
    wheelLengths: p.wheelPositions.map(
      (w) => w.y,
    ) as MotionState["wheelLengths"],
  });
}

/** Source ControlOurCar fault episodes: steering >40, transmission >40.
 * Independent random source is injectable for deterministic replay/tests.
 */
export function applyDamagedControls(
  s: MotionState,
  input: MotionInput,
  dt: number,
  random: () => number = Math.random,
): MotionInput {
  const time = (s.controlTime ?? 0) + dt;
  s.controlTime = time;
  const steeringDamage = s.componentDamage?.[3] ?? 0;
  const transmissionDamage = s.componentDamage?.[1] ?? 0;
  const result = { ...input };
  const chance = (percentage: number) =>
    Math.floor(random() * 100) < Math.trunc(percentage);
  if (steeringDamage > 40) {
    if (s.steeringFaultEnd) {
      if (time < s.steeringFaultEnd || steeringDamage === 99)
        result.steer =
          Number(s.steeringFaultLeft ?? false) -
          Number(s.steeringFaultRight ?? false);
      else s.steeringFaultEnd = 0;
    } else if (
      chance(dt * 1000 * (steeringDamage - 40) * 0.0045) &&
      Math.abs(
        s.velocity.clone().applyQuaternion(s.orientation.clone().invert()).z,
      ) >
        1 / (10000 * S)
    ) {
      if (input.steer !== 0) {
        s.steeringFaultLeft = input.steer <= 0;
        s.steeringFaultRight = input.steer >= 0;
      } else if (chance(50)) s.steeringFaultLeft = true;
      else s.steeringFaultRight = true;
      s.steeringFaultEnd =
        time + (random() * 25 * (steeringDamage - 40)) / 1000;
    }
  }
  if (transmissionDamage > 40) {
    if (s.transmissionFaultEnd) {
      if (time < s.transmissionFaultEnd || transmissionDamage === 99) {
        s.gear = 0;
        s.justChangedGear = true;
      } else s.transmissionFaultEnd = 0;
    } else if (chance(dt * 1000 * (transmissionDamage - 40) * 0.006)) {
      s.transmissionFaultEnd =
        time + (random() * 50 * (transmissionDamage - 40)) / 1000;
    }
  }
  return result;
}

function steering(
  s: MotionState,
  input: number,
  dt: number,
  p: MotionParameters,
  v: Vector3,
  omega: Vector3,
) {
  let t = s.turnSpeed,
    c = s.curvature;
  const a = dt * 25 * (0.05 / (5 + s.velocity.length() * S));
  if (input > 0) {
    if (t < 0) t = 0;
    if (v.z > 0) t += dt * 0.25;
    else if ((c >= 0 && omega.y >= -0.001) || t !== 0) t += a * 0.25;
    else {
      t = a;
      if (omega.y < -0.01) t -= dt * omega.y * 0.25;
    }
  } else if (input < 0) {
    if (t > 0) t = 0;
    if (v.z > 0) t -= dt * 0.25;
    else if ((c <= 0 && omega.y <= 0.001) || t !== 0) t -= a * 0.25;
    else {
      t = -a;
      if (omega.y < -0.01) t -= dt * omega.y * 0.25;
    }
  } else t = 0;
  if (input !== 0 && Math.abs(t) < Math.abs(2 * dt * c) && t * c < 0)
    t = -2 * dt * c;
  c += t;
  if (input !== 0 && Math.abs(input) < 1)
    c = Math.sign(input) * input * input * p.maxCurve;
  s.turnSpeed = t;
  s.curvature = clamp(c, -p.maxCurve, p.maxCurve);
}

export function allocateTyrePair(
  demand: number,
  leftCap: number,
  rightCap: number,
  reduction: number,
): [number, number, boolean] {
  let left = demand,
    right = demand;
  if (demand <= leftCap && demand <= rightCap) return [left, right, false];
  if (demand > leftCap && demand <= rightCap) {
    left = reduction * leftCap;
    right = 2 * demand - left;
    if (right <= rightCap) return [left, right, false];
    return [left, reduction * rightCap, true];
  }
  if (demand <= leftCap && demand > rightCap) {
    right = reduction * rightCap;
    left = 2 * demand - right;
    if (left <= leftCap) return [left, right, false];
    return [reduction * leftCap, right, true];
  }
  return [reduction * leftCap, reduction * rightCap, true];
}

/** Installed 0x418f8e..0x419068 samples metric wheel position PLUS the world
 * normal times the raw ray distance, then projects the bump along local Y. */
export function wheelBumpinessOffset(
  wheelWorldMetric: Vector3,
  worldNormal: Vector3,
  distanceMetric: number,
  localNormalY: number,
  bumpiness: number,
): number {
  const fold = (value: number) => {
    const phase = Math.abs(Math.trunc(value * 512)) % 2048;
    return phase > 1024 ? 2048 - phase : phase;
  };
  // World wheel/normal/distance inputs have source Float32 stores. The Z
  // normal-distance product additionally spills at418f9f before the phase sum.
  const distance = Math.fround(distanceMetric);
  const x = fold(
    Math.fround(wheelWorldMetric.x) + Math.fround(worldNormal.x) * distance,
  );
  const z = fold(
    Math.fround(wheelWorldMetric.z) +
      Math.fround(Math.fround(worldNormal.z) * distance),
  );
  const sum = x + z;
  const delta = Math.max(0, (sum > 1024 ? 2048 - sum : sum) - 400);
  return delta * bumpiness * 2.358490564802196e-5 * localNormalY;
}

/** Adds COM/world velocity and world omega changes; the caller owns transform integration. */
export function applyVehicleForces(
  s: MotionState,
  input: MotionInput,
  dt: number,
  p: MotionParameters,
  ground: MotionGround,
  context: MotionContext = sharedMotionContext,
): MotionDebug {
  const inv = s.orientation.clone().invert();
  const v = s.velocity.clone().applyQuaternion(inv).multiplyScalar(S);
  const omega = s.angularVelocity.clone().applyQuaternion(inv);
  const F = new Vector3(),
    T = new Vector3(),
    normalSum = new Vector3();
  const loads: MotionDebug["wheelSpringLoads"] = [0, 0, 0, 0];
  const caps: MotionDebug["wheelCapacities"] = [0, 0, 0, 0];
  const actual: MotionDebug["wheelTyreForces"] = [0, 0, 0, 0];
  const axleDemands: MotionDebug["axleDemands"] = [0, 0];
  const skidRequests: MotionDebug["skidRequests"] = [
    false,
    false,
    false,
    false,
  ];
  const hits: Array<MotionGroundHit | null> = [];
  const wheelPoints: Array<Vector3 | null> = [];
  const wheelSmashPoints: Array<Vector3 | undefined> = [];
  const wheelGrounded: boolean[] = [];
  const rearDirection = new Vector3(),
    frontDirection = new Vector3();
  let grounded = 0,
    downforce = 0;
  if (!(dt > 0 && Number.isFinite(dt)))
    throw new Error("Motion step must be positive and finite");
  const humanControls = (s.driver ?? 8) >= 7;
  if (humanControls) input = applyDamagedControls(s, input, dt, p.random);
  if (humanControls) steering(s, clamp(input.steer, -1, 1), dt, p, v, omega);
  let throttle = clamp(input.throttle, 0, 1),
    brake = clamp(input.brake, 0, 1);
  const forwardSpeed = -v.z;
  if (humanControls && s.rpm === 0) s.gear = 0;
  const reverse =
    s.gear < 0 ||
    (s.gear === 0 && brake > 0 && throttle === 0 && Math.abs(forwardSpeed) < 1);
  if (humanControls && reverse) [throttle, brake] = [brake, throttle];
  const damage = s.componentDamage ?? [];
  const engineDamage = damage[0] ?? 0;
  let engineTorque =
    -1e-8 * s.rpm ** 2 -
    0.2 +
    1.2 *
      throttle *
      (s.engineFactor ?? 1) *
      (s.powerMultiplier ?? 1) *
      (engineDamage > 10 ? 1 - (engineDamage - 10) * 0.01 : 1);
  if (humanControls && throttle === 0) s.tractionControl = true;
  if (humanControls && brake === 0) s.brakeForce = 0;
  else if (humanControls && s.brakeForce === 0) s.brakeForce = p.initialBrake;
  else if (humanControls)
    s.brakeForce = Math.min(
      p.initialBrake + p.brakeIncrease,
      s.brakeForce + dt * p.brakeIncrease,
    );
  // Driver<7 bypasses player Controls; the AI's forces remain in the same
  // source fields through every PHIL step (installed416bfc/41a19e).
  let accelerationForce = humanControls ? 0 : (s.accForce ?? 0);
  if (humanControls && s.gear !== 0) {
    accelerationForce = (p.forceTorqueRatio * engineTorque) / s.gear;
    if (s.brakeForce !== 0) s.rpm = s.tractionRpm;
    else if (Math.abs(s.rpm - s.tractionRpm) > 1)
      accelerationForce +=
        (s.rpm - s.tractionRpm + engineTorque * dt * 5000) /
        (dt *
          (s.gear / (p.forceTorqueRatio * 0.0002) +
            1 / (p.speedRevsRatio * p.mass * s.gear)));
  }
  const steeringDamage = s.steeringDamageCurvature ?? 0;
  s.curvature += steeringDamage;
  if (humanControls) s.curvature = clamp(s.curvature, -p.maxCurve, p.maxCurve);
  const rayLength = Math.max(...p.suspensionLength) + 0.5;
  const rayDirection = new Vector3(0, -1, 0).applyQuaternion(s.orientation);
  for (let i = 0; i < 4; i++) {
    const w = p.wheelPositions[i],
      axle = i >> 1;
    if (s.wheelEnabled?.[i] === false) {
      hits[i] = null;
      wheelPoints[i] = null;
      wheelGrounded[i] = false;
      s.wheelLengths[i] = p.suspensionLength[axle];
      continue;
    }
    const start = w
      .clone()
      .multiplyScalar(1 / S)
      .applyQuaternion(s.orientation)
      .add(s.position);
    const rawHit = (ground.wheelRaycast ?? ground.raycast).call(
      ground,
      start,
      rayDirection,
      rayLength / S,
    );
    wheelPoints[i] = start.clone().multiplyScalar(S);
    wheelGrounded[i] = false;
    const hit =
      rawHit && s.volumeSurface
        ? {
            ...rawHit,
            friction: s.volumeSurface.tyreFriction,
            downforce: s.volumeSurface.downforce,
            bumpiness: s.volumeSurface.bumpiness,
          }
        : rawHit;
    hits[i] = hit;
    let length = hit ? hit.distance * S : 2 * rayLength;
    if (hit?.bumpiness)
      length += wheelBumpinessOffset(
        start.clone().multiplyScalar(S),
        hit.normal,
        length,
        hit.normal.clone().applyQuaternion(inv).y,
        hit.bumpiness,
      );
    const damageOffset = (s.wheelDamageOffsets?.[i ^ 2] ?? 0) * S;
    if (
      length < -0.5 ||
      length > p.suspensionLength[axle] + damageOffset ||
      !hit
    )
      length = p.suspensionLength[axle];
    else {
      normalSum.add(hit.normal.clone().applyQuaternion(inv));
      wheelGrounded[i] = true;
      grounded++;
      length -= damageOffset;
      let load =
        (p.suspensionLength[axle] - length) * p.spring[axle] -
        (p.damper[axle] * (length - s.wheelLengths[i])) / dt;
      if (
        s.wheelLengths[i] === p.suspensionLength[axle] &&
        hit.normal.dot(s.velocity) * S > -0.01 &&
        load > p.mass * 5
      ) {
        load = p.mass * 5;
        length = p.suspensionLength[axle];
      }
      loads[i] = Math.max(0, load);
      F.y += loads[i];
      T.x -= loads[i] * (w.z - p.centerOfMass.z);
      T.z += loads[i] * (w.x - p.centerOfMass.x);
      if (loads[i] > 0)
        ground.springReaction?.(
          hit,
          new Vector3(0, (-loads[i] * dt) / S, 0).applyQuaternion(
            s.orientation,
          ),
        );
    }
    s.wheelLengths[i] = length;
    if (wheelGrounded[i])
      wheelSmashPoints[i] = start
        .clone()
        .multiplyScalar(S)
        .addScaledVector(rayDirection, length)
        .multiplyScalar(Math.fround(1 / S));
  }
  ground.supports?.(
    hits.map((hit, i) => (wheelGrounded[i] ? hit?.body : undefined)),
  );
  ground.worldWheelContact?.(
    hits.map((hit, i) => ({
      hit: wheelGrounded[i] ? hit : null,
      load: loads[i],
      point: wheelSmashPoints[i],
    })),
  );
  const wallClimb = !!s.wallClimb && (s.driver ?? 8) > 5;
  // HW41958a: test the raw local support sum before normalization. A tiny
  // nonzero sum uses local Y; an exactly zero sum retains ordinary gravity.
  if (
    wallClimb &&
    (normalSum.x !== 0 || normalSum.y !== 0 || normalSum.z !== 0)
  ) {
    const support = normalSum.clone();
    const length = support.length();
    if (length > EPS) support.divideScalar(length);
    else support.set(0, 1, 0);
    F.addScaledVector(support, -p.mass * 10);
  } else {
    F.add(
      new Vector3(
        0,
        -p.mass *
          10 *
          (s.volumeGravityFactor ?? 1) *
          (s.globalGravityMultiplier ?? 1),
        0,
      ).applyQuaternion(inv),
    );
  }
  // GetWheelOil0x4a72d0 tests authored wheel positions in metric coordinates;
  // per-wheel oil values multiply native capacities before tyre allocation.
  const oil = ground.sampleOil?.(wheelPoints, wheelGrounded) ?? [1, 1, 1, 1];
  if (
    humanControls &&
    input.steer === 0 &&
    (s.wheelLengths[2] < p.suspensionLength[1] ||
      s.wheelLengths[3] < p.suspensionLength[1])
  ) {
    let decay =
      (-dt * omega.dot(normalSum)) /
      (p.wheelPositions[0].z - p.wheelPositions[2].z);
    const ordinary = -dt * s.curvature;
    if (Math.abs(decay) < Math.abs(ordinary) || decay * ordinary < 0)
      decay = ordinary;
    s.curvature += decay;
    if (s.curvature * decay > 0) s.curvature = 0;
  }
  s.slipping = 0;
  if (grounded > 0 && normalSum.lengthSq() > EPS * EPS) {
    const n = normalSum.normalize(),
      c = s.curvature;
    const zr = p.wheelPositions[0].z,
      zf = p.wheelPositions[2].z;
    const rearLever = zr - p.centerOfMass.z,
      frontLever = zf - p.centerOfMass.z;
    const ratio = frontLever / rearLever;
    // HW419bf8: wall climbing replaces inclination independently of the
    // gravity branch; material factor, speed scaling and force cap remain.
    const incline = wallClimb
      ? 1
      : n.dot(new Vector3(0, 1, 0).applyQuaternion(inv));
    const downFactor = hits[0]?.downforce ?? 1;
    if (incline * downFactor > 0 && p.downforceBalanceSpeed > 0) {
      downforce = Math.min(
        p.mass * 10,
        (Math.abs(v.z) * p.mass * 10 * incline * downFactor) /
          p.downforceBalanceSpeed,
      );
      // Source419c6a: previous grounded count, but this call's updated front
      // distances. The probe starts at local(0,0,frontZ), spans one wheelbase
      // along negative actor Y, and does not start at the wheel's ride height.
      if (
        s.groundedWheelCount === 4 &&
        s.wheelLengths[2] === p.suspensionLength[1] &&
        s.wheelLengths[3] === p.suspensionLength[1]
      ) {
        const span = zr - zf;
        const origin = new Vector3(0, 0, zf / S)
          .applyQuaternion(s.orientation)
          .add(s.position);
        const support = ground.raycast(
          origin,
          rayDirection.clone().multiplyScalar(Math.sign(span)),
          Math.abs(span) / S,
        );
        if (!support || support.distance > Math.abs(span) / S)
          s.crestDownforce = true;
      } else if (
        s.crestDownforce &&
        (s.wheelLengths[2] < p.suspensionLength[1] ||
          s.wheelLengths[3] < p.suspensionLength[1])
      )
        s.crestDownforce = false;
      if (s.crestDownforce) {
        downforce *= (zf - p.centerOfMass.z) / (zf - zr);
        T.x += rearLever * downforce;
      }
      F.y -= downforce;
    }
    const vp = v.clone().addScaledVector(n, -v.dot(n));
    const direction = vp.z < 0 ? 1 : -1;
    const lateral = unit(new Vector3(n.y, -n.x, 0), new Vector3(1, 0, 0));
    const longitudinal = unit(new Vector3(0, n.z, -n.y), new Vector3(1, 0, 0));
    const iy = p.inertia.y * S2;
    const yawError = direction * c * vp.length() - omega.dot(n);
    const yawForce = ((iy / dt) * yawError) / (zf - zr);
    const sideMismatch =
      vp.dot(lateral) +
      rearLever * vp.dot(longitudinal) * Math.abs(c) * Math.sign(c);
    const correction =
      ((-p.mass / dt) * sideMismatch - F.dot(lateral)) / (1 - ratio);
    let frontSide = yawForce + correction,
      rearSide = -yawForce - ratio * correction;
    let frontLong = (zr - zf) * c * frontSide;
    const stopDemand =
      F.dot(longitudinal) + (p.mass / dt) * v.dot(longitudinal);
    let rearBrake = (s.brakeForce * p.mu[0]) / (p.mu[1] / p.ellipse + p.mu[0]);
    let frontBrake = s.brakeForce - rearBrake;
    const rearDamage = Math.floor(((damage[6] ?? 0) + (damage[7] ?? 0)) / 2);
    const frontDamage = Math.floor(((damage[4] ?? 0) + (damage[5] ?? 0)) / 2);
    if (rearDamage > 20) rearBrake *= (1 - (rearDamage - 20) * 0.0125) ** 2;
    if (frontDamage > 20) frontBrake *= (1 - (frontDamage - 20) * 0.0125) ** 2;
    rearBrake += p.rolling[0] * (loads[0] + loads[1]);
    frontBrake += p.rolling[1] * (loads[2] + loads[3]);
    let frontRetard = frontBrake / Math.sqrt((zr - zf) ** 2 * c * c + 1);
    const retard = rearBrake + frontRetard;
    if (Math.abs(stopDemand) < Math.abs(retard)) {
      const factor = Math.abs(stopDemand / retard);
      rearBrake *= factor;
      frontRetard *= factor;
    }
    if ((frontBrake + rearBrake) * stopDemand < 0) {
      rearBrake = -rearBrake;
      frontRetard = -frontRetard;
    }
    let rearLong = accelerationForce - rearBrake;
    if (input.handbrake && (damage[6] ?? 0) < 60 && (damage[7] ?? 0) < 60) {
      rearLong -= stopDemand - (frontRetard + rearBrake);
      s.gear = 0;
    }
    rearLong /= p.ellipse;
    let rearDemand = Math.hypot(rearLong, rearSide) * 0.5;
    const contactV = new Vector3()
      .crossVectors(omega, p.wheelPositions[0].clone().sub(p.centerOfMass))
      .add(v);
    const countersteer =
      direction > 0 &&
      ((input.steer > 0 && c > 0 && yawError > 0.1 && contactV.x > 0) ||
        (input.steer < 0 && c < 0 && yawError < 0.1 && contactV.x < 0));
    const muRear = countersteer
      ? p.mu[0]
      : p.mu[2] + (p.mu[2] - p.mu[0]) * Math.min(Math.abs(contactV.x) * 0.1, 1);
    caps[0] =
      Math.sqrt(loads[0]) *
      muRear *
      (s.tyreGripFactor ?? 1) *
      (hits[0]?.friction ?? 1) *
      (oil[0] ?? 1);
    caps[1] =
      Math.sqrt(loads[1]) *
      muRear *
      (s.tyreGripFactor ?? 1) *
      (hits[1]?.friction ?? 1) *
      (oil[1] ?? 1);
    const rearCapacity = caps[0] + caps[1];
    if (
      s.tractionControl !== false &&
      oil[0] === 1 &&
      oil[1] === 1 &&
      2 * rearDemand > rearCapacity &&
      accelerationForce > 0 &&
      s.tractionRpm > 1000 &&
      s.gear > 0
    ) {
      const sidePart = Math.sqrt(
        Math.max(0, 4 * rearDemand ** 2 - rearLong ** 2),
      );
      if (rearCapacity <= sidePart) engineTorque = -1e-8 * s.rpm ** 2 - 0.1;
      else {
        const discarded =
          rearLong -
          Math.sign(rearLong) *
            Math.sqrt(Math.max(0, (rearCapacity * 0.99) ** 2 - sidePart ** 2));
        if (Math.abs(discarded) < Math.abs(rearLong)) rearLong -= discarded;
        rearDemand = Math.hypot(rearLong, rearSide) * 0.5;
      }
    } else if (
      s.gear > 0 &&
      s.tractionRpm < s.rpm &&
      s.tractionControl === false
    ) {
      s.tractionControl = true;
      const factor = Math.max(
        0.4,
        1 - (s.rpm - s.tractionRpm) / (s.gear * 400),
      );
      caps[0] *= factor;
      caps[1] *= factor;
    }
    if (Math.abs(rearSide) > caps[0] + caps[1] && caps[0] + caps[1] > 0.1) {
      const h = ((caps[0] + caps[1]) / Math.abs(rearSide)) * dt;
      const impulse = rearSide * h;
      const denominator = -(
        (frontSide * frontLever) ** 2 / iy +
        (frontLong ** 2 + frontSide ** 2) / p.mass
      );
      const numerator =
        (vp.dot(lateral) + impulse / p.mass) * frontSide +
        vp.dot(longitudinal) * frontLong +
        omega.dot(n) * frontLever * frontSide +
        ((rearLever * frontLever * impulse) / iy) * frontSide;
      if (Math.abs(denominator) > 0.1) {
        const factor = numerator / (denominator * dt);
        frontSide *= factor;
        frontLong *= factor;
      }
    }
    frontLong -= frontRetard;
    frontSide += (zr - zf) * c * frontRetard;
    if (rearDemand > 1e-4) {
      rearSide /= 2 * rearDemand;
      rearLong /= 2 * rearDemand;
    }
    rearLong *= p.ellipse;
    rearDirection
      .copy(longitudinal)
      .multiplyScalar(rearLong)
      .addScaledVector(lateral, rearSide);
    const rearAllocation = allocateTyrePair(
      rearDemand,
      caps[0],
      caps[1],
      p.slipMultiplier,
    );
    const rearSkid = nativeTyreSkidRequests(
      rearDemand,
      caps[0],
      caps[1],
      p.slipMultiplier,
      context.currentCar === s,
    );
    axleDemands[0] = rearDemand;
    skidRequests[0] = rearSkid[0];
    skidRequests[1] = rearSkid[1];
    actual[0] = rearAllocation[0];
    actual[1] = rearAllocation[1];
    if (rearAllocation[2]) s.slipping |= 2;
    if (
      s.slipping &&
      s.turnSpeed * c > 0 &&
      Math.abs(rearSide) > 0.01 &&
      c * rearSide < 0 &&
      !input.handbrake
    )
      s.turnSpeed = 0;
    const frontDemand = Math.hypot(frontLong, frontSide) * 0.5;
    if (frontDemand > 1e-4) {
      frontLong /= 2 * frontDemand;
      frontSide /= 2 * frontDemand;
    }
    frontDirection
      .copy(longitudinal)
      .multiplyScalar(frontLong)
      .addScaledVector(lateral, frontSide);
    caps[2] =
      Math.sqrt(loads[2]) *
      p.mu[1] *
      (s.tyreGripFactor ?? 1) *
      (hits[2]?.friction ?? 1) *
      (oil[2] ?? 1);
    caps[3] =
      Math.sqrt(loads[3]) *
      p.mu[1] *
      (s.tyreGripFactor ?? 1) *
      (hits[3]?.friction ?? 1) *
      (oil[3] ?? 1);
    const frontAllocation = allocateTyrePair(
      frontDemand,
      caps[2],
      caps[3],
      p.slipMultiplier,
    );
    const frontSkid = nativeTyreSkidRequests(
      frontDemand,
      caps[2],
      caps[3],
      p.slipMultiplier,
      context.currentCar === s,
    );
    axleDemands[1] = frontDemand;
    skidRequests[2] = frontSkid[0];
    skidRequests[3] = frontSkid[1];
    actual[2] = frontAllocation[0];
    actual[3] = frontAllocation[1];
    if (frontAllocation[2]) s.slipping |= 1;
    for (let i = 0; i < 4; i++) {
      const f = (i < 2 ? rearDirection : frontDirection)
        .clone()
        .multiplyScalar(actual[i]);
      const r = p.wheelPositions[i].clone().sub(p.centerOfMass);
      r.y -= s.wheelLengths[i];
      F.add(f);
      T.add(new Vector3().crossVectors(r, f));
    }
  }
  s.groundedWheelCount = grounded;
  s.velocity.addScaledVector(
    F.clone().applyQuaternion(s.orientation),
    dt / (p.mass * S),
  );
  const deltaOmega = new Vector3(
    T.x / p.inertia.x,
    T.y / p.inertia.y,
    T.z / p.inertia.z,
  )
    .multiplyScalar(dt * INV_S2)
    .applyQuaternion(s.orientation);
  s.angularVelocity.add(deltaOmega);
  // Installed41bc52 skips this feedback store for nonhuman drivers.
  if (humanControls) s.accForce = -rearDirection.z * (actual[0] + actual[1]);
  let timer = context.stopTimer;
  // Native41bb03: the null-volume branch skips BOTH gravity divisions.
  const settlingForce =
    s.settlingVolumeGravity === undefined
      ? F.length()
      : F.length() / s.settlingVolumeGravity / (s.globalGravityMultiplier ?? 1);
  if (
    s.velocity.lengthSq() < 0.10000000149011612 &&
    (throttle === 0 || s.gear === 0) &&
    brake === 0 &&
    (s.bounceRate ?? 0) === 0 &&
    s.angularVelocity.length() < 0.05 &&
    (settlingForce < p.mass || (input.handbrake && grounded > 2))
  ) {
    if (timer === 100) timer = 0;
    if (timer > 0.5) {
      s.velocity.set(0, 0, 0);
      s.angularVelocity.set(0, 0, 0);
      timer = 0.5;
    }
  }
  //41bc1f stores Float32 before comparing the threshold, retaining the
  // original strict boundaries and per-car accumulation order.
  timer = Math.fround(timer + Math.fround(dt));
  context.stopTimer = timer > 1 ? 100 : timer;
  const drag = dt * 0.0005000000237487257 * (s.volumeDragFactor ?? 1);
  s.velocity.multiplyScalar(
    Math.max(0, 1 - (s.velocity.length() * drag * S) / p.mass),
  );
  const bodyOmega = s.angularVelocity.clone().applyQuaternion(inv),
    omegaLength = bodyOmega.length();
  bodyOmega.set(
    bodyOmega.x * Math.max(0, 1 - (omegaLength * drag * INV_S2) / p.inertia.x),
    bodyOmega.y * Math.max(0, 1 - (omegaLength * drag * INV_S2) / p.inertia.y),
    bodyOmega.z * Math.max(0, 1 - (omegaLength * drag * INV_S2) / p.inertia.z),
  );
  s.angularVelocity.copy(bodyOmega.applyQuaternion(s.orientation));
  if (humanControls) {
    const speed = -s.velocity.clone().applyQuaternion(inv).z * S;
    s.tractionRpm = s.gear !== 0 ? speed / p.speedRevsRatio / s.gear : 0;
    if (s.tractionRpm < 0) {
      s.tractionRpm = 0;
      s.gear = 0;
    }
    let spinForce = engineTorque * p.forceTorqueRatio;
    if (grounded) spinForce -= s.gear * (s.accForce ?? 0);
    if (s.gear === 0 && s.rpm > 1000 && throttle > 0 && !input.handbrake) {
      s.gear = reverse ? -1 : 1;
      s.tractionRpm = speed / p.speedRevsRatio / s.gear;
    } else if (s.gear < 2 && brake > 0 && Math.abs(speed) < 1 && s.rpm > 1000)
      s.gear = -s.gear;
    s.rpm = Math.max(0, s.rpm + (dt * 5000 * spinForce) / p.forceTorqueRatio);
    if (
      s.tractionControl !== false &&
      spinForce > 0 &&
      s.tractionRpm < s.rpm &&
      s.gear !== 0 &&
      s.tractionRpm > 1000
    )
      s.rpm = s.tractionRpm;
    while (
      s.tractionRpm > 6000 &&
      s.gear > 0 &&
      s.gear < p.maxGear &&
      !s.justChangedGear
    ) {
      s.tractionRpm *= s.gear / (s.gear + 1);
      s.gear++;
    }
    while (s.gear > 1 && s.tractionRpm < 3000 && !s.justChangedGear) {
      s.tractionRpm *= s.gear / (s.gear - 1);
      s.gear--;
    }
    if (
      s.rpm < 200 &&
      s.tractionRpm < 200 &&
      s.gear < 2 &&
      throttle === 0 &&
      !s.justChangedGear
    )
      s.gear = 0;
    if (
      s.justChangedGear &&
      s.rpm < 6000 &&
      s.rpm > 200 &&
      (s.gear < 2 || s.rpm >= 3000)
    )
      s.justChangedGear = false;
    if (s.rpm >= 6000 && throttle > 0) s.justChangedGear = false;
  }
  s.curvature -= steeringDamage;
  return {
    wheelContacts: hits,
    wheelSpringLoads: loads,
    wheelRoadFrictions: hits.map((hit) => hit?.friction ?? 0),
    wheelSurfaceModifiers: hits.map(
      (hit) => s.volumeSurface ?? hit?.surface?.modifier,
    ),
    dynamicWheelSupport: hits.some((hit, i) => wheelGrounded[i] && !!hit?.body),
    wheelCapacities: caps,
    wheelTyreForces: actual,
    axleDemands,
    skidCurrentCar: context.currentCar === s,
    skidRequests,
    axleForces: [
      rearDirection.clone().multiplyScalar(actual[0] + actual[1]),
      frontDirection.clone().multiplyScalar(actual[2] + actual[3]),
    ],
    grounded,
    force: F,
    torque: T,
    downforce,
    oilWheelFactors: oil,
  };
}

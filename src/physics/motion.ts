import { Vector3 } from "three";
import type { CarMechanics, MechanicsWheel } from "../mechanics";
import type { RigidState } from "./contact";

/** Local HW binary 0x418870, 0x415320, 0x417600 and 0x41fc80.
 * Independently expressed equations; positions are model units, forces use S=6.9.
 */
export const C2_WORLD_SCALE = 6.9;
const S = C2_WORLD_SCALE;
const S2 = 47.61000061035156;
const INV_S2 = 0.02100399136543274;
const EPS = 2 ** -22;

export interface MotionState extends RigidState {
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
  tractionControl?: boolean;
  accForce?: number;
  stopTimer?: number;
}
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
}
export interface MotionGround {
  raycast(origin: Vector3, direction: Vector3, maxDistance: number): MotionGroundHit | null;
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
}
export interface MotionDebug {
  wheelSpringLoads: [number, number, number, number];
  wheelCapacities: [number, number, number, number];
  wheelTyreForces: [number, number, number, number];
  axleForces: [Vector3, Vector3];
  grounded: number;
  force: Vector3;
  torque: Vector3;
  downforce: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function unit(v: Vector3, fallback: Vector3): Vector3 {
  return v.length() > EPS ? v.normalize() : v.copy(fallback);
}

/** Resolver is used for source zero positions and returns model-unit local positions. */
export function createMotionParameters(
  source: CarMechanics,
  resolveWheel?: (wheel: MechanicsWheel) => Vector3 | readonly [number, number, number] | undefined,
): MotionParameters {
  const ordered = new Array<MechanicsWheel>(4);
  const positions = new Array<Vector3>(4);
  let rear: MechanicsWheel | undefined, front: MechanicsWheel | undefined;
  for (const wheel of source.wheels) {
    const resolved = wheel.positionFromActor ? resolveWheel?.(wheel) : undefined;
    const p = resolved instanceof Vector3 ? resolved.clone() : new Vector3(...(resolved ?? wheel.position));
    const index = (wheel.steerable ? 2 : 0) + (p.x > 0 ? 1 : 0);
    if (ordered[index]) throw new Error(`Duplicate mechanics wheel slot ${index}`);
    ordered[index] = wheel;
    positions[index] = p.multiplyScalar(S);
    if (wheel.steerable) front = wheel; else rear = wheel;
  }
  if (ordered.some((w) => !w) || !rear || !front || positions.filter(Boolean).length !== 4)
    throw new Error("Mechanics requires a left/right wheel on both axles");
  const mass = source.root.mass;
  const com = new Vector3(...source.root.centerOfMass).multiplyScalar(S);
  const inertia = new Vector3(...source.root.inertia);
  let minY = Infinity;
  for (const shape of source.shapes) {
    if (shape.kind === "box") minY = Math.min(minY, shape.bounds.min[1]);
    else if (shape.kind === "sphere") minY = Math.min(minY, shape.center[1] - shape.radius);
    else for (const p of shape.vertices) minY = Math.min(minY, p[1]);
  }
  if (!Number.isFinite(minY)) throw new Error("Mechanics requires root collision bounds");
  const rideHeight = (minY + 0.01) * S;
  for (const p of positions) p.y = rideHeight;
  const zr = positions[0].z, zf = positions[2].z;
  const ratio = Math.abs((zr - com.z) / (zf - com.z));
  // The local binary crosses source suspension give between the grouped axles.
  const rearGive = front.suspensionGive * S, frontGive = rear.suspensionGive * S;
  const rearMass = mass / (ratio + 1), frontMass = mass / (1 / ratio + 1);
  if (!(mass > 0 && rearGive > 0 && frontGive > 0 && ratio > 0 && inertia.x > 0 && inertia.y > 0 && inertia.z > 0))
    throw new Error("Invalid mass, inertia or suspension geometry");
  const damping = source.wheels[3].damping;
  const rearLoad = (zf - com.z) / (zf - zr) * mass * 5;
  const frontLoad = (zr - com.z) / (zr - zf) * mass * 5;
  const angle = (degrees: number, load: number) => Math.tan(degrees * (157 / 9000)) / 4 * Math.sqrt(load);
  return {
    mass, inertia, centerOfMass: com, centerOfMassModel: com.clone().multiplyScalar(1 / S),
    wheelPositions: positions as MotionParameters["wheelPositions"],
    spring: [rearMass * 5 / rearGive, frontMass * 5 / frontGive],
    damper: [rearMass * Math.sqrt(5 / rearGive) * damping, frontMass * Math.sqrt(5 / frontGive) * damping],
    suspensionLength: [rideHeight + rearGive, rideHeight + frontGive],
    maxCurve: 1 / (source.minimumTurningCircle * S),
    mu: [angle(rear.frictionAngles[0], rearLoad), angle(front.frictionAngles[0], frontLoad), angle(rear.frictionAngles[1], rearLoad)],
    ellipse: rear.tractionMultiplier,
    slipMultiplier: source.wheels[3].slippingFrictionReduction,
    rolling: [rear.rollingResistance, front.rollingResistance],
    initialBrake: source.brakeMultiplier * 12 * mass,
    brakeIncrease: source.brakingStrengthMultiplier * 12 * mass,
    maxGear: source.gearCount,
    speedRevsRatio: source.speedAtRedline * 4 / 9 / source.gearCount / 6000,
    forceTorqueRatio: mass * source.highestGearAcceleration * source.gearCount,
    downforceBalanceSpeed: source.root.downforceBalanceSpeed,
    unsupported: ["special volumes/water", "oil", "dynamic platform reactions", "crest downforce flag", "powerup multipliers", "original shared stop timer"],
  };
}

export function initializeMotion(state: RigidState, p: MotionParameters): MotionState {
  return Object.assign(state, {
    curvature: 0, turnSpeed: 0, gear: 0, rpm: 0, tractionRpm: 0,
    brakeForce: 0, slipping: 0, tractionControl: true, accForce: 0, stopTimer: 100,
    wheelLengths: p.wheelPositions.map((w) => w.y) as MotionState["wheelLengths"],
  });
}

function steering(s: MotionState, input: number, dt: number, p: MotionParameters, v: Vector3, omega: Vector3) {
  let t = s.turnSpeed, c = s.curvature;
  const a = dt * 25 * (0.05 / (5 + s.velocity.length() * S));
  if (input > 0) {
    if (t < 0) t = 0;
    if (v.z > 0) t += dt * 0.25;
    else if ((c >= 0 && omega.y >= -0.001) || t !== 0) t += a * 0.25;
    else { t = a; if (omega.y < -0.01) t -= dt * omega.y * 0.25; }
  } else if (input < 0) {
    if (t > 0) t = 0;
    if (v.z > 0) t -= dt * 0.25;
    else if ((c <= 0 && omega.y <= 0.001) || t !== 0) t -= a * 0.25;
    else { t = -a; if (omega.y < -0.01) t -= dt * omega.y * 0.25; }
  } else t = 0;
  if (input !== 0 && Math.abs(t) < Math.abs(2 * dt * c) && t * c < 0) t = -2 * dt * c;
  c += t;
  if (input !== 0 && Math.abs(input) < 1) c = Math.sign(input) * input * input * p.maxCurve;
  s.turnSpeed = t;
  s.curvature = clamp(c, -p.maxCurve, p.maxCurve);
}

export function allocateTyrePair(demand: number, leftCap: number, rightCap: number, reduction: number): [number, number, boolean] {
  let left = demand, right = demand;
  if (demand <= leftCap && demand <= rightCap) return [left, right, false];
  if (demand > leftCap && demand <= rightCap) {
    left = reduction * leftCap; right = 2 * demand - left;
    if (right <= rightCap) return [left, right, false];
    return [left, reduction * rightCap, true];
  }
  if (demand <= leftCap && demand > rightCap) {
    right = reduction * rightCap; left = 2 * demand - right;
    if (left <= leftCap) return [left, right, false];
    return [reduction * leftCap, right, true];
  }
  return [reduction * leftCap, reduction * rightCap, true];
}

/** Adds COM/world velocity and world omega changes; the caller owns transform integration. */
export function applyVehicleForces(s: MotionState, input: MotionInput, dt: number, p: MotionParameters, ground: MotionGround): MotionDebug {
  const inv = s.orientation.clone().invert();
  const v = s.velocity.clone().applyQuaternion(inv).multiplyScalar(S);
  const omega = s.angularVelocity.clone().applyQuaternion(inv);
  const F = new Vector3(), T = new Vector3(), normalSum = new Vector3();
  const loads: MotionDebug["wheelSpringLoads"] = [0, 0, 0, 0];
  const caps: MotionDebug["wheelCapacities"] = [0, 0, 0, 0];
  const actual: MotionDebug["wheelTyreForces"] = [0, 0, 0, 0];
  const hits: Array<MotionGroundHit | null> = [];
  const rearDirection = new Vector3(), frontDirection = new Vector3();
  let grounded = 0, downforce = 0;
  if (!(dt > 0 && Number.isFinite(dt))) throw new Error("Motion step must be positive and finite");
  steering(s, clamp(input.steer, -1, 1), dt, p, v, omega);
  let throttle = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
  const forwardSpeed = -v.z;
  if (s.rpm === 0) s.gear = 0;
  const reverse = s.gear < 0 || (s.gear === 0 && brake > 0 && throttle === 0 && Math.abs(forwardSpeed) < 1);
  if (reverse) [throttle, brake] = [brake, throttle];
  const damage = s.componentDamage ?? [];
  const engineDamage = damage[0] ?? 0;
  let engineTorque = -1e-8 * s.rpm ** 2 - 0.2 + 1.2 * throttle * (engineDamage > 10 ? 1 - (engineDamage - 10) * 0.01 : 1);
  if (throttle === 0) s.tractionControl = true;
  if (brake === 0) s.brakeForce = 0;
  else if (s.brakeForce === 0) s.brakeForce = p.initialBrake;
  else s.brakeForce = Math.min(p.initialBrake + p.brakeIncrease, s.brakeForce + dt * p.brakeIncrease);
  let accelerationForce = 0;
  if (s.gear !== 0) {
    accelerationForce = p.forceTorqueRatio * engineTorque / s.gear;
    if (s.brakeForce !== 0) s.rpm = s.tractionRpm;
    else if (Math.abs(s.rpm - s.tractionRpm) > 1)
      accelerationForce += (s.rpm - s.tractionRpm + engineTorque * dt * 5000) /
        (dt * (s.gear / (p.forceTorqueRatio * 0.0002) + 1 / (p.speedRevsRatio * p.mass * s.gear)));
  }
  const steeringDamage = s.steeringDamageCurvature ?? 0;
  s.curvature = clamp(s.curvature + steeringDamage, -p.maxCurve, p.maxCurve);
  const rayLength = Math.max(...p.suspensionLength) + 0.5;
  const rayDirection = new Vector3(0, -1, 0).applyQuaternion(s.orientation);
  for (let i = 0; i < 4; i++) {
    const w = p.wheelPositions[i], axle = i >> 1;
    const start = w.clone().multiplyScalar(1 / S).applyQuaternion(s.orientation).add(s.position);
    const hit = ground.raycast(start, rayDirection, rayLength / S);
    hits[i] = hit;
    let length = hit ? hit.distance * S : 2 * rayLength;
    const damageOffset = (s.wheelDamageOffsets?.[i ^ 2] ?? 0) * S;
    if (length < -0.5 || length > p.suspensionLength[axle] + damageOffset || !hit) length = p.suspensionLength[axle];
    else {
      normalSum.add(hit.normal.clone().applyQuaternion(inv)); grounded++;
      length -= damageOffset;
      let load = (p.suspensionLength[axle] - length) * p.spring[axle] - p.damper[axle] * (length - s.wheelLengths[i]) / dt;
      if (s.wheelLengths[i] === p.suspensionLength[axle] && hit.normal.dot(s.velocity) * S > -0.01 && load > p.mass * 5) {
        load = p.mass * 5; length = p.suspensionLength[axle];
      }
      loads[i] = Math.max(0, load);
      F.y += loads[i];
      T.x -= loads[i] * (w.z - p.centerOfMass.z);
      T.z += loads[i] * (w.x - p.centerOfMass.x);
    }
    s.wheelLengths[i] = length;
  }
  F.add(new Vector3(0, -p.mass * 10, 0).applyQuaternion(inv));
  if (input.steer === 0 && (s.wheelLengths[2] < p.suspensionLength[1] || s.wheelLengths[3] < p.suspensionLength[1])) {
    let decay = -dt * omega.dot(normalSum) / (p.wheelPositions[0].z - p.wheelPositions[2].z);
    const ordinary = -dt * s.curvature;
    if (Math.abs(decay) < Math.abs(ordinary) || decay * ordinary < 0) decay = ordinary;
    s.curvature += decay;
    if (s.curvature * decay > 0) s.curvature = 0;
  }
  s.slipping = 0;
  if (grounded > 0 && normalSum.lengthSq() > EPS * EPS) {
    const n = normalSum.normalize(), c = s.curvature;
    const zr = p.wheelPositions[0].z, zf = p.wheelPositions[2].z;
    const rearLever = zr - p.centerOfMass.z, frontLever = zf - p.centerOfMass.z;
    const ratio = frontLever / rearLever;
    const incline = n.dot(new Vector3(0, 1, 0).applyQuaternion(inv));
    const downFactor = hits[0]?.downforce ?? 1;
    if (incline * downFactor > 0 && p.downforceBalanceSpeed > 0) {
      downforce = Math.min(p.mass * 10, Math.abs(v.z) * p.mass * 10 * incline * downFactor / p.downforceBalanceSpeed);
      F.y -= downforce;
    }
    const vp = v.clone().addScaledVector(n, -v.dot(n));
    const direction = vp.z < 0 ? 1 : -1;
    const lateral = unit(new Vector3(n.y, -n.x, 0), new Vector3(1, 0, 0));
    const longitudinal = unit(new Vector3(0, n.z, -n.y), new Vector3(1, 0, 0));
    const iy = p.inertia.y * S2;
    const yawError = direction * c * vp.length() - omega.dot(n);
    const yawForce = iy / dt * yawError / (zf - zr);
    const sideMismatch = vp.dot(lateral) + rearLever * vp.dot(longitudinal) * Math.abs(c) * Math.sign(c);
    const correction = (-p.mass / dt * sideMismatch - F.dot(lateral)) / (1 - ratio);
    let frontSide = yawForce + correction, rearSide = -yawForce - ratio * correction;
    let frontLong = (zr - zf) * c * frontSide;
    const stopDemand = F.dot(longitudinal) + p.mass / dt * v.dot(longitudinal);
    let rearBrake = s.brakeForce * p.mu[0] / (p.mu[1] / p.ellipse + p.mu[0]);
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
      const factor = Math.abs(stopDemand / retard); rearBrake *= factor; frontRetard *= factor;
    }
    if ((frontBrake + rearBrake) * stopDemand < 0) { rearBrake = -rearBrake; frontRetard = -frontRetard; }
    let rearLong = accelerationForce - rearBrake;
    if (input.handbrake && (damage[6] ?? 0) < 60 && (damage[7] ?? 0) < 60) {
      rearLong -= stopDemand - (frontRetard + rearBrake); s.gear = 0;
    }
    rearLong /= p.ellipse;
    let rearDemand = Math.hypot(rearLong, rearSide) * 0.5;
    const contactV = new Vector3().crossVectors(omega, p.wheelPositions[0].clone().sub(p.centerOfMass)).add(v);
    const countersteer = direction > 0 && ((input.steer > 0 && c > 0 && yawError > 0.1 && contactV.x > 0) || (input.steer < 0 && c < 0 && yawError < 0.1 && contactV.x < 0));
    const muRear = countersteer ? p.mu[0] : p.mu[2] + (p.mu[2] - p.mu[0]) * Math.min(Math.abs(contactV.x) * 0.1, 1);
    caps[0] = Math.sqrt(loads[0]) * muRear * (hits[0]?.friction ?? 1);
    caps[1] = Math.sqrt(loads[1]) * muRear * (hits[1]?.friction ?? 1);
    const rearCapacity = caps[0] + caps[1];
    if (s.tractionControl !== false && 2 * rearDemand > rearCapacity && accelerationForce > 0 && s.tractionRpm > 1000 && s.gear > 0) {
      const sidePart = Math.sqrt(Math.max(0, 4 * rearDemand ** 2 - rearLong ** 2));
      if (rearCapacity <= sidePart) engineTorque = -1e-8 * s.rpm ** 2 - 0.1;
      else {
        const discarded = rearLong - Math.sign(rearLong) * Math.sqrt(Math.max(0, (rearCapacity * 0.99) ** 2 - sidePart ** 2));
        if (Math.abs(discarded) < Math.abs(rearLong)) rearLong -= discarded;
        rearDemand = Math.hypot(rearLong, rearSide) * 0.5;
      }
    } else if (s.gear > 0 && s.tractionRpm < s.rpm && s.tractionControl === false) {
      s.tractionControl = true;
      const factor = Math.max(0.4, 1 - (s.rpm - s.tractionRpm) / (s.gear * 400)); caps[0] *= factor; caps[1] *= factor;
    }
    if (Math.abs(rearSide) > caps[0] + caps[1] && caps[0] + caps[1] > 0.1) {
      const h = (caps[0] + caps[1]) / Math.abs(rearSide) * dt;
      const impulse = rearSide * h;
      const denominator = -((frontSide * frontLever) ** 2 / iy + (frontLong ** 2 + frontSide ** 2) / p.mass);
      const numerator = (vp.dot(lateral) + impulse / p.mass) * frontSide + vp.dot(longitudinal) * frontLong + omega.dot(n) * frontLever * frontSide + rearLever * frontLever * impulse / iy * frontSide;
      if (Math.abs(denominator) > 0.1) { const factor = numerator / (denominator * dt); frontSide *= factor; frontLong *= factor; }
    }
    frontLong -= frontRetard; frontSide += (zr - zf) * c * frontRetard;
    if (rearDemand > 1e-4) { rearSide /= 2 * rearDemand; rearLong /= 2 * rearDemand; }
    rearLong *= p.ellipse;
    rearDirection.copy(longitudinal).multiplyScalar(rearLong).addScaledVector(lateral, rearSide);
    const rearAllocation = allocateTyrePair(rearDemand, caps[0], caps[1], p.slipMultiplier);
    actual[0] = rearAllocation[0]; actual[1] = rearAllocation[1];
    if (rearAllocation[2]) s.slipping |= 2;
    if (s.slipping && s.turnSpeed * c > 0 && Math.abs(rearSide) > 0.01 && c * rearSide < 0 && !input.handbrake) s.turnSpeed = 0;
    const frontDemand = Math.hypot(frontLong, frontSide) * 0.5;
    if (frontDemand > 1e-4) { frontLong /= 2 * frontDemand; frontSide /= 2 * frontDemand; }
    frontDirection.copy(longitudinal).multiplyScalar(frontLong).addScaledVector(lateral, frontSide);
    caps[2] = Math.sqrt(loads[2]) * p.mu[1] * (hits[2]?.friction ?? 1);
    caps[3] = Math.sqrt(loads[3]) * p.mu[1] * (hits[3]?.friction ?? 1);
    const frontAllocation = allocateTyrePair(frontDemand, caps[2], caps[3], p.slipMultiplier);
    actual[2] = frontAllocation[0]; actual[3] = frontAllocation[1];
    if (frontAllocation[2]) s.slipping |= 1;
    for (let i = 0; i < 4; i++) {
      const f = (i < 2 ? rearDirection : frontDirection).clone().multiplyScalar(actual[i]);
      const r = p.wheelPositions[i].clone().sub(p.centerOfMass); r.y -= s.wheelLengths[i];
      F.add(f); T.add(new Vector3().crossVectors(r, f));
    }
  }
  s.velocity.addScaledVector(F.clone().applyQuaternion(s.orientation), dt / (p.mass * S));
  const deltaOmega = new Vector3(T.x / p.inertia.x, T.y / p.inertia.y, T.z / p.inertia.z).multiplyScalar(dt * INV_S2).applyQuaternion(s.orientation);
  s.angularVelocity.add(deltaOmega);
  s.accForce = -rearDirection.z * (actual[0] + actual[1]);
  let timer = s.stopTimer ?? 100;
  if (s.velocity.lengthSq() < 0.1 && (throttle === 0 || s.gear === 0) && brake === 0 && s.angularVelocity.length() < 0.05 && (F.length() < p.mass || (input.handbrake && grounded > 2))) {
    if (timer === 100) timer = 0;
    if (timer > 0.5) { s.velocity.set(0, 0, 0); s.angularVelocity.set(0, 0, 0); timer = 0.5; }
  }
  timer += dt; s.stopTimer = timer > 1 ? 100 : timer;
  const drag = dt * 0.0005000000237487257;
  s.velocity.multiplyScalar(Math.max(0, 1 - s.velocity.length() * drag * S / p.mass));
  const bodyOmega = s.angularVelocity.clone().applyQuaternion(inv), omegaLength = bodyOmega.length();
  bodyOmega.set(bodyOmega.x * Math.max(0, 1 - omegaLength * drag * INV_S2 / p.inertia.x), bodyOmega.y * Math.max(0, 1 - omegaLength * drag * INV_S2 / p.inertia.y), bodyOmega.z * Math.max(0, 1 - omegaLength * drag * INV_S2 / p.inertia.z));
  s.angularVelocity.copy(bodyOmega.applyQuaternion(s.orientation));
  const speed = -s.velocity.clone().applyQuaternion(inv).z * S;
  s.tractionRpm = s.gear !== 0 ? speed / p.speedRevsRatio / s.gear : 0;
  if (s.tractionRpm < 0) { s.tractionRpm = 0; s.gear = 0; }
  let spinForce = engineTorque * p.forceTorqueRatio;
  if (grounded) spinForce -= s.gear * s.accForce;
  if (s.gear === 0 && s.rpm > 1000 && throttle > 0 && !input.handbrake) {
    s.gear = reverse ? -1 : 1; s.tractionRpm = speed / p.speedRevsRatio / s.gear;
  } else if (s.gear < 2 && brake > 0 && Math.abs(speed) < 1 && s.rpm > 1000) s.gear = -s.gear;
  s.rpm = Math.max(0, s.rpm + dt * 5000 * spinForce / p.forceTorqueRatio);
  if (s.tractionControl !== false && spinForce > 0 && s.tractionRpm < s.rpm && s.gear !== 0 && s.tractionRpm > 1000) s.rpm = s.tractionRpm;
  while (s.tractionRpm > 6000 && s.gear > 0 && s.gear < p.maxGear) { s.tractionRpm *= s.gear / (s.gear + 1); s.gear++; }
  while (s.gear > 1 && s.tractionRpm < 3000) { s.tractionRpm *= s.gear / (s.gear - 1); s.gear--; }
  if (s.rpm < 200 && s.tractionRpm < 200 && s.gear < 2 && throttle === 0) s.gear = 0;
  s.curvature -= steeringDamage;
  return { wheelSpringLoads: loads, wheelCapacities: caps, wheelTyreForces: actual, axleForces: [rearDirection.clone().multiplyScalar(actual[0] + actual[1]), frontDirection.clone().multiplyScalar(actual[2] + actual[3])], grounded, force: F, torque: T, downforce };
}

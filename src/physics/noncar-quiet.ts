import { Box3, Vector3 } from "three";
import type { NonCarBody } from "./noncar-body";
import { hullsBounds } from "./geometry";
import { evaluateNativeQuietLeaf, type NativeQuietResult } from "./quiet-state";

const f = Math.fround;

/** Independent quiet/snapshot state. ec is explicit doNothing state; it is not
 * inferred from a noncar's motor sleep flag or from elapsed time. */
export interface State {
  doNothing: boolean;
  quietState: number;
  beforeWorldV: Vector3;
  beforeLocalOmega: Vector3;
  gravityIncrement: Vector3;
  /** Native solver-local +1a8 cache; the contact solver may mutate it. */
  localVelocity: Vector3;
  auxiliaryLocalOmega: Vector3;
  inertiaScale: 1 | 50;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  unsupported: string[];
  lastResult?: NativeQuietResult;
  /** Diagnostics retain one-tick eligibility across render/polling frames. */
  eligibleLeaves: number;
  sleepTransitions: number;
  wakeTransitions: number;
}

export interface Support {
  supported: boolean;
  reasons: string[];
}

function finiteVector(vector: Vector3, name: string): void {
  if (
    ![vector.x, vector.y, vector.z].every((value) => Number.isFinite(f(value)))
  )
    throw new Error(`Invalid native noncar quiet ${name}`);
}
function number(value: number, name: string): number {
  const rounded = f(value);
  if (!Number.isFinite(rounded))
    throw new Error(`Invalid native noncar quiet ${name}`);
  return rounded;
}
function snapshotBounds(bounds: Box3): State["bounds"] {
  if (bounds.isEmpty())
    throw new Error("Native noncar quiet body has no hull bounds");
  return {
    min: bounds.min.toArray().map((value) => number(value, "bound")) as [
      number,
      number,
      number,
    ],
    max: bounds.max.toArray().map((value) => number(value, "bound")) as [
      number,
      number,
      number,
    ],
  };
}

/** Narrow support only for free, unjointed, ordinary simple noncar bodies. */
export function support(body: NonCarBody): Support {
  const reasons: string[] = [];
  if (body.attached) reasons.push("attached-body");
  if (body.joint) reasons.push("active-joint");
  if (body.mechanics.worldJoint) reasons.push("authored-world-joint");
  if (body.mechanics.tumble) reasons.push("tumble-mechanics");
  if (body.mechanics.infiniteInertia) reasons.push("infinite-inertia");
  if (!body.hulls.length) reasons.push("missing-hulls");
  else if (hullsBounds(body.hulls).isEmpty()) reasons.push("empty-hull-bounds");
  if (!(Number.isFinite(f(body.properties.mass)) && body.properties.mass > 0))
    reasons.push("invalid-mass");
  if (
    !body.properties.inertia
      .toArray()
      .every((value) => Number.isFinite(f(value)) && value > 0)
  )
    reasons.push("invalid-inertia");
  if (
    !body.properties.centerOfMass
      .toArray()
      .every((value) => Number.isFinite(f(value)))
  )
    reasons.push("invalid-centre-of-mass");
  return { supported: reasons.length === 0, reasons };
}

/** Create caller-owned state; disconnected props begin as singleton candidates.
 * The owning simulation decides when a connected contact ring retains quiet. */
export function createState(body: NonCarBody): State {
  const validation = support(body);
  const bounds = body.hulls.length
    ? snapshotBounds(hullsBounds(body.hulls))
    : {
        min: [0, 0, 0] as [number, number, number],
        max: [0, 0, 0] as [number, number, number],
      };
  return {
    doNothing: false,
    quietState: 0,
    beforeWorldV: new Vector3(),
    beforeLocalOmega: new Vector3(),
    gravityIncrement: new Vector3(),
    localVelocity: new Vector3(),
    auxiliaryLocalOmega: new Vector3(),
    inertiaScale: 1,
    bounds,
    unsupported: validation.reasons,
    eligibleLeaves: 0,
    sleepTransitions: 0,
    wakeTransitions: 0,
  };
}

function requireSupported(body: NonCarBody, state: State): void {
  if (state.unsupported.length)
    throw new Error(
      `Unsupported native noncar quiet body: ${state.unsupported.join(", ")}`,
    );
  const current = support(body);
  if (!current.supported)
    throw new Error(
      `Unsupported native noncar quiet body: ${current.reasons.join(", ")}`,
    );
  if (state.inertiaScale !== 1)
    throw new Error("Native noncar quiet inertia is still solver-scaled");
}

/** Installed InternalPrepareObject snapshot, after forces and before contacts.
 * Retained quiet state inflates awake solver moments by f32(*50), then finish
 * restores and spills them before running the source leaf evaluator. */
export function prepare(
  body: NonCarBody,
  state: State,
  actualGravityIncrement: Vector3,
): void {
  requireSupported(body, state);
  finiteVector(actualGravityIncrement, "gravity increment");
  state.gravityIncrement.set(
    f(actualGravityIncrement.x),
    f(actualGravityIncrement.y),
    f(actualGravityIncrement.z),
  );
  state.beforeWorldV.copy(body.state.velocity);
  state.beforeLocalOmega
    .copy(body.state.angularVelocity)
    .applyQuaternion(body.state.orientation.clone().invert());
  state.localVelocity
    .copy(body.state.velocity)
    .applyQuaternion(body.state.orientation.clone().invert());
  if (state.quietState !== 0 && !state.doNothing) {
    body.properties.inertia.multiplyScalar(50);
    body.properties.inertia.set(
      f(body.properties.inertia.x),
      f(body.properties.inertia.y),
      f(body.properties.inertia.z),
    );
    state.inertiaScale = 50;
  }
}

function restoreInertia(body: NonCarBody, state: State): void {
  if (state.inertiaScale !== 50) return;
  body.properties.inertia.divideScalar(50);
  body.properties.inertia.set(
    f(body.properties.inertia.x),
    f(body.properties.inertia.y),
    f(body.properties.inertia.z),
  );
  state.inertiaScale = 1;
}

/** Restore native moments, evaluate the exact shared leaf kernel, and apply
 * only its source velocity-zeroing outputs. Ring membership/sleep stays upstream. */
export function finish(
  body: NonCarBody,
  state: State,
  singleton: boolean,
  solverLocalVelocity: Vector3 = state.localVelocity,
): NativeQuietResult {
  if (state.unsupported.length)
    throw new Error(
      `Unsupported native noncar quiet body: ${state.unsupported.join(", ")}`,
    );
  if (!Number.isFinite(body.properties.mass) || body.properties.mass <= 0)
    throw new Error("Invalid native noncar quiet mass");
  finiteVector(solverLocalVelocity, "solver-local velocity");
  restoreInertia(body, state);
  const validation = support(body);
  if (!validation.supported)
    throw new Error(
      `Unsupported native noncar quiet body: ${validation.reasons.join(", ")}`,
    );
  const bounds = state.bounds,
    localOmega = body.state.angularVelocity
      .clone()
      .applyQuaternion(body.state.orientation.clone().invert()),
    com = body.properties.centerOfMass;
  const result = evaluateNativeQuietLeaf({
    previousQuietState: state.quietState,
    singleton,
    collisionFlags: body.collisionFlags,
    doNothing: state.doNothing,
    beforeWorldVelocity: state.beforeWorldV.toArray() as [
      number,
      number,
      number,
    ],
    worldVelocity: body.state.velocity.toArray() as [number, number, number],
    beforeLocalOmega: state.beforeLocalOmega.toArray() as [
      number,
      number,
      number,
    ],
    localOmega: localOmega.toArray() as [number, number, number],
    localVelocity: solverLocalVelocity.toArray() as [number, number, number],
    gravityIncrement: state.gravityIncrement.toArray() as [
      number,
      number,
      number,
    ],
    mass: body.properties.mass,
    inertia: body.properties.inertia.toArray() as [number, number, number],
    bounds,
    centreOfMass: com.toArray() as [number, number, number],
    jointInfoOrientationY: null,
  });
  state.quietState = result.quietState;
  state.lastResult = result;
  if (result.quietEligible) state.eligibleLeaves++;
  if (result.zeroVelocities) {
    body.state.velocity.set(0, 0, 0);
    body.state.angularVelocity.set(0, 0, 0);
    state.auxiliaryLocalOmega.set(0, 0, 0);
  }
  return result;
}

/** Caller may use this only after its complete contact ring passes the native
 * group fold; mixed-ring membership and application are simulation-owned. */
export function sleep(body: NonCarBody, state: State): void {
  requireSupported(body, state);
  if ((state.quietState & 2) === 0)
    throw new Error(
      "Native noncar quiet sleep requires an eligible leaf state",
    );
  if (!state.doNothing) state.sleepTransitions++;
  state.doNothing = true;
  body.properties.immovable = true;
  state.quietState = 0;
}
/** Explicit contact/wake event. Motor sleeping and elapsed time are irrelevant. */
export function wake(body: NonCarBody, state: State): void {
  requireSupported(body, state);
  if (state.doNothing) state.wakeTransitions++;
  state.doNothing = false;
  body.properties.immovable = false;
  state.quietState = 0;
}

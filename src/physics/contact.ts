import { Quaternion, Vector3 } from "three";
import {
  buildJointConstraints,
  applyJointConstraintImpulses,
  jointConstraintImpacts,
  projectQuickHingeVelocities,
  selectQuickHinges,
} from "./joint";
import type { RigidJoint, JointConstraintImpact } from "./joint";
export type { JointConstraintImpact } from "./joint";

/** Actor origin and solver-frame orientation; velocities refer to the COM. */
export interface RigidState {
  position: Vector3;
  orientation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3; // World coordinates.
  /** Candidate actor transform after advancing the original 40 ms step. */
  predictedPosition?: Vector3;
  predictedOrientation?: Quaternion;
}

export interface RigidProperties {
  mass: number;
  inertia: Vector3; // Diagonal body inertia, mass * model-unit squared.
  centerOfMass: Vector3;
  objectFriction?: number; // Original default is 0.4.
  worldFriction: number;
  rotationLocked?: boolean;
  /** Native dormant object/world anchor: no velocity response until activated. */
  immovable?: boolean;
}

export interface RigidBody {
  state: RigidState;
  properties: RigidProperties;
}

export interface Contact {
  a: RigidBody;
  b?: RigidBody;
  point: Vector3;
  /** Independent B solver-frame lever for candidate-frame car/car contacts. */
  pointB?: Vector3;
  normal: Vector3; // Unit world normal pointing from B toward A.
  penetration?: number;
  faceFriction?: number;
  /** Original world feature flags0=edge,1=body vertex,2=world vertex;5=pair. */
  sourceType?: number;
  sourceSurface?: import("../world").Surface;
}

export interface ContactImpact extends Contact {
  normalImpulse: number;
  closingSpeed: number;
  tangentImpulse: Vector3; // World impulse applied to A.
}

/** Return false when the callback changed collision geometry and the caller
 * must recollect/re-solve this group. No contact, joint or friction impulses
 * from that solve are then applied. Individual type9 rows are also disabled. */
export type BeforeContactApply = (
  impacts: ContactImpact[],
  jointImpacts: JointConstraintImpact[],
) => void | boolean;

// Independently expressed rigid-body equations. Original HW impact branch:
// 0x4bac60; impulse update: 0x4b7700; friction: 0x4c0870.
const NORMAL_BIAS = 0.01;
const IMPACT_MULTIPLIER = 1.001;
const ORIGINAL_STEP = 0.04;
const FRICTION_SCALE = 0.35;
const scratchLever = new Vector3();
const scratchTorque = new Vector3();
const scratchDelta = new Vector3();

function rotate(
  value: Vector3,
  orientation: Quaternion,
  target: Vector3,
  inverse = false,
): Vector3 {
  const sign = inverse ? -1 : 1;
  const qx = orientation.x * sign;
  const qy = orientation.y * sign;
  const qz = orientation.z * sign;
  const qw = orientation.w;
  const x = value.x,
    y = value.y,
    z = value.z;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return target.set(
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  );
}

function lever(
  state: RigidState,
  properties: RigidProperties,
  point: Vector3,
  target: Vector3,
): Vector3 {
  rotate(properties.centerOfMass, state.orientation, target);
  return target.negate().add(point).sub(state.position);
}

function inverseInertia(body: RigidBody, torque: Vector3, target: Vector3) {
  if (body.properties.rotationLocked || body.properties.immovable)
    return target.set(0, 0, 0);
  rotate(torque, body.state.orientation, target, true);
  const inertia = body.properties.inertia;
  target.set(target.x / inertia.x, target.y / inertia.y, target.z / inertia.z);
  return rotate(target, body.state.orientation, target);
}

export function pointVelocity(
  state: RigidState,
  properties: RigidProperties,
  point: Vector3,
  target = new Vector3(),
): Vector3 {
  lever(state, properties, point, scratchLever);
  return target
    .crossVectors(state.angularVelocity, scratchLever)
    .add(state.velocity);
}

export function applyImpulse(
  state: RigidState,
  properties: RigidProperties,
  point: Vector3,
  impulse: Vector3,
): void {
  if (properties.immovable) return;
  lever(state, properties, point, scratchLever);
  scratchTorque.crossVectors(scratchLever, impulse);
  inverseInertia({ state, properties }, scratchTorque, scratchDelta);
  state.velocity.addScaledVector(impulse, 1 / properties.mass);
  state.angularVelocity.add(scratchDelta);
}

export function inverseMass(body: RigidBody): number {
  return body.properties.immovable ? 0 : 1 / body.properties.mass;
}

interface ContactRow {
  body: RigidBody;
  direction: Vector3;
  torque: Vector3;
  angularResponse: Vector3;
}

function row(body: RigidBody, point: Vector3, direction: Vector3): ContactRow {
  const torque = lever(body.state, body.properties, point, new Vector3()).cross(
    direction,
  );
  return {
    body,
    direction,
    torque,
    angularResponse: inverseInertia(body, torque, new Vector3()),
  };
}

function coupling(a: ContactRow[], b: ContactRow[]): number {
  let value = 0;
  for (const x of a) {
    for (const y of b) {
      if (x.body.state === y.body.state) {
        value += x.direction.dot(y.direction) * inverseMass(x.body);
        value += x.torque.dot(y.angularResponse);
      }
    }
  }
  return value;
}

/** Dense Gaussian elimination with only numerical regularization for redundancy. */
function linearSolve(
  matrix: number[][],
  rhs: number[],
  active: number[],
): number[] {
  const count = active.length;
  const scale = Math.max(...active.map((i) => matrix[i][i]), 1e-30);
  const work = active.map((i, r) => [
    ...active.map((j, c) => matrix[i][j] + (r === c ? scale * 1e-12 : 0)),
    rhs[i],
  ]);
  for (let column = 0; column < count; column++) {
    let pivot = column;
    for (let r = column + 1; r < count; r++) {
      if (Math.abs(work[r][column]) > Math.abs(work[pivot][column])) pivot = r;
    }
    [work[column], work[pivot]] = [work[pivot], work[column]];
    const divisor = work[column][column];
    for (let c = column; c <= count; c++) work[column][c] /= divisor;
    for (let r = column + 1; r < count; r++) {
      const factor = work[r][column];
      for (let c = column; c <= count; c++)
        work[r][c] -= factor * work[column][c];
    }
  }
  const solution = new Array<number>(count).fill(0);
  for (let r = count - 1; r >= 0; r--) {
    let value = work[r][count];
    for (let c = r + 1; c < count; c++) value -= work[r][c] * solution[c];
    solution[r] = value;
  }
  return solution;
}

/** Independent active-set solve: lambda >= 0, K lambda - b >= 0. */
function solveNormals(
  matrix: number[][],
  rhs: number[],
  unilateral = rhs.map(() => true),
): number[] {
  const count = rhs.length;
  const impulses = new Array<number>(count).fill(0);
  const active = Array.from({ length: count }, (_, i) => i);
  const tolerance = 1e-9 * Math.max(1, ...rhs);
  for (let iteration = 0; iteration < 4 * count * count + 1; iteration++) {
    impulses.fill(0);
    if (active.length) {
      const solution = linearSolve(matrix, rhs, active);
      let negative = -1;
      for (let i = 0; i < active.length; i++) {
        impulses[active[i]] = solution[i];
        if (
          unilateral[active[i]] &&
          solution[i] < -tolerance &&
          (negative < 0 || solution[i] < solution[negative])
        ) {
          negative = i;
        }
      }
      if (negative >= 0) {
        active.splice(negative, 1);
        continue;
      }
    }
    let worst = -1,
      minimum = -tolerance;
    for (let i = 0; i < count; i++) {
      if (active.includes(i)) continue;
      let slack = -rhs[i];
      for (let j = 0; j < count; j++) slack += matrix[i][j] * impulses[j];
      if (slack < minimum) {
        minimum = slack;
        worst = i;
      }
    }
    if (worst < 0)
      return impulses.map((value, i) =>
        unilateral[i] ? Math.max(0, value) : value,
      );
    active.push(worst);
  }
  // Degenerate active sets can cycle. Projected coordinate descent solves the
  // same nonnegative quadratic without introducing a physical compliance.
  impulses.fill(0);
  for (let pass = 0; pass < 2000; pass++) {
    let change = 0;
    for (let i = 0; i < count; i++) {
      let residual = rhs[i];
      for (let j = 0; j < count; j++) residual -= matrix[i][j] * impulses[j];
      const value = impulses[i] + residual / matrix[i][i];
      const next = unilateral[i] ? Math.max(0, value) : value;
      change = Math.max(change, Math.abs(next - impulses[i]));
      impulses[i] = next;
    }
    if (change < tolerance) break;
  }
  return impulses;
}

function restingRhs(contact: Contact): number {
  const a = contact.a.state;
  const localPoint = rotate(
    contact.point.clone().sub(a.position),
    a.orientation,
    new Vector3(),
    true,
  );
  const predictedPoint = rotate(
    localPoint,
    a.predictedOrientation ?? a.orientation,
    new Vector3(),
  ).add(a.predictedPosition ?? a.position);
  if (!contact.b) {
    const displacement = rotate(
      predictedPoint.sub(a.position),
      a.orientation,
      predictedPoint,
      true,
    ).sub(localPoint);
    const normal = rotate(contact.normal, a.orientation, new Vector3(), true);
    return Math.max(
      NORMAL_BIAS,
      NORMAL_BIAS - normal.dot(displacement) / ORIGINAL_STEP,
    );
  }
  const b = contact.b.state;
  const localB = rotate(
    (contact.pointB ?? contact.point).clone().sub(b.position),
    b.orientation,
    new Vector3(),
    true,
  );
  const predictedBPoint = rotate(
    localB,
    b.predictedOrientation ?? b.orientation,
    new Vector3(),
  ).add(b.predictedPosition ?? b.position);
  const oldRelative = rotate(
    contact.point.clone().sub(contact.pointB ?? contact.point),
    b.orientation,
    new Vector3(),
    true,
  );
  const newRelative = rotate(
    predictedPoint.sub(predictedBPoint),
    b.predictedOrientation ?? b.orientation,
    predictedPoint,
    true,
  );
  const normal = rotate(contact.normal, b.orientation, new Vector3(), true);
  return Math.max(
    NORMAL_BIAS,
    -normal.dot(newRelative.sub(oldRelative)) / ORIGINAL_STEP,
  );
}

interface FrictionBody {
  body: RigidBody;
  localLever: Vector3;
  localVelocity: Vector3;
  localOmega: Vector3;
  candidate: Quaternion;
}
function frictionBody(
  body: RigidBody,
  point: Vector3,
  velocities: Map<RigidState, Vector3>,
): FrictionBody {
  let localVelocity = velocities.get(body.state);
  if (!localVelocity) {
    localVelocity = rotate(
      body.state.velocity,
      body.state.orientation,
      new Vector3(),
      true,
    );
    velocities.set(body.state, localVelocity);
  }
  return {
    body,
    localVelocity,
    localLever: rotate(
      point.clone().sub(body.state.position),
      body.state.orientation,
      new Vector3(),
      true,
    ).sub(body.properties.centerOfMass),
    localOmega: rotate(
      body.state.angularVelocity,
      body.state.orientation,
      new Vector3(),
      true,
    ),
    candidate: body.state.predictedOrientation ?? body.state.orientation,
  };
}
function frictionSlip(entry: FrictionBody, leverScale = 1): Vector3 {
  return entry.localOmega
    .clone()
    .cross(entry.localLever)
    .multiplyScalar(leverScale)
    .add(entry.localVelocity)
    .applyQuaternion(entry.candidate);
}
function frictionResponse(
  entry: FrictionBody,
  worldTangent: Vector3,
): { tangent: Vector3; response: Vector3; inverseMass: number } {
  const tangent = rotate(worldTangent, entry.candidate, new Vector3(), true);
  const torque = entry.localLever.clone().cross(tangent);
  const response =
    entry.body.properties.rotationLocked || entry.body.properties.immovable
      ? new Vector3()
      : torque.clone().divide(entry.body.properties.inertia);
  return {
    tangent,
    response,
    inverseMass: inverseMass(entry.body) + torque.dot(response),
  };
}
function frictionApply(
  entry: FrictionBody,
  worldTangent: Vector3,
  tangent: Vector3,
  response: Vector3,
  magnitude: number,
): void {
  entry.body.state.velocity.addScaledVector(
    worldTangent,
    magnitude * inverseMass(entry.body),
  );
  entry.localVelocity.addScaledVector(
    tangent,
    magnitude * inverseMass(entry.body),
  );
  entry.body.state.angularVelocity.addScaledVector(
    rotate(response, entry.body.state.orientation, new Vector3()),
    magnitude,
  );
}
function limitFrictionOmega(body: RigidBody): void {
  const rotationSquared =
    body.state.angularVelocity.lengthSq() * 0.0015999999595806003;
  if (rotationSquared > 2.464900016784668) {
    body.state.angularVelocity.divideScalar(
      2 * Math.sqrt(rotationSquared) * 0.6369426250457764,
    );
  }
}
function resolveFriction(
  contact: ContactImpact,
  velocities: Map<RigidState, Vector3>,
): boolean {
  if (contact.normalImpulse <= 0) return false;
  const a = frictionBody(contact.a, contact.point, velocities);
  const b = contact.b
    ? frictionBody(contact.b, contact.pointB ?? contact.point, velocities)
    : undefined;
  const slip = frictionSlip(
    a,
    !b && contact.sourceType === 1 ? 1 - 0.004999999888241291 : 1,
  );
  if (b) slip.sub(frictionSlip(b));
  slip.addScaledVector(contact.normal, -slip.dot(contact.normal));
  let speed = slip.length();
  if (speed < 0.001) return false;
  const tangent = slip.multiplyScalar(-1 / speed);
  const responseA = frictionResponse(a, tangent);
  const responseB = b ? frictionResponse(b, tangent) : undefined;
  let effectiveInverseMass =
    responseA.inverseMass + (responseB?.inverseMass ?? 0);
  if (!b) {
    const normal = rotate(
      contact.normal,
      a.body.state.orientation,
      new Vector3(),
      true,
    );
    const normalSpin = a.localOmega.dot(normal);
    if (
      Math.abs(normalSpin) < 0.10000000149011612 &&
      a.localOmega.dot(responseA.response) < 0 &&
      a.body.state.velocity.lengthSq() < 0.001
    ) {
      a.localOmega.addScaledVector(normal, -normalSpin);
      rotate(
        a.localOmega,
        a.body.state.orientation,
        a.body.state.angularVelocity,
      );
      responseA.response.set(0, 0, 0);
      speed = a.localVelocity.length();
      if (speed < 0.001) return false;
      responseA.tangent.copy(a.localVelocity).multiplyScalar(-1 / speed);
      tangent.copy(responseA.tangent).applyQuaternion(a.candidate);
      effectiveInverseMass = inverseMass(a.body);
    }
  }
  if (Math.abs(effectiveInverseMass) <= 0.0001) return false;
  const friction = b
    ? (1 + (a.body.properties.objectFriction ?? 0.4)) *
      (1 + (b.body.properties.objectFriction ?? 0.4))
    : (1 + a.body.properties.worldFriction) * (contact.faceFriction ?? 1);
  const magnitude = Math.min(
    speed / effectiveInverseMass,
    Math.max(0, FRICTION_SCALE * contact.normalImpulse * friction),
  );
  contact.tangentImpulse.copy(tangent).multiplyScalar(magnitude);
  frictionApply(a, tangent, responseA.tangent, responseA.response, magnitude);
  if (b && responseB)
    frictionApply(
      b,
      tangent,
      responseB.tangent,
      responseB.response,
      -magnitude,
    );
  return true;
}

/**
 * Resolve one connected contact group. Positions/orientations are not changed.
 * The original rest branch measures solver-to-candidate transform drift rather
 * than arbitrary penetration. Its fixed factor 25 is retained regardless of dt.
 * Optional joints add signed anchor/hinge rows and angular limits to the same
 * matrix. Friction retains candidate-frame transport and original world modes.
 */
export function resolveContacts(
  contacts: Contact[],
  _dt = ORIGINAL_STEP,
  joints: RigidJoint[] = [],
  beforeApply?: BeforeContactApply,
): ContactImpact[] {
  if (!contacts.length && !joints.length) return [];
  // C2's hidden quick-hinge rows are already satisfied before it measures
  // closing speeds. Full bilateral rows below implement the same projected
  // normal response by Schur equivalence, including impulses on the partner.
  selectQuickHinges(joints);
  for (const joint of joints)
    if (joint.quickHinge) projectQuickHingeVelocities(joint);
  const relative = new Vector3();
  const otherVelocity = new Vector3();
  const impacts = contacts.map((contact) => {
    pointVelocity(
      contact.a.state,
      contact.a.properties,
      contact.point,
      relative,
    );
    if (contact.b)
      relative.sub(
        pointVelocity(
          contact.b.state,
          contact.b.properties,
          contact.pointB ?? contact.point,
          otherVelocity,
        ),
      );
    return {
      ...contact,
      point: contact.point.clone(),
      pointB: contact.pointB?.clone(),
      normal: contact.normal.clone(),
      normalImpulse: 0,
      closingSpeed: Math.max(0, -contact.normal.dot(relative)),
      tangentImpulse: new Vector3(),
    };
  });
  const jointConstraints = buildJointConstraints(joints);
  const impactBranch =
    jointConstraints.some(
      (row) => row.unilateral && (row.closingSpeed ?? 0) >= 0.001,
    ) || impacts.some((impact) => impact.closingSpeed > NORMAL_BIAS);
  const rhs = impacts.map((impact) =>
    impactBranch
      ? NORMAL_BIAS + IMPACT_MULTIPLIER * impact.closingSpeed
      : restingRhs(impact),
  );
  for (const row of jointConstraints)
    rhs.push(
      row.unilateral
        ? impactBranch
          ? Math.max(0.001, row.closingSpeed ?? 0)
          : (row.restRhs ?? row.rhs)
        : row.rhs,
    );
  const rows = contacts.map((contact) => {
    const values = [row(contact.a, contact.point, contact.normal)];
    if (contact.b)
      values.push(
        row(
          contact.b,
          contact.pointB ?? contact.point,
          contact.normal.clone().negate(),
        ),
      );
    return values;
  });
  for (const joint of jointConstraints)
    rows.push(
      joint.jacobians.map((entry) => ({
        body: entry.body,
        direction: entry.linear,
        torque: entry.angular,
        angularResponse: entry.response,
      })),
    );
  const matrix = rows.map((a) => rows.map((b) => coupling(a, b)));
  const normalImpulses = solveNormals(matrix, rhs, [
    ...contacts.map(() => true),
    ...jointConstraints.map((row) => row.unilateral),
  ]);
  for (let i = 0; i < impacts.length; i++)
    impacts[i].normalImpulse = normalImpulses[i];
  const jointImpacts = jointConstraintImpacts(
    jointConstraints,
    normalImpulses.slice(contacts.length),
    contacts.length,
  );
  if (beforeApply?.(impacts, jointImpacts) === false) return impacts;
  const angularDelta = new Vector3();
  for (let i = 0; i < impacts.length; i++) {
    const contact = impacts[i];
    if (contact.sourceType === 9 || contact.normalImpulse === 0) continue;
    // The original stores the lever in the contact record before its callback.
    // A split can change COM/mass/inertia without changing that saved lever.
    for (const entry of rows[i]) {
      const body = entry.body;
      body.state.velocity.addScaledVector(
        entry.direction,
        contact.normalImpulse * inverseMass(body),
      );
      inverseInertia(body, entry.torque, angularDelta);
      body.state.angularVelocity.addScaledVector(
        angularDelta,
        contact.normalImpulse,
      );
    }
  }
  applyJointConstraintImpulses(
    joints,
    jointConstraints,
    jointImpacts.map((impact) =>
      impact.sourceType === 9 ? 0 : impact.normalImpulse,
    ),
  );
  const frictionVelocities = new Map<RigidState, Vector3>();
  for (const contact of impacts) {
    if (contact.sourceType === 9 || contact.normalImpulse === 0) continue;
    const applied = resolveFriction(contact, frictionVelocities);
    if (contact.b || applied) limitFrictionOmega(contact.a);
    if (contact.b) limitFrictionOmega(contact.b);
  }
  return impacts;
}

/** Partition the contact/joint graph by shared rigid state. The world does not
 * connect separate bodies: C2 selects impact versus rest for each object group.
 * Contacts and joints retain their supplied order within each group. */
export function resolveContactGroups(
  contacts: Contact[],
  dt = ORIGINAL_STEP,
  joints: RigidJoint[] = [],
  beforeApply?: BeforeContactApply,
): ContactImpact[] {
  const parents = new Map<RigidState, RigidState>();
  const find = (state: RigidState): RigidState => {
    const parent = parents.get(state);
    if (!parent) {
      parents.set(state, state);
      return state;
    }
    if (parent === state) return state;
    const root = find(parent);
    parents.set(state, root);
    return root;
  };
  const join = (a: RigidBody, b?: RigidBody) => {
    const root = find(a.state);
    if (b) parents.set(find(b.state), root);
  };
  for (const contact of contacts) join(contact.a, contact.b);
  for (const joint of joints) join(joint.parent, joint.child);
  const groups = new Map<
    RigidState,
    { contacts: Contact[]; joints: RigidJoint[] }
  >();
  const group = (body: RigidBody) => {
    const root = find(body.state);
    let value = groups.get(root);
    if (!value) {
      value = { contacts: [], joints: [] };
      groups.set(root, value);
    }
    return value;
  };
  for (const contact of contacts) group(contact.a).contacts.push(contact);
  for (const joint of joints) group(joint.parent).joints.push(joint);
  const results = new Map<Contact, ContactImpact>();
  for (const value of groups.values()) {
    const impacts = resolveContacts(
      value.contacts,
      dt,
      value.joints,
      beforeApply,
    );
    for (let i = 0; i < impacts.length; i++)
      results.set(value.contacts[i], impacts[i]);
  }
  return contacts.map((contact) => results.get(contact)!);
}

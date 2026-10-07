import { Quaternion, Vector3 } from "three";

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
}

export interface RigidBody {
  state: RigidState;
  properties: RigidProperties;
}

export interface Contact {
  a: RigidBody;
  b?: RigidBody;
  point: Vector3;
  normal: Vector3; // Unit world normal pointing from B toward A.
  penetration?: number;
  faceFriction?: number;
}

export interface ContactImpact extends Contact {
  normalImpulse: number;
  closingSpeed: number;
  tangentImpulse: Vector3; // World impulse applied to A.
}

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
  if (body.properties.rotationLocked) return target.set(0, 0, 0);
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
  lever(state, properties, point, scratchLever);
  scratchTorque.crossVectors(scratchLever, impulse);
  inverseInertia({ state, properties }, scratchTorque, scratchDelta);
  state.velocity.addScaledVector(impulse, 1 / properties.mass);
  state.angularVelocity.add(scratchDelta);
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
        value += x.direction.dot(y.direction) / x.body.properties.mass;
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
function solveNormals(matrix: number[][], rhs: number[]): number[] {
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
    if (worst < 0) return impulses.map((value) => Math.max(0, value));
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
      const next = Math.max(0, impulses[i] + residual / matrix[i][i]);
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
  const oldRelative = rotate(
    contact.point.clone().sub(b.position),
    b.orientation,
    new Vector3(),
    true,
  );
  const newRelative = rotate(
    predictedPoint.sub(b.predictedPosition ?? b.position),
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

/**
 * Resolve one connected contact group. Positions/orientations are not changed.
 * The original rest branch measures solver-to-candidate transform drift rather
 * than arbitrary penetration. Its fixed factor 25 is retained regardless of dt.
 * Joint limits and original special rolling/static-friction flags are excluded.
 */
export function resolveContacts(
  contacts: Contact[],
  _dt = ORIGINAL_STEP,
): ContactImpact[] {
  if (!contacts.length) return [];
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
          contact.point,
          otherVelocity,
        ),
      );
    return {
      ...contact,
      point: contact.point.clone(),
      normal: contact.normal.clone(),
      normalImpulse: 0,
      closingSpeed: Math.max(0, -contact.normal.dot(relative)),
      tangentImpulse: new Vector3(),
    };
  });
  const impactBranch = impacts.some(
    (impact) => impact.closingSpeed > NORMAL_BIAS,
  );
  const rhs = impacts.map((impact) =>
    impactBranch
      ? NORMAL_BIAS + IMPACT_MULTIPLIER * impact.closingSpeed
      : restingRhs(impact),
  );
  const rows = contacts.map((contact) => {
    const values = [row(contact.a, contact.point, contact.normal)];
    if (contact.b)
      values.push(
        row(contact.b, contact.point, contact.normal.clone().negate()),
      );
    return values;
  });
  const matrix = rows.map((a) => rows.map((b) => coupling(a, b)));
  const normalImpulses = solveNormals(matrix, rhs);
  const impulse = new Vector3();
  for (let i = 0; i < impacts.length; i++) {
    const contact = impacts[i];
    contact.normalImpulse = normalImpulses[i];
    impulse.copy(contact.normal).multiplyScalar(contact.normalImpulse);
    applyImpulse(contact.a.state, contact.a.properties, contact.point, impulse);
    if (contact.b)
      applyImpulse(
        contact.b.state,
        contact.b.properties,
        contact.point,
        impulse.negate(),
      );
  }
  for (const contact of impacts) {
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
          contact.point,
          otherVelocity,
        ),
      );
    relative.addScaledVector(contact.normal, -relative.dot(contact.normal));
    const speed = relative.length();
    if (speed < 0.001 || contact.normalImpulse <= 0) continue;
    const tangent = relative.multiplyScalar(-1 / speed);
    const tangentRows = [row(contact.a, contact.point, tangent)];
    if (contact.b)
      tangentRows.push(row(contact.b, contact.point, tangent.clone().negate()));
    const inverseMass = coupling(tangentRows, tangentRows);
    if (Math.abs(inverseMass) <= 0.0001) continue;
    const friction = contact.b
      ? (1 + (contact.a.properties.objectFriction ?? 0.4)) *
        (1 + (contact.b.properties.objectFriction ?? 0.4))
      : (1 + contact.a.properties.worldFriction) * (contact.faceFriction ?? 1);
    const magnitude = Math.min(
      speed / inverseMass,
      Math.max(0, FRICTION_SCALE * contact.normalImpulse * friction),
    );
    contact.tangentImpulse.copy(tangent).multiplyScalar(magnitude);
    applyImpulse(
      contact.a.state,
      contact.a.properties,
      contact.point,
      contact.tangentImpulse,
    );
    if (contact.b)
      applyImpulse(
        contact.b.state,
        contact.b.properties,
        contact.point,
        impulse.copy(contact.tangentImpulse).negate(),
      );
  }
  return impacts;
}

import { Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";

export interface JointPlaneLimit {
  childDirection: Vector3;
  parentNormal: Vector3;
}
export interface RigidJoint {
  type: "ball" | "hinge" | "universal";
  child: RigidBody;
  parent: RigidBody;
  childAnchor: Vector3;
  parentAnchor: Vector3;
  childAxis?: Vector3;
  parentAxis?: Vector3;
  /** SDB type4; a second hinge sharing either body becomes ordinary type1. */
  quickHinge?: boolean;
  /** Source child-local transverse basis, independent of the flap limit radial. */
  hingeBasis?: [Vector3, Vector3];
  planeLimits: JointPlaneLimit[];
  /** Original nonzero object mode permits constraints already inside the margin. */
  allowNearBoundary?: boolean;
}
export interface JointReaction {
  joint: RigidJoint;
  linearImpulse: Vector3;
  angularImpulse: Vector3;
  constraintImpulses: number[];
}

const STEP = 0.04;
const ANGULAR_BIAS = 0.001;
const axisBasis = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
];
const worldPoint = (body: RigidBody, point: Vector3) =>
  point
    .clone()
    .applyQuaternion(body.state.orientation)
    .add(body.state.position);
const worldDirection = (
  body: RigidBody,
  direction: Vector3,
  predicted = false,
) =>
  direction
    .clone()
    .applyQuaternion(
      predicted
        ? (body.state.predictedOrientation ?? body.state.orientation)
        : body.state.orientation,
    );

export function createBallJoint(
  child: RigidBody,
  parent: RigidBody,
  childAnchor: Vector3,
  parentAnchor: Vector3,
  planeLimits: JointPlaneLimit[] = [],
): RigidJoint {
  return {
    type: "ball",
    child,
    parent,
    childAnchor: childAnchor.clone(),
    parentAnchor: parentAnchor.clone(),
    planeLimits,
  };
}
export function createHingeJoint(
  child: RigidBody,
  parent: RigidBody,
  childAnchor: Vector3,
  parentAnchor: Vector3,
  childAxis: Vector3,
  parentAxis: Vector3,
  planeLimits: JointPlaneLimit[] = [],
): RigidJoint {
  return {
    ...createBallJoint(child, parent, childAnchor, parentAnchor, planeLimits),
    type: "hinge",
    childAxis: childAxis.clone().normalize(),
    parentAxis: parentAxis.clone().normalize(),
  };
}

export interface OrdinaryDetachGeometry {
  vertexIndex: number;
  cornerBits: number;
  side: number;
}

/** Original ordinary-part setup selects a corner nearest any car bounds plane,
 * then the nearest authored vertex. Indexed joints retain their authored index. */
export function selectOrdinaryDetachGeometry(
  vertices: readonly Vector3[],
  carMin: Vector3,
  carMax: Vector3,
  explicitIndex?: number,
): OrdinaryDetachGeometry {
  if (!vertices.length)
    throw new Error("Detached part requires authored vertices");
  if (
    explicitIndex !== undefined &&
    (!Number.isInteger(explicitIndex) ||
      explicitIndex < 0 ||
      explicitIndex >= vertices.length)
  ) {
    throw new Error("Detached part vertex index is outside the authored model");
  }
  const partMin = vertices[0].clone(),
    partMax = vertices[0].clone();
  for (const vertex of vertices) {
    partMin.min(vertex);
    partMax.max(vertex);
  }
  let cornerBits = 0,
    best = Infinity;
  const chosen = new Vector3();
  for (let bits = 0; bits < 8; bits++) {
    const corner = new Vector3();
    for (let axis = 0; axis < 3; axis++)
      corner.setComponent(
        axis,
        ((bits >> axis) & 1 ? partMax : partMin).getComponent(axis),
      );
    const score =
      explicitIndex === undefined
        ? Math.min(
            ...[0, 1, 2].flatMap((axis) => [
              Math.abs(corner.getComponent(axis) - carMin.getComponent(axis)),
              Math.abs(corner.getComponent(axis) - carMax.getComponent(axis)),
            ]),
          )
        : corner.distanceToSquared(vertices[explicitIndex]);
    if (score < best) {
      best = score;
      cornerBits = bits;
      chosen.copy(corner);
    }
  }
  let vertexIndex = explicitIndex ?? 0;
  if (explicitIndex === undefined) {
    best = Infinity;
    vertices.forEach((vertex, index) => {
      const distance = vertex.distanceToSquared(chosen);
      if (distance < best) {
        best = distance;
        vertexIndex = index;
      }
    });
  }
  const center = partMin.add(partMax).multiplyScalar(0.5);
  let side = 0;
  best = Infinity;
  for (let candidate = 0; candidate < 6; candidate++) {
    if (candidate === 2) continue;
    const axis = candidate >> 1;
    const distance = Math.abs(
      center.getComponent(axis) -
        (candidate & 1 ? carMax : carMin).getComponent(axis),
    );
    if (distance < best) {
      best = distance;
      side = candidate;
    }
  }
  return { vertexIndex, cornerBits, side };
}

/** Reconstruct the ordinary ball joint from bytes +30/+32/+33 of detach data.
 * The car bounds side supplies its common plane normal; the corner bits supply
 * the two independent directions, each biased .01 toward that normal. */
export function createOrdinaryDetachJoint(
  child: RigidBody,
  parent: RigidBody,
  vertices: readonly Vector3[],
  geometry: OrdinaryDetachGeometry,
): RigidJoint {
  const anchor = vertices[geometry.vertexIndex];
  if (!anchor)
    throw new Error("Detached part vertex index is outside the authored model");
  const axis = geometry.side >> 1;
  if (axis < 0 || axis > 2)
    throw new Error("Detached part side must be a car bounds side");
  const sign = geometry.side & 1 ? 1 : -1;
  const normal = new Vector3().setComponent(axis, sign);
  const parentNormal = normal;
  const directions = [1, 2].map((offset) => {
    const other = (axis + offset) % 3;
    return new Vector3()
      .setComponent(other, geometry.cornerBits & (1 << other) ? -1 : 1)
      .setComponent(axis, sign * 0.01)
      .normalize();
  });
  const parentAnchor = worldPoint(child, anchor)
    .sub(parent.state.position)
    .applyQuaternion(parent.state.orientation.clone().conjugate());
  return createBallJoint(
    child,
    parent,
    anchor,
    parentAnchor,
    directions.map((childDirection) => ({
      childDirection,
      parentNormal: parentNormal.clone(),
    })),
  );
}

/** Recover the SDB ball's two plane limits from its three authored vertices.
 * Original setup0x4373d0 uses cross(v1,v2)+.01*(v1+v2), normalized. */
export function createSdbBallJoint(
  child: RigidBody,
  parent: RigidBody,
  points: readonly Vector3[],
): RigidJoint {
  if (points.length < 3)
    throw new Error("SDB joint requires three authored points");
  const anchor = points[0];
  const worldAnchor = worldPoint(child, anchor);
  const parentAnchor = worldAnchor
    .sub(parent.state.position)
    .applyQuaternion(parent.state.orientation.clone().conjugate());
  const first = points[1].clone().sub(anchor).normalize();
  const second = points[2].clone().sub(anchor).normalize();
  const normal = first
    .clone()
    .cross(second)
    .addScaledVector(first, 0.01)
    .addScaledVector(second, 0.01)
    .normalize();
  const parentNormal = worldDirection(child, normal).applyQuaternion(
    parent.state.orientation.clone().conjugate(),
  );
  return createBallJoint(child, parent, anchor, parentAnchor, [
    { childDirection: first, parentNormal: parentNormal.clone() },
    { childDirection: second, parentNormal: parentNormal.clone() },
  ]);
}

/** SDB type4 hinge geometry from0x437a10, with limit angle in radians. */
export function createSdbHingeJoint(
  child: RigidBody,
  parent: RigidBody,
  points: readonly Vector3[],
  limitAngle: number,
): RigidJoint {
  if (points.length < 3)
    throw new Error("SDB hinge requires three authored points");
  const anchor = points[0];
  const axis = points[1].clone().sub(anchor).normalize();
  const radial = points[2].clone().sub(anchor);
  radial.addScaledVector(axis, -radial.dot(axis)).normalize();
  const tangent = axis.clone().cross(radial).normalize();
  // Original subtracts0x3ffc BRender angle units, i.e.90degrees minus4units.
  const secondNormal = radial
    .clone()
    .applyAxisAngle(axis, limitAngle - Math.PI / 2 + (4 * 2 * Math.PI) / 65536);
  const toParent = (direction: Vector3) =>
    worldDirection(child, direction).applyQuaternion(
      parent.state.orientation.clone().conjugate(),
    );
  const parentAnchor = worldPoint(child, anchor)
    .sub(parent.state.position)
    .applyQuaternion(parent.state.orientation.clone().conjugate());
  const joint = createHingeJoint(
    child,
    parent,
    anchor,
    parentAnchor,
    axis,
    toParent(axis),
    [
      {
        childDirection: radial
          .clone()
          .addScaledVector(tangent, 0.01)
          .normalize(),
        parentNormal: toParent(tangent),
      },
      {
        childDirection: radial
          .clone()
          .addScaledVector(secondNormal, 0.01)
          .normalize(),
        parentNormal: toParent(secondNormal),
      },
    ],
  );
  joint.quickHinge = true;
  const first = new Vector3(-axis.z, 0, axis.x);
  if (first.lengthSq() === 0) first.set(1, 0, 0);
  first.normalize();
  joint.hingeBasis = [first, axis.clone().cross(first).normalize()];
  return joint;
}

export interface BodyJacobian {
  body: RigidBody;
  linear: Vector3;
  angular: Vector3;
  response: Vector3;
}
export interface JointConstraint {
  joint: RigidJoint;
  jacobians: BodyJacobian[];
  rhs: number;
  unilateral: boolean;
  angular: boolean;
  axis: Vector3;
  closingSpeed?: number;
  restRhs?: number;
}

/** Solved row metadata presented to the collision callback before application.
 * Source11 identifies angular limits, not signed bilateral hinge restrictions.
 * Angular coefficients are child/parent LOCAL vectors, before lambda scaling. */
export interface JointConstraintImpact {
  constraint: JointConstraint;
  joint: RigidJoint;
  a: RigidBody;
  b: RigidBody;
  sourceType: number;
  normalImpulse: number;
  angularConstraintLocal: Vector3;
  parentAngularConstraintLocal: Vector3;
  closingSpeed: number;
  rowIndex: number;
}

export function jointConstraintImpacts(
  constraints: readonly JointConstraint[],
  impulses: readonly number[],
  rowOffset = 0,
): JointConstraintImpact[] {
  return constraints.map((constraint, index) => ({
    constraint,
    joint: constraint.joint,
    a: constraint.joint.child,
    b: constraint.joint.parent,
    sourceType: constraint.angular && constraint.unilateral ? 11 : 10,
    normalImpulse: impulses[index],
    angularConstraintLocal: constraint.jacobians[0].angular
      .clone()
      .applyQuaternion(
        constraint.joint.child.state.orientation.clone().conjugate(),
      ),
    parentAngularConstraintLocal: constraint.jacobians[1].angular
      .clone()
      .negate()
      .applyQuaternion(
        constraint.joint.parent.state.orientation.clone().conjugate(),
      ),
    closingSpeed: constraint.closingSpeed ?? 0,
    rowIndex: rowOffset + index,
  }));
}
function inverseInertia(body: RigidBody, value: Vector3): Vector3 {
  if (body.properties.rotationLocked) return new Vector3();
  const result = value
    .clone()
    .applyQuaternion(body.state.orientation.clone().conjugate());
  result
    .divide(body.properties.inertia)
    .applyQuaternion(body.state.orientation);
  return result;
}
function jacobian(
  body: RigidBody,
  linear: Vector3,
  angular: Vector3,
): BodyJacobian {
  return { body, linear, angular, response: inverseInertia(body, angular) };
}
function constraint(
  joint: RigidJoint,
  axis: Vector3,
  angular: boolean,
  rhs?: number,
  unilateral = false,
): JointConstraint {
  const childPoint = worldPoint(joint.child, joint.childAnchor);
  const parentPoint = worldPoint(joint.parent, joint.parentAnchor);
  const childCom = worldPoint(joint.child, joint.child.properties.centerOfMass);
  const parentCom = worldPoint(
    joint.parent,
    joint.parent.properties.centerOfMass,
  );
  const negative = axis.clone().negate();
  const jacobians = angular
    ? [
        jacobian(joint.child, new Vector3(), axis.clone()),
        jacobian(joint.parent, new Vector3(), negative),
      ]
    : [
        jacobian(
          joint.child,
          axis.clone(),
          childPoint.sub(childCom).cross(axis),
        ),
        jacobian(
          joint.parent,
          negative,
          parentPoint.sub(parentCom).cross(negative),
        ),
      ];
  const relativeSpeed = jacobians.reduce(
    (sum, entry) =>
      sum +
      entry.linear.dot(entry.body.state.velocity) +
      entry.angular.dot(entry.body.state.angularVelocity),
    0,
  );
  return {
    joint,
    axis,
    angular,
    jacobians,
    rhs: rhs ?? -relativeSpeed,
    unilateral,
  };
}
function matrixElement(a: JointConstraint, b: JointConstraint): number {
  let result = 0;
  for (const x of a.jacobians)
    for (const y of b.jacobians) {
      if (x.body.state !== y.body.state) continue;
      result +=
        x.linear.dot(y.linear) / x.body.properties.mass +
        x.angular.dot(y.response);
    }
  return result;
}
function denseSolve(
  matrix: number[][],
  rhs: number[],
  active: number[],
): number[] {
  const count = active.length;
  if (!count) return [];
  const scale = Math.max(...active.map((i) => matrix[i][i]), 1e-30);
  const rows = active.map((i, r) => [
    ...active.map((j, c) => matrix[i][j] + (r === c ? scale * 1e-12 : 0)),
    rhs[i],
  ]);
  for (let c = 0; c < count; c++) {
    let pivot = c;
    for (let r = c + 1; r < count; r++)
      if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const divisor = rows[c][c];
    for (let j = c; j <= count; j++) rows[c][j] /= divisor;
    for (let r = c + 1; r < count; r++) {
      const factor = rows[r][c];
      for (let j = c; j <= count; j++) rows[r][j] -= factor * rows[c][j];
    }
  }
  const values = new Array<number>(count).fill(0);
  for (let r = count - 1; r >= 0; r--) {
    values[r] = rows[r][count];
    for (let c = r + 1; c < count; c++) values[r] -= rows[r][c] * values[c];
  }
  return values;
}

/** The three rows eliminated by C2's quick hinge: axial anchor motion and
 * both transverse angular motions (0x4b8a90). Their response projector is
 * P = M^-1 - M^-1 H^T (H M^-1 H^T)^-1 H M^-1. */
export function buildQuickHingeConstraints(joint: RigidJoint): JointConstraint[] {
  if (joint.type !== "hinge" || !joint.childAxis)
    throw new Error("Quick hinge requires a hinge axis");
  const axis = worldDirection(joint.child, joint.childAxis).normalize();
  const reference = Math.abs(axis.x) < 0.8 ? axisBasis[0] : axisBasis[1];
  const first = joint.hingeBasis
    ? worldDirection(joint.child, joint.hingeBasis[0])
    : axis.clone().cross(reference).normalize();
  const second = joint.hingeBasis
    ? worldDirection(joint.child, joint.hingeBasis[1])
    : axis.clone().cross(first).normalize();
  return [
    constraint(joint, axis, false),
    constraint(joint, first, true),
    constraint(joint, second, true),
  ];
}

/** Momentum-preserving source three-row velocity projection. */
export function projectQuickHingeVelocities(joint: RigidJoint): JointReaction {
  const rows = buildQuickHingeConstraints(joint);
  const matrix = rows.map((a) => rows.map((b) => matrixElement(a, b)));
  const impulses = denseSolve(matrix, rows.map((row) => row.rhs), [0, 1, 2]);
  return applyJointConstraintImpulses([joint], rows, impulses)[0];
}

/** Source0x4b93f0 reserves one quick hinge per body, permanently downgrading
 * later conflicting type4 joints to ordinary hinges. Supply tree order. */
export function selectQuickHinges(joints: readonly RigidJoint[]): void {
  const occupied = new Set<RigidBody["state"]>();
  for (const joint of joints) {
    if (!joint.quickHinge) continue;
    if (occupied.has(joint.child.state) || occupied.has(joint.parent.state)) {
      joint.quickHinge = false;
      continue;
    }
    occupied.add(joint.child.state);
    occupied.add(joint.parent.state);
  }
}

function finishQuickHingeProjection(joint: RigidJoint): void {
  const childAxis = worldDirection(joint.child, joint.childAxis!).normalize();
  const parentAxis = worldDirection(joint.parent, joint.parentAxis!).normalize();
  const parentPerpendicular = joint.parent.state.angularVelocity
    .clone()
    .addScaledVector(parentAxis, -joint.parent.state.angularVelocity.dot(parentAxis));
  joint.child.state.angularVelocity
    .copy(childAxis.clone().multiplyScalar(joint.child.state.angularVelocity.dot(childAxis)))
    .add(parentPerpendicular);
  const childLever = joint.childAnchor.clone()
    .sub(joint.child.properties.centerOfMass)
    .applyQuaternion(joint.child.state.orientation);
  const parentLever = joint.parentAnchor.clone()
    .sub(joint.parent.properties.centerOfMass)
    .applyQuaternion(joint.parent.state.orientation);
  const parentPointVelocity = joint.parent.state.angularVelocity.clone()
    .cross(parentLever).add(joint.parent.state.velocity);
  const childPointVelocity = joint.child.state.angularVelocity.clone()
    .cross(childLever).add(joint.child.state.velocity);
  joint.child.state.velocity.addScaledVector(
    childAxis,
    parentPointVelocity.sub(childPointVelocity).dot(childAxis),
  );
}

/** Source0x4b72b0/0x4b80f0 joint preparation, after external forces and before
 * predicting actor transforms. Quick hidden rows are projected first; the
 * coupled full bilateral solve is algebraically the source Schur elimination.
 * Angular plane limits are collision rows and are deferred to resolveContacts. */
export function prepareJointVelocities(joints: RigidJoint[]): JointReaction[] {
  selectQuickHinges(joints);
  for (const joint of joints) {
    if (!joint.quickHinge) continue;
    projectQuickHingeVelocities(joint);
    finishQuickHingeProjection(joint);
  }
  return solveJointConstraints(joints, buildJointConstraints(joints, false));
}

/** Coupled signed anchor/hinge constraints plus unilateral angular plane limits.
 * Original type10 anchors have no restitution or separating-speed bias. */
export function buildJointConstraints(
  joints: RigidJoint[],
  includeLimits = true,
): JointConstraint[] {
  const constraints: JointConstraint[] = [];
  for (const joint of joints) {
    for (const axis of axisBasis)
      constraints.push(constraint(joint, axis.clone(), false));
    if (joint.type !== "ball") {
      if (!joint.childAxis)
        throw new Error("Angular joint requires a child axis");
      const axis = worldDirection(joint.child, joint.childAxis).normalize();
      const reference = Math.abs(axis.x) < 0.8 ? axisBasis[0] : axisBasis[1];
      const first = joint.hingeBasis
        ? worldDirection(joint.child, joint.hingeBasis[0])
        : axis.clone().cross(reference).normalize();
      constraints.push(constraint(joint, first, true));
      if (joint.type === "hinge")
        constraints.push(
          constraint(
            joint,
            joint.hingeBasis
              ? worldDirection(joint.child, joint.hingeBasis[1])
              : axis.clone().cross(first).normalize(),
            true,
          ),
        );
    }
  }
  if (!includeLimits) return constraints;
  const limitRows: {
    joint: RigidJoint;
    axis: Vector3;
    drift: number;
    closing: number;
  }[] = [];
  for (const joint of joints)
    for (const limit of joint.planeLimits) {
      const child = worldDirection(joint.child, limit.childDirection);
      const parent = worldDirection(joint.parent, limit.parentNormal);
      const before = child.dot(parent);
      const after = worldDirection(joint.child, limit.childDirection, true).dot(
        worldDirection(joint.parent, limit.parentNormal, true),
      );
      if (
        before < 0 ||
        after >= ANGULAR_BIAS ||
        (before < ANGULAR_BIAS && !joint.allowNearBoundary)
      )
        continue;
      const axis = child.clone().cross(parent);
      if (axis.length() <= 1e-6) {
        axis
          .copy(joint.child.state.angularVelocity)
          .sub(joint.parent.state.angularVelocity);
        if (axis.length() <= 2.384185791015625e-7)
          axis.set(1, 0, 0).applyQuaternion(joint.parent.state.orientation);
      }
      axis.normalize();
      const closing = -axis.dot(
        joint.child.state.angularVelocity
          .clone()
          .sub(joint.parent.state.angularVelocity),
      );
      limitRows.push({ joint, axis, closing, drift: after - before });
    }
  const impactBranch = limitRows.some((row) => row.closing >= ANGULAR_BIAS);
  for (const row of limitRows) {
    const limit = constraint(
      row.joint,
      row.axis,
      true,
      impactBranch
        ? Math.max(ANGULAR_BIAS, row.closing)
        : (ANGULAR_BIAS - row.drift) / STEP,
      true,
    );
    limit.closingSpeed = row.closing;
    limit.restRhs = (ANGULAR_BIAS - row.drift) / STEP;
    constraints.push(limit);
  }
  return constraints;
}

export function resolveJoints(joints: RigidJoint[]): JointReaction[] {
  const constraints = buildJointConstraints(joints);
  return solveJointConstraints(joints, constraints);
}

function solveJointConstraints(
  joints: RigidJoint[],
  constraints: JointConstraint[],
): JointReaction[] {
  if (!constraints.length) return [];
  const matrix = constraints.map((a) =>
    constraints.map((b) => matrixElement(a, b)),
  );
  const rhs = constraints.map((row) => row.rhs);
  const active = constraints.map((_, i) => i);
  const impulses = new Array<number>(constraints.length).fill(0);
  for (
    let iteration = 0;
    iteration < constraints.length * constraints.length + 1;
    iteration++
  ) {
    impulses.fill(0);
    const solved = denseSolve(matrix, rhs, active);
    let remove = -1;
    for (let i = 0; i < active.length; i++) {
      impulses[active[i]] = solved[i];
      if (constraints[active[i]].unilateral && solved[i] < -1e-9) remove = i;
    }
    if (remove >= 0) {
      active.splice(remove, 1);
      continue;
    }
    let add = -1;
    for (let i = 0; i < constraints.length; i++) {
      if (active.includes(i)) continue;
      let slack = -rhs[i];
      for (let j = 0; j < impulses.length; j++)
        slack += matrix[i][j] * impulses[j];
      if (slack < -1e-9) {
        add = i;
        break;
      }
    }
    if (add < 0) break;
    active.push(add);
  }
  return applyJointConstraintImpulses(joints, constraints, impulses);
}

export function applyJointConstraintImpulses(
  joints: RigidJoint[],
  constraints: JointConstraint[],
  impulses: number[],
): JointReaction[] {
  const reactions = joints.map((joint) => ({
    joint,
    linearImpulse: new Vector3(),
    angularImpulse: new Vector3(),
    constraintImpulses: [] as number[],
  }));
  for (let i = 0; i < constraints.length; i++) {
    const row = constraints[i];
    const value = row.unilateral ? Math.max(0, impulses[i]) : impulses[i];
    const reaction = reactions[joints.indexOf(row.joint)];
    reaction.constraintImpulses.push(value);
    (row.angular
      ? reaction.angularImpulse
      : reaction.linearImpulse
    ).addScaledVector(row.axis, value);
    for (const entry of row.jacobians) {
      entry.body.state.velocity.addScaledVector(
        entry.linear,
        value / entry.body.properties.mass,
      );
      entry.body.state.angularVelocity.addScaledVector(entry.response, value);
    }
  }
  return reactions;
}

/** Original actor integration enforces coincidence of parent/child anchors.
 * Call after advancing solver velocities, in parent-before-child tree order. */
export function projectJointPositions(joints: RigidJoint[]): void {
  for (const joint of joints) {
    if (joint.type === "hinge" && joint.childAxis && joint.parentAxis) {
      const current = worldDirection(joint.child, joint.childAxis).normalize();
      const target = worldDirection(joint.parent, joint.parentAxis).normalize();
      joint.child.state.orientation
        .premultiply(new Quaternion().setFromUnitVectors(current, target))
        .normalize();
    }
    const parentAnchor = worldPoint(joint.parent, joint.parentAnchor);
    const childOffset = joint.childAnchor
      .clone()
      .applyQuaternion(joint.child.state.orientation);
    joint.child.state.position.copy(parentAnchor.sub(childOffset));
  }
}

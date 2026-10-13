/** Reconstruct ignored local captures, never proprietary checked-in fixtures.
 * No actors, DamageSystem or original installation are required. Hydration
 * supplies pair/joint geometry only; it cannot reconstruct a complete tick.
 */
import { Quaternion, Vector3 } from "three";
import { sealCollisionHulls } from "../../src/physics/immutable-hulls.ts";

const MAX_BODIES = 8192;
const fail = (message) => {
  throw new Error(`Invalid captured bodies: ${message}`);
};
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
}
function array(value, maximum, label, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(label);
  return value;
}
function finite(value, label) {
  if (!Number.isFinite(value)) fail(label);
  return value;
}
function tuple(value, length, label) {
  array(value, length, label, length);
  return value.map((component) => finite(component, label));
}
const vector = (value, label) => new Vector3(...tuple(value, 3, label));
function rotation(value, label) {
  const result = new Quaternion(...tuple(value, 4, label));
  if (!(result.lengthSq() > 0)) fail(`${label}: zero quaternion`);
  return result;
}
function identifier(value, label, external = false) {
  if (!Number.isSafeInteger(value) || value < (external ? -1 : 0)) fail(label);
  return value;
}
function cloneJSON(value, label, depth = 0, budget = { remaining: 200000 }) {
  if (depth > 12 || --budget.remaining < 0) fail(`${label}: metadata limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return finite(value, label);
  if (Array.isArray(value))
    return array(value, 32768, label).map((entry) =>
      cloneJSON(entry, label, depth + 1, budget),
    );
  object(value, label);
  if (Object.keys(value).length > 1024) fail(`${label}: field limit`);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      fail(`${label}: unsafe key`);
    result[key] = cloneJSON(entry, label, depth + 1, budget);
  }
  return result;
}
function properties(row, label, metadataBudget) {
  object(row, label);
  const result = cloneJSON(row, label, 0, metadataBudget);
  result.mass = finite(row.mass, `${label}.mass`);
  result.inertia = vector(row.inertia, `${label}.inertia`);
  result.centerOfMass = vector(row.centerOfMass, `${label}.centerOfMass`);
  if (
    !(result.mass > 0) ||
    result.inertia.toArray().some((value) => !(value > 0))
  )
    fail(`${label}: positive mass/inertia required`);
  result.worldFriction = finite(
    row.worldFriction ?? 0,
    `${label}.worldFriction`,
  );
  for (const field of ["immovable", "rotationLocked"])
    if (row[field] !== undefined && typeof row[field] !== "boolean")
      fail(`${label}.${field}`);
  return result;
}
function state(row, label, metadataBudget) {
  object(row, label);
  return {
    ...cloneJSON(row, label, 0, metadataBudget),
    position: vector(row.position, `${label}.position`),
    orientation: rotation(row.orientation, `${label}.orientation`),
    velocity: vector(row.velocity, `${label}.velocity`),
    angularVelocity: vector(row.angularVelocity, `${label}.angularVelocity`),
    predictedPosition: vector(
      row.predictedPosition ?? row.position,
      `${label}.predictedPosition`,
    ),
    predictedOrientation: rotation(
      row.predictedOrientation ?? row.orientation,
      `${label}.predictedOrientation`,
    ),
  };
}
function hull(row, label, geometryBudget) {
  object(row, label);
  for (const field of ["vertices", "faces", "edges"])
    if (
      !Array.isArray(row[field]) ||
      (geometryBudget[field] -= row[field].length) < 0
    )
      fail(`${label}: total geometry limit`);
  const vertices = array(row.vertices, 4096, `${label}.vertices`, 1).map(
    (point) => vector(point, `${label}.vertices`),
  );
  const index = (value) => {
    if (!Number.isInteger(value) || value < 0 || value >= vertices.length)
      fail(`${label}: vertex index`);
    return value;
  };
  if (
    row.nativeType !== undefined &&
    !["BOX", "WIRE", "POLY", "WIREPOLY"].includes(row.nativeType)
  )
    fail(`${label}.nativeType`);
  return {
    ...(row.nativeType === undefined ? {} : { nativeType: row.nativeType }),
    vertices,
    ...(row.vertexOrder === undefined
      ? {}
      : {
          vertexOrder: array(
            row.vertexOrder,
            vertices.length,
            `${label}.vertexOrder`,
          ).map(index),
        }),
    faces: array(row.faces, 8192, `${label}.faces`).map((face) => {
      object(face, `${label}.face`);
      return {
        normal: vector(face.normal, `${label}.face.normal`),
        constant: finite(face.constant, `${label}.face.constant`),
        indices: array(
          face.indices,
          vertices.length,
          `${label}.face.indices`,
          1,
        ).map(index),
      };
    }),
    edges: array(row.edges, 16384, `${label}.edges`).map((edge) =>
      array(edge, 2, `${label}.edge`, 2).map(index),
    ),
  };
}
function dormantAnchor() {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
      immovable: true,
      rotationLocked: true,
    },
  };
}

/** Numeric recorded identities and distinct synthetic external identities. */
export function capturedBodyIdentifier(body) {
  return body.capturedId ?? body.capturedExternalId ?? null;
}

/** Supports both recorded type/owner and kind/joint.fields snapshot schemas.
 * Unrecorded dormant NONCAR anchors are distinct constructor-origin objects;
 * -1 never means shared identity. Active unrecorded anchors are rejected unless
 * a complete explicitly immovable externalParent snapshot is supplied.
 */
export function hydrateCapturedBodies(snapshot) {
  object(snapshot, "snapshot");
  const rows = array(snapshot.bodies, MAX_BODIES, "bodies", 1);
  const geometryBudget = {
    hulls: 8192,
    vertices: 200000,
    faces: 400000,
    edges: 800000,
  };
  const metadataBudget = { remaining: 1000000 };
  const rowsById = new Map();
  const bodies = rows.map((row) => {
    object(row, "body");
    const id = identifier(row.id, "body.id");
    if (rowsById.has(id)) fail(`duplicate body ${id}`);
    rowsById.set(id, row);
    const recordedKind = row.type ?? row.kind;
    if (!["car", "part", "noncar"].includes(recordedKind))
      fail(`body ${id}: unsupported kind`);
    const type =
      row.owner !== undefined && row.owner !== null ? "part" : recordedKind;
    const flags = cloneJSON(
      row.flags ?? {},
      `body ${id}.flags`,
      0,
      metadataBudget,
    );
    if (
      !Array.isArray(row.hulls) ||
      (geometryBudget.hulls -= row.hulls.length) < 0
    )
      fail(`body ${id}: total hull limit`);
    const result = {
      ...flags,
      capturedId: id,
      capturedType: type,
      capturedName: row.name ?? null,
      properties: properties(
        row.properties,
        `body ${id}.properties`,
        metadataBudget,
      ),
      state: state(row.state, `body ${id}.state`, metadataBudget),
      hulls: array(row.hulls, 128, `body ${id}.hulls`, 1).map((entry, i) =>
        hull(entry, `body ${id}.hull ${i}`, geometryBudget),
      ),
    };
    if (row.part !== undefined)
      result.part = identifier(row.part, `body ${id}.part`, true);
    if (type === "noncar") result.kind = "noncar";
    else delete result.kind;
    for (const field of ["filterA", "filterB"])
      if (
        result[field] !== undefined &&
        (!Number.isInteger(result[field]) ||
          result[field] < -2147483648 ||
          result[field] > 4294967295)
      )
        fail(`body ${id}.${field}`);
    sealCollisionHulls(result.hulls);
    return result;
  });
  const byId = new Map(bodies.map((body) => [body.capturedId, body]));
  const externalAnchors = [];
  const joints = [];
  for (const row of rows) {
    const body = byId.get(row.id);
    if (row.owner !== undefined && row.owner !== null) {
      identifier(row.owner, `body ${row.id}.owner`);
      if (!byId.has(row.owner)) fail(`body ${row.id}: unknown owner`);
      body.owner = byId.get(row.owner);
    }
    if (!row.joint) continue;
    object(row.joint, `body ${row.id}.joint`);
    const recorded = row.joint.fields ?? row.joint;
    object(recorded, `body ${row.id}.joint.fields`);
    const childId = identifier(
      row.joint.child ?? recorded.child ?? row.id,
      "joint.child",
    );
    if (childId !== row.id) fail(`body ${row.id}: inconsistent joint child`);
    const parentId = identifier(
      row.joint.parent ?? recorded.parent ?? -1,
      "joint.parent",
      true,
    );
    let parent = byId.get(parentId);
    if (parentId !== -1 && !parent)
      fail(`body ${row.id}: unknown joint parent`);
    if (parentId === -1) {
      const external = row.joint.externalParent ?? recorded.externalParent;
      if (external) {
        parent = {
          state: state(external.state, "external.state", metadataBudget),
          properties: properties(
            external.properties,
            "external.properties",
            metadataBudget,
          ),
        };
        if (!parent.properties.immovable) fail("external anchor must be fixed");
      } else {
        if (body.capturedType !== "noncar" || !body.properties.immovable)
          fail(`body ${row.id}: unrecorded active external anchor`);
        parent = dormantAnchor();
      }
      parent.capturedExternalId = `external-for-${row.id}`;
      externalAnchors.push(parent);
    }
    if (!["ball", "hinge", "universal", "translation"].includes(recorded.type))
      fail(`body ${row.id}: joint type`);
    const joint = {
      type: recorded.type,
      child: body,
      parent,
      childAnchor: vector(recorded.childAnchor, "joint.childAnchor"),
      parentAnchor: vector(recorded.parentAnchor, "joint.parentAnchor"),
      planeLimits: array(
        recorded.planeLimits ?? [],
        64,
        "joint.planeLimits",
      ).map((limit) => ({
        childDirection: vector(limit.childDirection, "joint.childDirection"),
        parentNormal: vector(limit.parentNormal, "joint.parentNormal"),
      })),
    };
    for (const field of ["childAxis", "parentAxis", "translationAxis"])
      if (recorded[field] !== undefined)
        joint[field] = vector(recorded[field], `joint.${field}`);
    for (const field of ["hingeBasis", "translationTransverse"])
      if (recorded[field] !== undefined)
        joint[field] = array(recorded[field], 2, `joint.${field}`, 2).map(
          (entry) => vector(entry, `joint.${field}`),
        );
    for (const field of ["quickHinge", "allowNearBoundary"])
      if (recorded[field] !== undefined) {
        if (typeof recorded[field] !== "boolean") fail(`joint.${field}`);
        joint[field] = recorded[field];
      }
    if (recorded.translationTravel !== undefined) {
      joint.translationTravel = finite(
        recorded.translationTravel,
        "joint.translationTravel",
      );
      if (joint.translationTravel < 0) fail("negative joint travel");
    }
    if (joint.type === "hinge" && (!joint.childAxis || !joint.parentAxis))
      fail("hinge axes absent");
    if (
      joint.type === "translation" &&
      (!joint.translationAxis || joint.translationTravel === undefined)
    )
      fail("translation data absent");
    body.joint = joint;
    joints.push(joint);
  }
  for (const body of bodies) {
    const seen = new Set();
    let member = body;
    while (member?.joint) {
      if (seen.has(member) || seen.size > 256)
        fail("cyclic or excessive joint ancestry");
      seen.add(member);
      member = member.joint.parent;
    }
  }
  return {
    bodies,
    byId,
    rowsById,
    joints,
    externalAnchors,
    identifiers: bodies.map(capturedBodyIdentifier),
    limitations: [
      "Each recorded body receives an independent RigidState; unrecorded shared-state identities cannot be inferred.",
      "Actors, controls, forces, world contacts, damage callbacks and original-installation lifecycle state are not reconstructed.",
      "Unrecorded dormant NONCAR endpoints use distinct fixed constructor-origin anchors, never one shared -1 identity.",
    ],
  };
}

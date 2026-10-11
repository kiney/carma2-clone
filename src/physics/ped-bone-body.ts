import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { PedBounds, PedVector } from "../ped-form";
import type { NativePedSeverBoneRequest } from "./ped-sever";
import { buildBoxHull } from "./box-hull";
import type { RigidBody } from "./contact";
import type { CollisionHull } from "./geometry";
import type { BodyVolumeState } from "./simulation";

const f = Math.fround;
export type NativePedBoneShape =
  | { type: "BOX"; tag: 0; bounds: PedBounds; hull: CollisionHull }
  | {
      type: "LINE";
      tag: 2;
      bounds: PedBounds;
      endpoints: readonly [PedVector, PedVector];
      edge: readonly [0, 1];
    }
  | {
      type: "SPHERE";
      tag: 4;
      bounds: PedBounds;
      center: PedVector;
      radius: number;
      radiusSquared: number;
    };

/** Detached leaf state only. FORM boned-slot allocation, joints and PHIL header
 * capacity remain with the host; this is not an intact type2 pedestrian. */
export interface NativePedBoneBody<Model = unknown> extends RigidBody {
  kind: "pedestrian-bone";
  rigidType: 5;
  actor: Object3D;
  model: Model;
  owner: object;
  boneIndex: number;
  bonedSlot: number;
  nativeMatrix: Matrix4;
  /** Actual flat ACT pose storage owned by the current character slot.
   * Written by committed physics, never by render interpolation. */
  poseTarget?: Float32Array;
  modelBounds: PedBounds;
  shape: NativePedBoneShape;
  hulls: CollisionHull[];
  bounds: PedBounds;
  radius: number;
  radiusSquared: number;
  localOmega: Vector3;
  auxiliaryLocalOmega: Vector3;
  solverLocalVelocity: Vector3;
  doNothing: boolean;
  haltCallbackEnabled: boolean;
  headerState: 0 | 1 | 2;
  headerFlags: number;
  rigidFlags: number;
  filterA: number | null;
  filterB: number | null;
  subindex: 0;
  gravity: number;
  levelOut: number;
  volumeEnabled: boolean;
  waterPlaneD: number;
  suppressWorldFaces: boolean;
  suppressSelfSentinel: boolean;
  suppressJointConstraints: boolean;
  specialVolume?: BodyVolumeState;
  previousSpecialVolume?: BodyVolumeState;
  registered: boolean;
  detached: boolean;
  /** Retained Object+18c. Ordinary bare allocations start NULL; preparation
   * never erases a later articulated owner's joint-info provider. */
  nativeJoint2: { quietOrientationY: number } | null;
  overlapRecovery: boolean;
  overlapDetected: boolean;
  worldRecovery: boolean;
  worldOverlapDetected: boolean;
}

/**4059f7 allocates physical objects before a character supplies an ACT/MODEL.
 * Bare resources cannot be registered or admitted to the solver. Preparation
 * refines THIS same object; the source header therefore tracks stable identity. */
export type NativePedBoneResource<Model = unknown> = Omit<
  NativePedBoneBody<Model>,
  "rigidType" | "actor" | "model" | "owner"
> & {
  rigidType: 0 | 5;
  actor: Object3D | null;
  model: Model | null;
  owner: object | null;
};
export function createNativePedBoneResource<Model = unknown>(
  collisionType: string | null,
): NativePedBoneResource<Model> {
  const modelBounds: PedBounds = { min: [0, 0, 0], max: [0, 0, 0] },
    shape = nativePedBoneShape(collisionType, modelBounds);
  return {
    kind: "pedestrian-bone",
    rigidType: 0,
    actor: null,
    model: null,
    owner: null,
    boneIndex: 0,
    bonedSlot: 0,
    nativeMatrix: new Matrix4(),
    modelBounds,
    shape,
    hulls: shape.type === "BOX" ? [shape.hull] : [],
    bounds: shape.bounds,
    radius: 0,
    radiusSquared: 0,
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 0,
      inertia: new Vector3(),
      centerOfMass: new Vector3(),
      worldFriction: 0,
      objectFriction: 0,
      immovable: true,
    },
    localOmega: new Vector3(),
    auxiliaryLocalOmega: new Vector3(),
    solverLocalVelocity: new Vector3(),
    doNothing: false,
    haltCallbackEnabled: false,
    headerState: 0,
    headerFlags: 0,
    rigidFlags: 0,
    filterA: null,
    filterB: null,
    subindex: 0,
    gravity: 0,
    levelOut: 0,
    volumeEnabled: false,
    waterPlaneD: 0,
    suppressWorldFaces: false,
    suppressSelfSentinel: false,
    suppressJointConstraints: false,
    registered: false,
    detached: false,
    nativeJoint2: null,
    overlapRecovery: false,
    overlapDetected: false,
    worldRecovery: false,
    worldOverlapDetected: false,
  };
}

export function prepareNativePedBoneResource<Model>(
  resource: NativePedBoneResource<Model>,
  input: Omit<Parameters<typeof createNativePedBoneBody<Model>>[0], "retained">,
): NativePedBoneBody<Model> {
  if (resource.registered || resource.headerState !== 0)
    throw new Error("Native bone preparation requires proven PHIL release");
  const prepared = createNativePedBoneBody({
    ...input,
    retained: {
      rigidFlags: resource.rigidFlags,
      objectFriction: resource.properties.objectFriction ?? 0,
    },
  });
  if (resource.shape.type !== prepared.shape.type)
    throw new Error("A native FORM bone resource cannot change its shape tag");
  const copyBounds = (target: PedBounds, source: PedBounds) => {
    const min = target.min as [number, number, number],
      max = target.max as [number, number, number];
    for (let i = 0; i < 3; i++) {
      min[i] = source.min[i];
      max[i] = source.max[i];
    }
  };
  copyBounds(resource.modelBounds, prepared.modelBounds);
  copyBounds(resource.shape.bounds, prepared.shape.bounds);
  if (resource.shape.type === "BOX" && prepared.shape.type === "BOX") {
    const sourceShape = prepared.shape;
    resource.shape.hull.vertices.forEach((v, i) =>
      v.copy(sourceShape.hull.vertices[i]),
    );
    resource.shape.hull.faces.forEach((face, i) => {
      face.normal.copy(sourceShape.hull.faces[i].normal);
      face.constant = sourceShape.hull.faces[i].constant;
    });
  } else if (
    resource.shape.type === "SPHERE" &&
    prepared.shape.type === "SPHERE"
  ) {
    for (let i = 0; i < 3; i++)
      (resource.shape.center as [number, number, number])[i] =
        prepared.shape.center[i];
    resource.shape.radius = prepared.shape.radius;
    resource.shape.radiusSquared = prepared.shape.radiusSquared;
  } else if (resource.shape.type === "LINE" && prepared.shape.type === "LINE")
    for (let end = 0; end < 2; end++)
      for (let i = 0; i < 3; i++)
        (resource.shape.endpoints[end] as [number, number, number])[i] =
          prepared.shape.endpoints[end][i];
  // The explicit initializer list preserves external retained joint2 fields.
  for (const key of [
    "actor",
    "model",
    "owner",
    "boneIndex",
    "bonedSlot",
    "radius",
    "radiusSquared",
    "doNothing",
    "haltCallbackEnabled",
    "headerState",
    "headerFlags",
    "filterA",
    "filterB",
    "gravity",
    "levelOut",
    "volumeEnabled",
    "waterPlaneD",
    "suppressWorldFaces",
    "suppressSelfSentinel",
    "suppressJointConstraints",
    "registered",
    "detached",
    "overlapRecovery",
    "overlapDetected",
    "worldRecovery",
    "worldOverlapDetected",
  ] as const)
    (resource as unknown as Record<string, unknown>)[key] = prepared[key];
  resource.rigidType = 5;
  resource.nativeMatrix.copy(prepared.nativeMatrix);
  resource.poseTarget = undefined;
  resource.state.position.copy(prepared.state.position);
  resource.state.orientation.copy(prepared.state.orientation);
  resource.state.velocity.copy(prepared.state.velocity);
  resource.state.angularVelocity.copy(prepared.state.angularVelocity);
  resource.state.predictedPosition?.copy(prepared.state.position);
  resource.state.predictedOrientation?.copy(prepared.state.orientation);
  resource.properties.mass = prepared.properties.mass;
  resource.properties.inertia.copy(prepared.properties.inertia);
  resource.properties.centerOfMass.copy(prepared.properties.centerOfMass);
  resource.properties.worldFriction = 1;
  resource.properties.immovable = true;
  resource.localOmega.set(0, 0, 0);
  resource.auxiliaryLocalOmega.set(0, 0, 0);
  resource.solverLocalVelocity.set(0, 0, 0);
  resource.specialVolume = undefined;
  resource.previousSpecialVolume = undefined;
  return resource as NativePedBoneBody<Model>;
}

function scalar(value: number): number {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new Error("Non-finite native pedestrian bone scalar");
  return result;
}
function vector(value: PedVector): [number, number, number] {
  if (value.length !== 3) throw new Error("Invalid pedestrian bone vector");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function bounds(value: PedBounds): PedBounds {
  const min = vector(value.min),
    max = vector(value.max);
  if (min.some((v, i) => v > max[i]))
    throw new Error("Inverted current pedestrian MODEL bounds");
  return { min, max };
}
function pose(value: ArrayLike<number>): Matrix4 {
  if (value.length !== 12)
    throw new Error("Bone body requires native ACT pose");
  const a = Array.from(value, scalar);
  const matrix = new Matrix4().set(
    a[0],
    a[3],
    a[6],
    a[9],
    a[1],
    a[4],
    a[7],
    a[10],
    a[2],
    a[5],
    a[8],
    a[11],
    0,
    0,
    0,
    1,
  );
  const x = new Vector3(...a.slice(0, 3)),
    y = new Vector3(...a.slice(3, 6)),
    z = new Vector3(...a.slice(6, 9));
  // Native copies the full ACT basis. The current quaternion rigid adapter
  // cannot represent scale/shear; reject it instead of silently decomposing it.
  if (
    [
      x.lengthSq() - 1,
      y.lengthSq() - 1,
      z.lengthSq() - 1,
      x.dot(y),
      x.dot(z),
      y.dot(z),
      matrix.determinant() - 1,
    ].some((n) => Math.abs(n) > 0.0001)
  )
    throw new Error("Bone ACT basis needs a full-matrix rigid provider");
  return matrix;
}

/** 4087b0 with BOTH endpoint arguments NULL, as supplied by sever40b8ff.
 * Unsupported FORM tags really allocate NULL at405a87; rec2's LINE fallthrough
 * does not describe the installed jump table4067b8. */
export function nativePedBoneShape(
  collisionType: string | null,
  currentModelBounds: PedBounds,
): NativePedBoneShape {
  const box = bounds(currentModelBounds);
  if (collisionType === "BOX")
    return {
      type: "BOX",
      tag: 0,
      bounds: box,
      hull: buildBoxHull(new Vector3(...box.min), new Vector3(...box.max)),
    };
  const dimensions = box.max.map((v, i) => f(v - box.min[i]));
  if (collisionType === "SPHERE") {
    const center = box.min.map((v, i) => f(v + dimensions[i] * 0.5)) as [
      number,
      number,
      number,
    ];
    const radius = f(
      (dimensions[1] + dimensions[0] + dimensions[2]) * f(1 / 6),
    );
    return {
      type: "SPHERE",
      tag: 4,
      center,
      radius,
      radiusSquared: f(radius * radius),
      bounds: {
        min: center.map((v) => f(v - radius)) as [number, number, number],
        max: center.map((v) => f(v + radius)) as [number, number, number],
      },
    };
  }
  if (collisionType === "LINE") {
    let largest = -1,
      axis = -1;
    for (let i = 0; i < 3; i++)
      if (dimensions[i] > largest) {
        largest = dimensions[i];
        axis = i;
      }
    const first = box.min.map((v, i) => f((v + box.max[i]) * 0.5)) as [
      number,
      number,
      number,
    ];
    const second = [...first] as [number, number, number];
    first[axis] = box.min[axis];
    second[axis] = box.max[axis];
    return {
      type: "LINE",
      tag: 2,
      endpoints: [first, second],
      edge: [0, 1],
      bounds: {
        min: first.map((v, i) => Math.min(v, second[i])) as [
          number,
          number,
          number,
        ],
        max: first.map((v, i) => Math.max(v, second[i])) as [
          number,
          number,
          number,
        ],
      },
    };
  }
  throw new Error(
    `FORM bone collision type ${collisionType} has no installed shape provider`,
  );
}

/** MODEL dimensions, not the sphere/line's resulting bounds. Explicit spills
 * mirror408b88/408b98; .025 is the installed Float32 constant588390. */
export function nativePedBoneMassProperties(
  mass: number,
  source: PedBounds,
): {
  mass: number;
  centerOfMass: Vector3;
  inertia: Vector3;
} {
  const b = bounds(source),
    m = scalar(mass),
    c = f(0.025);
  if (m <= 0) throw new Error("Massless FORM bone has no physical body");
  const [x, y, z] = b.max.map((v, i) => f(v - b.min[i]));
  const sx = f(x * x),
    sy = f(y * y);
  const inertia = new Vector3(
    f(m * (z * z + sy) * c),
    f(m * (z * z + sx) * c),
    f(m * (y * y + sx) * c),
  );
  if (inertia.toArray().some((v) => !Number.isFinite(v) || v <= 0))
    throw new Error("Current MODEL has singular native bone inertia");
  return {
    mass: m,
    inertia,
    centerOfMass: new Vector3(
      f(b.min[0] + x * 0.5),
      f(b.min[1] + y * 0.5),
      f(b.min[2] + z * 0.5),
    ),
  };
}

export function createNativePedBoneBody<Model>(input: {
  request: NativePedSeverBoneRequest<Object3D, Model>;
  owner: object;
  levelOut: number;
  /** Pooled fields not overwritten by4085f0. The pool owner supplies them. */
  retained: { rigidFlags: number; objectFriction: number };
}): NativePedBoneBody<Model> {
  const { request } = input;
  if (
    !request.snapshot.actor ||
    request.snapshot.model == null ||
    !input.owner ||
    !Number.isInteger(request.index) ||
    request.index < 0 ||
    request.index > 255 ||
    !Number.isInteger(request.slot) ||
    request.slot < 0 ||
    request.rigidType !== 5 ||
    request.filterA !== 0x40000 ||
    request.filterB !== 0x50000 ||
    !Number.isInteger(input.retained.rigidFlags) ||
    input.retained.rigidFlags < 0 ||
    input.retained.rigidFlags > 0xffffffff
  )
    throw new Error("Invalid native sever body provider");
  const modelBounds = bounds(request.snapshot.bounds),
    shape = nativePedBoneShape(request.bone.collisionType, modelBounds),
    massProperties = nativePedBoneMassProperties(
      request.bone.mass,
      modelBounds,
    ),
    nativeMatrix = pose(request.snapshot.nativePose),
    position = new Vector3(),
    orientation = new Quaternion();
  nativeMatrix.decompose(position, orientation, new Vector3());
  // 4c5e50 retains each min square in x87 but spills the max square to Float32.
  const sum = shape.bounds.min.reduce(
    (s, v, i) =>
      s + Math.max(v * v, f(shape.bounds.max[i] * shape.bounds.max[i])),
    0,
  );
  const radius = f(Math.sqrt(sum)),
    radiusSquared = f(sum);
  if (!Number.isFinite(radiusSquared)) throw new Error("Bone radius overflow");
  return {
    kind: "pedestrian-bone",
    rigidType: 5,
    actor: request.snapshot.actor,
    model: request.snapshot.model,
    owner: input.owner,
    boneIndex: request.index,
    bonedSlot: request.slot,
    nativeMatrix,
    modelBounds,
    shape,
    hulls: shape.type === "BOX" ? [shape.hull] : [],
    bounds: shape.bounds,
    radius,
    radiusSquared,
    state: {
      position,
      orientation,
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      ...massProperties,
      worldFriction: 1,
      objectFriction: scalar(input.retained.objectFriction),
      immovable: true,
    },
    localOmega: new Vector3(),
    auxiliaryLocalOmega: new Vector3(),
    solverLocalVelocity: new Vector3(),
    doNothing: true,
    haltCallbackEnabled: true,
    headerState: 0,
    headerFlags: 0,
    rigidFlags: input.retained.rigidFlags >>> 0,
    filterA: null,
    filterB: null,
    subindex: 0,
    gravity: 0,
    levelOut: scalar(input.levelOut),
    volumeEnabled: false,
    waterPlaneD: 0,
    suppressWorldFaces: false,
    suppressSelfSentinel: false,
    suppressJointConstraints: false,
    specialVolume: undefined,
    previousSpecialVolume: undefined,
    registered: false,
    detached: false,
    nativeJoint2: null,
    overlapRecovery: false,
    overlapDetected: false,
    worldRecovery: false,
    worldOverlapDetected: false,
  };
}

export type NativePedBoneProperty = 0 | 3 | 4 | 5 | 6 | 7 | 8;
function property<Model>(
  body: NativePedBoneBody<Model>,
  index: NativePedBoneProperty,
  value: number,
): void {
  switch (index) {
    case 0:
      body.gravity = f(value);
      break;
    case 3:
      body.suppressWorldFaces = !!value;
      body.rigidFlags = ((body.rigidFlags & ~0x40) | (value ? 0x40 : 0)) >>> 0;
      break;
    case 4:
      body.suppressSelfSentinel = !!value;
      body.rigidFlags = ((body.rigidFlags & ~8) | (value ? 8 : 0)) >>> 0;
      break;
    case 5:
      body.suppressJointConstraints = !!value;
      body.rigidFlags = ((body.rigidFlags & ~16) | (value ? 16 : 0)) >>> 0;
      break;
    case 6:
      body.headerFlags |= 4;
      break;
    case 7:
      body.headerFlags |= 8;
      body.volumeEnabled = true;
      body.waterPlaneD = 10000;
      break;
    case 8:
      body.levelOut = f(value);
      break;
  }
}

/** Immediate4b6050 precedes ALL properties and CBFillInObject. A failed add
 * leaves the prepared body intact and never fabricates a successful header. */
export function registerNativePedBoneBody<Model>(
  body: NativePedBoneBody<Model>,
  host: {
    supportsShape: (shape: NativePedBoneShape) => boolean;
    registerImmediate: (body: NativePedBoneBody<Model>) => number;
    onProperty?: (
      body: NativePedBoneBody<Model>,
      index: NativePedBoneProperty,
      value: number,
    ) => void;
  },
): { accepted: boolean; code: number } {
  if (body.registered) throw new Error("Bone body already registered");
  if (!host.supportsShape(body.shape))
    throw new Error(
      `Native ${body.shape.type} bone collision provider required`,
    );
  const code = host.registerImmediate(body);
  if (!Number.isInteger(code) || code < 0)
    throw new Error("Invalid PHIL registration result");
  if (code !== 0) return { accepted: false, code };
  body.headerState = 1;
  finishNativePedBoneInitialization(body, host.onProperty);
  return { accepted: true, code };
}

/** Only the real registrar may establish passive state1. Resource-pool hosts
 * use this tail after their shared PHIL add succeeds, without adding twice. */
export function finishNativePedBoneInitialization<Model>(
  body: NativePedBoneBody<Model>,
  onProperty?: (
    body: NativePedBoneBody<Model>,
    index: NativePedBoneProperty,
    value: number,
  ) => void,
): void {
  if (body.rigidType !== 5 || body.headerState !== 1 || body.registered)
    throw new Error(
      "Native bone properties require successful passive registration",
    );
  body.registered = true;
  body.rigidFlags = (body.rigidFlags | 0x20) >>> 0;
  for (const [index, value] of [
    [0, 1],
    [3, 0],
    [4, 1],
    [5, 1],
    [7, 1],
    [8, body.levelOut],
    [6, 1],
  ] as const) {
    property(body, index, value);
    onProperty?.(body, index, value);
  }
  body.filterA = 0x40000;
  body.filterB = 0x50000;
}

/** Call after the sever owner commits its missing-mask bit. The explicit unlink
 * callback owns parent+224/body+228, children+224 and link+188; no joint/pool
 * ownership is invented here. Raw world V and BODY omega retain native units. */
export function commitNativePedBoneBody<Model>(
  request: NativePedSeverBoneRequest<Object3D, Model>,
  body: NativePedBoneBody<Model>,
  host: {
    unlink: (body: NativePedBoneBody<Model>) => void;
    activate: (body: NativePedBoneBody<Model>) => void;
    onProperty?: (
      body: NativePedBoneBody<Model>,
      index: NativePedBoneProperty,
      value: number,
    ) => void;
  },
): void {
  if (
    !body.registered ||
    body.detached ||
    body.actor !== request.snapshot.actor ||
    body.model !== request.snapshot.model ||
    body.boneIndex !== request.index ||
    body.bonedSlot !== request.slot
  )
    throw new Error("Sever commit does not match registered bone");
  const velocity = request.activation
      ? vector(request.activation.velocity)
      : null,
    omega = request.activation ? vector(request.localOmega) : null;
  host.unlink(body);
  body.detached = true;
  if (!velocity || !omega) return;
  body.doNothing = false;
  body.state.velocity.set(...velocity);
  body.localOmega.set(...omega);
  body.state.angularVelocity
    .copy(body.localOmega)
    .applyQuaternion(body.state.orientation);
  body.state.angularVelocity.set(
    f(body.state.angularVelocity.x),
    f(body.state.angularVelocity.y),
    f(body.state.angularVelocity.z),
  );
  host.activate(body);
  body.headerState = 2;
  // The immediate PHIL activation branch4b5ec3..ee3 clears passive bit20
  // and the caller's zero activation argument clears header bit2.
  body.rigidFlags = (body.rigidFlags & ~0x20) >>> 0;
  body.headerFlags &= ~2;
  body.properties.immovable = false;
  body.haltCallbackEnabled = true;
  for (const [index, value] of [
    [0, 1],
    [3, 0],
    [4, 0],
    [5, 0],
  ] as const) {
    property(body, index, value);
    host.onProperty?.(body, index, value);
  }
}

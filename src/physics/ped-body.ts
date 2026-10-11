import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { PedSimpleBodyProfile } from "../ped-form";
import { buildBoxHull } from "./box-hull";
import type { RigidBody, Contact, ContactImpact } from "./contact";
import type { CollisionHull } from "./geometry";
import type { BodyVolumeState } from "./simulation";
import type {
  PedContactForm,
  PedContactSettings,
  PedContactState,
  PedContactInputs,
  passivePedContact,
  activePedContact,
} from "./ped-contact";

export type NativePedContactResult =
  | ReturnType<typeof passivePedContact>
  | ReturnType<typeof activePedContact>;
export interface NativePedContactContext {
  settings: PedContactSettings;
  form: PedContactForm;
  state: PedContactState;
  /** The live character owner supplies its one-shot sever/HP continuation.
   * Forwarded to the native dispatcher before the solver applies impulses. */
  damageTail?: PedContactInputs["damageTail"];
  passivePrelude?: PedContactInputs["passivePrelude"];
  specialMass?: number;
}
export interface NativePedContactDispatch {
  phase: "passive" | "active";
  other: RigidBody | undefined;
  contact?: Contact;
  firstRow?: ContactImpact;
  totalLambda?: number;
  firstLambda?: number;
  force?: Vector3;
}

/** Intact simple-body state from 4085f0/408c30 and PHIL registration4b6050.
 * Header registration, sleep and overlap recovery are independent states. */
export interface NativePedBody extends RigidBody {
  kind: "pedestrian";
  rigidType: 2;
  actor: Object3D;
  profile: PedSimpleBodyProfile;
  hulls: CollisionHull[];
  headerState: 0 | 1 | 2;
  doNothing: boolean;
  haltCallbackEnabled: boolean;
  gravity: number;
  drag: number;
  volumeEnabled: boolean;
  levelOut: number;
  phaseMarker: 0 | 2;
  filterA: number;
  filterB: number;
  /** Object+19c persistent physics policy. Distinct from contact flags+1dc. */
  rigidFlags: number;
  collisionFlags: number;
  quietState: number;
  solverInertiaScale: 1 | 50;
  suppressWorldFaces: boolean;
  suppressSelfSentinel: boolean;
  suppressJointConstraints: boolean;
  beforeWorldVelocity: Vector3;
  beforeLocalOmega: Vector3;
  solverLocalVelocity: Vector3;
  auxiliaryLocalOmega: Vector3;
  firstWorldFaceNormal: Vector3 | null;
  worldFaceNormals: Vector3[];
  gravityIncrement: Vector3;
  characterVelocity: Vector3;
  hitPoints: number;
  pedestrianFlags: number;
  impactCount: number;
  diagnostics: Set<string>;
  contactProvider?: (
    body: NativePedBody,
    dispatch: NativePedContactDispatch,
  ) => NativePedContactContext;
  onActivated?: (body: NativePedBody, other: RigidBody | undefined) => void;
  onContactDamage?: (
    body: NativePedBody,
    result: NativePedContactResult,
    phase: "passive" | "active",
  ) => void;
  onMoved?: (body: NativePedBody, framePeriodMs: number) => void;
  /** Only a source lifecycle provider can accept/reject PHIL halt. */
  onHalt?: (body: NativePedBody, framePeriodMs: number) => boolean;
  specialVolume?: BodyVolumeState;
  overlapRecovery: boolean;
  overlapDetected: boolean;
  worldRecovery: boolean;
  worldOverlapDetected: boolean;
}

function rootMatrix(pose: ArrayLike<number>): Matrix4 {
  if (
    pose.length !== 12 ||
    Array.from(pose).some(
      (value) =>
        !Number.isFinite(value) || !Number.isFinite(Math.fround(value)),
    )
  )
    throw new Error(
      "Pedestrian physics requires a finite native root ACT pose",
    );
  const matrix = new Matrix4().set(
    pose[0],
    pose[3],
    pose[6],
    pose[9],
    pose[1],
    pose[4],
    pose[7],
    pose[10],
    pose[2],
    pose[5],
    pose[8],
    pose[11],
    0,
    0,
    0,
    1,
  );
  // Source root bases are LP-normalized. A mirrored/scaled render transform
  // cannot replace this provider without changing native bounds and inertia.
  const x = new Vector3(pose[0], pose[1], pose[2]),
    y = new Vector3(pose[3], pose[4], pose[5]),
    z = new Vector3(pose[6], pose[7], pose[8]);
  if (
    [
      x.lengthSq() - 1,
      y.lengthSq() - 1,
      z.lengthSq() - 1,
      x.dot(y),
      x.dot(z),
      y.dot(z),
      matrix.determinant() - 1,
    ].some((value) => Math.abs(value) > 0.0001)
  )
    throw new Error("Pedestrian physics root basis is not normalized");
  return matrix;
}

/** Load authored remapped bounds/COM, source mass and .025 box moments.
 * The actor must represent the native root, not a Y-major visual wrapper. */
export function createNativePedBody(input: {
  actor: Object3D;
  profile: PedSimpleBodyProfile;
  rootPose: ArrayLike<number>;
  levelOut: number;
}): NativePedBody {
  const { profile } = input;
  if (
    !Number.isFinite(input.levelOut) ||
    !Number.isFinite(Math.fround(input.levelOut)) ||
    !(
      Math.fround(profile.mass) > 0 &&
      Number.isFinite(Math.fround(profile.mass))
    ) ||
    [
      ...profile.centreOfMass,
      ...profile.inertia,
      ...profile.bounds.min,
      ...profile.bounds.max,
    ].some(
      (value) =>
        !Number.isFinite(value) || !Number.isFinite(Math.fround(value)),
    ) ||
    profile.inertia.some((value) => Math.fround(value) <= 0) ||
    profile.bounds.min.some((value, axis) => value >= profile.bounds.max[axis])
  )
    throw new Error("Invalid authored pedestrian physics profile");
  const matrix = rootMatrix(input.rootPose),
    position = new Vector3(),
    orientation = new Quaternion();
  matrix.decompose(position, orientation, new Vector3());
  input.actor.userData.dynamicBody = true;
  return {
    kind: "pedestrian",
    rigidType: 2,
    actor: input.actor,
    profile,
    hulls: [
      buildBoxHull(
        new Vector3(...profile.bounds.min),
        new Vector3(...profile.bounds.max),
      ),
    ],
    state: {
      position,
      orientation,
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: profile.mass,
      inertia: new Vector3(...profile.inertia),
      centerOfMass: new Vector3(...profile.centreOfMass),
      worldFriction: 1,
      objectFriction: 0,
      // Host integration gate for the passive/sleeping body. Activation clears
      // it BEFORE solving contacts; this is not a permanently immovable mass.
      immovable: true,
    },
    headerState: 1,
    doNothing: true,
    haltCallbackEnabled: true,
    gravity: 1,
    drag: 0,
    volumeEnabled: true,
    levelOut: Math.fround(input.levelOut),
    phaseMarker: 2,
    filterA: 0x10000,
    filterB: 0x50000,
    rigidFlags: 0x78,
    collisionFlags: 0,
    quietState: 0,
    solverInertiaScale: 1,
    suppressWorldFaces: true,
    suppressSelfSentinel: true,
    suppressJointConstraints: true,
    beforeWorldVelocity: new Vector3(),
    beforeLocalOmega: new Vector3(),
    solverLocalVelocity: new Vector3(),
    auxiliaryLocalOmega: new Vector3(),
    firstWorldFaceNormal: null,
    worldFaceNormals: [],
    gravityIncrement: new Vector3(),
    characterVelocity: new Vector3(),
    hitPoints: 100,
    pedestrianFlags: 0,
    impactCount: 0,
    diagnostics: new Set(),
    overlapRecovery: true,
    overlapDetected: false,
    worldRecovery: true,
    worldOverlapDetected: false,
  };
}

/** Walking pose is an explicit native root provider, never render-bounds yaw. */
export function positionPassivePedBody(
  body: NativePedBody,
  rootPose: ArrayLike<number>,
): void {
  if (body.headerState !== 1)
    throw new Error("Cannot overwrite an active pedestrian physics pose");
  rootMatrix(rootPose).decompose(
    body.state.position,
    body.state.orientation,
    new Vector3(),
  );
  body.state.predictedPosition?.copy(body.state.position);
  body.state.predictedOrientation?.copy(body.state.orientation);
}

/** Reinitialize a preallocated FORM simple slot without replacing its BOX,
 * object identity or retained policy/friction fields. Registration and its
 * ordered property/fill tail are owned by the shared pool host. */
export function prepareNativePedBody(
  body: NativePedBody,
  input: Parameters<typeof createNativePedBody>[0],
): void {
  if (body.profile.formName !== input.profile.formName)
    throw new Error("Cannot reuse a pedestrian simple slot across FORMs");
  const prepared = createNativePedBody(input),
    box = body.hulls[0],
    next = prepared.hulls[0];
  if (
    body.hulls.length !== 1 ||
    box.vertices.length !== next.vertices.length ||
    box.faces.length !== next.faces.length
  )
    throw new Error("Pooled pedestrian simple slot requires its original BOX");
  body.actor = input.actor;
  body.profile = input.profile;
  box.vertices.forEach((v, i) => v.copy(next.vertices[i]));
  box.faces.forEach((face, i) => {
    face.normal.copy(next.faces[i].normal);
    face.constant = next.faces[i].constant;
  });
  body.state.position.copy(prepared.state.position);
  body.state.orientation.copy(prepared.state.orientation);
  body.state.predictedPosition?.copy(body.state.position);
  body.state.predictedOrientation?.copy(body.state.orientation);
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.set(0, 0, 0);
  body.properties.mass = prepared.properties.mass;
  body.properties.centerOfMass.copy(prepared.properties.centerOfMass);
  body.properties.inertia.copy(prepared.properties.inertia);
  body.properties.worldFriction = 1;
  body.properties.immovable = true;
  body.doNothing = true;
  body.haltCallbackEnabled = true;
  body.levelOut = prepared.levelOut;
  body.beforeWorldVelocity.set(0, 0, 0);
  body.beforeLocalOmega.set(0, 0, 0);
  body.solverLocalVelocity.set(0, 0, 0);
  body.auxiliaryLocalOmega.set(0, 0, 0);
  body.specialVolume = undefined;
  body.headerState = 0;
  // These integration/contact snapshots belong to the new slot owner, not
  // Object+19c or +64, which the installed initializer retains.
  body.phaseMarker = 2;
  body.collisionFlags = 0;
  body.quietState = 0;
  body.solverInertiaScale = 1;
  body.firstWorldFaceNormal = null;
  body.worldFaceNormals.length = 0;
  body.gravityIncrement.set(0, 0, 0);
  body.characterVelocity.set(0, 0, 0);
  body.overlapDetected = false;
  body.worldOverlapDetected = false;
  body.diagnostics.clear();
}

/** Successful immediate PHIL registration precedes properties0/3/4/5/7/8
 * and the type2 filter callback. Keep failed registrations before this seam. */
export function finishNativePedBodyInitialization(body: NativePedBody): void {
  if (body.headerState !== 1)
    throw new Error("Native simple-body properties require PHIL registration");
  body.rigidFlags = (body.rigidFlags | 0x78) >>> 0;
  body.gravity = 1;
  body.suppressWorldFaces = true;
  body.suppressSelfSentinel = true;
  body.suppressJointConstraints = true;
  body.volumeEnabled = true;
  body.filterA = 0x10000;
  body.filterB = 0x50000;
}

/** Character activation40b620 precedes damage eligibility4cd9db and lambda
 * solving. It copies character world V without an invented car kick/spin. */
export function activateNativePedBody(
  body: NativePedBody,
  characterVelocity: Vector3,
): boolean {
  if (body.headerState !== 1) return false;
  if (!characterVelocity.toArray().every(Number.isFinite))
    throw new Error("Invalid native pedestrian character velocity");
  body.doNothing = false;
  body.state.velocity.set(
    Math.fround(characterVelocity.x),
    Math.fround(characterVelocity.y),
    Math.fround(characterVelocity.z),
  );
  body.headerState = 2;
  body.phaseMarker = 0;
  body.worldRecovery = true;
  body.suppressWorldFaces = false;
  body.suppressSelfSentinel = false;
  body.suppressJointConstraints = false;
  body.gravity = 1;
  body.properties.immovable = false;
  body.rigidFlags = (body.rigidFlags & ~0x78) >>> 0;
  return true;
}

/** Native masks exclude pairs; they are not positive membership categories. */
export function pedBodyPairExcluded(
  a: { filterA?: number; filterB?: number },
  b: { filterA?: number; filterB?: number },
): boolean {
  return (
    (((a.filterA ?? 0) & (b.filterB ?? 0)) |
      ((b.filterA ?? 0) & (a.filterB ?? 0))) !==
    0
  );
}

/** Only an eligible passive damage result changes these native masks. */
export function setStruckPedBodyFilters(body: NativePedBody): void {
  body.filterA = 0x20000;
  body.filterB = 0x40000;
}

/** BRender row-basis/root origin provider for animation and halt callbacks. */
export function nativePedRootPose(body: NativePedBody): Float32Array {
  const e = new Matrix4().compose(
    body.state.position,
    body.state.orientation,
    new Vector3(1, 1, 1),
  ).elements;
  return new Float32Array([
    e[0],
    e[1],
    e[2],
    e[4],
    e[5],
    e[6],
    e[8],
    e[9],
    e[10],
    e[12],
    e[13],
    e[14],
  ]);
}

export function acceptNativePedHalt(body: NativePedBody): void {
  body.headerState = 1;
  body.doNothing = true;
  body.properties.immovable = true;
  body.suppressWorldFaces = true;
  body.suppressSelfSentinel = true;
  body.suppressJointConstraints = true;
  body.rigidFlags = (body.rigidFlags | 0x78) >>> 0;
  body.filterA = 0x10000;
  body.filterB = 0x50000;
  body.specialVolume = undefined;
  body.characterVelocity.copy(body.state.velocity);
}

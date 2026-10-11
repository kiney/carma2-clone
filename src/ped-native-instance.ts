/** Ordinary native pedestrian instances, composed independently from the verified
 * root clock and flat bone-pose kernels. No procedural skeleton or body solver. */
import * as THREE from "three";
import type { NativePedAssets, NativePedMoveAsset } from "./ped-native-assets";
import {
  advancePedAnimationClock,
  buildPedOrientation,
  buildPedRootMotion,
  composePedRootPose,
  groundPedRootOrigin,
  pedRootMotionDirection,
  reorientPedRootPose,
  stepPedRootPose,
  type PedAnimationClock,
  type PedSimpleBodyProfile,
  type PedVector,
} from "./ped-form";
import {
  buildNativePedBoneMotion,
  poseNativePedBones,
  type NativePedBoneMotion,
  type NativePedPoseBone,
} from "./ped-bone-pose";

export interface NativePedInstanceMove {
  asset: NativePedMoveAsset;
  roots: readonly Float32Array[];
  bones: NativePedBoneMotion;
  sourceDirection: PedVector;
}
export interface NativePedInstanceBone {
  index: number;
  /** Root/world matrices are independent per instance and retain object identity. */
  pose: Float32Array;
  /** One stable native ACT identity; changing the model never replaces this. */
  actor: THREE.Group;
  /** Selected render resource under actor, equivalent to ACT.model (may be NULL). */
  model: THREE.Group | null;
  poseIndex: number;
  /** Per-instance pose0..3 render resources; only model is attached to the ACT. */
  modelSets: [
    readonly (THREE.Group | null)[],
    readonly (THREE.Group | null)[] | null,
  ];
}
export interface NativePedInstance {
  readonly template: NativePedAssets;
  readonly group: THREE.Group;
  readonly hullProfile: PedSimpleBodyProfile;
  readonly bones: NativePedInstanceBone[];
  readonly poseBones: NativePedPoseBone[];
  readonly rootPose: Float32Array;
  readonly rootWorldPosition: THREE.Vector3;
  readonly nativeCharacterVelocity: [number, number, number];
  characterOrientation: Float32Array;
  movement: Float32Array;
  direction: PedVector;
  groundNormal: PedVector;
  move: NativePedInstanceMove | null;
  moveId: number | null;
  clock: PedAnimationClock;
  modelSet: 0 | 1;
  removedBoneMask: number;
  vanishedBoneMask: number;
  physicsActive: boolean;
  boned: boolean;
  temporaryMatricesAvailable: boolean;
  morphActive: boolean;
  mutantSpeed: number;
  movementDisabled: boolean;
  completionRequested: boolean;
  onMoveCompleted:
    | ((instance: NativePedInstance, timeMs: number) => void)
    | null;
  /** Host-owned detached actors are not written by intact rendering. */
  detachedBoneMask: number;
}
export interface NativePedInstanceCreateOptions {
  rootPose: ArrayLike<number>;
  /** Preallocated shared FORM render slot: bare, unowned flat ACTs in FORM order.
   * Reuse requires releaseNativePedActorSet after the host releases all PHIL
   * references, including removed parts. Container local/world transforms are identity. */
  actorSet?: NativePedActorSet;
  /** Required for actual source model set1. The loader currently supplies set0. */
  modelSet1?: readonly (readonly (THREE.Group | null)[])[];
}
export interface NativePedActorSet {
  group: THREE.Group;
  actors: readonly THREE.Group[];
}
export interface NativePedActorReleaseOptions {
  /** Required read-only host proof that no registered or deferred PHIL object
   * retains these ACTs. Physics flags alone are not an ownership proof. */
  isPhysicsReleased: (instance: NativePedInstance) => boolean;
}
export interface NativePedMoveSelectionOptions {
  /** Actual signed native period; absent means authored FORM period. */
  periodMs?: number;
  restart?: boolean;
  /** Source completion-request bit2; ordinary unrequested moves wrap to frame0. */
  completionRequested?: boolean;
  onMoveCompleted?: (instance: NativePedInstance, timeMs: number) => void;
  /** Explicit source ground point during grounded move selection. */
  groundHeight?: number;
  /** Retained-root/morph transitions require a separate source provider. */
  retainRoot?: boolean;
  morphDurationMs?: number;
}
export interface NativePedAdvanceOptions {
  /** A source ground point, applied before authored deltas, never guessed feet. */
  groundHeight?: number;
  activeRootPose?: ArrayLike<number>;
  /** Physical V is validated here but owned by the moved callback, not the BON clock. */
  activeWorldVelocity?: PedVector;
  /** Legacy caller argument: native Munge selects its own modes. */
  mode?: 0 | 1 | 2 | 3;
  actionReplay?: boolean;
  /** Required only when replay is enabled; negative rate reverses root deltas. */
  replayRate?: number;
}
export interface NativePedInstanceResult {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  processedFrames: number;
  completedMove: boolean;
  /** Known source NULL is an ordinary model-selection failure, not a missing provider. */
  nativeModelReturn?: 0 | 1;
}
const f = Math.fround;
const identity = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
const moveCache = new WeakMap<
  NativePedAssets,
  Map<number, NativePedInstanceMove>
>();
const actorOwners = new WeakMap<THREE.Group, NativePedInstance>();
const groupOwners = new WeakMap<THREE.Group, NativePedInstance>();
const groupForms = new WeakMap<THREE.Group, string>();
function ownsActors(instance: NativePedInstance): boolean {
  return (
    groupOwners.get(instance.group) === instance &&
    instance.bones.every((bone) => actorOwners.get(bone.actor) === instance)
  );
}
function validateActorSet(
  set: NativePedActorSet,
  template: NativePedAssets,
): void {
  const { group, actors } = set;
  if (!group?.isGroup || actors.length !== template.bones.length)
    throw new Error(
      "Native FORM actor set requires its identity group and exact bone count",
    );
  if (groupOwners.has(group))
    throw new Error(
      "Native FORM actor set is still owned; host release is required",
    );
  const formName = groupForms.get(group);
  if (formName && formName !== template.profile.formName)
    throw new Error("Native render actor slot belongs to a different FORM");
  group.updateWorldMatrix(true, false);
  const expected = new THREE.Matrix4().elements;
  for (const elements of [group.matrix.elements, group.matrixWorld.elements])
    if (elements.some((n, i) => !Number.isFinite(n) || n !== expected[i]))
      throw new Error(
        "Native FORM actor container must have finite identity local/world matrices",
      );
  if (new Set(actors).size !== actors.length)
    throw new Error("Native FORM actor set contains duplicate ACTs");
  if (group.children.length !== actors.length)
    throw new Error(
      "Native FORM actor set must contain only its flat bone ACTs",
    );
  actors.forEach((actor, index) => {
    if (
      !actor?.isGroup ||
      actor.name !== template.bones[index].name ||
      actor.parent !== group ||
      !group.children.includes(actor)
    )
      throw new Error(
        "Native FORM actor set bone name/order/flat parent mismatch",
      );
    if (actorOwners.has(actor))
      throw new Error(
        "Native FORM bone ACT is still owned; host release is required",
      );
    if (actor.children.length)
      throw new Error(
        "Unowned native FORM ACT must have no bound model contents",
      );
    actor.updateWorldMatrix(false, false);
    if (
      [...actor.matrix.elements, ...actor.matrixWorld.elements].some(
        (n) => !Number.isFinite(n),
      )
    )
      throw new Error("Native FORM ACT requires finite matrices");
  });
}
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("Native pedestrian instance: non-finite scalar");
  return f(n);
}
function matrix(m: ArrayLike<number>): Float32Array {
  if (m.length !== 12)
    throw new Error("Native pedestrian instance requires native12 matrix");
  return Float32Array.from(m, scalar);
}
function time(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
    throw new Error("Invalid native pedestrian instance time");
  return n;
}
function period(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 32767)
    throw new Error(
      "Native instance requires an ordinary forward period0..32767; reverse replay is a separate provider",
    );
  return n;
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3)
    throw new Error("Invalid native pedestrian instance vector");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}
function result(
  requiredProviders: string[] = [],
  processedFrames = 0,
  completedMove = false,
): NativePedInstanceResult {
  return {
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders,
    processedFrames,
    completedMove,
  };
}
function setActorPose(actor: THREE.Group, p: Float32Array): void {
  actor.matrix.set(
    p[0],
    p[3],
    p[6],
    p[9],
    p[1],
    p[4],
    p[7],
    p[10],
    p[2],
    p[5],
    p[8],
    p[11],
    0,
    0,
    0,
    1,
  );
  actor.matrixAutoUpdate = false;
  actor.matrixWorldNeedsUpdate = true;
}
function cloneModel(actor: THREE.Group | null): THREE.Group | null {
  if (!actor) return null;
  const copy = actor.clone(true);
  copy.matrixAutoUpdate = false;
  copy.matrix.identity();
  copy.visible = false;
  return copy;
}
function assignModel(
  bone: NativePedInstanceBone,
  model: THREE.Group | null,
): void {
  if (bone.model) {
    if (bone.model.parent === bone.actor) bone.actor.remove(bone.model);
    bone.model.visible = false;
  }
  bone.model = model;
  if (model) {
    model.visible = true;
    bone.actor.add(model);
  }
}
function render(instance: NativePedInstance): void {
  instance.rootWorldPosition.set(
    instance.rootPose[9],
    instance.rootPose[10],
    instance.rootPose[11],
  );
  for (const bone of instance.bones) {
    if (instance.detachedBoneMask & ((2 ** bone.index) >>> 0)) continue;
    const vanished = !!(instance.vanishedBoneMask & ((2 ** bone.index) >>> 0));
    bone.actor.visible = !vanished;
    setActorPose(bone.actor, bone.pose);
  }
  instance.group.updateMatrixWorld(true);
}
function applyBonePose(
  instance: NativePedInstance,
  mode: 0 | 1 | 2 | 3,
): NativePedInstanceResult {
  if (!ownsActors(instance)) return result(["native-render-actor-set-owner"]);
  if (!instance.move) {
    render(instance);
    return result(["native-selected-move-provider"]);
  }
  const posed = poseNativePedBones({
    bones: instance.poseBones,
    angles: instance.move.bones.frames[instance.clock.frame],
    rootPose: instance.rootPose,
    characterOrientation: instance.characterOrientation,
    currentPoses: instance.bones.map((b) => b.pose),
    removedBoneMask: instance.removedBoneMask,
    mode,
    selectedMoveValid: true,
    renderAvailable: true,
    physicsActive: instance.physicsActive,
    boned: instance.boned,
    temporaryMatricesAvailable: instance.temporaryMatricesAvailable,
    morphActive: instance.morphActive,
    mutantSpeed: instance.mutantSpeed,
  });
  if (posed.requiredProviders.length) return result(posed.requiredProviders);
  for (let i = 0; i < instance.bones.length; i++)
    instance.bones[i].pose.set(posed.poses[i]);
  render(instance);
  return result();
}
function cachedMove(
  template: NativePedAssets,
  id: number,
): NativePedInstanceMove | null {
  const asset = template.moves.get(id);
  if (!asset || !asset.personality) return null;
  let cache = moveCache.get(template);
  if (!cache) {
    cache = new Map();
    moveCache.set(template, cache);
  }
  let move = cache.get(id);
  if (!move) {
    const roots = buildPedRootMotion(
        asset.motion,
        template.profile.rootName,
        asset.form.resetAxes,
        { missingRoot: "native-zero" },
      ),
      bones = buildNativePedBoneMotion(
        asset.motion,
        template.form.bones.map((b) => b.name),
        { missingBones: "native-zero" },
      );
    move = {
      asset,
      roots,
      bones,
      sourceDirection: pedRootMotionDirection(
        roots,
        asset.form.direction,
        asset.form.resetAxes,
      ).sourceDirection,
    };
    cache.set(id, move);
  }
  return move;
}
/** Create one stable flat ACT per FORM bone, borrowing immutable mesh resources.
 * Model variants stay outside the universe until selected under that ACT. No
 * source ACT parent matrices survive; caller supplies the source world root. */
export function createNativePedInstance(
  template: NativePedAssets,
  options: NativePedInstanceCreateOptions,
): NativePedInstance {
  const root = matrix(options.rootPose);
  if (options.modelSet1 && options.modelSet1.length !== template.bones.length)
    throw new Error("Invalid native model set1 bone table");
  if (!template.bones.length || template.bones.length > 32)
    throw new Error("Invalid native instance bone count");
  for (const set of options.modelSet1 ?? [])
    if (!set || set.length > 4)
      throw new Error("Invalid native model set1 pose table");
  if (
    template.form.bones.length !== template.bones.length ||
    template.bones.some(
      (b, index) =>
        b.index !== index || b.name !== template.form.bones[index].name,
    )
  )
    throw new Error("Native instance asset bones must match FORM order");
  const poseBones = template.bones.map((asset, index) => {
    if (asset.parent === null)
      throw new Error(
        `Native zero-mass attachment semantics require a provider: ${asset.name}`,
      );
    if (index && !asset.attachments)
      throw new Error(`Missing native attachment: ${asset.name}`);
    return {
      parent: asset.parent,
      childAttachment: asset.attachments?.child ?? null,
      parentAttachment: asset.attachments?.parent ?? null,
    };
  });
  if (options.actorSet) validateActorSet(options.actorSet, template);
  // Clone every resource before touching the shared ACT slot. A failed clone
  // cannot leave a half-bound unowned slot with selected models attached.
  const modelSets = template.bones.map(
    (asset, index) =>
      [
        asset.variants.map((v) => cloneModel(v.actor)),
        options.modelSet1?.[index]?.map(cloneModel) ?? null,
      ] as NativePedInstanceBone["modelSets"],
  );
  const group = options.actorSet?.group ?? new THREE.Group();
  if (!options.actorSet) {
    group.name = template.group.name;
    group.matrix.identity();
  }
  group.matrixAutoUpdate = false;
  group.visible = true;
  const bones = template.bones.map((asset, index) => {
    const [set0, set1] = modelSets[index],
      actor = options.actorSet?.actors[index] ?? new THREE.Group();
    if (!options.actorSet) {
      actor.name = asset.name;
      group.add(actor);
    }
    actor.matrixAutoUpdate = false;
    const bone: NativePedInstanceBone = {
      index,
      pose: index === 0 ? root : identity(),
      actor,
      model: null,
      poseIndex: 0,
      modelSets: [set0, set1] as NativePedInstanceBone["modelSets"],
    };
    assignModel(bone, set0[0] ?? null);
    return bone;
  });
  const instance: NativePedInstance = {
    template,
    group,
    hullProfile: template.profile,
    bones,
    poseBones,
    rootPose: root,
    rootWorldPosition: new THREE.Vector3(),
    nativeCharacterVelocity: [0, 0, 0],
    characterOrientation: identity(),
    movement: identity(),
    direction: [0, 0, 1],
    groundNormal: [0, 1, 0],
    move: null,
    moveId: null,
    clock: { frame: 0, fraction: 0, lastTimeMs: 0, periodMs: 0 },
    modelSet: 0,
    removedBoneMask: 0,
    vanishedBoneMask: 0,
    detachedBoneMask: 0,
    physicsActive: false,
    boned: false,
    temporaryMatricesAvailable: false,
    morphActive: false,
    mutantSpeed: 0,
    movementDisabled: false,
    completionRequested: false,
    onMoveCompleted: null,
  };
  groupOwners.set(group, instance);
  if (template.profile.formName)
    groupForms.set(group, template.profile.formName);
  for (const bone of bones) actorOwners.set(bone.actor, instance);
  render(instance);
  return instance;
}
/** Release a FORM render binding only after actual body/part removal. ACTs and
 * matrices remain stable; models detach, and stale instances cannot pose them.
 * Host returns detached ACTs to their original flat slot before calling this. */
export function releaseNativePedActorSet(
  instance: NativePedInstance,
  options: NativePedActorReleaseOptions,
): NativePedActorSet {
  if (!ownsActors(instance))
    throw new Error(
      "Native render ACT binding is already released or replaced",
    );
  if (
    typeof options?.isPhysicsReleased !== "function" ||
    options.isPhysicsReleased(instance) !== true
  )
    throw new Error(
      "Native FORM ACT release requires actual PHIL ownership release proof",
    );
  if (
    instance.group.children.length !== instance.bones.length ||
    instance.bones.some(
      (bone) =>
        bone.actor.parent !== instance.group ||
        !instance.group.children.includes(bone.actor),
    )
  )
    throw new Error(
      "Native FORM ACT release requires detached bones returned to their flat render slot",
    );
  for (const bone of instance.bones) {
    assignModel(bone, null);
    bone.actor.visible = false;
    actorOwners.delete(bone.actor);
  }
  instance.group.visible = false;
  groupOwners.delete(instance.group);
  return {
    group: instance.group,
    actors: instance.bones.map((bone) => bone.actor),
  };
}
/** Select ordinary non-morph move and heading. Re-selecting the same move turns
 * its current full root basis without resetting its frame/fraction. */
export function selectNativePedMove(
  instance: NativePedInstance,
  id: number,
  direction: PedVector,
  groundNormal: PedVector,
  timeMs: number,
  options: NativePedMoveSelectionOptions = {},
): NativePedInstanceResult {
  if (!ownsActors(instance)) return result(["native-render-actor-set-owner"]);
  time(timeMs);
  if (!Number.isInteger(id) || id < 0 || id > 0x7fffffff)
    throw new Error("Invalid native move ID");
  if (options.retainRoot)
    return result(["native-retained-root-transition-provider"]);
  if (options.morphDurationMs)
    return result(["native-ped-morph-pose-provider"]);
  let move: NativePedInstanceMove | null;
  try {
    move = cachedMove(instance.template, id);
  } catch (error) {
    return result([
      `native-move-${id}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (!move)
    return result([`native-move-${id}-and-personality-record-provider`]);
  const p = period(options.periodMs ?? move.asset.form.periodMs),
    d = vector(direction),
    u = vector(groundNormal),
    built = buildPedOrientation(d, u, move.sourceDirection);
  const same = instance.moveId === id && !options.restart;
  if (instance.physicsActive)
    return result(["native-active-direction-and-move-transition-provider"]);
  const next = same
    ? reorientPedRootPose(
        instance.rootPose,
        instance.characterOrientation,
        built.orientation,
      )
    : composePedRootPose(move.roots[0], built.orientation, [
        instance.rootPose[9],
        instance.rootPose[10],
        instance.rootPose[11],
      ]);
  if (
    options.groundHeight !== undefined &&
    move.asset.personality!.groundingMode === 0
  )
    next.set(
      groundPedRootOrigin(
        [next[9], next[10], next[11]],
        options.groundHeight,
        move.asset.personality!.groundingOffset,
      ),
      9,
    );
  instance.move = move;
  instance.moveId = id;
  instance.characterOrientation = built.orientation;
  instance.movement = built.movement;
  instance.direction = built.direction;
  instance.groundNormal = built.up;
  if (!same)
    instance.clock = { frame: 0, fraction: 0, lastTimeMs: timeMs, periodMs: p };
  else instance.clock.periodMs = p;
  if (options.completionRequested !== undefined)
    instance.completionRequested = options.completionRequested;
  if (options.onMoveCompleted)
    instance.onMoveCompleted = options.onMoveCompleted;
  instance.rootPose.set(next);
  return applyBonePose(instance, 0);
}
/** Source model selection is a pointer/visibility change, not a new sibling
 * clone or a collision-hull resize. Set1 must be supplied by the actual owner. */
export function selectNativePedBoneModel(
  instance: NativePedInstance,
  boneIndex: number,
  poseIndex: number,
  modelSet: 0 | 1,
): NativePedInstanceResult {
  if (!ownsActors(instance)) return result(["native-render-actor-set-owner"]);
  const bone = instance.bones[boneIndex];
  if (
    !bone ||
    !Number.isInteger(boneIndex) ||
    !Number.isInteger(poseIndex) ||
    poseIndex >= 4 ||
    !Number.isInteger(modelSet) ||
    modelSet < 0 ||
    modelSet > 1
  )
    throw new Error("Invalid native model selection");
  const target = bone.modelSets[modelSet];
  if (!target) return result(["native-model-set1-provider"]);
  // Source infers the previous pose by pointer in the character's current
  // model set. A pointer absent from that table falls back to pose0.
  const previousPose =
    bone.modelSets[instance.modelSet]?.indexOf(bone.model) ?? -1;
  const pose = poseIndex < 0 ? Math.max(0, previousPose) : poseIndex;
  instance.modelSet = modelSet;
  const actor = target[pose];
  if (!actor && poseIndex >= 0) return { ...result(), nativeModelReturn: 0 };
  // Installed40b49b assigns even NULL in the inferred-pose branch, returning1.
  assignModel(bone, actor ?? null);
  bone.poseIndex = pose;
  render(instance);
  return { ...result(), nativeModelReturn: 1 };
}
/** Explicit SetCharacterBonePositions mode without changing the BON clock. */
export function poseNativePedFrame(
  instance: NativePedInstance,
  mode: 0 | 1 | 2 | 3,
): NativePedInstanceResult {
  if (!Number.isInteger(mode) || mode < 0 || mode > 3)
    throw new Error("Invalid native pose mode");
  return applyBonePose(instance, mode);
}
/** Installed40b770/409400 shared physical-pose prefix. This never consumes the
 * animation clock; moved and accepted halt own the separate character-V copy. */
export function synchronizeNativePedPhysicalPose(
  instance: NativePedInstance,
  physicalRootPose: ArrayLike<number>,
): NativePedInstanceResult {
  if (!ownsActors(instance)) return result(["native-render-actor-set-owner"]);
  if (!instance.move) return result(["native-selected-move-provider"]);
  const root = matrix(physicalRootPose),
    frame = instance.move.roots[instance.clock.frame],
    inverse = identity();
  // Installed BrMatrix34LPInverse5324f0 transposes the LP basis; O translation
  // is explicitly cleared after inverse(frame)*physicalRoot.
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) inverse[i * 3 + j] = frame[j * 3 + i];
  instance.rootPose.set(root);
  const orders = [
    [2, 1, 0],
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [0, 2, 1],
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 0, 2],
  ];
  const orientation = new Float32Array(12);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++) {
      const terms = [0, 1, 2].map(
          (k) => inverse[row * 3 + k] * root[k * 3 + column],
        ),
        order = orders[row * 3 + column];
      orientation[row * 3 + column] = scalar(
        terms[order[0]] + terms[order[1]] + terms[order[2]],
      );
    }
  instance.characterOrientation = orientation;
  return applyBonePose(instance, 3);
}
/** Installed409ca0 ordinary non-morph clock. Negative advance poses the CURRENT
 * frame before decrementing. Moved/halt callbacks own physical O and V updates. */
export function advanceNativePedPose(
  instance: NativePedInstance,
  timeMs: number,
  options: NativePedAdvanceOptions = {},
): NativePedInstanceResult {
  if (!ownsActors(instance)) return result(["native-render-actor-set-owner"]);
  time(timeMs);
  const physicalRoot = options.activeRootPose
    ? matrix(options.activeRootPose)
    : null;
  if (options.activeWorldVelocity) vector(options.activeWorldVelocity);
  if (
    options.mode !== undefined &&
    (!Number.isInteger(options.mode) || options.mode < 0 || options.mode > 3)
  )
    throw new Error("Invalid native pose mode");
  if (options.groundHeight !== undefined) scalar(options.groundHeight);
  if (!instance.move) return result(["native-selected-move-provider"]);
  if (instance.morphActive) return result(["native-ped-morph-pose-provider"]);
  if (instance.mutantSpeed !== 0)
    return result(["native-mutant-angle-rng-provider"]);
  const active = instance.physicsActive || !!physicalRoot;
  // Installed409ccb returns before clock changes for active articulated bodies.
  if (active && instance.boned && !instance.temporaryMatricesAvailable)
    return result(["native-temporary-bone-matrix-provider"]);
  if (active && instance.boned && instance.temporaryMatricesAvailable)
    return result(["native-temporary-bone-matrix-storage-provider"]);
  if (active && !physicalRoot)
    return result(["native-active-root-pose-provider"]);
  const replay = options.actionReplay ?? false;
  if (replay && options.replayRate === undefined)
    return result(["native-replay-rate-provider"]);
  if (options.replayRate !== undefined) scalar(options.replayRate);
  const move = instance.move,
    clock = advancePedAnimationClock(instance.clock, timeMs);
  if (
    clock.advance > 0 &&
    !replay &&
    instance.completionRequested &&
    !instance.onMoveCompleted &&
    instance.clock.frame + clock.advance >= move.roots.length
  )
    return result(["native-move-completion-provider"]);
  instance.physicsActive = active;
  if (physicalRoot) instance.rootPose.set(physicalRoot);
  if (
    options.groundHeight !== undefined &&
    !active &&
    move.asset.personality!.groundingMode === 0
  )
    instance.rootPose.set(
      groundPedRootOrigin(
        [instance.rootPose[9], instance.rootPose[10], instance.rootPose[11]],
        options.groundHeight,
        move.asset.personality!.groundingOffset,
      ),
      9,
    );
  const oldOrigin = [...instance.rootPose.subarray(9)],
    oldPeriod = instance.clock.periodMs;
  let processedFrames = 0,
    completedMove = false,
    posed = result();
  const pose = (mode: 0 | 2 | 3, translate: boolean) => {
    if (!active && mode !== 3) {
      const next = stepPedRootPose(
        instance.rootPose,
        instance.move!.roots[instance.clock.frame],
        instance.characterOrientation,
        instance.movement,
        instance.move!.asset.personality!.scale,
        translate && !instance.movementDisabled,
        replay && options.replayRate! < 0 ? -1 : 1,
      );
      if (mode === 2) next.set(instance.rootPose.subarray(0, 9));
      instance.rootPose.set(next);
    }
    posed = applyBonePose(instance, mode);
  };
  instance.clock.fraction = clock.fraction;
  if (oldPeriod !== 0) {
    if (clock.initialPose) pose(0, false);
    else if (clock.advance < 0) {
      for (let iterator = clock.advance; iterator < 0; iterator++) {
        pose(iterator < -1 ? 2 : 0, true);
        processedFrames++;
        instance.clock.frame--;
        if (instance.clock.frame < 0) {
          if (move.asset.form.flags & 1) {
            instance.clock.frame = 0;
            pose(3, true);
            break;
          }
          instance.clock.frame = move.roots.length - 1;
        }
      }
    } else if (clock.advance > 0) {
      for (let iterator = 0; iterator < clock.advance; iterator++) {
        instance.clock.frame++;
        if (instance.clock.frame >= instance.move!.roots.length) {
          const current = instance.move!;
          instance.clock.frame = current.roots.length - 1;
          if (!replay && instance.completionRequested) {
            instance.completionRequested = false;
            completedMove = true;
            instance.onMoveCompleted!(instance, timeMs);
            if (!ownsActors(instance))
              return {
                ...result(["native-render-actor-set-owner"]),
                processedFrames,
                completedMove,
              };
            if (instance.move === current) instance.clock.frame = 0;
            pose(0, false);
            // Installed CBMoveCompleted returns1 even if the move stays unchanged.
            break;
          }
          if (replay && current.asset.form.flags & 1) {
            pose(0, true);
            processedFrames++;
            break;
          }
          instance.clock.frame = 0;
        }
        pose(iterator + 1 < clock.advance ? 2 : 0, true);
        processedFrames++;
      }
    } else if (active || replay) pose(0, false);
  }
  // A completion callback may change the period. Native still uses the original
  // signed requested advance, including steps skipped by that callback.
  instance.clock.lastTimeMs = timeMs;
  if (clock.advance) {
    const seconds = clock.advance * instance.clock.periodMs * 0.001;
    const velocity = oldOrigin.map((n, i) =>
      f(f(instance.rootPose[9 + i] - n) / seconds),
    );
    if (velocity.some((n) => !Number.isFinite(n)))
      return {
        ...result(["native-nonfinite-animation-velocity"]),
        processedFrames,
        completedMove,
      };
    instance.nativeCharacterVelocity.splice(
      0,
      3,
      ...(velocity as [number, number, number]),
    );
  } else if (oldPeriod === 0) instance.nativeCharacterVelocity.fill(0);
  return { ...posed, processedFrames, completedMove };
}
/** Selected authored model identity and remapped local bounds for body setup. */
export function currentNativePedModel(
  instance: NativePedInstance,
  boneIndex: number,
) {
  if (!ownsActors(instance))
    throw new Error("Native render ACT binding is released or replaced");
  const bone = instance.bones[boneIndex];
  if (!bone) throw new Error("Invalid native bone index");
  const variant = instance.template.bones[boneIndex].variants[bone.poseIndex];
  return {
    actor: bone.actor,
    model: bone.model,
    identifier: bone.model ? (variant?.identifier ?? bone.model.name) : null,
    modelSet: instance.modelSet,
    poseIndex: bone.poseIndex,
    modelBounds: bone.model ? (variant?.modelBounds ?? null) : null,
  };
}

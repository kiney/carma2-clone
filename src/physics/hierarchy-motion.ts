import { Box3, Quaternion, Vector3 } from "three";
import type { RigidBody, RigidProperties } from "./contact";
import type { RigidJoint } from "./joint";
import { advanceRigidBody } from "./integrate";
import type { GuardPose, PosePath } from "./pair-guard";

export interface HierarchyMotionSample extends GuardPose {
  velocity: Vector3;
  angularVelocity: Vector3;
}
export interface HierarchyMotionPhase {
  paths: Map<RigidBody, PosePath>;
  /** One captured temporal cap per physical tree, including external anchors. */
  worldFractions: ReadonlyMap<RigidBody, number>;
  pose(body: RigidBody, fraction: number): HierarchyMotionSample;
  writeCandidates(targets: readonly RigidBody[], fraction?: number): void;
  commit(
    targets: readonly RigidBody[],
    pairFractions?: ReadonlyMap<RigidBody, number>,
  ): void;
}
interface CapturedJoint {
  type: RigidJoint["type"];
  childAnchor: Vector3;
  parentAnchor: Vector3;
  childAxis?: Vector3;
  translationAxis?: Vector3;
}
interface MotionNode {
  body: RigidBody;
  fixed: boolean;
  oldPose: GuardPose;
  oldVelocity: [number, number, number];
  oldOmega: [number, number, number];
  com: [number, number, number];
  properties?: RigidProperties;
  joint?: CapturedJoint;
  parent?: MotionNode;
  root?: MotionNode;
  scratch?: RigidBody;
  cache?: Map<number, HierarchyMotionSample>;
  constantSample?: HierarchyMotionSample;
  angularTravel?: number;
  worldAngularSampling?: number;
  comBounds?: Box3;
}
const tuple = (value: Vector3): [number, number, number] => [
  value.x,
  value.y,
  value.z,
];
const vec = (value: readonly number[]) => new Vector3(...value);
const worldPoint = (pose: GuardPose, local: Vector3) =>
  local.clone().applyQuaternion(pose.orientation).add(pose.position);
function cap(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(
      "Hierarchy temporal fraction must be finite and within [0, 1]",
    );
  return value;
}
function immutableSample(sample: HierarchyMotionSample): HierarchyMotionSample {
  Object.freeze(sample.position);
  Object.freeze(sample.orientation);
  Object.freeze(sample.velocity);
  Object.freeze(sample.angularVelocity);
  return Object.freeze(sample);
}
function hingeRelativeRate(node: MotionNode): number {
  const inverse = node.oldPose.orientation.clone().invert();
  const childLocal = vec(node.oldOmega).applyQuaternion(inverse);
  const parentLocal = vec(node.parent!.oldOmega).applyQuaternion(inverse);
  return childLocal.sub(parentLocal).dot(node.joint!.childAxis!);
}
/** Ordinary installed joint movement: 4b8fd0, ball/universal anchor alignment
 * 4b9298..4b9317, hinge 4b9156, type5 transverse/axial movement. Root angular
 * integration remains advanceRigidBody. Unmapped source flag0x400 ancestor
 * selection, cached-relative-affine paths and upward WORLD-joint correction
 * require their own source metadata; this module does not invent those variants.
 *
 * Capture after each solve/activation/topology barrier. Pose queries are pure;
 * source state, properties and joint vectors are never borrowed as mutable
 * inputs. Hinge motion uses finite parent rotation, not an end-axis projection.
 * Collision masks do not disconnect the physical temporal hierarchy. */
export function createHierarchyMotionPhase(
  bodies: readonly RigidBody[],
  joints: readonly RigidJoint[],
  stepSeconds: number,
  sourceWorldFractions?: ReadonlyMap<RigidBody, number>,
): HierarchyMotionPhase {
  if (!(Number.isFinite(stepSeconds) && stepSeconds >= 0))
    throw new Error("Hierarchy step must be finite and nonnegative");
  const nodes = new Map<RigidBody, MotionNode>();
  const capture = (body: RigidBody): MotionNode => {
    const previous = nodes.get(body);
    if (previous) return previous;
    const fixed = !!body.properties.immovable;
    const node: MotionNode = {
      body,
      fixed,
      oldPose: {
        position: body.state.position.clone(),
        orientation: body.state.orientation.clone(),
      },
      oldVelocity: tuple(body.state.velocity),
      oldOmega: tuple(body.state.angularVelocity),
      com: tuple(body.properties.centerOfMass),
    };
    Object.freeze(node.oldPose.position);
    Object.freeze(node.oldPose.orientation);
    Object.freeze(node.oldPose);
    // Fixed scenery gets only two pose clones, no state/probe/sample map. Its
    // motion tuples are captured scalars; full samples are materialized lazily.
    if (!fixed) {
      node.properties = {
        mass: body.properties.mass,
        inertia: body.properties.inertia.clone(),
        centerOfMass: vec(node.com),
        objectFriction: body.properties.objectFriction,
        worldFriction: body.properties.worldFriction,
        rotationLocked: body.properties.rotationLocked,
        immovable: false,
      };
      node.cache = new Map();
    }
    nodes.set(body, node);
    return node;
  };
  for (const body of bodies) capture(body);
  for (const joint of joints) {
    const child = nodes.get(joint.child);
    if (!child)
      throw new Error("Hierarchy joint child is absent from the body roster");
    if (child.joint)
      throw new Error("Hierarchy child has multiple parent joints");
    child.parent = capture(joint.parent);
    child.joint = {
      type: joint.type,
      childAnchor: joint.childAnchor.clone(),
      parentAnchor: joint.parentAnchor.clone(),
      childAxis: joint.childAxis?.clone(),
      translationAxis: joint.translationAxis?.clone(),
    };
    if (joint.type === "hinge" && !child.joint.childAxis)
      throw new Error("Hierarchy hinge requires its authored child axis");
    if (joint.type === "translation" && !child.joint.translationAxis)
      throw new Error("Hierarchy translation joint requires its authored axis");
  }
  const visiting = new Set<MotionNode>();
  const rootOf = (node: MotionNode): MotionNode => {
    if (node.root) return node.root;
    if (visiting.has(node))
      throw new Error("Cycle in physical joint hierarchy");
    visiting.add(node);
    node.root = node.parent ? rootOf(node.parent) : node;
    visiting.delete(node);
    return node.root;
  };
  const worldCaps = new Map<MotionNode, number>();
  for (const node of nodes.values()) {
    const root = rootOf(node);
    const value = cap(sourceWorldFractions?.get(node.body) ?? 1);
    worldCaps.set(root, Math.min(worldCaps.get(root) ?? 1, value));
  }
  const worldFractions = new Map<RigidBody, number>();
  for (const node of nodes.values())
    worldFractions.set(node.body, worldCaps.get(node.root!)!);
  const duration = (node: MotionNode, fraction: number) =>
    stepSeconds * worldCaps.get(node.root!)! * fraction;
  const oldSample = (node: MotionNode): HierarchyMotionSample =>
    immutableSample({
      position: node.oldPose.position,
      orientation: node.oldPose.orientation,
      velocity: vec(node.oldVelocity),
      angularVelocity: vec(node.oldOmega),
    });
  const scratchFor = (node: MotionNode): RigidBody => {
    if (!node.scratch)
      node.scratch = {
        properties: node.properties!,
        state: {
          position: new Vector3(),
          orientation: new Quaternion(),
          velocity: new Vector3(),
          angularVelocity: new Vector3(),
        },
      };
    const scratch = node.scratch;
    scratch.state.position.copy(node.oldPose.position);
    scratch.state.orientation.copy(node.oldPose.orientation);
    scratch.state.velocity.set(...node.oldVelocity);
    scratch.state.angularVelocity.set(...node.oldOmega);
    return scratch;
  };
  const pose = (body: RigidBody, fraction: number): HierarchyMotionSample => {
    const node = nodes.get(body);
    if (!node)
      throw new Error(
        "Pose requested for a body outside the captured hierarchy",
      );
    if (!(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1))
      throw new Error(
        "Hierarchy pose fraction must be finite and within [0, 1]",
      );
    if (node.fixed) return (node.constantSample ??= oldSample(node));
    const cached = node.cache!.get(fraction);
    if (cached) return cached;
    if (fraction === 0 || duration(node, fraction) === 0) {
      const value = oldSample(node);
      node.cache!.set(fraction, value);
      return value;
    }
    const dt = duration(node, fraction);
    const scratch = scratchFor(node);
    const joint = node.joint;
    const parent = node.parent;
    let parentPose: HierarchyMotionSample | undefined;
    if (joint && parent) parentPose = pose(parent.body, fraction);
    if (joint?.type === "hinge" && parent && parentPose) {
      const axis = joint.childAxis!;
      const relativeRate = hingeRelativeRate(node);
      const angle =
        (Math.trunc(Math.fround(relativeRate * dt) * 10430.378350470453) &
          0xffff) *
        ((2 * Math.PI) / 65536);
      scratch.state.orientation
        .copy(parentPose.orientation)
        .multiply(parent.oldPose.orientation.clone().invert())
        .multiply(node.oldPose.orientation)
        .multiply(new Quaternion().setFromAxisAngle(axis, angle))
        .normalize();
      // Source hinge path retains world V/omega; only finite pose changes.
    } else {
      if (joint) scratch.state.velocity.set(0, 0, 0);
      advanceRigidBody(scratch, dt);
      if (joint) scratch.state.velocity.set(...node.oldVelocity);
    }
    if (joint && parentPose) {
      const displacement = worldPoint(parentPose, joint.parentAnchor).sub(
        worldPoint(scratch.state, joint.childAnchor),
      );
      scratch.state.position.add(displacement);
      if (joint.type === "translation") {
        const axis = joint
          .translationAxis!.clone()
          .applyQuaternion(node.oldPose.orientation);
        scratch.state.position.addScaledVector(axis, -displacement.dot(axis));
        scratch.state.velocity
          .copy(axis)
          .multiplyScalar(vec(node.oldVelocity).dot(axis));
        scratch.state.position.addScaledVector(scratch.state.velocity, dt);
      }
    }
    const value = immutableSample({
      position: scratch.state.position.clone(),
      orientation: scratch.state.orientation.clone(),
      velocity: scratch.state.velocity.clone(),
      angularVelocity: scratch.state.angularVelocity.clone(),
    });
    node.cache!.set(fraction, value);
    return value;
  };
  const angularTravel = (node: MotionNode): number => {
    if (node.angularTravel !== undefined) return node.angularTravel;
    if (node.fixed) return (node.angularTravel = 0);
    const inertia = node.properties!.inertia;
    const own = node.properties!.rotationLocked
      ? 0
      : (vec(node.oldOmega)
          .applyQuaternion(node.oldPose.orientation.clone().invert())
          .multiply(inertia)
          .length() /
          Math.min(inertia.x, inertia.y, inertia.z)) *
        stepSeconds *
        worldCaps.get(node.root!)!;
    const inherited = node.parent ? angularTravel(node.parent) : 0;
    // A parent's rotation moves a ball child's COM even if its orientation is
    // constant. For hinges also bound the relative-axis contribution separately.
    if (node.joint?.type === "hinge" && node.parent) {
      const relative =
        Math.abs(hingeRelativeRate(node)) *
        stepSeconds *
        worldCaps.get(node.root!)!;
      return (node.angularTravel = own + inherited + relative);
    }
    return (node.angularTravel = own + inherited);
  };
  const worldAngularSampling = (node: MotionNode): number => {
    if (node.worldAngularSampling !== undefined)
      return node.worldAngularSampling;
    if (node.fixed) return (node.worldAngularSampling = 0);
    const inherited = node.parent ? worldAngularSampling(node.parent) : 0;
    const rate =
      node.joint?.type === "hinge" && node.parent
        ? Math.abs(hingeRelativeRate(node))
        : vec(node.oldOmega).length();
    // Retain the world's captured-speed sampling heuristic, adding inherited
    // motion. This is deliberately separate from the conservative momentum/
    // inertia angularTravel bound required by the solid body-pair guard.
    return (node.worldAngularSampling =
      inherited + rate * stepSeconds * worldCaps.get(node.root!)!);
  };
  const centerBounds = (node: MotionNode): Box3 => {
    if (node.comBounds) return node.comBounds;
    const oldCOM = worldPoint(node.oldPose, vec(node.com));
    if (node.fixed)
      return (node.comBounds = new Box3(oldCOM.clone(), oldCOM.clone()));
    if (!node.joint || !node.parent) {
      const end = oldCOM
        .clone()
        .addScaledVector(vec(node.oldVelocity), duration(node, 1));
      return (node.comBounds = new Box3().setFromPoints([oldCOM, end]));
    }
    const joint = node.joint;
    if (joint.type === "translation") {
      const axis = joint
        .translationAxis!.clone()
        .applyQuaternion(node.oldPose.orientation);
      const axialTravel =
        Math.abs(vec(node.oldVelocity).dot(axis)) * duration(node, 1);
      const parentAnchorBounds = centerBounds(node.parent)
        .clone()
        .expandByScalar(
          joint.parentAnchor.clone().sub(vec(node.parent.com)).length(),
        );
      // COM*=A+(I-nnT)Rnew(C-a)+nnT(oldCOM-A)+dt*n(Vold.n).
      // The farthest corner bounds |oldCOM-A(t)| even for a moving parent;
      // origin/anchor lengths alone can miss the second COM term.
      const distance = new Vector3(
        Math.max(
          Math.abs(oldCOM.x - parentAnchorBounds.min.x),
          Math.abs(oldCOM.x - parentAnchorBounds.max.x),
        ),
        Math.max(
          Math.abs(oldCOM.y - parentAnchorBounds.min.y),
          Math.abs(oldCOM.y - parentAnchorBounds.max.y),
        ),
        Math.max(
          Math.abs(oldCOM.z - parentAnchorBounds.min.z),
          Math.abs(oldCOM.z - parentAnchorBounds.max.z),
        ),
      ).length();
      const extent =
        vec(node.com).sub(joint.childAnchor).length() + distance + axialTravel;
      node.comBounds = parentAnchorBounds
        .expandByScalar(extent)
        .expandByPoint(oldCOM);
      return node.comBounds;
    }
    const parentOffset = joint.parentAnchor
      .clone()
      .sub(vec(node.parent.com))
      .length();
    const childOffset = vec(node.com).sub(joint.childAnchor).length();
    return (node.comBounds = centerBounds(node.parent)
      .clone()
      .expandByScalar(parentOffset + childOffset)
      .expandByPoint(oldCOM));
  };
  const paths = new Map<RigidBody, PosePath>();
  for (const node of nodes.values()) {
    const path: PosePath & {
      temporalGroup?: object;
      centerBounds?: Box3;
      worldAngularSampling?: number;
    } = node.fixed
      ? () => node.oldPose
      : (fraction) => pose(node.body, fraction);
    path.stable = true;
    path.temporalGroup = node.root!.body;
    path.angularTravel = angularTravel(node);
    path.worldAngularSampling = worldAngularSampling(node);
    if (node.fixed) path.constantPose = node.oldPose;
    else if (node.joint) path.centerBounds = centerBounds(node);
    paths.set(node.body, path);
  }
  const writeCandidates = (targets: readonly RigidBody[], fraction = 1) => {
    cap(fraction);
    for (const body of targets) {
      const node = nodes.get(body);
      if (!node)
        throw new Error("Candidate target is outside the captured hierarchy");
      // Fixed candidate writes need only the captured pose. Do not materialize
      // velocity/omega sample vectors for every dormant scenery participant.
      const value = node.fixed ? node.oldPose : pose(body, fraction);
      (body.state.predictedPosition ??= new Vector3()).copy(value.position);
      (body.state.predictedOrientation ??= new Quaternion()).copy(
        value.orientation,
      );
    }
  };
  const commit = (
    targets: readonly RigidBody[],
    pairFractions?: ReadonlyMap<RigidBody, number>,
  ) => {
    const pairCaps = new Map<MotionNode, number>();
    for (const node of nodes.values()) {
      const value = cap(pairFractions?.get(node.body) ?? 1);
      pairCaps.set(node.root!, Math.min(pairCaps.get(node.root!) ?? 1, value));
    }
    // All samples are captured before writes; target order cannot feed updated
    // parent state back into an independent child's committed trajectory.
    const values = targets.map((body) => {
      const node = nodes.get(body);
      if (!node)
        throw new Error("Commit target is outside the captured hierarchy");
      return {
        body,
        node,
        value: node.fixed ? undefined : pose(body, pairCaps.get(node.root!)!),
      };
    });
    for (const { body, value } of values) {
      if (!value) continue;
      body.state.position.copy(value.position);
      body.state.orientation.copy(value.orientation);
      body.state.velocity.copy(value.velocity);
      body.state.angularVelocity.copy(value.angularVelocity);
    }
  };
  return { paths, worldFractions, pose, writeCandidates, commit };
}

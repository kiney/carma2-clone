import { Box3, Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";
import type { RigidJoint } from "./joint";
import type { PedBounds } from "../ped-form";
import {
  evaluateNativeQuietLeaf,
  foldNativeQuietHierarchy,
  type NativeQuietResult,
} from "./quiet-state";

const f = Math.fround;
export interface NativeQuietNode {
  doNothing: boolean;
  quietState: number;
}
export interface NativeHierarchyQuietState extends NativeQuietNode {
  /** Own eligibility before the descendant fold:0 or1. */
  ownState: number;
  bounds: PedBounds;
  oldOrientation: Quaternion;
  oldOrientationY: number;
  beforeWorldV: Vector3;
  beforeLocalOmega: Vector3;
  localVelocity: Vector3;
  auxiliaryLocalOmega: Vector3;
  gravityIncrement: Vector3;
  inertiaScale: 1 | 50;
  prepared: boolean;
  eligibleLeaves: number;
  sleepTransitions: number;
  wakeTransitions: number;
  lastResult?: NativeQuietResult;
}
export interface NativeHierarchyQuietHost<T> {
  /** Actual mutable state owned by an existing pedestrian/free-prop provider.
   * Unknown nodes return null and conservatively block whole-group sleep. */
  readExternalState?(body: T): NativeQuietNode | null;
  setExternalDoNothing?(body: T, value: boolean): void;
  onWake?(body: T): void;
  onSleep?(body: T): void;
}
export interface NativeHierarchyQuietFinish {
  collisionFlags: number;
  singleton: boolean;
  /** +18c world joint-info, not ordinary parent joint+188. */
  hasJointInfo?: boolean;
  /** Explicit native OLD matrix+9c provider overrides the captured value. */
  jointInfoOrientationY?: number | null;
  /** Prefer the actual solver-maintained+1a8 cache when available. */
  solverLocalVelocity?: Vector3;
}
type Link = Pick<RigidJoint, "parent" | "child">;
function finite(value: number): number {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new Error("Non-finite native hierarchy quiet input");
  return result;
}
function capturedBounds(value: Box3 | PedBounds): PedBounds {
  const min = value instanceof Box3 ? value.min.toArray() : value.min;
  const max = value instanceof Box3 ? value.max.toArray() : value.max;
  const result = {
    min: min.map(finite) as [number, number, number],
    max: max.map(finite) as [number, number, number],
  };
  if (result.max.some((n, i) => n < result.min[i]))
    throw new Error("Invalid native hierarchy quiet bounds");
  return result;
}
function topology<T extends RigidBody>(
  roster: readonly T[],
  joints: readonly Link[],
) {
  const alive = new Set<RigidBody>(roster);
  const parent = new Map<T, T>(),
    children = new Map<T, T[]>();
  for (const body of roster) children.set(body, []);
  for (const joint of joints) {
    // World anchors are not sleeping PHIL nodes; only real physical children
    // participate in the recursive+224 list.
    if (!alive.has(joint.child) || !alive.has(joint.parent)) continue;
    const child = joint.child as T,
      owner = joint.parent as T;
    if (parent.has(child)) throw new Error("Duplicate quiet hierarchy parent");
    parent.set(child, owner);
    children.get(owner)!.push(child);
  }
  for (const body of roster) {
    const visited = new Set<T>();
    for (let node: T | undefined = body; node; node = parent.get(node)) {
      if (visited.has(node)) throw new Error("Cyclic quiet hierarchy");
      visited.add(node);
    }
  }
  return { alive, parent, children };
}

/** Installed4b9780/4ba7a0 and4ba6cc: generic leaf snapshots, hierarchy fold
 * and complete-ring ec ownership. This runtime does not infer ec from camera,
 * velocity, motor sleep or elapsed time. Grounded-car/motor/attachment callers
 * remain host-owned; contact wake preserves quiet bytes, forced wake clears them.
 * Evidence: docs/c2-ped-physics-lifecycle-re.md and c2-noncar-wake-pull-re.md. */
export class NativeHierarchyQuiet<T extends RigidBody> {
  readonly stateMap = new Map<T, NativeHierarchyQuietState>();
  constructor(private readonly host: NativeHierarchyQuietHost<T> = {}) {}
  get(body: T): NativeHierarchyQuietState | null {
    return this.stateMap.get(body) ?? null;
  }
  private node(body: T): NativeQuietNode | null {
    return this.get(body) ?? this.host.readExternalState?.(body) ?? null;
  }
  retain(
    body: T,
    bounds: Box3 | PedBounds,
    initialec = false,
  ): NativeHierarchyQuietState {
    const box = capturedBounds(bounds);
    const existing = this.get(body);
    if (existing) {
      existing.bounds = box;
      return existing;
    }
    const state: NativeHierarchyQuietState = {
      doNothing: initialec,
      quietState: 0,
      ownState: 0,
      bounds: box,
      oldOrientation: new Quaternion(),
      oldOrientationY: 1,
      beforeWorldV: new Vector3(),
      beforeLocalOmega: new Vector3(),
      localVelocity: new Vector3(),
      auxiliaryLocalOmega: new Vector3(),
      gravityIncrement: new Vector3(),
      inertiaScale: 1,
      prepared: false,
      eligibleLeaves: 0,
      sleepTransitions: 0,
      wakeTransitions: 0,
    };
    this.stateMap.set(body, state);
    body.properties.immovable = initialec;
    return state;
  }
  prepare(body: T, gravityIncrement: Vector3, parentDoNothing?: boolean): void {
    const state = this.get(body);
    if (!state) throw new Error("Missing native hierarchy quiet owner");
    if (state.prepared)
      throw new Error("Hierarchy quiet prepared twice before finish");
    if (parentDoNothing !== undefined) state.doNothing = parentDoNothing;
    body.properties.immovable = state.doNothing;
    state.oldOrientation.copy(body.state.orientation);
    const q = state.oldOrientation;
    for (const n of [q.x, q.y, q.z, q.w]) finite(n);
    // Three's committed rotation-matrix element5, native matrix+9c.
    state.oldOrientationY = 1 - (q.x * (q.x + q.x) + q.z * (q.z + q.z));
    const inverse = q.clone().invert();
    state.beforeWorldV.copy(body.state.velocity);
    state.beforeLocalOmega
      .copy(body.state.angularVelocity)
      .applyQuaternion(inverse);
    state.localVelocity.copy(body.state.velocity).applyQuaternion(inverse);
    state.gravityIncrement.set(
      finite(gravityIncrement.x),
      finite(gravityIncrement.y),
      finite(gravityIncrement.z),
    );
    if (
      !(finite(body.properties.mass) > 0) ||
      !body.properties.inertia.toArray().every((n) => finite(n) > 0)
    )
      throw new Error("Invalid native hierarchy quiet mass/inertia");
    if (state.quietState !== 0 && !state.doNothing) {
      body.properties.inertia.set(
        f(body.properties.inertia.x * 50),
        f(body.properties.inertia.y * 50),
        f(body.properties.inertia.z * 50),
      );
      state.inertiaScale = 50;
    }
    state.prepared = true;
  }
  /** InternalPrepare copies parent ec before child's quiet/candidate work. */
  prepareHierarchy(
    roster: readonly T[],
    joints: readonly Link[],
    gravity: (body: T) => Vector3,
  ): void {
    this.prepareTree(roster, joints, gravity, false);
  }
  /** Collection-time topology changes prepare only newly retained nodes.
   * Already prepared parents keep their immutable pre-contact snapshots and
   * temporary solver moments; new children inherit the current parent ec. */
  prepareNewHierarchy(
    roster: readonly T[],
    joints: readonly Link[],
    gravity: (body: T) => Vector3,
  ): void {
    this.prepareTree(roster, joints, gravity, true);
  }
  private prepareTree(
    roster: readonly T[],
    joints: readonly Link[],
    gravity: (body: T) => Vector3,
    onlyUnprepared: boolean,
  ): void {
    const tree = topology(roster, joints);
    const visit = (body: T) => {
      const parent = tree.parent.get(body);
      const state = this.get(body);
      if (state && (!onlyUnprepared || !state.prepared))
        this.prepare(
          body,
          gravity(body),
          parent ? this.node(parent)?.doNothing : undefined,
        );
      for (const child of tree.children.get(body)!) visit(child);
    };
    for (const body of roster) if (!tree.parent.has(body)) visit(body);
  }
  private restore(body: T, state: NativeHierarchyQuietState): void {
    if (state.inertiaScale === 50) {
      body.properties.inertia.set(
        f(body.properties.inertia.x / 50),
        f(body.properties.inertia.y / 50),
        f(body.properties.inertia.z / 50),
      );
      state.inertiaScale = 1;
    }
  }
  finish(body: T, input: NativeHierarchyQuietFinish): NativeQuietResult {
    const state = this.get(body);
    if (!state?.prepared)
      throw new Error("Hierarchy quiet finish lacks preparation");
    this.restore(body, state);
    const inverse = state.oldOrientation.clone().invert();
    const omega = body.state.angularVelocity.clone().applyQuaternion(inverse);
    if (input.solverLocalVelocity)
      state.localVelocity.copy(input.solverLocalVelocity);
    else state.localVelocity.copy(body.state.velocity).applyQuaternion(inverse);
    const result = evaluateNativeQuietLeaf({
      previousQuietState: state.doNothing ? 0 : state.quietState,
      singleton: input.singleton,
      collisionFlags: input.collisionFlags,
      doNothing: state.doNothing,
      beforeWorldVelocity: state.beforeWorldV.toArray(),
      worldVelocity: body.state.velocity.toArray(),
      beforeLocalOmega: state.beforeLocalOmega.toArray(),
      localOmega: omega.toArray(),
      localVelocity: state.localVelocity.toArray(),
      gravityIncrement: state.gravityIncrement.toArray(),
      mass: body.properties.mass,
      inertia: body.properties.inertia.toArray(),
      bounds: state.bounds,
      centreOfMass: body.properties.centerOfMass.toArray(),
      jointInfoOrientationY:
        input.jointInfoOrientationY !== undefined
          ? input.jointInfoOrientationY
          : input.hasJointInfo
            ? state.oldOrientationY
            : null,
    });
    state.ownState = result.quietEligible ? 1 : 0;
    state.quietState = state.ownState;
    state.lastResult = result;
    state.prepared = false;
    if (result.quietEligible) state.eligibleLeaves++;
    if (result.zeroVelocities) {
      body.state.velocity.set(0, 0, 0);
      body.state.angularVelocity.set(0, 0, 0);
      state.auxiliaryLocalOmega.set(0, 0, 0);
    }
    return result;
  }
  /** Postorder+224 fold. External providers have already evaluated their own
   * leaf; bit0 remains own eligibility, bit1 is recomputed from real children. */
  fold(roster: readonly T[], joints: readonly Link[]): Map<T, number> {
    const tree = topology(roster, joints),
      folded = new Map<T, number>();
    const visit = (body: T): number => {
      const children = tree.children.get(body)!;
      const childStates = children.map(visit);
      const node = this.node(body);
      const own = this.get(body)?.ownState ?? (node ? node.quietState & 1 : 0);
      const value = foldNativeQuietHierarchy(
        own,
        children.length ? childStates : null,
      );
      if (node) node.quietState = value;
      folded.set(body, value);
      return value;
    };
    for (const body of roster) if (!tree.parent.has(body)) visit(body);
    return folded;
  }
  private members(
    group: readonly T[],
    roster: readonly T[],
    joints: readonly Link[],
  ): T[] | null {
    const tree = topology(roster, joints),
      roots = new Set<T>(),
      members = new Set<T>();
    for (const body of group) {
      if (!tree.alive.has(body)) return null;
      let root = body;
      while (tree.parent.has(root)) root = tree.parent.get(root)!;
      roots.add(root);
    }
    const visit = (body: T) => {
      members.add(body);
      for (const child of tree.children.get(body)!) visit(child);
    };
    for (const root of roots) visit(root);
    return [...members];
  }
  /** The caller supplies the complete contact ring. This adds each physical
   * tree and validates all participants before changing any ec/quiet state. */
  sleep(
    group: readonly T[],
    roster: readonly T[],
    joints: readonly Link[],
  ): boolean {
    const members = this.members(group, roster, joints);
    if (
      !members?.length ||
      members.some((body) => {
        const node = this.node(body);
        return (
          !node ||
          !(node.quietState & 2) ||
          (!this.get(body) && !this.host.setExternalDoNothing)
        );
      })
    )
      return false;
    for (const body of members) {
      const state = this.get(body),
        node = this.node(body)!;
      if (state) {
        if (!state.doNothing) state.sleepTransitions++;
        state.doNothing = true;
        state.ownState = 0;
      } else this.host.setExternalDoNothing!(body, true);
      node.doNothing = true;
      node.quietState = 0;
      body.properties.immovable = true;
      this.host.onSleep?.(body);
    }
    return true;
  }
  /** Contact wake4bde80 ascends nonzero joint chains and wakes descendants;
   * velocities stay untouched. Force/ground callers pass clearQuiet=true. */
  wake(
    body: T,
    roster: readonly T[],
    joints: readonly Link[],
    options: { clearQuiet?: boolean } = {},
  ): T[] {
    const members = this.members([body], roster, joints);
    if (!members) return [];
    for (const member of members) {
      const state = this.get(member),
        node = this.node(member);
      // Unknown eligibility blocks SLEEP, never an ec-clear. The host can
      // clear an unsupported owner's actual ec through onWake; its unknown
      // quiet byte and velocities remain untouched here.
      if (!node) {
        member.properties.immovable = false;
        this.host.onWake?.(member);
        continue;
      }
      const wasAsleep = node.doNothing;
      if (state) {
        if (wasAsleep) state.wakeTransitions++;
        state.doNothing = false;
        if (options.clearQuiet) state.ownState = 0;
      } else this.host.setExternalDoNothing?.(member, false);
      node.doNothing = false;
      if (options.clearQuiet) node.quietState = 0;
      member.properties.immovable = false;
      if (wasAsleep) this.host.onWake?.(member);
    }
    return members;
  }
  remove(body: T): void {
    const state = this.get(body);
    if (state) this.restore(body, state);
    this.stateMap.delete(body);
  }
  clear(): void {
    for (const body of this.stateMap.keys()) this.remove(body);
  }
}

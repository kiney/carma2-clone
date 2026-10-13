import { Box3, Quaternion, Vector3 } from "three";
import type { Contact, RigidBody } from "./contact";
import {
  hullBounds,
  hullsBounds,
  transformHull,
  type CollisionHull,
} from "./geometry";
import type { HullBody } from "./pair-guard";
import { hasImmutableCollisionHulls } from "./immutable-hulls";

/** Contact/world maps last one tick. Exact source/pose certificates and weakly
 * owned geometry may persist; each new tick explicitly admits its snapshots. */
export type CorrectionToken = object;
export interface CorrectionBodySnapshot {
  readonly body: HullBody;
  readonly token: CorrectionToken;
  readonly shapeToken: CorrectionToken;
  readonly oldPoseToken: CorrectionToken;
  readonly nextPoseToken: CorrectionToken;
  readonly cacheable: boolean;
}
export interface CorrectionDiagnostics {
  validityChecks?: number;
  validityChanges?: number;
  geometryTransforms?: number;
  geometryHits?: number;
  pairTests?: number;
  pairHits?: number;
  worldTests?: number;
  worldHits?: number;
}
export interface CorrectionGeometry {
  old: CollisionHull[];
  next: CollisionHull[];
  oldHullBounds: Box3[];
  nextHullBounds: Box3[];
  oldBounds: Box3;
  nextBounds: Box3;
  bounds: Box3;
}
export interface CorrectionPairResult {
  /** Raw emitter rows, never solved ContactImpact records. Preserve order. */
  contacts: Contact[];
  /** Replay on both bodies even when contacts is empty. */
  overlap: boolean;
}
export interface CorrectionWorldResult<T> {
  value: T;
  /** Restore these candidate values on a hit before continuing collection. */
  position: Vector3;
  orientation: Quaternion;
}
export type CorrectionBoundsProvider = (
  body: HullBody,
  position: Vector3,
  orientation: Quaternion,
  hulls: CollisionHull[],
) => Box3;

type Visit = (value: unknown) => void;
type Walk = (visit: Visit) => void;
/** Compare the previous scalar/identity stream without allocating deep arrays.
 * A changed stream is captured once. Object.is retains signed zero and NaN. */
class ExactValues {
  private values?: unknown[];
  token: CorrectionToken = {};
  update(walk: Walk, force = false): boolean {
    let index = 0,
      same = !force && !!this.values;
    walk((value) => {
      if (!this.values || !Object.is(value, this.values[index])) same = false;
      index++;
    });
    if (same && index === this.values!.length) return false;
    const values: unknown[] = [];
    walk((value) => values.push(value));
    this.values = values;
    this.token = {};
    return true;
  }
}
function vector(value: Vector3 | Quaternion | undefined, visit: Visit) {
  visit(value);
  if (!value) return;
  visit(value.x);
  visit(value.y);
  visit(value.z);
  if ("w" in value) visit(value.w);
}
/** Pose slots may be recreated with identical values after a diagnostic reset.
 * Transforms consume their numbers, while state identity remains certified. */
function poseNumbers(value: Vector3 | Quaternion | undefined, visit: Visit) {
  visit(value !== undefined);
  if (!value) return;
  visit(value.x);
  visit(value.y);
  visit(value.z);
  if ("w" in value) visit(value.w);
}
function numbers(value: readonly number[] | undefined, visit: Visit) {
  visit(value);
  if (!value) return;
  visit(value.length);
  for (const number of value) visit(number);
}
function hull(value: CollisionHull, visit: Visit) {
  visit(value);
  visit(value.nativeType);
  visit(value.vertices);
  visit(value.vertices.length);
  for (const vertex of value.vertices) vector(vertex, visit);
  numbers(value.vertexOrder, visit);
  visit(value.faces);
  visit(value.faces.length);
  for (const face of value.faces) {
    visit(face);
    vector(face.normal, visit);
    visit(face.constant);
    numbers(face.indices, visit);
  }
  visit(value.edges);
  visit(value.edges.length);
  for (const edge of value.edges) numbers(edge, visit);
}
interface OptionalShape {
  type?: string;
  tag?: number;
  bounds?: { min: readonly number[]; max: readonly number[] };
  center?: readonly number[];
  radius?: number;
  radiusSquared?: number;
  hull?: CollisionHull;
  endpoints?: readonly (readonly number[])[];
  edge?: readonly number[];
}
type CollisionBody = HullBody & {
  kind?: string;
  shape?: OptionalShape;
  joint?: { parent: RigidBody };
  filterA?: number | null;
  filterB?: number | null;
  overlapRecovery?: boolean;
  overlapDetected?: boolean;
  worldRecovery?: boolean;
  worldOverlapDetected?: boolean;
  suppressWorldFaces?: boolean;
  suppressSelfSentinel?: boolean;
  suppressJointConstraints?: boolean;
  mechanics?: { ignoreWorldCollisions?: boolean };
};
function shapeValues(body: CollisionBody, visit: Visit) {
  visit(body);
  visit(body.hulls);
  visit(body.hulls.length);
  // Only producer-owned, deeply frozen local geometry can use identity here.
  // Mutable cars, crush/debris and custom hulls retain the complete value walk.
  if (!hasImmutableCollisionHulls(body.hulls))
    for (const value of body.hulls) hull(value, visit);
  const shape = body.shape;
  visit(shape);
  if (!shape) return;
  visit(shape.type);
  visit(shape.tag);
  visit(shape.bounds);
  if (shape.bounds) {
    numbers(shape.bounds.min, visit);
    numbers(shape.bounds.max, visit);
  }
  numbers(shape.center, visit);
  visit(shape.radius);
  visit(shape.radiusSquared);
  if (shape.hull) hull(shape.hull, visit);
  visit(shape.endpoints);
  if (shape.endpoints) {
    visit(shape.endpoints.length);
    for (const endpoint of shape.endpoints) numbers(endpoint, visit);
  }
  numbers(shape.edge, visit);
}
function motionValues(
  body: CollisionBody,
  visit: Visit,
  ancestry: RigidBody[],
) {
  const { state, properties } = body;
  visit(state);
  visit(properties);
  vector(state.velocity, visit);
  vector(state.angularVelocity, visit);
  vector(properties.centerOfMass, visit);
  vector(properties.inertia, visit);
  visit(properties.mass);
  visit(properties.immovable);
  visit(properties.rotationLocked);
  visit(properties.worldFriction);
  visit(properties.objectFriction);
  visit(body.kind);
  visit(body.filterA);
  visit(body.filterB);
  visit(body.overlapRecovery);
  visit(body.overlapDetected);
  visit(body.worldRecovery);
  visit(body.worldOverlapDetected);
  visit(body.suppressWorldFaces);
  visit(body.suppressSelfSentinel);
  visit(body.suppressJointConstraints);
  visit(body.mechanics);
  visit(body.mechanics?.ignoreWorldCollisions);
  // Reuse scratch storage; no ancestry arrays are allocated on valid checks.
  let current: RigidBody = body,
    length = 0;
  ancestry.length = 0;
  while (!ancestry.includes(current)) {
    ancestry.push(current);
    visit(current);
    const joint = (current as CollisionBody).joint;
    visit(joint);
    visit(joint?.parent);
    length++;
    if (!joint) break;
    current = joint.parent;
  }
  visit(length);
}
interface PoseGeometry {
  token: CorrectionToken;
  hulls: CollisionHull[];
  hullBounds: Box3[];
  bounds: Box3;
  provider?: CorrectionBoundsProvider;
}
interface BodyEntry {
  shape: ExactValues;
  oldPose: ExactValues;
  nextPose: ExactValues;
  motion: ExactValues;
  ancestry: RigidBody[];
  snapshot?: CorrectionBodySnapshot;
  old?: PoseGeometry;
  next?: PoseGeometry;
  geometry?: CorrectionGeometry;
}
interface PairEntry {
  a: CorrectionToken;
  b: CorrectionToken;
  result: CorrectionPairResult;
}
interface WorldEntry {
  token: CorrectionToken;
  revision: unknown;
  result: CorrectionWorldResult<unknown>;
}

/** Contact/world use: create inside step(), discard before final commitment.
 * createTick() shares only weak body certificates/geometry across ticks;
 * per-tick pairs/world results remain independent. A separate weak geometry-only
 * set preserves dormant snapshots; never use its pair/world methods.
 * capture() checks unversioned geometry contents as well as identities. Reuse
 * snapshots only during synchronous pure collection; recapture after callbacks,
 * solves, activation, crush, split, attachment changes or external mutations.
 * A custom provider whose mutations/inputs cannot be certified must pass false
 * to capture(), or an undefined world revision, to retain uncached behavior.
 * This helper never skips masks, native callbacks, contact preparation, solving,
 * damage, recovery flag replay, or final conservative guard decisions. */
export class CorrectionWorkingSet {
  private certificates = new WeakSet<CorrectionBodySnapshot>();
  private pairs = new Map<HullBody, Map<HullBody, PairEntry>>();
  private worlds = new Map<HullBody, Map<boolean, WorldEntry>>();
  constructor(
    public diagnostics?: CorrectionDiagnostics,
    private readonly bodies = new WeakMap<HullBody, BodyEntry>(),
  ) {}
  /** Retain exact geometry certificates weakly, but give every tick fresh
   * contact/world maps. Contents are still checked by capture(), including
   * unversioned source mutation; no solved rows or safe fractions survive. */
  createTick(diagnostics?: CorrectionDiagnostics): CorrectionWorkingSet {
    return new CorrectionWorkingSet(diagnostics, this.bodies);
  }
  private count(key: keyof CorrectionDiagnostics, amount = 1) {
    if (this.diagnostics)
      this.diagnostics[key] = (this.diagnostics[key] ?? 0) + amount;
  }
  capture(body: HullBody, cacheable = true): CorrectionBodySnapshot {
    this.count("validityChecks");
    let entry = this.bodies.get(body);
    if (!entry) {
      entry = {
        shape: new ExactValues(),
        oldPose: new ExactValues(),
        nextPose: new ExactValues(),
        motion: new ExactValues(),
        ancestry: [],
      };
      this.bodies.set(body, entry);
    }
    const shaped = body as CollisionBody;
    // Unknown analytic shape providers need an explicit uncached fallback.
    cacheable &&=
      !shaped.shape ||
      shaped.shape.type === "BOX" ||
      shaped.shape.type === "LINE" ||
      shaped.shape.type === "SPHERE";
    const shapeChanged = entry.shape.update(
      (visit) => shapeValues(shaped, visit),
      !cacheable,
    );
    const oldChanged = entry.oldPose.update((visit) => {
      visit(entry!.shape.token);
      visit(body.state);
      poseNumbers(body.state.position, visit);
      poseNumbers(body.state.orientation, visit);
    });
    const nextChanged = entry.nextPose.update((visit) => {
      visit(entry!.shape.token);
      visit(body.state);
      visit(body.state.predictedPosition !== undefined);
      visit(body.state.predictedOrientation !== undefined);
      poseNumbers(body.state.predictedPosition ?? body.state.position, visit);
      poseNumbers(
        body.state.predictedOrientation ?? body.state.orientation,
        visit,
      );
    });
    const motionChanged = entry.motion.update(
      (visit) => motionValues(shaped, visit, entry!.ancestry),
      !cacheable,
    );
    if (
      !entry.snapshot ||
      shapeChanged ||
      oldChanged ||
      nextChanged ||
      motionChanged ||
      entry.snapshot.cacheable !== cacheable
    ) {
      this.count("validityChanges");
      entry.snapshot = {
        body,
        token: {},
        shapeToken: entry.shape.token,
        oldPoseToken: entry.oldPose.token,
        nextPoseToken: entry.nextPose.token,
        cacheable,
      };
    }
    this.certificates.add(entry.snapshot);
    return entry.snapshot;
  }
  geometry(
    body: HullBody,
    snapshot = this.capture(body),
    boundsForPose?: CorrectionBoundsProvider,
  ): CorrectionGeometry {
    this.checkBody(body, snapshot);
    const entry = this.bodies.get(body)!;
    const sample = (predicted: boolean): PoseGeometry => {
      const token = predicted ? snapshot.nextPoseToken : snapshot.oldPoseToken,
        old = predicted ? entry.next : entry.old;
      if (
        snapshot.cacheable &&
        old?.token === token &&
        old.provider === boundsForPose
      ) {
        this.count("geometryHits");
        return old;
      }
      const position = predicted
          ? (body.state.predictedPosition ?? body.state.position)
          : body.state.position,
        orientation = predicted
          ? (body.state.predictedOrientation ?? body.state.orientation)
          : body.state.orientation,
        hulls = body.hulls.map((value) =>
          transformHull(value, position, orientation),
        );
      this.count("geometryTransforms", hulls.length);
      const result = {
        token,
        hulls,
        hullBounds: hulls.map(hullBounds),
        bounds: boundsForPose
          ? boundsForPose(body, position, orientation, hulls)
          : hullsBounds(hulls),
        provider: boundsForPose,
      };
      if (predicted) entry.next = result;
      else entry.old = result;
      return result;
    };
    const old = sample(false),
      next = sample(true);
    if (entry.geometry?.old === old.hulls && entry.geometry.next === next.hulls)
      return entry.geometry;
    return (entry.geometry = {
      old: old.hulls,
      next: next.hulls,
      oldHullBounds: old.hullBounds,
      nextHullBounds: next.hullBounds,
      oldBounds: old.bounds,
      nextBounds: next.bounds,
      bounds: old.bounds.clone().union(next.bounds),
    });
  }
  pair(
    a: HullBody,
    b: HullBody,
    snapshotA: CorrectionBodySnapshot,
    snapshotB: CorrectionBodySnapshot,
    emit: () => CorrectionPairResult,
  ): CorrectionPairResult {
    this.checkBody(a, snapshotA);
    this.checkBody(b, snapshotB);
    this.count("pairTests");
    const old = this.pairs.get(a)?.get(b);
    if (
      snapshotA.cacheable &&
      snapshotB.cacheable &&
      old?.a === snapshotA.token &&
      old.b === snapshotB.token
    ) {
      this.count("pairHits");
      return old.result;
    }
    const result = emit();
    let partners = this.pairs.get(a);
    if (!partners) this.pairs.set(a, (partners = new Map()));
    partners.set(b, { a: snapshotA.token, b: snapshotB.token, result });
    return result;
  }
  world<T>(
    body: HullBody,
    snapshot: CorrectionBodySnapshot,
    worldRevision: unknown,
    refine: boolean,
    collect: () => T,
  ): CorrectionWorldResult<T> {
    this.checkBody(body, snapshot);
    this.count("worldTests");
    const old = this.worlds.get(body)?.get(refine);
    if (
      snapshot.cacheable &&
      worldRevision !== undefined &&
      old?.token === snapshot.token &&
      Object.is(old.revision, worldRevision)
    ) {
      this.count("worldHits");
      return old.result as CorrectionWorldResult<T>;
    }
    const value = collect(),
      result = {
        value,
        position: (body.state.predictedPosition ?? body.state.position).clone(),
        orientation: (
          body.state.predictedOrientation ?? body.state.orientation
        ).clone(),
      };
    let modes = this.worlds.get(body);
    if (!modes) this.worlds.set(body, (modes = new Map()));
    modes.set(refine, {
      token: snapshot.token,
      revision: worldRevision,
      result,
    });
    return result;
  }
  private checkBody(body: HullBody, snapshot: CorrectionBodySnapshot) {
    if (snapshot.body !== body || !this.certificates.has(snapshot))
      throw new Error("Correction snapshot belongs to a different body/set");
  }
}

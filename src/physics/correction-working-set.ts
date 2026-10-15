import { Box3, Quaternion, Vector3 } from "three";
import type {
  Contact,
  RigidBody,
  RigidProperties,
  RigidState,
} from "./contact";
import { hullBounds, hullsBounds, type CollisionHull } from "./geometry";
import type { HullBody } from "./pair-guard";
import type { RigidJoint } from "./joint";
import { hasImmutableCollisionHulls } from "./immutable-hulls";

/** Contact/world maps last one tick. Exact source/pose certificates and weakly
 * owned geometry may persist; each new tick explicitly admits its snapshots. */
export type CorrectionToken = object;
export interface CorrectionGeometrySnapshot {
  readonly body: HullBody;
  readonly shapeToken: CorrectionToken;
  readonly oldPoseToken: CorrectionToken;
  readonly nextPoseToken: CorrectionToken;
  readonly cacheable: boolean;
}
export interface CorrectionBodySnapshot extends CorrectionGeometrySnapshot {
  readonly token: CorrectionToken;
}
export interface CorrectionDiagnostics {
  validityChecks?: number;
  geometryValidityChecks?: number;
  validityChanges?: number;
  geometryTransforms?: number;
  geometryHits?: number;
  boundsBuilds?: number;
  boundsHits?: number;
  boundsVertexTransforms?: number;
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
interface ScalarVector {
  source: Vector3;
  x: number;
  y: number;
  z: number;
}
interface FixedResponseInput {
  state: RigidState;
  properties: RigidProperties;
  hulls: CollisionHull[];
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  velocity: ScalarVector;
  omega: ScalarVector;
  com: ScalarVector;
  inertia: ScalarVector;
  mass: number;
  immovable: boolean | undefined;
  rotationLocked: boolean | undefined;
  worldFriction: number;
  objectFriction: number | undefined;
  filterA: number | null | undefined;
  filterB: number | null | undefined;
  kind: string | undefined;
  overlapRecovery: boolean | undefined;
  worldRecovery: boolean | undefined;
  suppressWorldFaces: boolean | undefined;
  suppressSelfSentinel: boolean | undefined;
  suppressJointConstraints: boolean | undefined;
  mechanics: CollisionBody["mechanics"];
  ignoreWorldCollisions: boolean | undefined;
}
function scalarVector(value: Vector3): ScalarVector {
  return { source: value, x: value.x, y: value.y, z: value.z };
}
function sameScalarVector(old: ScalarVector, value: Vector3): boolean {
  return (
    old.source === value &&
    Object.is(old.x, value.x) &&
    Object.is(old.y, value.y) &&
    Object.is(old.z, value.z)
  );
}
/** Only producer-certified fixed noncars enter this path. All hot comparisons
 * are direct identities/scalars, with no ancestry or ExactValues visitor walk.
 * Their own joint is excluded from the simulation's active joint roster; wake
 * invalidates eligibility before that joint can affect response prediction. */
function sameFixedResponse(
  old: FixedResponseInput,
  body: CollisionBody,
): boolean {
  const { state, properties } = body;
  return (
    old.state === state &&
    old.properties === properties &&
    old.hulls === body.hulls &&
    Object.is(old.px, state.position.x) &&
    Object.is(old.py, state.position.y) &&
    Object.is(old.pz, state.position.z) &&
    Object.is(old.qx, state.orientation.x) &&
    Object.is(old.qy, state.orientation.y) &&
    Object.is(old.qz, state.orientation.z) &&
    Object.is(old.qw, state.orientation.w) &&
    sameScalarVector(old.velocity, state.velocity) &&
    sameScalarVector(old.omega, state.angularVelocity) &&
    sameScalarVector(old.com, properties.centerOfMass) &&
    sameScalarVector(old.inertia, properties.inertia) &&
    Object.is(old.mass, properties.mass) &&
    Object.is(old.immovable, properties.immovable) &&
    Object.is(old.rotationLocked, properties.rotationLocked) &&
    Object.is(old.worldFriction, properties.worldFriction) &&
    Object.is(old.objectFriction, properties.objectFriction) &&
    Object.is(old.filterA, body.filterA) &&
    Object.is(old.filterB, body.filterB) &&
    Object.is(old.kind, body.kind) &&
    Object.is(old.overlapRecovery, body.overlapRecovery) &&
    Object.is(old.worldRecovery, body.worldRecovery) &&
    Object.is(old.suppressWorldFaces, body.suppressWorldFaces) &&
    Object.is(old.suppressSelfSentinel, body.suppressSelfSentinel) &&
    Object.is(old.suppressJointConstraints, body.suppressJointConstraints) &&
    old.mechanics === body.mechanics &&
    Object.is(old.ignoreWorldCollisions, body.mechanics?.ignoreWorldCollisions)
  );
}
function fixedResponseInput(body: CollisionBody): FixedResponseInput {
  const { state, properties } = body;
  return {
    state,
    properties,
    hulls: body.hulls,
    px: state.position.x,
    py: state.position.y,
    pz: state.position.z,
    qx: state.orientation.x,
    qy: state.orientation.y,
    qz: state.orientation.z,
    qw: state.orientation.w,
    velocity: scalarVector(state.velocity),
    omega: scalarVector(state.angularVelocity),
    com: scalarVector(properties.centerOfMass),
    inertia: scalarVector(properties.inertia),
    mass: properties.mass,
    immovable: properties.immovable,
    rotationLocked: properties.rotationLocked,
    worldFriction: properties.worldFriction,
    objectFriction: properties.objectFriction,
    filterA: body.filterA,
    filterB: body.filterB,
    kind: body.kind,
    overlapRecovery: body.overlapRecovery,
    worldRecovery: body.worldRecovery,
    suppressWorldFaces: body.suppressWorldFaces,
    suppressSelfSentinel: body.suppressSelfSentinel,
    suppressJointConstraints: body.suppressJointConstraints,
    mechanics: body.mechanics,
    ignoreWorldCollisions: body.mechanics?.ignoreWorldCollisions,
  };
}
type CollisionBody = HullBody & {
  kind?: string;
  shape?: OptionalShape;
  joint?: Partial<RigidJoint> & { parent: RigidBody };
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
  response = false,
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
  if (!response) visit(body.overlapDetected);
  visit(body.worldRecovery);
  if (!response) visit(body.worldOverlapDetected);
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
    if (joint) {
      visit(joint.type);
      visit(joint.quickHinge);
      vector(joint.childAnchor, visit);
      vector(joint.parentAnchor, visit);
      vector(joint.childAxis, visit);
      vector(joint.parentAxis, visit);
      vector(joint.translationAxis, visit);
      visit(joint.translationTravel);
      if (response) {
        visit(joint.allowNearBoundary);
        visit(joint.planeLimits);
        visit(joint.planeLimits?.length);
        for (const limit of joint.planeLimits ?? []) {
          vector(limit.childDirection, visit);
          vector(limit.parentNormal, visit);
        }
        for (const basis of [joint.hingeBasis, joint.translationTransverse]) {
          visit(basis);
          for (const axis of basis ?? []) vector(axis, visit);
        }
      }
      const parent = joint.parent;
      visit(parent.state);
      poseNumbers(parent.state.position, visit);
      poseNumbers(parent.state.orientation, visit);
      vector(parent.state.velocity, visit);
      vector(parent.state.angularVelocity, visit);
      visit(parent.properties);
      vector(parent.properties.centerOfMass, visit);
      vector(parent.properties.inertia, visit);
      visit(parent.properties.immovable);
      visit(parent.properties.rotationLocked);
    }
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
  complete: boolean;
  provider?: CorrectionBoundsProvider;
  providerBounds?: Box3;
}
interface BodyEntry {
  shape: ExactValues;
  oldPose: ExactValues;
  nextPose: ExactValues;
  motion: ExactValues;
  ancestry: RigidBody[];
  response: ExactValues;
  snapshot?: CorrectionBodySnapshot;
  geometrySnapshot?: CorrectionGeometrySnapshot;
  old?: PoseGeometry;
  next?: PoseGeometry;
  geometry?: CorrectionGeometry;
  fixedResponse?: FixedResponseInput;
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
 * per-tick pairs/world results remain independent. The same weak endpoint owner
 * supplies broadphase bounds, dormant geometry and completed contact hulls.
 * capture() checks unversioned geometry contents as well as identities. Reuse
 * snapshots only during synchronous pure collection; recapture after callbacks,
 * solves, activation, crush, split, attachment changes or external mutations.
 * A custom provider whose mutations/inputs cannot be certified must pass false
 * to capture(), or an undefined world revision, to retain uncached behavior.
 * This helper never skips masks, native callbacks, contact preparation, solving,
 * damage, recovery flag replay, or final conservative guard decisions. */
export class CorrectionWorkingSet {
  private certificates = new WeakSet<CorrectionGeometrySnapshot>();
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
  private entry(body: HullBody): BodyEntry {
    let entry = this.bodies.get(body);
    if (!entry) {
      entry = {
        shape: new ExactValues(),
        oldPose: new ExactValues(),
        nextPose: new ExactValues(),
        motion: new ExactValues(),
        response: new ExactValues(),
        ancestry: [],
      };
      this.bodies.set(body, entry);
    }
    return entry;
  }
  /** Response inputs, not derived NEXT slots/detection accumulation. A fresh
   * candidate or repeated overlap detection is not a new physical response.
   * Includes unversioned shape edits and every ordinary joint solver field. */
  responseInput(body: HullBody): CorrectionToken {
    const entry = this.entry(body),
      shaped = body as CollisionBody;
    const fixed =
      shaped.kind === "noncar" &&
      !!body.properties.immovable &&
      shaped.shape === undefined &&
      hasImmutableCollisionHulls(body.hulls);
    if (
      fixed &&
      entry.fixedResponse &&
      sameFixedResponse(entry.fixedResponse, shaped)
    )
      return entry.response.token;
    entry.shape.update((visit) => shapeValues(shaped, visit));
    entry.response.update((visit) => {
      visit(entry.shape.token);
      poseNumbers(body.state.position, visit);
      poseNumbers(body.state.orientation, visit);
      motionValues(shaped, visit, entry.ancestry, true);
    });
    entry.fixedResponse = fixed ? fixedResponseInput(shaped) : undefined;
    return entry.response.token;
  }
  /** Geometry validity excludes velocities, friction and joint ancestry. They
   * affect response/candidate production, not these already-written poses. */
  captureGeometry(
    body: HullBody,
    cacheable = true,
  ): CorrectionGeometrySnapshot {
    this.count("geometryValidityChecks");
    const entry = this.entry(body),
      shaped = body as CollisionBody;
    cacheable &&=
      !shaped.shape ||
      shaped.shape.type === "BOX" ||
      shaped.shape.type === "LINE" ||
      shaped.shape.type === "SPHERE";
    entry.shape.update((visit) => shapeValues(shaped, visit), !cacheable);
    entry.oldPose.update((visit) => {
      visit(entry.shape.token);
      visit(body.state);
      poseNumbers(body.state.position, visit);
      poseNumbers(body.state.orientation, visit);
    });
    entry.nextPose.update((visit) => {
      visit(entry.shape.token);
      visit(body.state);
      visit(body.state.predictedPosition !== undefined);
      visit(body.state.predictedOrientation !== undefined);
      poseNumbers(body.state.predictedPosition ?? body.state.position, visit);
      poseNumbers(
        body.state.predictedOrientation ?? body.state.orientation,
        visit,
      );
    });
    const old = entry.geometrySnapshot;
    if (
      !old ||
      old.shapeToken !== entry.shape.token ||
      old.oldPoseToken !== entry.oldPose.token ||
      old.nextPoseToken !== entry.nextPose.token ||
      old.cacheable !== cacheable
    )
      entry.geometrySnapshot = {
        body,
        shapeToken: entry.shape.token,
        oldPoseToken: entry.oldPose.token,
        nextPoseToken: entry.nextPose.token,
        cacheable,
      };
    this.certificates.add(entry.geometrySnapshot!);
    return entry.geometrySnapshot!;
  }
  /** A geometry snapshot may be borrowed within one synchronous pure collection.
   * Recapture it after any pose/shape/provider callback mutation. Motion and
   * detection flags are always inspected freshly for pair-result validity. */
  capture(
    body: HullBody,
    cacheable = true,
    geometrySnapshot?: CorrectionGeometrySnapshot,
  ): CorrectionBodySnapshot {
    this.count("validityChecks");
    const geometry =
        geometrySnapshot && cacheable
          ? geometrySnapshot
          : this.captureGeometry(body, cacheable),
      entry = this.entry(body);
    this.checkBody(body, geometry);
    const motionChanged = entry.motion.update(
      (visit) => motionValues(body as CollisionBody, visit, entry.ancestry),
      !geometry.cacheable,
    );
    const old = entry.snapshot;
    if (
      !old ||
      old.shapeToken !== geometry.shapeToken ||
      old.oldPoseToken !== geometry.oldPoseToken ||
      old.nextPoseToken !== geometry.nextPoseToken ||
      motionChanged ||
      old.cacheable !== geometry.cacheable
    ) {
      this.count("validityChanges");
      entry.snapshot = { ...geometry, token: {} };
    }
    this.certificates.add(entry.snapshot!);
    return entry.snapshot!;
  }
  /** Transform source vertices once per endpoint. Broadphase and narrowphase
   * share this storage; full planes are materialized only on geometry(). */
  private poseGeometry(
    body: HullBody,
    snapshot: CorrectionGeometrySnapshot,
    predicted: boolean,
  ): PoseGeometry {
    const entry = this.entry(body),
      token = predicted ? snapshot.nextPoseToken : snapshot.oldPoseToken,
      old = predicted ? entry.next : entry.old;
    if (snapshot.cacheable && old?.token === token) return old;
    const position = predicted
        ? (body.state.predictedPosition ?? body.state.position)
        : body.state.position,
      orientation = predicted
        ? (body.state.predictedOrientation ?? body.state.orientation)
        : body.state.orientation;
    const hulls = body.hulls.map(
      (source) =>
        ({
          vertices: source.vertices.map((point) =>
            point.clone().applyQuaternion(orientation).add(position),
          ),
          vertexOrder: source.vertexOrder,
          edges: source.edges,
          faces: [],
          localHull: source,
          position: position.clone(),
          orientation: orientation.clone(),
        }) as CollisionHull,
    );
    this.count(
      "boundsVertexTransforms",
      body.hulls.reduce((n, h) => n + h.vertices.length, 0),
    );
    const value: PoseGeometry = {
      token,
      hulls,
      hullBounds: hulls.map(hullBounds),
      bounds: hullsBounds(hulls),
      complete: false,
    };
    if (predicted) entry.next = value;
    else entry.old = value;
    return value;
  }
  /** Polygonal broadphase bounds only. Analytic/custom providers must keep
   * using geometry(..., provider); their bounds need not follow hull vertices. */
  bounds(body: HullBody, snapshot = this.captureGeometry(body)): Box3 {
    this.checkBody(body, snapshot);
    const entry = this.entry(body);
    const old = this.poseGeometry(body, snapshot, false),
      next = this.poseGeometry(body, snapshot, true);
    const cached = entry.geometry;
    if (
      cached?.old === old.hulls &&
      cached.next === next.hulls &&
      cached.oldBounds === old.bounds &&
      cached.nextBounds === next.bounds
    ) {
      this.count("boundsHits");
      return cached.bounds;
    }
    // Keep the same aggregate record used by geometry(). No second bounds
    // cache, transformed vertices or shape owner competes with this snapshot.
    this.count("boundsBuilds");
    entry.geometry = {
      old: old.hulls,
      next: next.hulls,
      oldHullBounds: old.hullBounds,
      nextHullBounds: next.hullBounds,
      oldBounds: old.bounds,
      nextBounds: next.bounds,
      bounds: old.bounds.clone().union(next.bounds),
    };
    return entry.geometry.bounds;
  }
  geometry(
    body: HullBody,
    snapshot: CorrectionGeometrySnapshot = this.capture(body),
    boundsForPose?: CorrectionBoundsProvider,
  ): CorrectionGeometry {
    this.checkBody(body, snapshot);
    const entry = this.entry(body);
    const sample = (predicted: boolean): PoseGeometry => {
      const value = this.poseGeometry(body, snapshot, predicted);
      if (value.complete) this.count("geometryHits");
      else {
        for (const hull of value.hulls) {
          const position = hull.position!,
            orientation = hull.orientation!;
          hull.faces = hull.localHull!.faces.map((face) => {
            const normal = face.normal.clone().applyQuaternion(orientation);
            return {
              normal,
              constant: face.constant + normal.dot(position),
              indices: face.indices,
            };
          });
        }
        value.complete = true;
        this.count("geometryTransforms", value.hulls.length);
      }
      if (
        boundsForPose &&
        (value.provider !== boundsForPose || !value.providerBounds)
      ) {
        value.provider = boundsForPose;
        value.providerBounds = boundsForPose(
          body,
          predicted
            ? (body.state.predictedPosition ?? body.state.position)
            : body.state.position,
          predicted
            ? (body.state.predictedOrientation ?? body.state.orientation)
            : body.state.orientation,
          value.hulls,
        );
      }
      return value;
    };
    const old = sample(false),
      next = sample(true),
      oldBounds = boundsForPose ? old.providerBounds! : old.bounds,
      nextBounds = boundsForPose ? next.providerBounds! : next.bounds;
    if (
      entry.geometry?.old === old.hulls &&
      entry.geometry.next === next.hulls &&
      entry.geometry.oldBounds === oldBounds &&
      entry.geometry.nextBounds === nextBounds
    )
      return entry.geometry;
    return (entry.geometry = {
      old: old.hulls,
      next: next.hulls,
      oldHullBounds: old.hullBounds,
      nextHullBounds: next.hullBounds,
      oldBounds,
      nextBounds,
      bounds: oldBounds.clone().union(nextBounds),
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
  private checkBody(body: HullBody, snapshot: CorrectionGeometrySnapshot) {
    if (snapshot.body !== body || !this.certificates.has(snapshot))
      throw new Error("Correction snapshot belongs to a different body/set");
  }
}

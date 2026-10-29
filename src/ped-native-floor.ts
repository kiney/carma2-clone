/** Single FindYVerticallyBelow4e4130 traversal for the ordinary falling score.
 * This is the ACT/MODEL picker, not a physics-grid floor approximation. */
import { Matrix4 } from "three";
import type { PedVector } from "./ped-form";
import type { NativeWorldScene } from "./native-world-scene";
import type {
  NativeOrderedActor,
  NativeActorBounds,
} from "./native-actor-order";
import { nativeFindFacesColumnXZ } from "./native-find-faces";
import {
  nativeActorPickApplyPoint,
  nativeActorPickMultiply,
} from "./native-actor-pick";
import { nativeModelPickPreparedVertices } from "./native-model-pick";
import { nativeTrackRawBounds } from "./native-track-resources";
import type { NativeTrackModelResource } from "./native-track-resources";

const f = Math.fround;
const MAX = 3.4028234663852886e38;
const EPSILON = f(2 ** -22);
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
type Material = { flags: number; name?: string | null };
export interface NativePedFloorResult {
  height: number;
  materialName: string | null;
  requiredProviders: string[];
  actor: NativeOrderedActor | null;
  faceIndex: number | null;
  visitedActors: number;
  visitedFaces: number;
}
export interface NativePedFloorOptions {
  /** Synchronize actual ACT/current MODEL publications before any query read. */
  prepareActors?: (roots: readonly NativeOrderedActor[]) => void;
}
function scalar(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("Native pedestrian floor requires finite Float32 scalars");
  return f(value);
}
function vector(value: readonly number[]): [number, number, number] {
  if (value.length !== 3)
    throw new Error("Native pedestrian floor requires XYZ");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function inverse(value: readonly number[]): number[] | null {
  if (value.length !== 12)
    throw new Error("Native floor requires native12 ACT transform");
  const m = value.map(scalar);
  const matrix = new Matrix4().set(
    m[0],
    m[3],
    m[6],
    m[9],
    m[1],
    m[4],
    m[7],
    m[10],
    m[2],
    m[5],
    m[8],
    m[11],
    0,
    0,
    0,
    1,
  );
  if (matrix.determinant() === 0) return null;
  const e = matrix.invert().elements;
  return [
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
  ].map(scalar);
}
const dot = (a: PedVector, b: PedVector) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** PickBoundsTestRay4e37f0: rd is the opposite of the eventual callback ray. */
function boundsRay(
  bounds: NativeActorBounds,
  origin: PedVector,
  direction: PedVector,
): [number, number] | null {
  const min = vector(bounds.min),
    max = vector(bounds.max);
  if (min.some((value, axis) => value > max[axis]))
    throw new Error("Native floor bounds reversed");
  let near = 0,
    far = MAX;
  for (let axis = 0; axis < 3; axis++) {
    const rd = -direction[axis],
      rp = origin[axis];
    if (rd > EPSILON) {
      //4e3825 spills the positive reciprocal before both products.
      const reciprocal = f(1 / rd),
        firstLive = (rp - max[axis]) * reciprocal,
        first = f(firstLive),
        last = (rp - min[axis]) * reciprocal;
      if (firstLive > MAX) near = MAX;
      else if (first > near) near = first;
      if (last < -MAX) far = -MAX;
      else if (last < far) far = f(last);
    } else if (rd < -EPSILON) {
      //4e38a8 keeps the negative reciprocal live, but spills the near product.
      const reciprocal = 1 / rd,
        last = (rp - max[axis]) * reciprocal,
        first = f((rp - min[axis]) * reciprocal);
      if (last < -MAX) far = -MAX;
      else if (last < far) far = f(last);
      if (first > MAX) near = MAX;
      else if (first > near) near = first;
    } else if (rp > max[axis] || rp < min[axis]) return null;
  }
  return far < near ? null : [f(near), f(far)];
}

/** Installed DRModelPick2D4e3b50 dominant-plane inclusion, inclusive edges. */
function inside(
  point: PedVector,
  normal: PedVector,
  vertices: readonly PedVector[],
): boolean {
  let major = Math.abs(normal[1]) > Math.abs(normal[0]) ? 1 : 0;
  if (Math.abs(normal[2]) > Math.abs(normal[major])) major = 2;
  const axes = major === 0 ? [1, 2] : major === 1 ? [0, 2] : [0, 1];
  const [a, b, c] = vertices,
    [x, y] = axes;
  const vx = b[x] - a[x],
    vy = b[y] - a[y];
  const wx = c[x] - a[x],
    wy = c[y] - a[y];
  const px = point[x] - a[x],
    py = point[y] - a[y];
  let alpha: number, beta: number;
  if (Math.abs(vx) > EPSILON) {
    const denominator = wy * vx - vy * wx;
    if (denominator === 0) return false;
    beta = (py * vx - vy * px) / denominator;
    alpha = (px - beta * wx) / vx;
  } else {
    beta = px / wx;
    alpha = (py - beta * wy) / vy;
  }
  return alpha >= 0 && beta >= 0 && alpha + beta <= 1;
}

/** Actual source columns only. A player exclusion skips that ACT's MODEL,
 * while its children retain ordinary traversal/inheritance. */
export function findNativePedFloorBelow(
  scene: NativeWorldScene,
  position: PedVector,
  excludedPlayerActor?: object | null,
  options: NativePedFloorOptions = {},
): NativePedFloorResult {
  const p = vector(position),
    result: NativePedFloorResult = {
      height: -MAX,
      materialName: null,
      requiredProviders: [],
      actor: null,
      faceIndex: null,
      visitedActors: 0,
      visitedFaces: 0,
    };
  const missing = new Set<string>();
  const [cx, cz] = nativeFindFacesColumnXZ(p[0], p[2], scene.layout);
  const roots: NativeOrderedActor[] = [];
  for (
    let x = Math.max(cx - 1, 0);
    x < Math.min(cx + 2, scene.layout.countX);
    x++
  )
    for (
      let z = Math.max(cz - 1, 0);
      z < Math.min(cz + 2, scene.layout.countZ);
      z++
    ) {
      const root = scene.columns[z]?.[x];
      if (root === undefined) missing.add("native-floor-track-column-owner");
      else if (root) roots.push(root);
    }
  options.prepareActors?.(roots);
  const material = (identity: object | null): Material | null | undefined => {
    if (identity === null) return null;
    const value = identity as Material;
    if (
      !Number.isInteger(value.flags) ||
      value.flags < 0 ||
      value.flags > 0xffffffff ||
      (value.name !== undefined &&
        value.name !== null &&
        typeof value.name !== "string")
    ) {
      missing.add("native-floor-inherited-MAT-owner");
      return undefined;
    }
    return value;
  };
  const active = new Set<NativeOrderedActor>();
  const visit = (
    actor: NativeOrderedActor,
    parentMatrix: readonly number[],
    inheritedModel: object | null,
    inheritedMaterial: Material | null,
    depth: number,
  ): void => {
    if (depth > 1024 || result.visitedActors >= 1_000_000) {
      missing.add("native-floor-ACT-traversal-bound");
      return;
    }
    if (active.has(actor)) throw new Error("Native floor ACT hierarchy cycle");
    if (actor.renderStyle === 1) return;
    if (!actor.localModel.resolved || !actor.localMaterial.resolved) {
      missing.add(
        !actor.localModel.resolved
          ? actor.localModel.requiredProvider
          : !actor.localMaterial.resolved
            ? actor.localMaterial.requiredProvider
            : "native-floor-ACT-resource-owner",
      );
      return;
    }
    const modelIdentity = actor.localModel.value ?? inheritedModel;
    const mat =
      actor.localMaterial.value === null
        ? inheritedMaterial
        : material(actor.localMaterial.value);
    if (mat === undefined) return;
    const transform = nativeActorPickMultiply(actor.matrix, parentMatrix);
    const inv = inverse(transform);
    if (!inv) {
      missing.add("native-floor-invertible-ACT-transform");
      return;
    }
    const origin = nativeActorPickApplyPoint(p, inv);
    const direction: PedVector = [f(-inv[3]), f(-inv[4]), f(-inv[5])];
    result.visitedActors++;
    active.add(actor);
    let traverseChildren = true;
    if (actor.type === 5 || actor.type === 6) {
      if (!actor.bounds.resolved || !actor.bounds.value) {
        missing.add(
          actor.bounds.resolved
            ? "native-floor-ACT-bounds-owner"
            : actor.bounds.requiredProvider,
        );
        traverseChildren = false;
      } else
        traverseChildren =
          boundsRay(actor.bounds.value, origin, direction) !== null;
    } else if (actor.type === 1 && modelIdentity !== null) {
      const excluded =
        excludedPlayerActor != null &&
        (actor === excludedPlayerActor ||
          scene.actorObjects.get(actor) === excludedPlayerActor);
      if (!excluded) {
        const resource = scene.resources.get(modelIdentity);
        if (!resource) missing.add("native-floor-current-MODEL-owner");
        else pick(resource, actor, mat, origin, direction);
      }
    }
    if (traverseChildren) {
      const siblings = new Set<NativeOrderedActor>();
      for (let child = actor.firstChild; child; child = child.next) {
        if (siblings.has(child))
          throw new Error("Native floor ACT sibling cycle");
        siblings.add(child);
        visit(child, transform, modelIdentity, mat, depth + 1);
      }
    }
    active.delete(actor);
  };
  const pick = (
    resource: NativeTrackModelResource,
    actor: NativeOrderedActor,
    inheritedMaterial: Material | null,
    origin: PedVector,
    direction: PedVector,
  ) => {
    const bounds = nativeTrackRawBounds(resource);
    if (!bounds.resolved || !bounds.value) {
      missing.add(
        bounds.resolved
          ? "native-floor-MODEL-bounds-owner"
          : bounds.requiredProvider,
      );
      return;
    }
    const interval = boundsRay(bounds.value.bounds, origin, direction);
    if (!interval) return;
    const prepared = resource.prepared;
    if (!prepared || prepared.revision !== resource.revision) {
      missing.add("native-floor-current-prepared-MODEL-owner");
      return;
    }
    const near = f(interval[0] - f(0.001)),
      far = f(interval[1] + f(0.001));
    for (const face of prepared.faces) {
      result.visitedFaces++;
      const n = vector(face.plane.normal),
        d = scalar(face.plane.d);
      const incidenceLive = dot(n, direction),
        incidence = f(incidenceLive);
      if (Math.abs(incidenceLive) < EPSILON) continue;
      const mat =
        face.material === null ? inheritedMaterial : material(face.material);
      if (mat === undefined) continue;
      if (!(mat && mat.flags & 0x1800) && incidence > 0) continue;
      const numerator = dot(n, origin) - d;
      if (
        Math.abs(incidence) < 1 &&
        Math.abs(numerator) > Math.abs(incidence) * MAX
      )
        continue;
      const tLive = -numerator / incidence,
        t = f(tLive);
      //4e3c88 compares the still-live quotient;4e3c96 reloads it for far.
      if (tLive < near || t > far) continue;
      const point: PedVector = [
        f(origin[0] + direction[0] * t),
        f(origin[1] + direction[1] * t),
        f(origin[2] + direction[2] * t),
      ];
      if (!inside(point, n, nativeModelPickPreparedVertices(prepared, face)))
        continue;
      if (mat?.name?.[0] === "!" || mat?.name?.[0] === ">") continue;
      //4e4389 reads pPoint.y directly: no model-to-world transform here.
      if (point[1] > result.height) {
        result.height = point[1];
        result.materialName = mat?.name ?? null;
        result.actor = actor;
        result.faceIndex = face.nativeFaceIndex;
      }
    }
  };
  const black = material(scene.blackMaterial);
  if (black !== undefined)
    for (const root of roots) visit(root, I, null, black, 0);
  result.requiredProviders = [...missing];
  return result;
}

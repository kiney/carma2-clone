import type { Vector3 } from "three";
import type { Surface } from "../world";
import type { Contact, RigidBody } from "./contact";
import type { CorrectionGeometrySnapshot } from "./correction-working-set";

export interface NativeWorldContactResult {
  /** Unsolved feature rows. The caller supplies fresh copies to consumers. */
  contacts: Contact[];
  /** Replay accumulated detection even when contacts is empty. */
  overlap: boolean;
}
export interface NativeWorldContactDiagnostics {
  nativeWorldEmitTests?: number;
  nativeWorldEmitHits?: number;
  /** Primary miss causes, ordered geometry, recovery, faces. Uncacheable
   * attempts are counted separately, including attempts without an old entry. */
  nativeWorldGeometryInvalidations?: number;
  nativeWorldRecoveryInvalidations?: number;
  nativeWorldFaceInvalidations?: number;
  nativeWorldUncacheableInvalidations?: number;
}
interface Entry {
  geometry: CorrectionGeometrySnapshot;
  centerX: number;
  centerY: number;
  centerZ: number;
  recovery: boolean;
  faces: unknown[];
  result: NativeWorldContactResult;
}
type Visit = (value: unknown) => void;
function pointValues(point: Vector3, visit: Visit): void {
  visit(point.x);
  visit(point.y);
  visit(point.z);
}
/** Certify actual post-collection rows, including mutable custom surfaces.
 * Scalar streams retain no nested copies and allocate only on a cache miss. */
function faceValues(surfaces: readonly Surface[], visit: Visit): void {
  visit(surfaces.length);
  for (const surface of surfaces) {
    visit(surface);
    pointValues(surface.a, visit);
    pointValues(surface.b, visit);
    pointValues(surface.c, visit);
    pointValues(surface.normal, visit);
    visit(surface.material);
    visit(surface.enabled);
    visit(surface.collisionMode);
    visit(surface.twoSided);
    visit(surface.materialFlags);
    visit(surface.faceFlags);
    visit(surface.modifier);
    visit(surface.modifier.wallFriction);
    visit(surface.actor);
    visit(surface.source);
    visit(surface.native);
    visit(surface.faceIndex);
    visit(surface.constant);
    visit(surface.minY);
    visit(surface.maxY);
    visit(surface.pixelmapType);
  }
}
/** Return the old stream on equality. A mismatch copies its matching prefix
 * once and captures the remaining values during the same face walk. */
function certifyFaces(
  surfaces: readonly Surface[],
  previous?: unknown[],
): unknown[] {
  let index = 0;
  let values: unknown[] | undefined = previous ? undefined : [];
  faceValues(surfaces, (value) => {
    if (!values && !Object.is(value, previous![index]))
      values = previous!.slice(0, index);
    if (values) values.push(value);
    index++;
  });
  if (!values && index !== previous!.length) values = previous!.slice(0, index);
  return values ?? previous!;
}

/** Own one tick's raw static-world emissions, after live facesNearBody and
 * eligibility filtering. Never bypass native face-ring access/callbacks with
 * this cache. Callback-mutated inputs must be recaptured before its next use.
 * No solved impulses, preparation outcomes or movement fractions are retained. */
export class NativeWorldContactCache {
  private entries = new Map<RigidBody, Entry>();
  constructor(public diagnostics?: NativeWorldContactDiagnostics) {}
  private count(key: keyof NativeWorldContactDiagnostics): void {
    if (this.diagnostics)
      this.diagnostics[key] = (this.diagnostics[key] ?? 0) + 1;
  }
  get(
    body: RigidBody,
    geometry: CorrectionGeometrySnapshot,
    center: Vector3,
    recovery: boolean,
    surfaces: readonly Surface[],
    emit: () => NativeWorldContactResult,
  ): NativeWorldContactResult {
    if (geometry.body !== body)
      throw new Error("Native world geometry belongs to a different body");
    this.count("nativeWorldEmitTests");
    const old = this.entries.get(body);
    if (!geometry.cacheable || surfaces.some((surface) => !!surface.owner)) {
      this.entries.delete(body);
      this.count("nativeWorldUncacheableInvalidations");
      return emit();
    }
    let faces: unknown[] | undefined;
    if (old) {
      const sameGeometry =
        old.geometry.shapeToken === geometry.shapeToken &&
        old.geometry.oldPoseToken === geometry.oldPoseToken &&
        old.geometry.nextPoseToken === geometry.nextPoseToken;
      const sameRecovery =
        old.recovery === recovery &&
        Object.is(old.centerX, center.x) &&
        Object.is(old.centerY, center.y) &&
        Object.is(old.centerZ, center.z);
      if (!sameGeometry) this.count("nativeWorldGeometryInvalidations");
      else if (!sameRecovery) this.count("nativeWorldRecoveryInvalidations");
      else {
        faces = certifyFaces(surfaces, old.faces);
        if (faces === old.faces) {
          this.count("nativeWorldEmitHits");
          return old.result;
        }
        this.count("nativeWorldFaceInvalidations");
      }
    }
    // Capture dependencies before emission: emission outputs are never inputs.
    faces ??= certifyFaces(surfaces);
    const centerX = center.x,
      centerY = center.y,
      centerZ = center.z;
    const result = emit();
    this.entries.set(body, {
      geometry,
      centerX,
      centerY,
      centerZ,
      recovery,
      faces,
      result,
    });
    return result;
  }
}

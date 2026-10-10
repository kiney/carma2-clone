import { Box3, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { CollisionHull } from "../physics/geometry";
import { NativeChaseCamera } from "./chase";
import { clearCameraFromOwnShape } from "./own-shape";
import type { CameraSettings } from "./settings";

const INITIAL_ZOOM = 0.2;
const MAX_ZOOM = 2;
const SCAN_STEP = 0.01;
const REFINEMENT_STEPS = 12;

/** Browser startup-framing extension; C2 itself has no per-car zoom setting.
 * Keep the native initial zoom when it fits, otherwise find the first fit. */
export function selectInitialCameraZoom(
  localBounds: Box3,
  localCOM: Vector3,
  hulls: readonly CollisionHull[],
  settings: CameraSettings,
  aspect: number,
): { zoom: number; framed: boolean } {
  if (
    localBounds.isEmpty() ||
    ![
      ...localBounds.min.toArray(),
      ...localBounds.max.toArray(),
      ...localCOM.toArray(),
      aspect,
      settings.hitherGeneral,
      settings.far,
      settings.fovAngle16,
      settings.runtimeFovDegrees,
    ].every(Number.isFinite) ||
    !(aspect > 0) ||
    !(settings.hitherGeneral > 0) ||
    !(settings.far > settings.hitherGeneral) ||
    !(settings.runtimeFovDegrees > 0 && settings.runtimeFovDegrees < 180) ||
    !Number.isInteger(settings.fovAngle16) ||
    settings.fovAngle16 <= 0 ||
    settings.fovAngle16 >= 32768
  )
    throw new Error("Invalid startup camera framing input");
  const near = settings.hitherGeneral;

  const orientation = new Quaternion();
  const corners = [
    new Vector3(localBounds.min.x, localBounds.min.y, localBounds.min.z),
    new Vector3(localBounds.min.x, localBounds.min.y, localBounds.max.z),
    new Vector3(localBounds.min.x, localBounds.max.y, localBounds.min.z),
    new Vector3(localBounds.min.x, localBounds.max.y, localBounds.max.z),
    new Vector3(localBounds.max.x, localBounds.min.y, localBounds.min.z),
    new Vector3(localBounds.max.x, localBounds.min.y, localBounds.max.z),
    new Vector3(localBounds.max.x, localBounds.max.y, localBounds.min.z),
    new Vector3(localBounds.max.x, localBounds.max.y, localBounds.max.z),
  ];

  const fits = (zoom: number): boolean => {
    const chase = new NativeChaseCamera();
    chase.zoom = zoom;
    chase.reset(localCOM, orientation);
    const pose = chase.update({
      dtMs: 0,
      worldCOM: localCOM,
      orientation,
      modelVelocity: new Vector3(),
      rearWheelZ: 0,
      steeringCurvature: 0,
      fovBRenderAngle: settings.fovAngle16,
    });
    const cleared = clearCameraFromOwnShape(
      pose.cameraPosition,
      localCOM,
      { hulls, position: new Vector3(), orientation },
      near,
    ).position;
    const aim = chase.aim(localCOM, cleared, settings.fovAngle16).aimDirection;
    const camera = new PerspectiveCamera(
      settings.runtimeFovDegrees,
      aspect,
      near,
      settings.far,
    );
    camera.position.copy(cleared);
    camera.lookAt(cleared.clone().add(aim));
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return corners.every((corner) => {
      const projected = corner.clone().project(camera);
      return (
        Number.isFinite(projected.x) &&
        Number.isFinite(projected.y) &&
        Number.isFinite(projected.z) &&
        projected.x >= -1 &&
        projected.x <= 1 &&
        projected.y >= -1 &&
        projected.y <= 1 &&
        projected.z >= -1 &&
        projected.z <= 1
      );
    });
  };

  if (fits(INITIAL_ZOOM)) return { zoom: INITIAL_ZOOM, framed: true };
  let lower = INITIAL_ZOOM;
  for (
    let candidate = INITIAL_ZOOM + SCAN_STEP;
    candidate < MAX_ZOOM;
    candidate = Math.round((candidate + SCAN_STEP) * 100) / 100
  ) {
    if (!fits(candidate)) {
      lower = candidate;
      continue;
    }
    return { zoom: refine(lower, candidate, fits), framed: true };
  }
  if (!fits(MAX_ZOOM)) return { zoom: MAX_ZOOM, framed: false };
  return { zoom: refine(lower, MAX_ZOOM, fits), framed: true };
}

function refine(
  notFitting: number,
  fitting: number,
  fits: (zoom: number) => boolean,
): number {
  let lower = notFitting;
  let upper = fitting;
  for (let i = 0; i < REFINEMENT_STEPS; i++) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) upper = middle;
    else lower = middle;
  }
  // The controller stores Float32 zoom. Rounding a boundary down could undo
  // the successful fit; advance one representable Float32 when necessary.
  const rounded = Math.fround(upper);
  if (rounded >= upper) return rounded;
  const bits = new Uint32Array(new Float32Array([rounded]).buffer);
  bits[0]++;
  return new Float32Array(bits.buffer)[0];
}

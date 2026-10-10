import { Vector3 } from "three";

export interface CameraPlane {
  point: Vector3;
  normal: Vector3;
  twoSided?: boolean;
}
export interface CameraWorldHit {
  fraction: number;
  normal: Vector3;
}
export interface CameraWorldQueries {
  /** Original finite ActorFindFace segment; no hit is undefined. */
  ray(from: Vector3, delta: Vector3): CameraWorldHit | undefined;
  /** Native FindFacesInBox order, capped at six by the consumer. */
  faces(min: Vector3, max: Vector3): readonly CameraPlane[];
}

/** Ordinary CollideCamera2 world path, independently expressed from native
 * equations. Binary corrections: proper bounds, orthogonal second-plane push,
 * and suppression of the third plane after parallel-face substitution. */
export function clearCameraFromWorld(
  proposed: Vector3,
  worldCOM: Vector3,
  near: number,
  queries: CameraWorldQueries,
  upsideDown = false,
): { position: Vector3; collided: boolean } {
  if (!(near > 0 && Number.isFinite(near)))
    throw new Error("Invalid camera near plane");
  const position = proposed.clone();
  const clearance = near * 3;
  let collided = false;
  let adjusted = false;
  let delta = new Vector3();
  let distance = 0;
  let hit: CameraWorldHit | undefined;
  for (let pass = 0; pass < 2; pass++) {
    delta.copy(position).sub(worldCOM);
    distance = delta.length();
    if (!(distance > 0 && Number.isFinite(distance)))
      throw new Error("Invalid camera world segment");
    delta.multiplyScalar(1.25);
    hit = queries.ray(worldCOM, delta);
    if (!hit || hit.fraction > 1) break;
    if (hit.fraction < 1) collided = true;
    const normal = hit.normal.clone();
    let incidence = normal.dot(delta);
    if (incidence > 0) normal.negate();
    incidence = Math.abs(incidence);
    hit = { fraction: hit.fraction, normal };
    if (adjusted) break;
    const deficit = clearance + incidence / 1.25 - hit.fraction * incidence;
    if (deficit <= 0) break;
    const bent = normal.clone();
    bent.y += normal.y >= 0.7 ? 3 : -3;
    position.addScaledVector(
      bent,
      (Math.abs(normal.y) * deficit) / bent.length(),
    );
    position.sub(worldCOM).normalize().multiplyScalar(distance).add(worldCOM);
    adjusted = true;
  }
  if (hit && hit.fraction <= 1) {
    collided = true;
    const divisor = hit.normal.dot(delta);
    if (divisor !== 0) {
      const retreat = -clearance / divisor;
      let fraction = hit.fraction - retreat;
      if (fraction * distance < 1) {
        fraction += retreat - 0.001;
        if (fraction >= 1 / distance) fraction = 1 / distance;
      }
      fraction = Math.min(fraction, 0.8);
      delta.multiplyScalar(fraction);
      if (delta.length() < 0.6 && !adjusted) {
        const slide = hit.normal.clone().multiplyScalar(-hit.normal.y);
        slide.y += 1;
        if (upsideDown) slide.negate();
        const a = slide.lengthSq();
        const b = slide.dot(delta);
        const discriminant = b * b - 4 * a * (delta.lengthSq() - 0.36);
        if (discriminant >= 0 && a !== 0) {
          slide.multiplyScalar((Math.sqrt(discriminant) - b) / (2 * a));
          const start = worldCOM.clone().add(delta);
          const slideHit = queries.ray(start, slide);
          if (slideHit && slideHit.fraction < 1)
            slide.multiplyScalar(slideHit.fraction);
          const horizontal = delta.clone();
          horizontal.y = 0;
          horizontal.normalize();
          delta.add(slide);
          const projection = horizontal.dot(delta);
          if (projection < 0.03) {
            slide.normalize();
            const slideProjection = horizontal.dot(slide);
            if (slideProjection < -0.03)
              delta.addScaledVector(
                slide,
                (0.03 - projection) / slideProjection,
              );
          }
        }
      }
      position.copy(worldCOM).add(delta);
    }
  }

  const extent = new Vector3(clearance, clearance, clearance);
  const planes = queries
    .faces(position.clone().sub(extent), position.clone().add(extent))
    .slice(0, 6)
    .map((plane, index) => {
      const normal = plane.normal.clone();
      if (plane.twoSided && normal.dot(delta) > 0) normal.negate();
      return {
        point: plane.point,
        normal,
        index,
        distance: normal.dot(position.clone().sub(plane.point)),
      };
    })
    .filter((plane) => plane.distance > 0 && plane.distance < 100)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, 3);
  if (planes.length) {
    const first = planes[0];
    if (first.distance < clearance)
      position.addScaledVector(first.normal, clearance - first.distance);
    if (planes.length >= 2) {
      let second = planes[1];
      let count = planes.length;
      let alignment = first.normal.dot(second.normal);
      if (alignment > 0.95 && count === 3) {
        second = planes[2];
        alignment = first.normal.dot(second.normal);
        count = 2;
      }
      if (alignment <= 0.95) {
        const distance = second.normal.dot(position.clone().sub(second.point));
        if (distance < clearance) {
          second.normal.addScaledVector(
            first.normal,
            -first.normal.dot(second.normal),
          );
          position.addScaledVector(second.normal, clearance - distance);
        }
      }
      if (count === 3) {
        const distance = second.normal.dot(position.clone().sub(second.point));
        if (distance < clearance && distance >= 0 && distance > 0.5) {
          const direction = first.normal.clone().cross(second.normal);
          const third = planes[2].normal;
          if (direction.dot(third) < 0) direction.negate();
          const divisor = third.dot(direction);
          if (divisor !== 0)
            position.addScaledVector(
              direction,
              (clearance - distance) / divisor,
            );
        }
      }
    }
  }
  return { position, collided };
}

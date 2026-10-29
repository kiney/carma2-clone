import type { RigidBody } from "./contact";
import type { NonCarBody } from "./noncar-body";
import type { Surface } from "../world";
import {
  recoverWorldContacts,
  type CollisionHull,
  type WorldRecoverySurface,
} from "./geometry";

/** Ordinary NONCAR WORLD type3/1, not an attachment to a movable rigid body.
 * An authored released-actor marker is not permission to reinstate a WORLD
 * anchor, even if a retained/custom body still carries stale joint metadata. */
export function isFixedNonCarWorldJoint(body: RigidBody): body is NonCarBody {
  const noncar = body as Partial<NonCarBody>;
  return (
    noncar.kind === "noncar" &&
    noncar.attached === true &&
    noncar.actor?.name[3] !== "!" &&
    noncar.mechanics?.worldJoint?.kind !== "translation" &&
    noncar.joint?.type === "ball" &&
    noncar.joint.child === body &&
    noncar.joint.parent.properties.immovable === true
  );
}

function sameFiniteFace(a: Surface, b: Surface): boolean {
  return (
    a === b ||
    (!!a.source && a.source === b.source) ||
    (!!a.actor &&
      a.actor === b.actor &&
      a.faceIndex !== undefined &&
      a.faceIndex === b.faceIndex)
  );
}

/** A native-informed captured-phase policy, analogous to body-pair recovery:
 * native OLD recovery already owns this finite face. An additional guard must
 * not freeze an ordinary WORLD joint against the same source contact forever.
 * Source collection, impulses and snap callbacks remain live. Only OLD-selected
 * faces of this particular hull are admitted; NEW faces/hulls remain guarded.
 * Native endpoint slack can qualify positive clearance as well as penetration.
 */
export function captureWorldJointOldContacts(
  body: RigidBody,
  oldHulls: readonly CollisionHull[],
  nativeFaces: readonly WorldRecoverySurface[],
): ((hullIndex: number, surface: Surface) => boolean) | undefined {
  if (!isFixedNonCarWorldJoint(body) || !nativeFaces.length) return;
  const pose = oldHulls[0];
  if (!pose?.position || !pose.orientation) return;
  const center = body.properties.centerOfMass
    .clone()
    .applyQuaternion(pose.orientation)
    .add(pose.position);
  const detected = oldHulls.map((old) => {
    const faces = new Set<Surface>();
    // Test against the COMPLETE native inventory at once. In particular a
    // zero-drift detection still qualifies, and a farther losing face does not.
    recoverWorldContacts(old, old, nativeFaces, center, (face) => {
      if (face.sourceSurface) faces.add(face.sourceSurface);
    });
    return [...faces];
  });
  return (hullIndex, surface) =>
    detected[hullIndex]?.some((face) => sameFiniteFace(face, surface)) ?? false;
}

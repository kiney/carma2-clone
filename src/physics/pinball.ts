import { Vector3 } from "three";
import type { ContactImpact, RigidBody } from "./contact";

const NORMAL_GROUP_DOT = 0.7071070075035095;
const MINIMUM_NORMAL_IMPULSE = 0.00019999999494757503;
const MAX_ROWS_PER_GROUP = 4;
const MAX_DELTA_SQUARED = 500;
const NATIVE_STEP_SCALE = 0.20000000298023224;
const PINBALL_SCALE = 6.9;

export interface PinballImpulseGroup {
  body: RigidBody;
  impacts: ContactImpact[];
  impulse: Vector3;
  deltaVelocity: Vector3;
  sound: boolean;
}

/** Apply the verified world-contact pinball impulse branch to body velocities. */
export function applyWorldPinball(
  impacts: readonly ContactImpact[],
  factor: number,
): PinballImpulseGroup[] {
  if (!Number.isFinite(factor))
    throw new Error("Pinball factor must be finite");
  if (factor === 0) return [];
  const groups: {
    body: RigidBody;
    seedNormal: Vector3;
    rows: ContactImpact[];
  }[] = [];

  for (const impact of impacts) {
    if (impact.b || impact.sourceType === 9) continue;
    let group = groups.find(
      (candidate) =>
        candidate.body === impact.a &&
        candidate.rows.length < MAX_ROWS_PER_GROUP &&
        candidate.seedNormal.dot(impact.normal) > NORMAL_GROUP_DOT,
    );
    if (!group) {
      group = {
        body: impact.a,
        seedNormal: impact.normal.clone(),
        rows: [],
      };
      groups.push(group);
    }
    group.rows.push(impact);
  }

  return groups.flatMap(({ body, rows }) => {
    const weight = rows.reduce((sum, row) => sum + row.normalImpulse, 0);
    if (!(weight > MINIMUM_NORMAL_IMPULSE)) return [];
    const mass = body.properties.mass;
    if (!(mass > 0) || !Number.isFinite(mass))
      throw new Error("Pinball body mass must be positive and finite");
    const impulse = rows.reduce(
      (sum, row) => sum.addScaledVector(row.normal, row.normalImpulse),
      new Vector3(),
    );
    const deltaVelocity = impulse.multiplyScalar(
      (PINBALL_SCALE * factor * NATIVE_STEP_SCALE) / mass,
    );
    const squared = deltaVelocity.lengthSq();
    if (squared > MAX_DELTA_SQUARED)
      deltaVelocity.multiplyScalar(MAX_DELTA_SQUARED / squared);
    body.state.velocity.add(deltaVelocity);
    return [
      {
        body,
        impacts: rows,
        impulse: rows.reduce(
          (sum, row) => sum.addScaledVector(row.normal, row.normalImpulse),
          new Vector3(),
        ),
        deltaVelocity,
        sound: deltaVelocity.lengthSq() > 1,
      },
    ];
  });
}

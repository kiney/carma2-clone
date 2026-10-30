import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  conflictingWorldEncounter,
  admitSampledWorldContacts,
  mergeWorldContacts,
} from "../src/physics/world-contact-admission.ts";

function pair({ slot }) {
  const actor = {},
    body = {},
    angle = (1.33 * Math.PI) / 180;
  const first = {
    actor,
    a: new Vector3(-1, 0, 0),
    b: new Vector3(1, 0, 0),
    c: new Vector3(0, 0, 1),
    normal: new Vector3(0, 1, 0),
  };
  const second = {
    actor,
    a: new Vector3(-1, 0, 0),
    b: new Vector3(1, 0, 0),
    c: slot
      ? new Vector3(0, Math.sin(angle), Math.cos(angle))
      : new Vector3(0, Math.tan(angle), -1),
    normal: slot
      ? new Vector3(0, -Math.cos(angle), Math.sin(angle))
      : new Vector3(0, -Math.cos(angle), -Math.sin(angle)),
  };
  return [first, second].map((sourceSurface, index) => ({
    a: body,
    point: new Vector3(0, index * 0.0003, index * 0.03),
    normal: new Vector3(0, index ? -1 : 1, 0),
    sourceSurface,
    worldFeature: {
      hullIndex: 0,
      trajectory: "angular",
      fraction: index * 0.5,
    },
  }));
}

test("opposing acute slot walls extending from the same edge retain both constraints", () => {
  // Both faces extend in +Z, with a small widening Y gap. Their normals face
  // the slot interior. This differs from a nearly flat oppositely wound seam.
  const rows = pair({ slot: true });
  assert.equal(conflictingWorldEncounter(...rows), false);
  assert.deepEqual(admitSampledWorldContacts(rows), rows);
  assert.deepEqual(mergeWorldContacts([rows[1]], [rows[0]]), [
    rows[1],
    rows[0],
  ]);
});

test("reversed winding on a continuous two-sided shallow seam still identifies one encounter", () => {
  const rows = pair({ slot: false });
  for (const row of rows) row.sourceSurface.twoSided = true;
  assert.equal(conflictingWorldEncounter(...rows), true);
  assert.deepEqual(admitSampledWorldContacts(rows), [rows[0]]);
});

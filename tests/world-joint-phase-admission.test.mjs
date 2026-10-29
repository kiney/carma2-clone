import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion } from "three";
import {
  recoverWorldContacts,
  transformHull,
} from "../src/physics/geometry.ts";
import { pointVelocity } from "../src/physics/contact.ts";
import {
  independentBallCandidate,
  v,
  worldJointFixture,
} from "./support/world-joint-phase-fixture.mjs";

function assertPose(body, expected) {
  assert.ok(body.state.predictedPosition.distanceTo(expected.position) < 1e-12);
  assert.ok(
    1 - Math.abs(body.state.predictedOrientation.dot(expected.orientation)) <
      1e-12,
  );
}
function assertLiveSource(fixture) {
  const rows = fixture.source();
  assert.ok(rows.length > 0, "real native world emitter must remain live");
  assert.ok(
    rows.some(
      (row) =>
        pointVelocity(row.a.state, row.a.properties, row.point).dot(
          row.normal,
        ) < -0.001,
    ),
    "source rows oppose an actual inward contact velocity",
  );
  return rows;
}
function contactSnapshot(rows) {
  return rows.map((row) => ({
    point: row.point.toArray(),
    normal: row.normal.toArray(),
    sourceType: row.sourceType,
    face: row.sourceSurface,
  }));
}

for (const [name, options] of [
  ["prior recovery flag", {}],
  ["no prior recovery flag", { prior: false }],
  ["different authored mass", { mass: 2.75 }],
  [
    "rotated and translated world frame",
    {
      frame: new Quaternion().setFromEuler(new Euler(0.31, -0.47, 0.22)),
      translation: v(0.3, -0.2, 0.7),
    },
  ],
]) {
  test(`native OLD-qualified fixed WORLD ball joint admits the full source phase: ${name}`, () => {
    const fixture = worldJointFixture(options);
    try {
      const expected = independentBallCandidate(fixture);
      assertPose(fixture.body, expected);
      assert.equal(
        fixture.oldRecovery().overlapDetected,
        true,
        "native OLD recovery detects the finite floor including endpoint slack",
      );
      const before = assertLiveSource(fixture);
      const guard = fixture.guard();
      assert.equal(
        guard.fraction,
        1,
        "an existing native-qualified face must not freeze the ordinary WORLD ball-joint phase",
      );
      assert.equal(guard.crossingFraction, 1);
      assert.equal(
        guard.contacts.length,
        0,
        "the extra angular guard must not inject duplicate recovery rows for this face",
      );
      assertPose(fixture.body, expected);
      assert.deepEqual(
        contactSnapshot(fixture.source()),
        contactSnapshot(before),
        "native world contacts are unchanged by angular admission",
      );
    } finally {
      fixture.dispose();
    }
  });
}

test("native OLD detection qualifies zero candidate drift even without emitted recovery rows", () => {
  const fixture = worldJointFixture({ omega: 0 });
  try {
    const { body, simulation } = fixture;
    const old = transformHull(
      body.hulls[0],
      body.state.position,
      body.state.orientation,
    );
    const surfaces = simulation.recoverySurfaces(
      simulation.facesNearBody(body, body.hulls, true),
    );
    const center = body.properties.centerOfMass
      .clone()
      .applyQuaternion(body.state.orientation)
      .add(body.state.position);
    const recovery = recoverWorldContacts(old, old, surfaces, center);
    assert.equal(recovery.overlapDetected, true);
    assert.equal(
      recovery.contacts.length,
      0,
      "detection is independent from inward candidate drift",
    );
    body.state.predictedPosition.copy(body.state.position);
    body.state.predictedOrientation.copy(body.state.orientation);
    assert.equal(
      fixture.source().length,
      0,
      "prime the real native face inventory with exactly zero drift",
    );
    const guard = fixture.guard();
    assert.equal(guard.fraction, 1);
    assert.equal(guard.contacts.length, 0);
  } finally {
    fixture.dispose();
  }
});

test("a NEW perpendicular finite wall remains guarded beside a qualified floor", () => {
  const fixture = worldJointFixture({ wall: true, omega: 1 });
  try {
    const { body, simulation, wallMesh } = fixture;
    const faces = simulation.facesNearBody(body, body.hulls, true);
    assert.equal(
      fixture.oldRecovery(
        0,
        faces.filter((face) => face.actor === wallMesh),
      ).overlapDetected,
      false,
      "wall starts beyond native OLD endpoint slack",
    );
    assert.equal(fixture.oldRecovery().overlapDetected, true);
    assertLiveSource(fixture);
    const candidate = independentBallCandidate(fixture, 1);
    const corners = body.hulls[0].vertices.map((point) =>
      point
        .clone()
        .applyQuaternion(candidate.orientation)
        .add(candidate.position),
    );
    assert.ok(
      Math.max(...corners.map((point) => point.z)) > 0.024,
      "the candidate really crosses the finite wall plane",
    );
    const guard = fixture.guard();
    assert.ok(guard.fraction < 1, "new wall crossing must cap this phase");
    assert.ok(
      guard.contacts.some((row) => row.sourceSurface.actor === wallMesh),
      "new wall must retain real collision rows",
    );
    assert.ok(
      guard.contacts.every((row) => row.sourceSurface.actor !== fixture.floor),
      "OLD-qualified floor alone must not contribute angular guard rows",
    );
  } finally {
    fixture.dispose();
  }
});

test("qualification is per hull: a sibling hull entering the same floor remains guarded", () => {
  const fixture = worldJointFixture({ sibling: true });
  try {
    assert.equal(fixture.oldRecovery(0).overlapDetected, true);
    assert.equal(fixture.oldRecovery(1).overlapDetected, false);
    const candidate = independentBallCandidate(fixture);
    assert.ok(
      Math.min(
        ...fixture.body.hulls[1].vertices.map(
          (point) =>
            point
              .clone()
              .applyQuaternion(candidate.orientation)
              .add(candidate.position).y,
        ),
      ) < 0,
      "sibling candidate corners really cross the floor",
    );
    assertLiveSource(fixture);
    const guard = fixture.guard();
    assert.ok(guard.fraction < 1);
    assert.ok(
      guard.contacts.some((row) => row.worldFeature?.hullIndex === 1),
      "the previously clear sibling has an actual floor encounter",
    );
    assert.ok(
      guard.contacts.every((row) => row.worldFeature?.hullIndex !== 0),
      "one hull's qualification cannot add or hide another hull's rows",
    );
  } finally {
    fixture.dispose();
  }
});

test("native recovery must select qualifying faces over the whole candidate set", () => {
  const fixture = worldJointFixture({ extraFloor: -0.0002 });
  try {
    const { body, simulation, extraFloorMesh } = fixture;
    const faces = simulation.facesNearBody(body, body.hulls, true);
    const farther = faces.filter((face) => face.actor === extraFloorMesh);
    assert.equal(
      fixture.oldRecovery(0, farther).overlapDetected,
      true,
      "the farther losing face would qualify if tested in isolation",
    );
    const actual = fixture.oldRecovery();
    assert.ok(actual.contacts.length > 0);
    assert.ok(
      actual.contacts.every((row) => row.sourceSurface.actor === fixture.floor),
      "native nearest-face selection chooses only the original floor for these inward rows",
    );
    assertLiveSource(fixture);
    const candidate = independentBallCandidate(fixture);
    assert.ok(
      Math.min(
        ...body.hulls[0].vertices.map(
          (point) =>
            point
              .clone()
              .applyQuaternion(candidate.orientation)
              .add(candidate.position).y,
        ),
      ) < -0.0002,
      "candidate corners really cross the farther floor",
    );
    const guard = fixture.guard();
    assert.ok(guard.fraction < 1);
    assert.ok(
      guard.contacts.some((row) => row.sourceSurface.actor === extraFloorMesh),
      "independent per-face recovery must not incorrectly admit the farther face",
    );
    assert.ok(
      guard.contacts.every((row) => row.sourceSurface.actor !== fixture.floor),
    );
  } finally {
    fixture.dispose();
  }
});

for (const [name, options] of [
  ["free body", { jointType: "none" }],
  ["movable parent", { movableParent: true }],
  ["hinge", { jointType: "hinge" }],
  ["translation joint", { jointType: "translation" }],
]) {
  test(`ordinary WORLD ball admission does not exempt a ${name}`, () => {
    const fixture = worldJointFixture(options);
    try {
      assert.equal(fixture.oldRecovery().overlapDetected, true);
      assertLiveSource(fixture);
      const guard = fixture.guard();
      assert.ok(guard.fraction < 1);
      assert.ok(
        guard.contacts.length > 0,
        "unsupported movement must keep active collision protection",
      );
    } finally {
      fixture.dispose();
    }
  });
}

test("next phase rearms a clear floor regardless of stale prior overlap flags", () => {
  const fixture = worldJointFixture({ halfDepth: 0.06 });
  try {
    assert.equal(fixture.oldRecovery().overlapDetected, true);
    assertLiveSource(fixture);
    fixture.guard();
    // Native recovery permits .003 world units past a segment endpoint. Lift
    // beyond that slack, then rotate far enough to create a real NEW crossing.
    fixture.body.state.position.add(v(0, 0.004, 0));
    fixture.body.joint.parentAnchor.add(v(0, 0.004, 0));
    fixture.body.state.angularVelocity.set(5, 0, 0);
    fixture.body.worldRecovery = fixture.body.worldOverlapDetected = true;
    fixture.capture();
    assert.equal(
      fixture.oldRecovery().overlapDetected,
      false,
      "fresh OLD geometry is clear beyond the native endpoint slack",
    );
    assertLiveSource(fixture);
    const corners = fixture.body.hulls[0].vertices.map((point) =>
      point
        .clone()
        .applyQuaternion(fixture.body.state.predictedOrientation)
        .add(fixture.body.state.predictedPosition),
    );
    assert.ok(
      Math.min(...corners.map((point) => point.y)) < -0.001,
      "the next candidate really crosses the floor after clearing OLD slack",
    );
    const guard = fixture.guard();
    assert.ok(guard.fraction < 1);
    assert.ok(
      guard.contacts.length > 0,
      "stale flags cannot keep the next phase exempt",
    );
  } finally {
    fixture.dispose();
  }
});

/**
 * Source-equation counterfactual, not an original-EXE oracle: retain all native
 * collection/response/quiet/snap paths and admit only an attached fixed WORLD
 * ball phase whose OLD finite-floor contact the real native detector confirms.
 */
function runSixProductionTicks(nativeOnlyAttachedControl) {
  const fixture = worldJointFixture();
  const { simulation, body } = fixture;
  const ticks = [];
  let responses = 0;
  let positiveNormalImpulse = 0;
  let nativePreparedRows = 0;
  let overriddenPhases = 0;
  let releasedFallbackPhases = 0;
  simulation.onLocalResponseTrace = (event) => {
    if (event.phase === "response") responses++;
  };
  const prepare = simulation.preparePedContacts;
  simulation.preparePedContacts = function (rows) {
    nativePreparedRows += rows.filter(
      (row) => row.a === body && row.worldFeature?.trajectory === "chord",
    ).length;
    return prepare.call(this, rows);
  };
  const processImpacts = simulation.processImpactDamage;
  simulation.processImpactDamage = function (impacts, ...args) {
    positiveNormalImpulse += impacts
      .filter((impact) => impact.a === body && !impact.b)
      .reduce((sum, impact) => sum + Math.max(0, impact.normalImpulse), 0);
    return processImpacts.call(this, impacts, ...args);
  };
  if (nativeOnlyAttachedControl) {
    const originalGuard = simulation.advanceWorldContacts;
    simulation.advanceWorldContacts = function (candidateBody, refine = false) {
      if (
        candidateBody === body &&
        body.attached &&
        body.joint?.type === "ball" &&
        body.joint.parent.properties.immovable
      ) {
        const nativeFaces = this.contactSurfaces.get(body);
        assert.equal(
          nativeFaces?.length,
          2,
          "every overridden phase uses the real complete native two-triangle floor inventory",
        );
        assert.ok(nativeFaces.every((face) => face.actor === fixture.floor));
        assert.equal(
          fixture.oldRecovery(0, nativeFaces).overlapDetected,
          true,
          "the native OLD detector must qualify every phase overridden by this diagnostic control",
        );
        overriddenPhases++;
        return {
          contacts: [],
          encounters: [],
          fraction: 1,
          crossingFraction: 1,
        };
      }
      if (candidateBody === body && !body.attached) releasedFallbackPhases++;
      // Release restores the original production guard, including its contacts
      // and temporal fraction; the control never exempts free-body movement.
      return originalGuard.call(this, candidateBody, refine);
    };
  }
  try {
    assert.equal(body.mechanics.snapAngleDegrees, 30);
    assertLiveSource(fixture);
    for (let tick = 0; tick < 6; tick++) {
      const beforeResponses = responses;
      const beforeImpulse = positiveNormalImpulse;
      const beforeNativeRows = nativePreparedRows;
      simulation.step();
      ticks.push({
        position: body.state.position.clone(),
        orientation: body.state.orientation.clone(),
        velocity: body.state.velocity.clone(),
        omega: body.state.angularVelocity.clone(),
        responses: responses - beforeResponses,
        impulse: positiveNormalImpulse - beforeImpulse,
        nativeRows: nativePreparedRows - beforeNativeRows,
        attached: body.attached,
        joint: !!body.joint,
        sleeping: body.motor.sleeping,
        up: v(0, 1).applyQuaternion(body.state.orientation).y,
      });
    }
    return { ticks, overriddenPhases, releasedFallbackPhases };
  } finally {
    fixture.dispose();
  }
}

test("six real production ticks follow native-qualified full phases through authored snap and free-body fallback", () => {
  const reference = runSixProductionTicks(true);
  const actual = runSixProductionTicks(false);
  assert.ok(reference.overriddenPhases > 0);
  assert.ok(
    reference.releasedFallbackPhases > 0,
    "the released reference uses the original guard again",
  );
  assert.deepEqual(
    reference.ticks.map((tick) => tick.responses),
    [30, 30, 30, 0, 0, 0],
    "the independent control retains the existing response budget and later exits through native behavior",
  );
  assert.ok(
    reference.ticks
      .slice(0, 3)
      .every((tick) => tick.impulse > 0 && tick.nativeRows > 0),
    "native source rows and positive normal impulses remain active",
  );
  const bendAngle =
    (Math.trunc((30 * 65536) / 360) & 0xffff) * ((2 * Math.PI) / 65536);
  assert.equal(reference.ticks[3].joint, true);
  assert.ok(reference.ticks[3].up >= Math.cos(bendAngle));
  assert.equal(reference.ticks[4].joint, false);
  assert.ok(
    reference.ticks[4].up < Math.cos(bendAngle),
    "ordinary postprocessing crosses the authored 30-degree snap threshold",
  );
  assert.equal(reference.ticks[4].velocity.lengthSq(), 0);
  assert.equal(reference.ticks[4].omega.lengthSq(), 0);
  assert.ok(
    reference.ticks[5].velocity.y < 0,
    "free-body gravity resumes after the ordinary release callback",
  );
  assert.ok(
    reference.ticks.every((tick) => !tick.sleeping),
    "the counterfactual never forces sleep to suppress retries",
  );
  for (let tick = 0; tick < reference.ticks.length; tick++) {
    const expected = reference.ticks[tick];
    const observed = actual.ticks[tick];
    assert.equal(
      observed.responses,
      expected.responses,
      `tick ${tick + 1}: response count follows native full-phase behavior`,
    );
    assert.ok(
      observed.position.distanceTo(expected.position) < 1e-10,
      `tick ${tick + 1}: committed position follows the native full-phase control`,
    );
    assert.ok(
      1 - Math.abs(observed.orientation.dot(expected.orientation)) < 1e-12,
      `tick ${tick + 1}: committed rotation follows the native full-phase control`,
    );
    assert.ok(
      observed.velocity.distanceTo(expected.velocity) < 1e-10,
      `tick ${tick + 1}: velocity`,
    );
    assert.ok(
      observed.omega.distanceTo(expected.omega) < 1e-10,
      `tick ${tick + 1}: angular velocity`,
    );
    assert.ok(
      Math.abs(observed.impulse - expected.impulse) < 1e-10,
      `tick ${tick + 1}: native normal impulse remains live`,
    );
    assert.equal(
      observed.attached,
      expected.attached,
      `tick ${tick + 1}: attachment`,
    );
    assert.equal(
      observed.joint,
      expected.joint,
      `tick ${tick + 1}: ordinary snap callback`,
    );
    assert.equal(
      observed.sleeping,
      expected.sleeping,
      `tick ${tick + 1}: native sleep decision`,
    );
  }
});

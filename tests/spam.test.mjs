import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import { DamageSystem } from "../src/damage.ts";
import { parseCarMechanics } from "../src/mechanics.ts";
import { buildHull } from "../src/physics/geometry.ts";
import { originalCar } from "./support/original-car.mjs";

const v = (x, y, z) => new Vector3(x, y, z);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const cube = () =>
  [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z) => v(x * 0.2, y * 0.2, z * 0.4))),
  );
const wam = (bend = 0, snap = 0) =>
  [
    "VERSION 4",
    ...Array(6).fill(["1", "0"]).flat(),
    bend,
    "-.1",
    ".1",
    snap,
    "0",
    "0,0,0",
    "1",
    "BODY.ACT",
    "normal",
    "boring",
    "0",
  ].join("\n");
async function fixture(bend = 0, snap = 0) {
  const path = "data/CARS/TEST/TEST.WAM";
  const assets = {
    manifest: [{ path }],
    resolve: () => path,
    text: async () => wam(bend, snap),
  };
  const group = new Group(),
    actor = new Group();
  group.name = "TEST";
  actor.name = "BODY.ACT";
  group.add(actor);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.from(cube().flatMap((p) => p.toArray())),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3, 4, 6, 5, 5, 6, 7]);
  const mesh = new Mesh(geometry, new MeshLambertMaterial());
  actor.add(mesh);
  const system = new DamageSystem(assets, group, "TEST.TXT\nTEST.WAM");
  await system.init();
  const shapes = [cube()];
  system.configurePhysics(
    {
      root: { mass: 1, centerOfMass: [0, 0, 0], inertia: [1, 1, 1] },
      wheels: [],
      shapes: [],
    },
    shapes,
  );
  return { system, shapes, mesh };
}

test("accepted deferred bending notifies before geometry and component writes, only once", async () => {
  const { system, mesh } = await fixture(1);
  system.damageContext.random = () => 0;
  const before = Array.from(mesh.geometry.attributes.position.array);
  let calls = 0;
  system.onBeforeStructuralBend = () => {
    calls++;
    assert.equal(system.structuralBend, undefined);
    assert.equal(system.structuralRevision, 0);
    assert.deepEqual(Array.from(system.componentLevels), Array(12).fill(0));
    assert.deepEqual(
      Array.from(mesh.geometry.attributes.position.array),
      before,
    );
  };
  const bend = () =>
    system.applyDeferredBend(v(0, 0, -0.4), v(0, 0, 1), 6, 40, true);
  assert.equal(bend(), true);
  assert.equal(calls, 1);
  assert.ok(system.structuralBend);
  assert.ok(system.componentLevels[0] >= 80);
  assert.notDeepEqual(
    Array.from(mesh.geometry.attributes.position.array),
    before,
  );
  // A later native mark still consumes sound RNG, but BendCar rejects geometry.
  assert.equal(bend(), true);
  assert.equal(calls, 1);
});

test("rejected, immune and middle-region bend requests do not notify removal", async () => {
  const { system } = await fixture(1);
  system.damageContext.random = () => 0;
  let calls = 0;
  system.onBeforeStructuralBend = () => calls++;
  assert.equal(
    system.applyDeferredBend(v(0, 0, 0), v(0, 0, 1), 6, 40, true),
    false,
  );
  system.damageContext.invulnerable = true;
  system.applyDeferredBend(v(0, 0, -0.4), v(0, 0, 1), 6, 40, true);
  assert.equal(calls, 0);
  assert.equal(system.structuralBend, undefined);
  system.damageContext.invulnerable = false;
  const saved = system.wam;
  system.wam = undefined;
  assert.equal(
    system.applyDeferredBend(v(0, 0, -0.4), v(0, 0, 1), 6, 40, true),
    false,
  );
  system.wam = saved;
  assert.equal(calls, 0);
});

test("SPAM bend notifies before its structural transform; ordinary repair does not", async () => {
  const { system } = await fixture(1);
  system.componentLevels.fill(40);
  const levels = Array.from(system.componentLevels);
  system.damageContext.random = () => 0.5;
  let calls = 0;
  system.onBeforeStructuralBend = () => {
    calls++;
    assert.equal(system.structuralBend, undefined);
    assert.equal(system.structuralRevision, 0);
    assert.deepEqual(Array.from(system.componentLevels), levels);
  };
  assert.ok(system.spamModel(1, 40).bendCase);
  assert.equal(calls, 1);
  system.repair();
  assert.equal(system.structuralBend, undefined);
  assert.equal(calls, 1, "full repair is not BendCar's removal boundary");
});

test("spam generates ten one-point rays and bypasses component programs, car softness and minimum force", async () => {
  const { system, shapes, mesh } = await fixture();
  system.damagePrograms = { softness: 0 };
  let count = 0;
  // Ten WAM IDs, then repeat maxX/minY/minZ -> opposite-face ray corners.
  system.damageContext.random = () =>
    count++ < 10 ? 0 : [0, 0, 1, 0, 1][(count - 11) % 5];
  const before = Array.from(mesh.geometry.attributes.position.array);
  const hullBefore = shapes[0].map((p) => p.clone());
  const levels = Array.from(system.componentLevels);
  const result = system.spamModel(0.01, 1000);
  assert.equal(result.rays.length, 10);
  assert.equal(
    count,
    60,
    "ten IDs and five samples per ray, no ordinary damage RNG",
  );
  result.rays.forEach(({ start, direction, force }) => {
    near(force, 0.015);
    near(start.x, 0.2 + 0.2 / 6.9);
    near(start.y, -0.2 - 0.2 / 6.9);
    near(start.z, -0.4 - 0.2 / 6.9);
    near(direction.length(), 1);
  });
  assert.deepEqual(Array.from(system.componentLevels), levels);
  const after = Array.from(mesh.geometry.attributes.position.array);
  const changed = after.filter(
    (value, index) => value !== before[index],
  ).length;
  assert.ok(
    changed > 0 && changed < after.length,
    "localized dent leaves remote coordinates intact",
  );
  assert.ok(shapes[0].some((point, index) => !point.equals(hullBefore[index])));
  assert.ok(
    shapes[0].every(
      (point, index) =>
        point.x === hullBefore[index].x && point.y === hullBefore[index].y,
    ),
    "physical root strips X and upward movement",
  );
  assert.ok(system.pendingShapeSwapFlags & 7);
  const persistent = after.slice();
  count = 0;
  system.spamModel(0.01, 2000);
  assert.notDeepEqual(
    Array.from(mesh.geometry.attributes.position.array),
    persistent,
  );
  assert.deepEqual(Array.from(system.componentLevels), levels);
});

test("spam caps direct force and rejects immunity, nonfinite input and already bent cars", async () => {
  const { system } = await fixture();
  system.damageContext.random = () => 0.5;
  assert.ok(system.spamModel(100, 0).rays.every((ray) => ray.force === 0.5));
  system.damageContext.invulnerable = true;
  assert.equal(system.spamModel(1, 0).rays.length, 0);
  system.damageContext.invulnerable = false;
  assert.equal(system.spamModel(NaN, 0).rays.length, 0);
  assert.equal(system.spamModel(1, Infinity).rays.length, 0);
  system.structuralBend = {};
  assert.equal(system.spamModel(1, 0).rays.length, 0);
});

test("spam bends only damaged cars and explicit native bend cases preserve component levels", async () => {
  for (let choice = 1; choice <= 8; choice++) {
    const { system } = await fixture(1, 0);
    system.componentLevels.fill(40);
    const levels = Array.from(system.componentLevels);
    let count = 0;
    system.damageContext.random = () => (count++ < 60 ? 0.5 : (choice - 1) / 8);
    const result = system.spamModel(1, 10);
    assert.equal(result.bendCase, choice);
    assert.ok(system.structuralBend);
    assert.deepEqual(
      Array.from(system.componentLevels),
      levels,
      "BendCar pDamageSystems=0",
    );
    assert.equal(
      system.structuralBend.angleXUnits,
      choice <= 2 ? (choice === 1 ? 0xe002 : 0x1ffe) : 0,
    );
    assert.equal(
      system.structuralBend.angleYUnits,
      choice >= 3 ? (choice === 3 ? 0xe002 : 0x1ffe) : 0,
    );
    assert.equal(system.structuralBend.pivot.z, choice <= 4 ? -0.1 : 0.1);
  }
  const { system } = await fixture(1, 4);
  system.damageContext.random = () => 0.5;
  const clean = system.spamModel(1, 0);
  assert.equal(clean.bendCase, undefined);
  assert.equal(clean.splitRequest, undefined);
});

test("successful spam snap returns native horizontal-plane request for the world gate", async () => {
  const { system } = await fixture(1, 4);
  system.componentLevels.fill(40);
  system.damageContext.random = () => 0.5;
  const result = system.spamModel(1, 0);
  assert.ok(result.splitRequest);
  near(result.splitRequest.normal.x, 0);
  near(result.splitRequest.normal.y, 0);
  near(result.splitRequest.normal.z, -1);
  near(result.splitRequest.constant, 0);
  assert.equal(result.bendCase, undefined);
  assert.equal(
    system.snapped,
    false,
    "simulation validates source world-edge gate before splitAtPlane",
  );
  assert.ok(system.componentLevels.every((level) => level === 40));
});

for (const name of ["EAGLE3", "buggy"]) {
  test(`stock ${name} spam retains localized bodywork/hull deformation and unchanged component damage`, async (t) => {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") return t.skip("Original assets absent");
      throw error;
    }
    const system = new DamageSystem(data.assets, data.group, data.text);
    await system.init();
    const mechanics = parseCarMechanics(data.text);
    const shapes = mechanics.shapes.map((shape) =>
      shape.vertices.map((point) => new Vector3(...point)),
    );
    system.configurePhysics(mechanics, shapes);
    let seed = 12345;
    system.damageContext.random = () => {
      seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
      return ((seed >>> 16) & 32767) / 32768;
    };
    const snapshots = [];
    data.group.traverse((object) => {
      if (object.isMesh)
        snapshots.push([
          object,
          Array.from(object.geometry.attributes.position.array),
        ]);
    });
    const before = shapes.flat().map((point) => point.clone());
    const result = system.spamModel(1, 2000);
    assert.equal(result.rays.length, 10);
    assert.ok(result.maxInfluence > 0);
    let moved = 0,
      unchanged = 0;
    for (const [mesh, saved] of snapshots) {
      Array.from(mesh.geometry.attributes.position.array).forEach(
        (value, i) => {
          if (value !== saved[i]) moved++;
          else unchanged++;
        },
      );
    }
    assert.ok(moved > 0 && unchanged > 0);
    assert.ok(shapes.flat().some((point, i) => !point.equals(before[i])));
    assert.ok(system.componentLevels.every((value) => value === 0));
    assert.ok(system.pendingShapeSwapFlags & 7);
    shapes.forEach((points) => {
      const hull = buildHull(points);
      assert.ok(hull.faces.length >= 4 && hull.edges.length >= 6);
      assert.ok(
        hull.faces.every(
          (face) =>
            Number.isFinite(face.constant) &&
            Math.abs(face.normal.length() - 1) < 1e-6,
        ),
      );
    });
    assert.ok(result.detachedParts.length > 0);
    for (const part of result.detachedParts) {
      assert.equal(part.forcedFullDetach, true);
      assert.equal(part.state.queuedAt, 2000);
      near(part.detachmentVelocityKick.length(), 8 / 6.9);
    }
    const firstRevision = system.deformationRevision;
    system.spamModel(1, 2500);
    assert.ok(system.deformationRevision > firstRevision);
    assert.ok(system.componentLevels.every((value) => value === 0));
    system.repair();
    assert.ok(
      system.runtimeParts.every(
        (part) => !part.forcedFullDetach && !part.detachmentVelocityKick,
      ),
    );
    assert.deepEqual(
      shapes.flat().map((point) => point.toArray()),
      before.map((point) => point.toArray()),
    );
  });
}

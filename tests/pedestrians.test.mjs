import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { Assets } from "../src/content.ts";
import {
  PedestrianSystem,
  parsePedSpawnSpecs,
  parsePedGroups,
  parsePedMotion,
} from "../src/pedestrians.ts";
import { createAssetStore } from "../server/assets.mjs";
import { WorldCollision } from "../src/world.ts";

const spawnText = "// Ped specs\n1\nsidewalk\n0\n0\n2\n1\n1\nroad\n1\ngarden\n";
test("pedestrian config reads material density, exclusions, exceptions and personality groups", () => {
  assert.deepEqual(parsePedSpawnSpecs(spawnText), [
    {
      material: "sidewalk",
      movement: 0,
      group: 0,
      density: 2,
      exclusions: ["road"],
      exclusionFlags: [1],
      exceptions: ["garden"],
    },
  ]);
  const groups = parsePedGroups(
    "// Group #0\n2\nAlice\nBob\n// Group #1\n1\nCharlie\n",
  );
  assert.deepEqual(groups.get(0), ["Alice", "Bob"]);
  assert.deepEqual(groups.get(1), ["Charlie"]);
  assert.throws(
    () => parsePedSpawnSpecs("// Ped specs\n50000"),
    /config count/,
  );
});

function triangleFloor() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-10, 0, -10, 0, 0, 10, 10, 0, -10], 3),
  );
  const material = new THREE.MeshBasicMaterial();
  material.name = "sidewalk";
  return new THREE.Mesh(geometry, material);
}
test("pedestrian population uses matching surfaces, swept hits pay once, reset and disposal work", async () => {
  const prototype = new THREE.Group();
  prototype.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.06),
      new THREE.MeshBasicMaterial(),
    ),
  );
  const assets = {
    manifest: [{ path: "data/PEDS/PEEPS/Alice/Alice.act", size: 1000 }],
    async text() {
      return "// Group #0\n1\nAlice\n";
    },
    async scene() {
      return { group: prototype.clone(true) };
    },
  };
  const events = [];
  const peds = await PedestrianSystem.create(
    assets,
    triangleFloor(),
    spawnText,
    () => 0,
    { spawn: new THREE.Vector3(), maxCount: 3, onHit: (e) => events.push(e) },
  );
  assert.equal(peds.count, 3);
  assert.equal(peds.hits, 0);
  const target = peds.group.children[0].position.clone();
  peds.update(0, { position: target, yaw: 0, speed: 3 });
  assert.ok(events.length >= 1);
  assert.equal(events[0].count, 1);
  assert.equal(events[0].total, 1);
  const hits = peds.hits;
  peds.update(0, { position: target, yaw: 0, speed: 3 });
  assert.equal(peds.hits, hits);
  peds.reset();
  assert.equal(peds.hits, 0);
  assert.equal(peds.alive, 3);
  peds.dispose();
  assert.equal(peds.count, 0);
  assert.equal(peds.group.children.length, 0);
});

let originalsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalsAvailable = false;
}
test(
  "read-only original pedestrian smoke: textured New City personalities and BON/SKL motions",
  { skip: !originalsAvailable },
  async () => {
    const store = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (path) => {
      const bytes = await store.read(path);
      assert.ok(bytes, path);
      return bytes;
    };
    const config = await assets.text("data/RACES/newcity1/newcity1.txt");
    const specs = parsePedSpawnSpecs(config);
    assert.equal(specs.length, 9);
    assert.equal(specs[0].material, "crossing");
    assert.equal(specs[0].group, 63);
    const groups = parsePedGroups(await assets.text("data/PEDS/settings.txt"));
    assert.ok(groups.get(63).some((name) => name.toUpperCase() === "HOLIDAHE"));
    const walk = parsePedMotion(
      await assets.bytes("data/PEDS/MOVES/walk_normal_male.SKL"),
    );
    assert.equal(walk.bones.length, 25);
    assert.equal(walk.frameCount, 30);
    assert.ok(walk.bones.some((bone) => bone.name === "Bip01 Spine"));
    const dog = parsePedMotion(
      await assets.bytes("data/PEDS/MOVES/DogWalk.BON"),
    );
    assert.equal(dog.bones.length, 39);
    assert.equal(dog.frameCount, 32);
    const walkBytes = await assets.bytes(
      "data/PEDS/MOVES/walk_normal_male.SKL",
    );
    assert.throws(
      () => parsePedMotion(walkBytes.subarray(0, 100)),
      /Truncated/,
    );
    const world = await assets.scene("data/RACES/newcity1", "newcity1");
    const collision = new WorldCollision(world.group);
    const peds = await PedestrianSystem.create(
      assets,
      world.group,
      config,
      (x, z, y) => collision.height(x, z, y),
      { spawn: new THREE.Vector3(54.061, 0.825, 23.629), maxCount: 30 },
    );
    assert.equal(peds.count, 30, peds.warnings.join("\n"));
    let texturedMeshes = 0;
    peds.group.traverse((o) => {
      if (
        o instanceof THREE.Mesh &&
        (Array.isArray(o.material) ? o.material : [o.material]).some(
          (m) => m.map,
        )
      )
        texturedMeshes++;
    });
    assert.ok(
      texturedMeshes > 100,
      `${texturedMeshes} original textured parts`,
    );
    assert.ok(
      peds.group.children.some((p) =>
        /holidahe|spec|oscar|cityswat|bismanbm/i.test(p.name),
      ),
    );
    const positions = peds.group.children.map((p) => p.position.clone());
    peds.update(
      0.1,
      {
        position: new THREE.Vector3(54.061, 0.825, 23.629),
        yaw: 0,
        speed: 0,
      },
      { cameraPosition: positions[0] },
    );
    assert.ok(
      peds.group.children.some(
        (p, i) => p.position.distanceTo(positions[i]) > 0,
      ),
    );
    peds.dispose();
  },
);

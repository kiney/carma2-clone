import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { PedestrianSystem, parsePedGroups } from "../src/pedestrians.ts";

let storePromise;
async function originalAssets(t) {
  try {
    storePromise ??= createAssetStore(
      process.env.CARMA2_ROOT ??
        new URL("../carma2_orig/", import.meta.url).pathname,
    );
    const store = await storePromise;
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
    );
    assets.bytes = async (path) => {
      const bytes = await store.read(path);
      if (!bytes) throw new Error(`Asset missing: ${path}`);
      return new Uint8Array(bytes);
    };
    return assets;
  } catch (error) {
    if (
      error?.code === "ENOENT" ||
      /Original installation/.test(String(error))
    ) {
      t.skip("Original installation unavailable");
      return null;
    }
    throw error;
  }
}

function ground() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-10, 0, -10, 0, 0, 10, 10, 0, -10], 3),
  );
  const material = new THREE.MeshBasicMaterial();
  material.name = "sidewalk";
  return new THREE.Mesh(geometry, material);
}

function matrices(presentation) {
  presentation.group.updateMatrixWorld(true);
  return presentation.instance.bones.map((bone) => [
    ...bone.actor.matrixWorld.elements,
  ]);
}

for (const dataRoot of ["data", "adv_data"]) {
  test(`${dataRoot} population uses native CitySwat presentation and ordinary reset lifecycle`, async (t) => {
    const assets = await originalAssets(t);
    if (!assets) return;
    let settings;
    try {
      settings = await assets.text(`${dataRoot}/PEDS/settings.txt`);
    } catch (error) {
      if (/Asset missing/.test(String(error))) {
        t.skip(`${dataRoot} CitySwat source assets unavailable`);
        return;
      }
      throw error;
    }
    const groupId = [...parsePedGroups(settings)].find(([, names]) =>
      names.some((name) => name.toLowerCase() === "cityswat"),
    )?.[0];
    assert.notEqual(
      groupId,
      undefined,
      `${dataRoot} settings should assign CitySwat to a pedestrian group`,
    );
    let countEvents = 0;
    const peds = await PedestrianSystem.create(
      assets,
      ground(),
      `// Ped specs\n1\nsidewalk\n0\n${groupId}\n1\n0\n0\n`,
      () => 0,
      {
        dataRoot,
        spawn: new THREE.Vector3(),
        maxCount: 1,
        random: () => 0.5,
        onCount: () => countEvents++,
      },
    );
    t.after(() => peds.dispose());
    assert.equal(peds.count, 1);
    const actor = peds.group.children[0];
    const record = peds.peds[0];
    const presentation = record.presentation;
    assert.ok(presentation, "Assets instance should use native presentation");
    assert.equal(
      presentation.template.profile.formName.toLowerCase(),
      "biped1",
    );
    assert.equal(
      presentation.moveSlot,
      15,
      "CitySwat should select authored move 30",
    );
    assert.ok(
      presentation.instance.bones[0].actor.matrix.elements[1] > 0.99,
      "the humanoid MODEL long local X axis is upright through its original root frame",
    );

    const before = matrices(presentation);
    actor.position.set(3, 0, 4);
    actor.rotation.y = 0.7;
    actor.updateMatrixWorld(true);
    presentation.update({
      parent: actor,
      worldPosition: actor.position,
      heading: 0.7,
      groundY: actor.position.y,
      moveId: record.moveId,
      periodMs: record.walkPeriod,
      timeMs: 1033,
      alive: true,
    });
    const after = matrices(presentation);
    assert.notDeepEqual(
      after[0],
      before[0],
      "root world matrix should follow gameplay translation and heading",
    );
    assert.notDeepEqual(
      after[1],
      before[1],
      "child world matrix should retain authored animation under the parent",
    );
    assert.ok(Math.abs(after[0][12] - 3) < 1e-5);
    assert.ok(Math.abs(after[0][14] - 4) < 1e-5);
    assert.ok(
      Math.abs(presentation.group.matrixWorld.elements[12]) < 1e-5,
      "presentation parent compensation must avoid double translation",
    );

    // Ordinary vehicle sweep owns legacy death. The native renderer keeps its
    // visible corpse coherent, then reset restores its authored standing pose.
    const start = actor.position.clone().add(new THREE.Vector3(-2, 0, 0));
    peds.previousCar.copy(start);
    peds.update(
      0,
      {
        position: actor.position.clone().add(new THREE.Vector3(2, 0, 0)),
        yaw: 0,
        speed: 2,
      },
      {
        gameTimeMs: 1100,
        cameraPosition: actor.position.clone(),
      },
    );
    assert.equal(peds.hits, 1);
    assert.equal(countEvents, 1);
    assert.equal(record.alive, false);
    assert.equal(actor.visible, true);
    assert.ok(
      matrices(presentation).every((matrix) => matrix.every(Number.isFinite)),
    );
    peds.reset();
    assert.equal(peds.hits, 0);
    assert.equal(peds.alive, 1);
    assert.equal(record.alive, true);
    assert.equal(presentation.moveSlot, 15);
    assert.ok(presentation.instance.bones[0].actor.matrix.elements[1] > 0.99);
  });
}

test("stationary original dog uses authored multi-frame idle rather than period zero", async (t) => {
  const assets = await originalAssets(t);
  if (!assets) return;
  const text = assets.text.bind(assets);
  // Controlled population membership, original personality/FORM/BON resources.
  assets.text = async (path) =>
    path.toLowerCase() === "data/peds/settings.txt"
      ? `${await text(path)}\n// Group #0\n1\ntwolf\n`
      : text(path);
  const peds = await PedestrianSystem.create(
    assets,
    ground(),
    "// Ped specs\n1\nsidewalk\n0\n0\n1\n0\n0\n",
    () => 0,
    { spawn: new THREE.Vector3(), maxCount: 1, random: () => 0.5 },
  );
  t.after(() => peds.dispose());
  assert.equal(peds.count, 1);
  const ped = peds.peds[0];
  assert.equal(ped.presentation.template.profile.formName, "DOG1");
  ped.walkPeriod = 0;
  ped.moveId = 0;
  const position = ped.object.position.clone();
  const threat = {
    position: position.clone().add(new THREE.Vector3(100, 0, 100)),
    yaw: 0,
    speed: 0,
  };
  peds.resetCar(threat.position);
  const update = (time) =>
    peds.update(0, threat, { gameTimeMs: time, cameraPosition: position });
  update(1000);
  assert.equal(ped.presentation.instance.clock.periodMs, 33);
  const frame = ped.presentation.instance.clock.frame;
  update(1033);
  assert.equal(ped.presentation.instance.clock.frame, (frame + 1) % 32);
  assert.deepEqual(
    ped.object.position.toArray(),
    position.toArray(),
    "idle playback adds no gameplay movement",
  );
});

test("mixed original population groups report missing personalities explicitly", async (t) => {
  const assets = await originalAssets(t);
  if (!assets) return;
  const text = assets.text.bind(assets);
  assets.text = async (path) =>
    path.toLowerCase() === "data/peds/settings.txt"
      ? `${await text(path)}\n// Group #0\n2\nCitySwat\nMissingTestPersonality\n`
      : text(path);
  const peds = await PedestrianSystem.create(
    assets,
    ground(),
    "// Ped specs\n1\nsidewalk\n0\n0\n1\n0\n0\n",
    () => 0,
    { spawn: new THREE.Vector3(), maxCount: 1, random: () => 0.5 },
  );
  t.after(() => peds.dispose());
  assert.equal(peds.count, 1);
  assert.equal(peds.populationFailures.length, 1);
  assert.equal(peds.populationFailures[0].group, 0);
  assert.match(peds.populationFailures[0].reason, /missingtestpersonality/i);
  assert.ok(
    peds.warnings.some((warning) => /MissingTestPersonality/.test(warning)),
  );
  assert.equal(peds.states[0].animation.source, "original-bon-skl");
});

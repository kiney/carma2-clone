import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import * as THREE from "three";
import {
  PedBloodRuntime,
  parsePedBloodSettings,
  pedBloodCloudIndex,
  pedGibletCount,
} from "../src/ped-blood.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import {
  PedestrianSystem,
  parsePedSpawnSpecs,
  collectPedSurfaces,
} from "../src/pedestrians.ts";
import { WorldCollision } from "../src/world.ts";

const group = (amount, scale) => ({
  amount,
  delaySeconds: [0, 0],
  offset: [0, 0, 0],
  xFactor: [0, 0.6],
  yFactor: [0, 0.6],
  zFactor: [0, 0.6],
  frameRate: [10, 10],
  scale,
  rotation: "randomrotate",
  frames: [1, 2, 3, 4, 5].map((i) => ({
    opacity: 100,
    pixelmap: `bigbl0${i}`,
  })),
});
const settings = {
  radius: 0.1,
  velocityFactor: 1,
  randomVelocity: 3,
  randomUp: 4,
  spin: 70,
  lifetimeMs: [500, 1500],
  sizes: [
    {
      minForce: 0.1,
      instanceForce: 0.1,
      maxCount: 1,
      models: [{ name: "chunk01", scale: 1, color: 0xff0000 }],
    },
    {
      minForce: 0.05,
      instanceForce: 0.05,
      maxCount: 2,
      models: [{ name: "chunk02", scale: 2, color: 0xff0000 }],
    },
    {
      minForce: 0.02,
      instanceForce: 0.02,
      maxCount: 3,
      models: [{ name: "chunk03", scale: 2, color: 0xff0000 }],
    },
    {
      minForce: 0.003,
      instanceForce: 0.006,
      maxCount: 6,
      models: [{ name: "chunk04", scale: 2, color: 0xff0000 }],
    },
    {
      minForce: 0.0002,
      instanceForce: 0.002,
      maxCount: 20,
      models: [{ name: "chunk05", scale: 1.05, color: 0xff0000 }],
    },
  ],
  clouds: [
    [group([1, 3], [2, 3])],
    [group([3, 6], [2.5, 4])],
    [group([6, 10], [3, 5])],
  ],
  slick: {
    delayMs: 300,
    growth: [0.00001, 0.00007],
    initialSize: 0.001,
    fullSize: [0.05, 0.15],
    pixelmap: "gibslick",
  },
};
function runtime() {
  const textures = new Map(
    [...Array(5)].map((_, i) => [
      `bigbl0${i + 1}`,
      new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1),
    ]),
  );
  textures.set("gibslick", new THREE.Texture());
  textures.set("pedsmear", new THREE.Texture());
  const models = new Map(
    settings.sizes.flatMap((s) =>
      s.models.map((m) => [m.name, new THREE.BoxGeometry(0.005, 0.005, 0.005)]),
    ),
  );
  return new PedBloodRuntime(
    settings,
    () => 0,
    () => 0.25,
    textures,
    models,
  );
}
test("installed blood cloud thresholds are strict; force selects authored quantity and model sizes", () => {
  assert.equal(pedBloodCloudIndex(0.04999999), -1);
  assert.equal(pedBloodCloudIndex(0.05), 0);
  assert.equal(pedBloodCloudIndex(0.05001), 0);
  assert.equal(pedBloodCloudIndex(0.25), 0);
  assert.equal(pedBloodCloudIndex(0.25001), 1);
  assert.equal(pedBloodCloudIndex(0.5), 1);
  assert.equal(pedBloodCloudIndex(0.50001), 2);
  assert.deepEqual(
    settings.sizes.map((s) => pedGibletCount(0.06, s)),
    [0, 1, 3, 6, 20],
  );
  assert.deepEqual(
    settings.sizes.map((s) => pedGibletCount(1, s)),
    [1, 2, 3, 6, 20],
  );
  assert.equal(pedGibletCount(0.0499, settings.sizes[1]), 0);
  assert.equal(pedGibletCount(0.05, settings.sizes[1]), 1);
});
test("blood runtime renders source textures/chunks, expires clouds and giblets, and supports reset", () => {
  const effects = runtime(),
    bounds = new THREE.Box3(
      new THREE.Vector3(-0.1, -0.15, -0.04),
      new THREE.Vector3(0.1, 0.15, 0.04),
    ),
    p = new THREE.Vector3(0, 0.15, 0);
  effects.hit(p, bounds, new THREE.Vector3(1, 0, 0), 1, 1000);
  assert.equal(effects.stats.giblets, 32);
  assert.equal(effects.stats.clouds, 7);
  assert.equal(
    effects.group.children.filter((c) => c.name === "original-ped-giblet")
      .length,
    32,
  );
  assert.equal(
    effects.group.children
      .find((c) => c.name === "original-ped-giblet")
      .material.color.getHex(),
    0xff0000,
  );
  effects.update(0.1, 1600);
  assert.equal(effects.stats.clouds, 0);
  effects.update(0.1, 2501);
  assert.equal(effects.stats.giblets, 0);
  effects.hit(p, bounds, new THREE.Vector3(), 1, 3000);
  effects.reset();
  assert.deepEqual(effects.stats, {
    clouds: 0,
    giblets: 0,
    slicks: 0,
    smears: 0,
  });
  effects.hit(p, bounds, new THREE.Vector3(), 1, 4000);
  assert.equal(effects.stats.clouds, 7);
  effects.dispose();
  assert.equal(effects.group.children.length, 0);
});
test("ground blood projects to native floor normals and slicks reject slopes below.97 upright", () => {
  let normal = new THREE.Vector3(0.1, 1, 0.1).normalize();
  const effects = new PedBloodRuntime(
    settings,
    () => 2,
    () => 0.25,
    new Map([
      ["gibslick", new THREE.Texture()],
      ["pedsmear", new THREE.Texture()],
    ]),
    new Map(),
    (p) => ({ position: new THREE.Vector3(p.x, 2, p.z), normal }),
  );
  effects.settled(new THREE.Vector3(1, 2, 1), 0);
  effects.smear(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 2, 1), 0.2);
  for (const mesh of effects.group.children) {
    assert.ok(
      new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).dot(normal) >
        1 - 1e-10,
    );
    assert.ok(
      mesh.position
        .clone()
        .sub(new THREE.Vector3(mesh.position.x, 2, mesh.position.z))
        .length() > 0,
    );
  }
  assert.equal(effects.stats.slicks, 1);
  normal = new THREE.Vector3(0.5, 1, 0).normalize();
  effects.settled(new THREE.Vector3(), 1000);
  assert.equal(effects.stats.slicks, 1);
  effects.dispose();
});
test("native blood slick delays/grows without invented fade, persistent pools replace32/100 entries", () => {
  const effects = runtime(),
    p = new THREE.Vector3();
  effects.settled(p, 1000);
  assert.equal(effects.stats.slicks, 1);
  const slick = effects.group.children[0];
  assert.equal(slick.visible, false);
  effects.update(0.1, 1300);
  assert.equal(slick.visible, true);
  assert.equal(slick.scale.x, 0.001);
  effects.update(0.1, 2300);
  assert.ok(Math.abs(slick.scale.x - 0.026) < 1e-12);
  effects.update(0.1, 1000000);
  assert.ok(Math.abs(slick.scale.x - 0.075) < 1e-12);
  assert.equal(slick.visible, true);
  for (let i = 0; i < 35; i++)
    effects.settled(new THREE.Vector3(i, 0, 0), 2000 + i);
  assert.equal(effects.stats.slicks, 32);
  assert.equal(slick.parent, null);
  for (let i = 0; i < 105; i++)
    effects.smear(
      new THREE.Vector3(i, 0, 0),
      new THREE.Vector3(i + 1, 0, 0),
      0.2,
    );
  assert.equal(effects.stats.smears, 100);
  effects.dispose();
});
let originals = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originals = false;
}
test(
  "read-only installed pedestrian blood settings and real original texture/geometry packages",
  { skip: !originals },
  async () => {
    const store = await createAssetStore(
        new URL("../carma2_orig", import.meta.url).pathname,
      ),
      assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (p) => {
      const b = await store.read(p);
      assert.ok(b, p);
      return b;
    };
    const parsed = parsePedBloodSettings(
      await assets.text("data/PEDS/settings.txt"),
    );
    assert.equal(parsed.sizes.length, 5);
    assert.equal(parsed.sizes[4].models[0].scale, 1.4 * 0.75);
    assert.deepEqual(parsed.lifetimeMs, [500, 1500]);
    assert.deepEqual(
      parsed.clouds.map((c) => c[0].amount),
      [
        [1, 3],
        [3, 6],
        [6, 10],
      ],
    );
    assert.deepEqual(
      parsed.clouds[0][0].frames.map((f) => f.pixelmap),
      ["bigbl01", "bigbl02", "bigbl03", "bigbl04", "bigbl05"],
    );
    const effects = await PedBloodRuntime.create(
      assets,
      parsed,
      () => 0,
      () => 0.25,
    );
    effects.hit(
      new THREE.Vector3(0, 0.15, 0),
      new THREE.Box3(
        new THREE.Vector3(-0.1, -0.15, -0.04),
        new THREE.Vector3(0.1, 0.15, 0.04),
      ),
      new THREE.Vector3(1, 0, 0),
      1,
      1000,
    );
    effects.update(0.1, 1200);
    assert.equal(effects.stats.giblets, 32);
    assert.ok(
      effects.group.children.some(
        (c) => c instanceof THREE.Sprite && /bigbl/i.test(c.material.map?.name),
      ),
    );
    assert.ok(
      effects.group.children.some(
        (c) =>
          c instanceof THREE.Mesh &&
          c.name === "original-ped-giblet" &&
          c.geometry.getAttribute("position").count > 3,
      ),
    );
    effects.dispose();
  },
);
test(
  "read-only full stock race populations and all native personality groups on three levels",
  { skip: !originals },
  async () => {
    const store = await createAssetStore(
        new URL("../carma2_orig", import.meta.url).pathname,
      ),
      assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (p) => {
      const b = await store.read(p);
      assert.ok(b, p);
      return b;
    };
    for (const stem of ["newcity1", "airport1", "carrier1"]) {
      const config = await assets.text(`data/RACES/${stem}/${stem}.txt`),
        world = await assets.scene(`data/RACES/${stem}`, stem),
        collision = new WorldCollision(world.group),
        specs = parsePedSpawnSpecs(config),
        surfaces = collectPedSurfaces(world.group, specs),
        expected = Math.min(
          2000,
          surfaces.reduce((n, s) => n + s.count, 0),
        );
      const peds = await PedestrianSystem.create(
        assets,
        world.group,
        config,
        (x, z, y) => collision.height(x, z, y),
        { spawn: new THREE.Vector3(), collision },
      );
      assert.equal(
        peds.count,
        expected,
        `${stem}: ${peds.warnings.join("\n")}`,
      );
      assert.ok(expected > 80, `${stem}: population${expected}`);
      if (stem === "newcity1") assert.equal(peds.count, 791);
      const expectedGroups = new Map();
      let remaining = 2000;
      for (const surface of surfaces) {
        const count = Math.min(remaining, surface.count);
        expectedGroups.set(
          surface.spec.group,
          (expectedGroups.get(surface.spec.group) ?? 0) + count,
        );
        remaining -= count;
        if (!remaining) break;
      }
      for (const [group, count] of expectedGroups)
        assert.equal(
          peds.groupCounts.get(group)?.total,
          count,
          `${stem}:group${group}`,
        );
      assert.ok(peds.bloodStats);
      assert.equal(
        peds.warnings.length,
        0,
        `${stem}: ${peds.warnings.join("\n")}`,
      );
      peds.dispose();
    }
  },
);

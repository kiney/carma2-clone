import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Box3, DataTexture, Group, Quaternion, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parsePix } from "../src/formats.ts";
import {
  EXPLOSION_CAPACITY,
  ExplosionRuntime,
  parseWastedExplosionSettings,
} from "../src/explosion.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const bounds = new Box3(v(-9, -8, -7), v(2, 3, 4));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
function group(overrides = {}) {
  return {
    amount: [1, 1],
    delaySeconds: [0, 0],
    offset: [0, 0.25, 0],
    xFactor: [0, 0],
    yFactor: [0, 0],
    zFactor: [0, 0],
    frameRate: [8, 8],
    scale: [6.9, 6.9],
    rotation: "norotate",
    frames: [
      { opacity: 50, pixelmap: "EX00001" },
      { opacity: 25, pixelmap: "EX00002" },
    ],
    ...overrides,
  };
}
function texture(width = 128, height = 128) {
  return new DataTexture(new Uint8Array(width * height * 4), width, height);
}
function setup(random = () => 0.5) {
  const scene = new Group(),
    a = texture(64, 32),
    b = texture(128, 64);
  const maps = new Map([
    ["EX00001.PIX", a],
    ["data/COMMON/boom/ex00002.pix", b],
  ]);
  return {
    scene,
    a,
    b,
    maps,
    runtime: new ExplosionRuntime(scene, maps, { random }),
  };
}
function block(g = group()) {
  return `// Wasted explosion settings\n100\n5400\nBOOM.PIX\n1\n${g.amount}\n${g.delaySeconds}\n${g.offset}\n${g.xFactor}\n${g.yFactor}\n${g.zFactor}\n${g.frameRate}\n${g.scale}\n${g.rotation}\n${g.frames.length}\n${g.frames.map((f) => `${f.opacity}\n${f.pixelmap}`).join("\n")}\n// following unrelated GENERAL section\n999`;
}

test("marked GENERAL explosion parser preserves authored frames and validates source bounds", () => {
  const settings = parseWastedExplosionSettings(block());
  assert.equal(settings.chancePercent, 100);
  assert.equal(settings.soundId, 5400);
  assert.equal(settings.pixelmapFile, "BOOM.PIX");
  assert.deepEqual(settings.groups, [group()]);
  for (const text of [
    "",
    block().replace("\n1\n1,1", "\n65\n1,1"),
    block(group({ amount: [-1, 2] })),
    block(group({ amount: [1.5, 2] })),
    block(group({ delaySeconds: [0, 33] })),
    block(group({ frameRate: [0, 8] })),
    block(group({ rotation: "spin" })),
    block(group({ frames: Array(11).fill({ opacity: 100, pixelmap: "A" }) })),
    block().replace("\n50\nEX00001", "\nNaN\nEX00001"),
    block().slice(0, block().indexOf("EX00002")),
  ])
    assert.throws(() => parseWastedExplosionSettings(text), /explosion/i);
});

test("source frame periods, full opacity, PIX sizing and native billboard UV", () => {
  const { runtime, scene, a, b } = setup();
  assert.equal(
    runtime.spawn([group()], v(1, 2, 3), bounds, 1000, v(0, -0.25, 0)),
    1,
  );
  const sprite = scene.children[0];
  assert.equal(sprite.material.map, a);
  assert.equal(
    sprite.material.opacity,
    1,
    "0x4ee672 replaces authored50 with100",
  );
  assert.deepEqual(sprite.position.toArray(), [1, 2, 3]);
  assert.deepEqual(sprite.scale.toArray(), [0.5, 0.25, 1]);
  assert.deepEqual(
    [...sprite.geometry.getAttribute("uv").array],
    [0, 1, 0, 0, 1, 0, 1, 1],
  );
  runtime.update(1124);
  assert.equal(sprite.material.map, a);
  runtime.update(1125);
  assert.equal(sprite.material.map, b);
  assert.deepEqual(sprite.scale.toArray(), [1, 0.5, 1]);
  runtime.update(1249);
  assert.equal(runtime.activeCount, 1);
  runtime.update(1250);
  assert.equal(runtime.activeCount, 0);
  assert.equal(scene.children.length, 0);
  runtime.dispose();
});

test("delays are integer milliseconds and source descending period sampling is retained", () => {
  const { runtime, scene, a, b } = setup();
  runtime.spawn(
    [group({ delaySeconds: [0.1, 0.3], frameRate: [7, 11] })],
    v(),
    bounds,
    0,
  );
  const sprite = scene.children[0];
  assert.equal(sprite.visible, false);
  // rand midpoint: delay100+floor(201*.5)=200; period142-trunc(51*.5)=117.
  runtime.update(199);
  assert.equal(sprite.visible, false);
  runtime.update(200);
  assert.equal(sprite.visible, true);
  runtime.update(316);
  assert.equal(sprite.material.map, a);
  runtime.update(317);
  assert.equal(sprite.material.map, b);
  runtime.update(434);
  assert.equal(runtime.activeCount, 0);
  runtime.dispose();
});

test("native position sample uses maximum coordinates and independent sign calls", () => {
  // amount; x magnitude/sign; y magnitude/sign; z magnitude/sign;
  // rotation; scale; period; delay, in exact native call order.
  const samples = [0, 0.5, 0, 0.5, 0.999, 0.5, 0, 0.25, 0.5, 0.5, 0.5];
  let calls = 0;
  const { runtime, scene } = setup(() => samples[calls++]);
  const orientation = new Quaternion().setFromAxisAngle(
    v(0, 1, 0),
    Math.PI / 2,
  );
  const position = v(10, 20, 30);
  runtime.spawn(
    [
      group({
        xFactor: [0.2, 0.6],
        yFactor: [0.2, 0.6],
        zFactor: [0.2, 0.6],
        rotation: "randomrotate",
      }),
    ],
    position,
    bounds,
    1000,
    v(0, -0.25, 0),
    orientation,
  );
  const sprite = scene.children[0];
  assert.equal(calls, 11);
  near(sprite.position.x, 11.6);
  near(sprite.position.y, 18.8);
  near(sprite.position.z, 29.2);
  near(sprite.material.rotation, Math.PI / 2);
  position.x = 15;
  runtime.update(1001);
  near(sprite.position.x, 16.6);
  runtime.dispose();
});

test("native 50-entry capacity never evicts active sprites and finished slots recycle", () => {
  let randomCalls = 0;
  const { runtime, scene, maps } = setup(() => {
    randomCalls++;
    return 0.5;
  });
  const many = group({ amount: [32767, 32767] });
  assert.equal(runtime.spawn([many], v(), bounds, 1000), EXPLOSION_CAPACITY);
  // norotate uses9 calls per candidate, plus the group count draw. The native
  // full-pool return still consumes the complete51st candidate.
  assert.equal(randomCalls, 1 + 51 * 9);
  assert.equal(scene.children.filter((sprite) => sprite.visible).length, 50);
  assert.equal(runtime.spawn([group()], v(), bounds, 1001), 0);
  assert.equal(scene.children.length, 50);
  runtime.update(1250);
  assert.equal(scene.children.length, 0);
  assert.equal(runtime.spawn([group()], v(), bounds, 1250), 1);
  let disposed = 0;
  scene.children[0].material.addEventListener("dispose", () => disposed++);
  let mapDisposed = 0;
  for (const tex of maps.values())
    tex.addEventListener("dispose", () => mapDisposed++);
  runtime.dispose();
  assert.equal(disposed, 1);
  assert.equal(mapDisposed, 0);
});

test("missing frame maps hide just that frame and still expire", () => {
  const { runtime, scene } = setup();
  runtime.spawn(
    [
      group({
        frames: [
          { opacity: 100, pixelmap: "MISSING" },
          { opacity: 0, pixelmap: "EX00002" },
        ],
      }),
    ],
    v(),
    bounds,
    0,
  );
  assert.equal(scene.children[0].visible, false);
  runtime.update(125);
  assert.equal(scene.children[0].visible, true);
  assert.equal(scene.children[0].material.opacity, 1);
  runtime.update(250);
  assert.equal(runtime.activeCount, 0);
  runtime.dispose();
});

test(
  "archived GENERAL supplies original three BOOM groups and original PIX frames",
  { skip: !existsSync(new URL("../carma2_orig/data.twt", import.meta.url)) },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const settings = parseWastedExplosionSettings(
      decodeText(await assets.read("data/general.txt")),
    );
    assert.equal(settings.soundId, 5400);
    assert.equal(settings.chancePercent, 100);
    assert.equal(settings.groups.length, 3);
    assert.deepEqual(
      settings.groups.map((g) => g.amount),
      [
        [1, 1],
        [8, 8],
        [5, 15],
      ],
    );
    assert.deepEqual(
      settings.groups.map((g) => g.delaySeconds),
      [
        [0, 0],
        [0.1, 0.3],
        [0.15, 0.6],
      ],
    );
    assert.deepEqual(
      settings.groups.map((g) => g.scale),
      [
        [15, 15],
        [7, 9],
        [4, 6],
      ],
    );
    assert.deepEqual(
      settings.groups[0].frames.map((f) => f.opacity),
      [50, 75, 75, 100, 100, 50, 25],
    );
    const maps = new Map();
    for (const frame of settings.groups[0].frames) {
      const entry = assets.manifest.find(
        (e) =>
          e.path.toLowerCase() ===
          `data/common/boom/pix8/${frame.pixelmap}.pix`,
      );
      assert.ok(entry, frame.pixelmap);
      const map = parsePix(await assets.read(entry.path))[0];
      assert.ok(map.width > 0 && map.height > 0);
      maps.set(
        frame.pixelmap,
        new DataTexture(map.rgba, map.width, map.height),
      );
    }
    const scene = new Group(),
      runtime = new ExplosionRuntime(scene, maps, { random: () => 0.5 });
    assert.equal(
      runtime.spawn(settings.groups, v(), bounds, 1000, v(0, -0.25, 0)),
      19,
    );
    assert.equal(runtime.activeCount, 19);
    assert.equal(scene.children.filter((c) => c.visible).length, 1);
    runtime.update(3000);
    assert.equal(runtime.activeCount, 0);
    runtime.dispose();
  },
);

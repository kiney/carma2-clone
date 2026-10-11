import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SmokeSystem, surfaceSmokePuff } from "../src/smoke.ts";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parsePix } from "../src/formats.ts";
import { NativeRandom, sharedNativeRandom } from "../src/native-random.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const f = Math.fround;
const actor = () =>
  new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute([1, 2, 3], 3),
    ),
  );
const column = (a = actor(), lifetimeMs = 25000) => ({
  mode: 2,
  actor: a,
  colour: 0,
  vertex: 0,
  lifetimeMs,
});
const puff = (position = v(), extra = {}) => ({
  position,
  velocity: v(),
  strength: 1,
  decay: 1,
  type: 16,
  ...extra,
});
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("split column and puff phases match composed update without duplicate advancement", () => {
  const combinedRandom = new NativeRandom(901),
    splitRandom = new NativeRandom(901);
  const combined = new SmokeSystem(undefined, {
      random: combinedRandom.random,
    }),
    split = new SmokeSystem(undefined, { random: splitRandom.random });
  for (const smoke of [combined, split]) {
    smoke.spawnColumn(column(actor(), 280));
    smoke.spawnPuff(puff(v(), { velocity: v(1, 0, 0), type: 7 }));
  }
  for (let frame = 1; frame <= 9; frame++) {
    combined.update(frame * 40, 40);
    split.updateColumns(frame * 40, 40);
    const columnsBeforeRender = split.snapshot().columns;
    split.updatePuffs(frame * 40, 40);
    assert.deepEqual(split.snapshot().columns, columnsBeforeRender);
    assert.deepEqual(split.snapshot(), combined.snapshot());
    assert.equal(splitRandom.state, combinedRandom.state);
  }
  combined.dispose();
  split.dispose();
});

test("split phases preserve the production CRT save-sample and reseed sequence", () => {
  const originalState = sharedNativeRandom.state;
  const run = (split) => {
    sharedNativeRandom.seed(803);
    const smoke = new SmokeSystem();
    smoke.spawnColumn(column());
    smoke.spawnPuff(puff(v(), { type: 7 }));
    for (let frame = 1; frame <= 7; frame++) {
      if (split) {
        smoke.updateColumns(frame * 40, 40);
        smoke.updatePuffs(frame * 40, 40);
      } else smoke.update(frame * 40, 40);
    }
    const result = {
      snapshot: smoke.snapshot(),
      state: sharedNativeRandom.state,
    };
    smoke.dispose();
    return result;
  };
  try {
    assert.deepEqual(run(true), run(false));
  } finally {
    sharedNativeRandom.seed(originalState);
  }
});

test("final-flush arrivals advance puffs but leave new columns until the next producer phase", () => {
  const smoke = new SmokeSystem(undefined, { random: () => 0 });
  smoke.updateColumns(40, 40);
  // Models a source emitted by the final smash flush, between producer/render.
  const id = smoke.spawnColumn(column(actor(), 120));
  const puffId = smoke.spawnPuff(
    puff(v(), { velocity: v(2, 0, 0), type: 7, timeSyncMs: 1 }),
  );
  const newPuff = smoke.snapshot().puffs[puffId];
  smoke.updatePuffs(40, 40);
  let snapshot = smoke.snapshot();
  assert.equal(snapshot.columns[id].remaining, 120);
  assert.equal(snapshot.columns[id].time, 0);
  const firstPosition = f(newPuff.position.x + newPuff.velocity.x * f(0.001));
  close(snapshot.puffs[puffId].position.x, firstPosition);
  assert.equal(snapshot.puffs[puffId].timeSync, 0);
  close(snapshot.puffs[puffId].strength, f(newPuff.strength - 40 * f(0.001)));
  smoke.updateColumns(80, 40);
  snapshot = smoke.snapshot();
  assert.equal(snapshot.columns[id].remaining, 80);
  assert.equal(snapshot.columns[id].time, 40);
  close(snapshot.puffs[puffId].position.x, firstPosition);
  smoke.dispose();
});

test("native 10-column and 25-puff cursors overwrite active records and survive clear", () => {
  const smoke = new SmokeSystem(undefined, { random: () => 0 });
  for (let i = 0; i < 11; i++)
    assert.equal(
      smoke.spawnColumn({
        ...column(),
        vertex: i,
        sampleVertex: (index, out) => {
          out.set(index, 0, 0);
          return true;
        },
      }),
      i % 10,
    );
  assert.equal(smoke.stats.columns, 10);
  assert.equal(smoke.stats.columnOverwrites, 1);
  assert.equal(smoke.snapshot().columns[0].vertex, 10);
  for (let i = 0; i < 26; i++)
    assert.equal(smoke.spawnPuff(puff(v(i, 0, 0))), i % 25);
  assert.equal(smoke.stats.puffs, 25);
  assert.equal(smoke.stats.puffOverwrites, 1);
  assert.equal(smoke.snapshot().puffs[0].position.x, 25);
  smoke.clear();
  assert.equal(smoke.stats.puffs, 0);
  assert.equal(smoke.spawnPuff(puff()), 1);
  assert.equal(smoke.spawnColumn(column()), 1);
  smoke.dispose();
  assert.equal(smoke.group.children.length, 0);
  assert.equal(smoke.spawnColumn(column()), null);
});

test("live source vertices and actor transforms move a mode-2 fire attachment", () => {
  const smoke = new SmokeSystem(undefined, { random: () => 0 });
  const a = actor();
  a.position.set(10, 20, 30);
  smoke.spawnColumn(column(a));
  smoke.update(40, 40);
  assert.deepEqual(smoke.snapshot().columns[0].position.toArray(), [
    11,
    f(22 - f(0.03)),
    33,
  ]);
  a.geometry.getAttribute("position").setXYZ(0, 4, 5, 6);
  a.position.x = 100;
  smoke.update(80, 40);
  assert.deepEqual(smoke.snapshot().columns[0].position.toArray(), [
    104,
    f(25 - f(0.03)),
    36,
  ]);
  smoke.spawnColumn({ ...column(), vertex: 1 });
  smoke.update(120, 40);
  assert.equal(smoke.snapshot().columns[1].active, false);
  assert.match(smoke.diagnostics.join(), /vertex unavailable/);
  smoke.dispose();
});

test("column lifetime equality updates once, accumulator emits each frame after warmup", () => {
  const smoke = new SmokeSystem(undefined, { random: () => 0.5 });
  smoke.spawnColumn({ ...column(), colour: 1 });
  for (let n = 1; n <= 5; n++) smoke.update(n * 40, 40);
  assert.equal(smoke.stats.puffs, 0);
  smoke.update(240, 40);
  assert.equal(smoke.stats.puffs, 1);
  smoke.update(280, 40);
  assert.equal(smoke.stats.puffs, 2);
  assert.equal(smoke.snapshot().columns[0].time, 200);
  assert.equal(smoke.snapshot().columns[0].count, 2);
  assert.equal(smoke.snapshot().columns[0].whiter, -1);
  const short = smoke.spawnColumn({ ...column(undefined, 40), colour: 1 });
  smoke.update(320, 40);
  assert.equal(smoke.snapshot().columns[short].active, true);
  assert.equal(smoke.snapshot().columns[short].remaining, 0);
  smoke.update(360, 40);
  assert.equal(smoke.snapshot().columns[short].active, false);
  // Neither field is reset on a recycled native slot.
  for (let n = 0; n < 9; n++) smoke.spawnColumn(column());
  smoke.spawnColumn(column());
  assert.equal(smoke.snapshot().columns[0].count, 4);
  assert.equal(smoke.snapshot().columns[0].whiter, -1);
  smoke.dispose();
});

test("puff initialization has native positive Y offsets and physics-sync duration", () => {
  const smoke = new SmokeSystem();
  smoke.spawnPuff(
    puff(v(1, 2, 3), {
      velocity: v(6.9, 0, -6.9),
      strength: 2,
      timeSyncMs: 10,
    }),
  );
  const initial = smoke.snapshot().puffs[0];
  assert.equal(initial.strength, 1);
  assert.equal(initial.radius, f(0.05));
  close(initial.position.y, 2.08);
  close(initial.velocity.x, 1);
  close(initial.velocity.y, 1 / 6.9);
  close(initial.velocity.z, -1);
  smoke.update(100, 40);
  const updated = smoke.snapshot().puffs[0];
  close(updated.position.x, 1.01);
  close(updated.position.z, 2.99);
  close(updated.position.y, 2.08 + 0.01 / 6.9);
  close(updated.strength, 0.46);
  close(updated.radius, 0.06);
  assert.equal(updated.timeSync, 0);
  assert.equal(updated.velocity.y, f(0.43478259));
  const glow = smoke.spawnPuff(puff(v(), { type: 7 }));
  assert.equal(smoke.snapshot().puffs[glow].radius, f(0.1));
  assert.equal(smoke.snapshot().puffs[glow].position.y, f(0.04));
  smoke.dispose();
});

test("native non-lonely quirk pairs arbitrarily distant active puffs", () => {
  const smoke = new SmokeSystem();
  smoke.spawnPuff(puff(v(-1000, 0, 0)));
  smoke.spawnPuff(puff(v(1000, 0, 0)));
  smoke.update(40, 40);
  for (const p of smoke.snapshot().puffs.slice(0, 2)) {
    close(p.strength, 0.96);
    close(p.radius, 0.07);
  }
  smoke.dispose();
});

test("camera range rejects before allocating and includes exact 25-unit boundary", () => {
  const camera = new THREE.PerspectiveCamera(),
    smoke = new SmokeSystem(undefined, { camera });
  assert.equal(smoke.spawnPuff(puff(v(25, 0, 0))), 0);
  assert.equal(smoke.spawnPuff(puff(v(25.01, 0, 0))), null);
  assert.equal(smoke.stats.puffCursor, 1);
  assert.equal(smoke.stats.rejectedPuffs, 1);
  smoke.dispose();
});

test("flames increment by calls, use three independent native startup delays and speed gate", () => {
  const smoke = new SmokeSystem(undefined, { random: () => 0 });
  smoke.spawnColumn(column());
  smoke.spawnColumn({ ...column(), mode: 1, car: { velocity: v(4, 0, 0) } });
  for (let n = 1; n <= 6; n++) smoke.update(n * 40, 40);
  const snapshot = smoke.snapshot();
  assert.ok(
    snapshot.columns[0].flames.every(
      (flame) => flame.frame === 0 && flame.visible,
    ),
  );
  for (const flame of snapshot.columns[0].flames) {
    assert.equal(flame.width, -f(0.003));
    assert.equal(flame.height, f(0.5 * f(0.003)));
    assert.equal(flame.x, f(-0.03));
    assert.equal(flame.z, f(-0.03));
  }
  assert.ok(
    snapshot.columns[1].flames.every(
      (flame) => flame.frame === -5 && !flame.visible,
    ),
  );
  const fast = new SmokeSystem(undefined, { random: () => 0 });
  fast.spawnColumn(column());
  for (let n = 1; n <= 6; n++) fast.update(n * 10, 10);
  assert.deepEqual(
    fast.snapshot().columns[0].flames.map((f) => f.frame),
    [0, 0, 0],
  );
  const dying = new SmokeSystem(undefined, { random: () => 0 });
  dying.spawnColumn(column(undefined, 1400));
  for (let n = 1; n <= 6; n++) dying.update(n * 40, 40);
  assert.ok(dying.snapshot().columns[0].flames.every((f) => f.frame === -5));
  smoke.dispose();
  fast.dispose();
  dying.dispose();
});

test("surface kernel projects trailing bounds, includes positive-X motion, and wraps authored dust", () => {
  const a = new THREE.Group();
  a.position.set(3, 4, 5);
  const source = {
    actor: a,
    wheel: 0,
    wheelPosition: v(),
    suspensionDistance: 0,
    suspensionHeight: 1,
    velocityCarSpace: v(10 / 6.9, 0, 0),
    omega: v(),
    bounds: new THREE.Box3(v(-1, -1, -1), v(1, 1, 1)),
    smokeType: 4,
    dustRotate: 2,
    dustCount: 3,
    driver: 8,
    disabled: false,
  };
  const generated = surfaceSmokePuff(source);
  close(generated.position.x, 2);
  close(generated.position.y, 4);
  close(generated.position.z, 5);
  close(generated.strength, 0.4);
  close(generated.decay, 0.8);
  assert.equal(generated.type, 9);
  assert.equal(
    surfaceSmokePuff({ ...source, velocityCarSpace: v(4 / 6.9, 0, 0) }),
    null,
  );
  const smoke = new SmokeSystem(undefined, {
    random: () => 0,
    shadeColours: Array(16).fill(0xffffff),
  });
  assert.equal(smoke.spawnSurfaceSmoke({ ...source, smokeType: 1 }, 40), null);
  assert.equal(
    smoke.spawnSurfaceSmoke({ ...source, disabled: true }, 40),
    null,
  );
  assert.equal(
    smoke.spawnSurfaceSmoke({ ...source, suspensionDistance: 1 }, 40),
    null,
  );
  assert.equal(smoke.spawnSurfaceSmoke({ ...source, driver: 5 }, 40), null);
  assert.equal(smoke.spawnSurfaceSmoke(source, 40), 0);
  for (let n = 0; n < 3; n++)
    assert.equal(smoke.spawnSurfaceSmoke(source, 40), null);
  assert.equal(smoke.spawnSurfaceSmoke(source, 40), 1);
  smoke.dispose();
});

test("lazy texture load reads installed sequence and does not dispose Assets-owned maps", async () => {
  const paths = [],
    textures = new Map();
  const smoke = new SmokeSystem(
    {
      textures,
      resolve: (p) => p,
      pixelmaps: async (p, target) => {
        paths.push(p);
        const name = p.split("/").at(-1).slice(0, -4).toLowerCase();
        const texture = new THREE.Texture();
        textures.set(name, texture);
        target.set(name, texture);
      },
    },
    { random: () => 0 },
  );
  smoke.spawnColumn(column());
  await smoke.loadTextures();
  assert.equal(paths.length, 21);
  assert.ok(paths[20].endsWith("flm20.PIX"));
  for (let n = 1; n <= 6; n++) smoke.update(n * 40, 40);
  assert.equal(smoke.group.children[0].children[0].visible, true);
  assert.equal(smoke.stats.glows, 1);
  let disposed = false;
  textures.get("smoke").addEventListener("dispose", () => {
    disposed = true;
  });
  smoke.dispose();
  assert.equal(disposed, false);
});

test("invalid indices, transforms, random samples and time are diagnosed or rejected", () => {
  const smoke = new SmokeSystem(undefined, { random: () => NaN });
  assert.throws(() => smoke.spawnColumn({ ...column(), vertex: -1 }), /vertex/);
  assert.throws(() => smoke.spawnPuff(puff(v(Infinity, 0, 0))), /source/);
  assert.throws(() => smoke.update(0, NaN), /frame period/);
  smoke.spawnColumn(column());
  assert.throws(() => smoke.update(40, 40), /RNG/);
  smoke.dispose();
});

test("installed smoke/fire textures load through the production asset protocol", async (t) => {
  let executable;
  try {
    executable = await readFile("carma2_orig/carma2_HW.exe");
  } catch {
    t.skip("Original installation unavailable");
    return;
  }
  if (
    createHash("sha256").update(executable).digest("hex") !==
    "698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c"
  ) {
    t.skip("Different original executable build");
    return;
  }
  const textures = new Map(),
    smoke = new SmokeSystem(
      {
        textures,
        resolve: (p) => p.replace(/flm(\d+)\.pix$/i, "FLM$1.PIX"),
        pixelmaps: async (p, target) => {
          for (const map of parsePix(
            new Uint8Array(await readFile("carma2_orig/" + p)),
          )) {
            const texture = new THREE.DataTexture(
              map.rgba,
              map.width,
              map.height,
              THREE.RGBAFormat,
            );
            const key = (map.name || p.split("/").at(-1))
              .replace(/\.pix$/i, "")
              .toLowerCase();
            target.set(key, texture);
          }
        },
      },
      { random: () => 0 },
    );
  await smoke.loadTextures();
  assert.equal(smoke.stats.textures, 21);
  assert.deepEqual(smoke.diagnostics, []);
  assert.equal(textures.get("smoke").image.width, 64);
  for (const texture of textures.values()) {
    const pixels = texture.image.data;
    assert.ok(pixels.some((n, i) => i % 4 === 3 && n === 0));
    assert.ok(pixels.some((n, i) => i % 4 === 3 && n > 0));
  }
  smoke.dispose();
  for (const texture of textures.values()) texture.dispose();
});

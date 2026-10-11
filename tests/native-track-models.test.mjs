import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat, decodeText } from "../src/formats.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";
import {
  NativeTrackModelError,
  migrateNativeTrackModel,
  nativeTrackFaceMustBeUpdateable,
  nativeTrackTextureReserve,
} from "../src/native-track-models.ts";

const material = { name: "same-name" };
const otherMaterial = { name: "same-name" };
const spec = (overrides = {}) => ({
  material,
  triggerType: 0,
  mode: 3,
  levelCount: 0,
  ...overrides,
});
const vertex = (position, uv = [0, 0], payload = {}) => ({
  position,
  uv,
  payload,
});
const face = (indices, sourceFaceIndex, pointer = material) => ({
  indices,
  sourceFaceIndex,
  material: pointer,
  payload: Uint8Array.from([sourceFaceIndex & 255, 99]),
});
const model = (
  faces = [face([0, 1, 2], 0)],
  vertices = [vertex([0, 0, 0]), vertex([1, 0, 0]), vertex([0, 1, 0])],
) => ({
  identity: {},
  flags: 1,
  pivot: [10, 20, 30],
  actorRenderStyle: 4,
  vertices,
  faces,
});
function capture() {
  const visits = [];
  return {
    visits,
    spawnPedsOnFace(visit) {
      visits.push(visit);
    },
    copyVertexPayload: structuredClone,
    copyFacePayload: structuredClone,
  };
}

// Expected predicates/copy records were also captured from installed 40d530:
// /tmp/c2-mungefaces-{capture.c,check.mjs}; this is a source-free numeric fixture.
test("source predicate uses raw pointer identity and signed count, without material-name fallback", () => {
  for (const count of [-2147483648, -1, 0])
    assert.equal(
      nativeTrackFaceMustBeUpdateable(material, [
        spec({ mode: 2, levelCount: count }),
      ]),
      false,
    );
  assert.equal(
    nativeTrackFaceMustBeUpdateable(material, [
      spec({ mode: 2, levelCount: 1 }),
    ]),
    true,
  );
  for (const mode of [3, 4])
    assert.equal(
      nativeTrackFaceMustBeUpdateable(material, [
        spec({ mode, levelCount: -1 }),
      ]),
      true,
    );
  assert.equal(
    nativeTrackFaceMustBeUpdateable(material, [
      spec({ mode: 1, levelCount: 1 }),
    ]),
    false,
  );
  assert.equal(
    nativeTrackFaceMustBeUpdateable(material, [spec({ triggerType: 1 })]),
    false,
  );
  assert.equal(nativeTrackFaceMustBeUpdateable(otherMaterial, [spec()]), false);
  assert.equal(nativeTrackFaceMustBeUpdateable(null, [spec()]), false);
  assert.equal(
    nativeTrackFaceMustBeUpdateable(null, [spec({ material: null })]),
    true,
  );
  assert.throws(
    () =>
      nativeTrackFaceMustBeUpdateable(material, [
        spec({ levelCount: 2147483648 }),
      ]),
    /signed32/,
  );
});

test("selection observes material and smash-spec changes made by the spawn outlet", () => {
  const input = model([face([0, 1, 2], 0, otherMaterial), face([0, 1, 2], 1)]);
  const specs = [spec({ mode: 1 })];
  const p = capture();
  p.spawnPedsOnFace = (visit) => {
    p.visits.push(visit);
    if (visit.face.sourceFaceIndex === 0) {
      visit.face.material = material;
      specs[0].mode = 3;
    } else visit.face.material = otherMaterial;
  };
  const result = migrateNativeTrackModel(input, specs, p);
  assert.deepEqual(
    result.generated.model.faces.map((face) => face.sourceFaceIndex),
    [0],
  );
  assert.deepEqual(
    result.remaining.faces.map((face) => face.sourceFaceIndex),
    [1],
  );
  assert.deepEqual(
    p.visits.map((visit) => visit.nativeFaceIndex),
    [0, 0],
  );
});

test("stable removal visits the current compacted index before selection and retains raw provenance", () => {
  const input = model([
    face([0, 1, 2], 10, otherMaterial),
    face([0, 1, 2], 20),
    face([0, 1, 2], 30, otherMaterial),
    face([0, 1, 2], 40),
    face([0, 1, 2], 50),
  ]);
  const provider = capture();
  const result = migrateNativeTrackModel(input, [spec()], provider);
  assert.deepEqual(
    provider.visits.map((v) => [
      v.face.sourceFaceIndex,
      v.nativeFaceIndex,
      v.remainingFaceCount,
    ]),
    [
      [10, 0, 5],
      [20, 1, 5],
      [30, 1, 4],
      [40, 2, 4],
      [50, 2, 3],
    ],
  );
  assert.deepEqual(
    provider.visits.map((v) => v.nativeFaces.map((f) => f.sourceFaceIndex)),
    [
      [10, 20, 30, 40, 50],
      [10, 20, 30, 40, 50],
      [10, 30, 40, 50],
      [10, 30, 40, 50],
      [10, 30, 50],
    ],
  );
  assert.deepEqual(
    result.remaining.faces.map((f) => [f.sourceFaceIndex, f.nativeFaceIndex]),
    [
      [10, 0],
      [30, 1],
    ],
  );
  assert.deepEqual(
    result.generated.model.faces.map((f) => [
      f.sourceFaceIndex,
      f.nativeFaceIndex,
    ]),
    [
      [20, 0],
      [40, 1],
      [50, 2],
    ],
  );
  assert.equal(result.remaining.vertices, input.vertices);
  assert.equal(result.remaining.pivot, input.pivot);
  assert.equal(result.remaining.flags, 1);
  assert.ok(
    result.remaining.faces.every((f) => f.sourceModel === input.identity),
  );
  assert.equal(result.generated.model.faces[0].material, material);
  result.generated.model.faces[0].payload[0] = 0;
  assert.equal(input.faces[1].payload[0], 20);
  assert.deepEqual(
    input.faces.map((f) => f.sourceFaceIndex),
    [10, 20, 30, 40, 50],
  );
});

test("generated model uses first exact XYZUV record across smoothing/material payloads and preserves seams", () => {
  const input = model(
    [face([0, 1, 2], 0), face([3, 1, 2], 1, otherMaterial), face([4, 1, 2], 2)],
    [
      vertex([0, 0, 0], [0, 0], { normal: [1, 2, 3], colour: 99 }),
      vertex([1, 0, 0], [1, 0]),
      vertex([0, 1, 0], [0, 1]),
      vertex([-0, 0, 0], [-0, 0], { normal: [9, 9, 9], colour: 55 }),
      vertex([0, 0, 0], [1, 1]),
    ],
  );
  const result = migrateNativeTrackModel(
    input,
    [spec(), spec({ material: otherMaterial, mode: 4 })],
    capture(),
  );
  const generated = result.generated;
  assert.deepEqual(
    generated.model.faces.map((f) => f.indices),
    [
      [0, 1, 2],
      [0, 1, 2],
      [3, 1, 2],
    ],
  );
  assert.deepEqual(
    generated.model.vertices.map((v) => v.sourceVertexIndex),
    [0, 1, 2, 4],
  );
  assert.deepEqual(
    generated.model.vertices[0].payload,
    input.vertices[0].payload,
  );
  assert.notEqual(
    generated.model.vertices[0].payload,
    input.vertices[0].payload,
  );
  assert.deepEqual(generated.model.pivot, [0, 0, 0]);
  assert.equal(generated.model.flags, 0x80);
  assert.equal(generated.model.identifier, null);
  assert.equal(generated.model.vertexCapacity, 2000);
  assert.equal(generated.model.faceCapacity, 2000);
  assert.deepEqual(generated.actor, {
    type: 1,
    renderStyle: 4,
    identifier: null,
    material: null,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  });
  assert.equal(result.remainingActorModelPresent, false);
  assert.equal(result.remainingActorRenderStyle, 1);
});

test("source update requests distinguish no change, remaining MODEL and empty MODEL; preparation stays explicit", () => {
  const p = capture();
  const unchanged = migrateNativeTrackModel(model(), [], p);
  assert.equal(p.visits.length, 1);
  assert.equal(unchanged.generated, null);
  assert.equal(unchanged.remainingActorModelPresent, true);
  assert.deepEqual(
    unchanged.actions.map((a) => a.kind),
    ["spawn-peds-on-face", "enumerate-noncars"],
  );
  const changed = migrateNativeTrackModel(
    model([face([0, 1, 2], 0), face([0, 1, 2], 1, otherMaterial)]),
    [spec()],
    capture(),
  );
  assert.deepEqual(
    changed.actions.map((a) => a.kind),
    [
      "spawn-peds-on-face",
      "allocate-generated",
      "spawn-peds-on-face",
      "update-remaining",
      "enumerate-noncars",
      "attach-generated-first-child",
      "register-and-prepare-generated",
      "calculate-reserve-and-reallocate",
      "prepare-generated-and-restore-group-materials",
    ],
  );
  assert.equal(
    changed.actions.find((a) => a.kind === "update-remaining").flags,
    0x7fff,
  );
  assert.equal(changed.generated.model.prepared, undefined);
});

test("native 2000-record limits guard initial and callback-driven overflow", () => {
  const shared = Array.from({ length: 2000 }, (_, i) => face([0, 1, 2], i));
  assert.equal(
    migrateNativeTrackModel(model(shared), [spec()], capture()).generated.model
      .faces.length,
    2000,
  );
  const p = capture();
  assert.throws(
    () =>
      migrateNativeTrackModel(
        model([...shared, face([0, 1, 2], 2000)]),
        [spec()],
        p,
      ),
    (e) => e instanceof NativeTrackModelError && e.code === "capacity-overflow",
  );
  assert.equal(p.visits.length, 0);
  const vertices = Array.from({ length: 2000 }, (_, i) => vertex([i, 0, 0]));
  const faces = Array.from({ length: 667 }, (_, i) =>
    face([3 * i, 3 * i + 1, (3 * i + 2) % 2000], i),
  );
  assert.equal(
    migrateNativeTrackModel(model(faces, vertices), [spec()], capture())
      .generated.model.vertices.length,
    2000,
  );
  vertices.push(vertex([2000, 0, 0]));
  faces.push(face([1998, 1999, 2000], 667));
  assert.throws(
    () => migrateNativeTrackModel(model(faces, vertices), [spec()], p),
    (e) => e.code === "capacity-overflow",
  );
  const mutable = model(
    shared
      .concat(face([0, 1, 2], 2000))
      .map((f) => ({ ...f, material: otherMaterial })),
  );
  const live = capture();
  live.spawnPedsOnFace = (visit) => {
    live.visits.push(visit);
    visit.face.material = material;
  };
  assert.throws(
    () => migrateNativeTrackModel(mutable, [spec()], live),
    (e) => e.code === "capacity-overflow",
  );
  assert.equal(live.visits.length, 2001); // Callback-induced overflow is detected after its outlet.
});

test("missing source outlets/payload adapters and invalid source data fail explicitly", () => {
  for (const name of [
    "spawnPedsOnFace",
    "copyVertexPayload",
    "copyFacePayload",
  ]) {
    const p = capture();
    delete p[name];
    assert.throws(
      () => migrateNativeTrackModel(model(), [spec()], p),
      (e) => e.code === "provider-required",
    );
  }
  for (const input of [
    model([face([0, 1, 9], 0)]),
    model([face([0, 1, 2], -1)]),
    model(undefined, [vertex([NaN, 0, 0])]),
    model(undefined, [vertex([0.1, 0, 0])]),
  ])
    assert.throws(
      () => migrateNativeTrackModel(input, [spec()], capture()),
      (e) => e.code === "invalid-input",
    );
  const input = model();
  input.faces[0].material = undefined;
  assert.throws(
    () => migrateNativeTrackModel(input, [spec()], capture()),
    /raw material identity/,
  );
});

test("reserve uses double .9, native extrema sentinels, truncation and signed32 arithmetic", () => {
  const tile = (range) => [
    [0, 0],
    [range, 0],
    [0, range],
  ];
  assert.deepEqual(nativeTrackTextureReserve([]), {
    extraFaces: 50,
    extraVertices: 50,
  });
  assert.equal(
    nativeTrackTextureReserve([tile(Math.fround(0.1))]).extraFaces,
    51,
  );
  assert.equal(
    nativeTrackTextureReserve([tile(0.09999999403953552)]).extraFaces,
    50,
  );
  assert.equal(nativeTrackTextureReserve([tile(100)]).extraFaces, 250);
  assert.equal(nativeTrackTextureReserve([tile(65535.5)]).extraFaces, 50); // 65536² wraps to zero.
  assert.equal(
    nativeTrackTextureReserve([tile(50000)]).extraFaces,
    -1794967246,
  );
  assert.equal(
    nativeTrackTextureReserve([
      [
        [10001, 10001],
        [10001, 10001],
        [10001, 10001],
      ],
    ]).extraFaces,
    51,
  );
  assert.throws(
    () => nativeTrackTextureReserve([tile(Infinity)]),
    /finite float32/,
  );
});

for (const directory of ["data", "adv_data"]) {
  test(`original ${directory} New City: 26 source models migrate 126 faces with exact provenance`, async (t) => {
    const root = process.env.CARMA2_ROOT ?? "carma2_orig";
    try {
      await access(root);
    } catch {
      t.skip("original installation absent");
      return;
    }
    const store = await createAssetStore(root),
      path = `${directory}/RACES/newcity1/newcity1`;
    if (
      !store.manifest.some(
        (e) => e.path.toLowerCase() === (path + ".act").toLowerCase(),
      )
    ) {
      t.skip("original New City absent");
      return;
    }
    const sourceModels = parseDat(await store.read(path + ".dat")),
      sourceActors = parseAct(await store.read(path + ".act")),
      sourceSpecs = parseTrackSmashables(
        decodeText(await store.read(path + ".txt")),
      );
    const models = new Map(sourceModels.map((m) => [m.name.toLowerCase(), m])),
      identities = new Map();
    const pointer = (name) => {
      const key = name.toLowerCase();
      if (!identities.has(key)) identities.set(key, { name });
      return identities.get(key);
    };
    const specs = sourceSpecs
      .filter((s) => s.trigger.kind === "material")
      .map((s) => ({
        material: pointer(s.trigger.name),
        triggerType: 0,
        mode: { texturechange: 2, remove: 3, replacemodel: 4 }[s.mode] ?? 0,
        levelCount: s.levels?.length ?? 0,
      }));
    const columns = [];
    function collect(actor) {
      const match = actor.name.match(/^\s*(\d+)\s+(\d+)/);
      if (match && +match[1] < 16 && +match[2] < 16) {
        columns.push(
          actor.model
            ? actor
            : [...actor.children]
                .reverse()
                .find((c) => !c.name.startsWith("&")),
        );
        return;
      }
      for (const c of [...actor.children].reverse()) collect(c);
    }
    for (const actor of sourceActors)
      for (const child of [...actor.children].reverse()) collect(child);
    let changed = 0,
      migrated = 0;
    for (const actor of columns) {
      const dat = models.get(actor.model.toLowerCase());
      const eligible = dat.faces.map((f) =>
        sourceSpecs.some(
          (s) =>
            s.trigger.kind === "material" &&
            dat.materials[f.material - 1] === s.trigger.name &&
            (s.mode === "remove" ||
              s.mode === "replacemodel" ||
              (s.mode === "texturechange" && s.levels?.length > 0)),
        ),
      );
      if (!eligible.some(Boolean)) continue;
      const input = {
        identity: dat,
        flags: dat.flags,
        pivot: dat.pivot,
        actorRenderStyle: actor.renderStyle,
        vertices: Array.from({ length: dat.positions.length / 3 }, (_, i) =>
          vertex(
            Array.from(dat.positions.subarray(i * 3, i * 3 + 3)),
            Array.from(dat.uvs.subarray(i * 2, i * 2 + 2)),
            { source: i },
          ),
        ),
        faces: dat.faces.map((f, i) => ({
          ...f,
          sourceFaceIndex: i,
          material: f.material ? pointer(dat.materials[f.material - 1]) : null,
          payload: { smoothing: f.smoothing, flags: f.flags },
        })),
      };
      const p = capture(),
        result = migrateNativeTrackModel(input, specs, p);
      changed++;
      migrated += result.generated.model.faces.length;
      assert.equal(p.visits.length, dat.faces.length);
      assert.deepEqual(
        result.remaining.faces.map((f) => f.sourceFaceIndex),
        eligible.flatMap((v, i) => (v ? [] : [i])),
      );
      assert.deepEqual(
        result.generated.model.faces.map((f) => f.sourceFaceIndex),
        eligible.flatMap((v, i) => (v ? [i] : [])),
      );
      for (const generated of result.generated.model.faces) {
        const original = dat.faces[generated.sourceFaceIndex];
        assert.deepEqual(generated.payload, {
          smoothing: original.smoothing,
          flags: original.flags,
        });
        assert.equal(generated.sourceModel, dat);
        for (let corner = 0; corner < 3; corner++) {
          const v = result.generated.model.vertices[generated.indices[corner]],
            source = original.indices[corner];
          assert.deepEqual(
            v.position,
            Array.from(dat.positions.subarray(source * 3, source * 3 + 3)),
          );
          assert.deepEqual(
            v.uv,
            Array.from(dat.uvs.subarray(source * 2, source * 2 + 2)),
          );
        }
      }
      assert.ok(result.remaining.faces.length > 0);
      assert.deepEqual(
        result.remaining.faces.map((f) => f.nativeFaceIndex),
        result.remaining.faces.map((_, i) => i),
      );
    }
    assert.equal(changed, 26);
    assert.equal(migrated, 126);
  });
}

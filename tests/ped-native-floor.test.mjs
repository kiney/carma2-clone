import test from "node:test";
import assert from "node:assert/strict";
import { Group } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat, parseMat } from "../src/formats.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";
import { nativeModelPickPreparedVertices } from "../src/native-model-pick.ts";
import { findNativePedFloorBelow } from "../src/ped-native-floor.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  MAX = 3.4028234663852886e38;
const mat = (name = "GROUND", flags = 0) => ({
  name,
  flags,
  rgba: [255, 255, 255, 255],
  ambient: 1,
  diffuse: 0,
  specular: 0,
  power: 0,
  uvTransform: [1, 0, 0, 1, 0, 0],
});
const dat = (height = 0, material = "GROUND", vertices) => ({
  name: "floor",
  flags: 0,
  pivot: [0, 0, 0],
  positions: Float32Array.from(
    vertices ?? [-10, height, -10, -10, height, 10, 10, height, -10],
  ),
  uvs: new Float32Array(6),
  materials: material ? [material] : [],
  faces: [
    { indices: [0, 1, 2], material: material ? 1 : 0, flags: 0, smoothing: 0 },
  ],
});
const raw = (name, fields = {}) => ({
  name,
  type: 1,
  renderStyle: 0,
  transform: [...I],
  model: "floor",
  children: [],
  ...fields,
});
function fixture(
  source = dat(),
  material = mat(),
  rawActors = [raw("column")],
) {
  const arena = new NativeResourceArena();
  if (material) arena.allocateMaterial(material);
  const built = createNativeTrackModelResource(
    source,
    () => known(material),
    4,
  );
  assert.equal(built.resolved, true);
  const resource = built.value;
  const prepared = prepareNativeTrackResource(
    resource,
    arena.materialOrder(resource.current.faces),
  );
  assert.equal(prepared.resolved, true);
  const state = createNativeActorOrder(rawActors, {
    model: () => known(resource),
    material: () => known(material),
  });
  const scene = {
    layout: {
      originX: -100,
      originZ: -100,
      columnSizeX: 200,
      columnSizeZ: 200,
      countX: 1,
      countZ: 1,
    },
    columns: [[state.roots[0]]],
    additionalActors: null,
    nonTrackActors: null,
    resources: new Map([[resource, resource]]),
    arena,
    blackMaterial: material,
    actorObjects: new Map(state.actors.map((actor) => [actor, new Group()])),
    actors: state.actors,
  };
  return { scene, resource, actors: state.actors, roots: state.roots, arena };
}

test("single native floor traversal returns highest MODEL-local hit with exact no-hit sentinel", () => {
  const h = fixture();
  const hit = findNativePedFloorBelow(h.scene, [-1, 3, -1]);
  assert.deepEqual(hit.requiredProviders, []);
  assert.equal(hit.height, 0);
  assert.equal(hit.materialName, "GROUND");
  assert.equal(hit.actor, h.roots[0]);
  assert.equal(hit.faceIndex, 0);
  assert.equal(findNativePedFloorBelow(h.scene, [20, 3, 20]).height, -MAX);
  assert.equal(findNativePedFloorBelow(h.scene, [-1, -1, -1]).height, -MAX);
  const deep = fixture(dat(-500));
  assert.equal(
    findNativePedFloorBelow(deep.scene, [-1, -200, -1]).height,
    -500,
    "no generic fallen-world−100 truncation",
  );
});

test("floor material filters allow question marks and NULL, excluding only bang and greater-than", () => {
  for (const [name, expected] of [
    ["?GROUND", 0],
    ["^GROUND", 0],
    ["!GROUND", -MAX],
    [">GROUND", -MAX],
  ]) {
    const h = fixture(dat(0, name), mat(name));
    assert.equal(
      findNativePedFloorBelow(h.scene, [-1, 3, -1]).height,
      expected,
    );
  }
  const empty = fixture(dat(0, null), null);
  const hit = findNativePedFloorBelow(empty.scene, [-1, 3, -1]);
  assert.deepEqual(hit.requiredProviders, []);
  assert.equal(hit.height, 0);
  assert.equal(hit.materialName, null);
});

test("source facing flags permit two-sided undersides and steep floors without an invented normal threshold", () => {
  const downward = dat();
  downward.faces[0].indices = [0, 2, 1];
  const one = fixture(downward, mat());
  assert.equal(findNativePedFloorBelow(one.scene, [-1, 3, -1]).height, -MAX);
  for (const flags of [0x800, 0x1000]) {
    const h = fixture(downward, mat("GROUND", flags));
    assert.equal(findNativePedFloorBelow(h.scene, [-1, 3, -1]).height, 0);
  }
  const steep = fixture(dat(0, "GROUND", [-1, -10, -1, -1, -10, 1, 1, 10, -1]));
  const hit = findNativePedFloorBelow(steep.scene, [-0.5, 2, -0.5]);
  assert.deepEqual(hit.requiredProviders, []);
  assert.ok(Math.abs(hit.height + 5) < 1e-5);
});

test("source ray has no+.12 ceiling and accepts exact triangle edges", () => {
  const above = fixture(dat(0.01));
  assert.equal(findNativePedFloorBelow(above.scene, [-1, 0, -1]).height, -MAX);
  const onEdge = fixture();
  assert.equal(findNativePedFloorBelow(onEdge.scene, [0, 3, 0]).height, 0);
  assert.equal(findNativePedFloorBelow(onEdge.scene, [10, 3, 10]).height, -MAX);
});

test("track candidate roots are x-major3x3 and ties retain first native ACT", () => {
  const h = fixture(
    dat(0, "GROUND", [-100, 0, -100, -100, 0, 300, 300, 0, -100]),
    mat(),
    [raw("x0z1"), raw("x1z0"), raw("additional")],
  );
  h.scene.layout = {
    originX: 0,
    originZ: 0,
    columnSizeX: 10,
    columnSizeZ: 10,
    countX: 3,
    countZ: 3,
  };
  h.scene.columns = [
    [null, h.roots[1], null],
    [h.roots[0], null, null],
    [null, null, null],
  ];
  h.scene.additionalActors = h.roots[2];
  h.scene.trackRoot = h.roots[2];
  h.scene.nonTrackActors = h.roots[2];
  const visits = [];
  const hit = findNativePedFloorBelow(h.scene, [15, 5, 15], null, {
    prepareActors: (roots) => visits.push(...roots.map((actor) => actor.name)),
  });
  assert.deepEqual(visits, ["x0z1", "x1z0"]);
  assert.equal(hit.actor, h.roots[0]);
  assert.equal(hit.visitedActors, 2);
  assert.equal(
    findNativePedFloorBelow(h.scene, [500, 5, 500]).height,
    -MAX,
    "clamped outer neighborhood never appends additional/nonTrack/global fallback actors",
  );
});

test("prepared material/group ordering wins equal-height ties through actual resource addresses", () => {
  const A = mat("A"),
    B = mat("B"),
    source = dat();
  source.materials = ["A", "B"];
  source.faces.push({ ...source.faces[0], indices: [0, 1, 2], material: 2 });
  const h = fixture(source, A);
  h.arena.allocateMaterial(B);
  h.resource.current.faces[1].material = B;
  assert.equal(
    prepareNativeTrackResource(
      h.resource,
      h.arena.materialOrder(h.resource.current.faces),
    ).resolved,
    true,
  );
  const hit = findNativePedFloorBelow(h.scene, [-1, 3, -1]);
  assert.deepEqual(hit.requiredProviders, []);
  assert.equal(hit.materialName, "A");
  assert.equal(hit.faceIndex, h.resource.prepared.faces[0].nativeFaceIndex);
});

test("arbitrary affine ACT inverse retains original local-Y callback behavior", () => {
  const transform = [2, 0, 0, 0, 3, 0, 0, 0, 1, 100, 100, 0];
  const h = fixture(dat(2, "GROUND", [-1, 2, -1, -1, 2, 1, 1, 2, -1]), mat(), [
    raw("scaled-translated", { transform }),
  ]);
  const hit = findNativePedFloorBelow(h.scene, [101.5, 110, -0.9]);
  assert.deepEqual(hit.requiredProviders, []);
  assert.equal(hit.height, 2, "source callback does not return worldY106");
  const column = fixture(dat(), mat(), [
    raw("unvisited track ancestor", {
      type: 0,
      transform: [...I.slice(0, 9), 200, 300, 400],
      children: [raw("actual column root")],
    }),
  ]);
  column.scene.columns = [[column.roots[0].firstChild]];
  assert.equal(
    findNativePedFloorBelow(column.scene, [-1, 3, -1]).height,
    0,
    "unparented source camera does not accumulate the candidate root's ancestors",
  );
});

test("native child links and MODEL/MAT inheritance survive player-ACT exclusion", () => {
  const children = [
    raw("first", { model: undefined }),
    raw("last", { model: undefined }),
  ];
  const h = fixture(dat(0, null), mat("INHERITED"), [
    raw("parent", { material: "INHERITED", children }),
  ]);
  assert.equal(h.roots[0].firstChild.name, "last");
  const actorExcluded = findNativePedFloorBelow(
    h.scene,
    [-1, 3, -1],
    h.roots[0],
  );
  assert.equal(
    actorExcluded.actor.name,
    "last",
    "excluding only parent MODEL retains first native child",
  );
  assert.equal(actorExcluded.materialName, "INHERITED");
  const objectExcluded = findNativePedFloorBelow(
    h.scene,
    [-1, 3, -1],
    h.scene.actorObjects.get(h.roots[0]),
  );
  assert.equal(objectExcluded.actor, actorExcluded.actor);
  const single = fixture();
  assert.equal(
    findNativePedFloorBelow(single.scene, [-1, 3, -1], single.roots[0]).height,
    -MAX,
  );
});

test("RSTYLE_NONE and bounds actors gate source subtrees, independently of Three visibility", () => {
  const hidden = fixture(dat(), mat(), [
    raw("hidden", { renderStyle: 1, children: [raw("child")] }),
  ]);
  assert.equal(findNativePedFloorBelow(hidden.scene, [-1, 3, -1]).height, -MAX);
  const h = fixture(dat(), mat(), [
    raw("bounds", {
      type: 5,
      model: undefined,
      bounds: { min: [50, 50, 50], max: [60, 60, 60] },
      children: [raw("child")],
    }),
  ]);
  assert.equal(findNativePedFloorBelow(h.scene, [-1, 3, -1]).height, -MAX);
  h.roots[0].bounds = known({ min: [-20, -20, -20], max: [20, 20, 20] });
  for (const object of h.scene.actorObjects.values()) object.visible = false;
  assert.equal(findNativePedFloorBelow(h.scene, [-1, 3, -1]).height, 0);
});

test("missing/stale source metadata and singular transforms stay explicit rather than guessing geometry", () => {
  for (const change of [
    (h) => {
      h.resource.prepared = null;
    },
    (h) => {
      h.resource.revision++;
    },
    (h) => {
      h.roots[0].localModel = {
        resolved: false,
        requiredProvider: "actual-MODEL-provider",
      };
    },
    (h) => {
      h.roots[0].matrix = new Array(12).fill(0);
    },
    (h) => {
      h.scene.resources.clear();
    },
  ]) {
    const h = fixture();
    change(h);
    const result = findNativePedFloorBelow(h.scene, [-1, 3, -1]);
    assert.ok(result.requiredProviders.length);
    assert.equal(result.height, -MAX);
  }
  const fresh = fixture();
  fresh.resource.revision++;
  const result = findNativePedFloorBelow(fresh.scene, [-1, 3, -1], null, {
    prepareActors: () => prepareNativeTrackResource(fresh.resource),
  });
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.height, 0);
  assert.throws(
    () => findNativePedFloorBelow(fresh.scene, [NaN, 0, 0]),
    /finite/,
  );
});

test("original Stock/Advanced Newcity prepared floor geometry supports the native point/face equation", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  const key = (s) => s.replace(/\.(mat|dat)$/i, "").toLowerCase();
  for (const root of ["data", "adv_data"]) {
    const prefix = `${root}/races/newcity1/`;
    const files = store.manifest.filter(
      (entry) =>
        entry.path.toLowerCase().startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes("/"),
    );
    if (!files.length) {
      t.skip(`Original ${root} Newcity unavailable`);
      return;
    }
    const materials = new Map(),
      arena = new NativeResourceArena();
    for (const file of files.filter((entry) => /\.mat$/i.test(entry.path)))
      for (const m of parseMat(await store.read(file.path))) {
        materials.set(key(m.name), m);
        arena.allocateMaterial(m);
      }
    let checked = 0;
    for (const file of files.filter((entry) => /\.dat$/i.test(entry.path))) {
      for (const model of parseDat(await store.read(file.path))) {
        const created = createNativeTrackModelResource(
          model,
          (name) => known(materials.get(key(name)) ?? null),
          4,
        );
        assert.equal(created.resolved, true);
        const resource = created.value,
          prepared = prepareNativeTrackResource(
            resource,
            arena.materialOrder(resource.current.faces),
          );
        if (!prepared.resolved) continue;
        const face = prepared.value.faces.find(
          (face) =>
            face.plane.normal[1] > 0.5 &&
            !/^[!>]/.test(face.material?.name ?? ""),
        );
        if (!face) continue;
        const vertices = nativeModelPickPreparedVertices(prepared.value, face);
        const point = [0, 1, 2].map((axis) =>
          Math.fround(vertices.reduce((sum, v) => sum + v[axis], 0) / 3),
        );
        const h = fixture();
        h.scene.resources = new Map([[resource, resource]]);
        h.roots[0].localModel = known(resource);
        h.scene.blackMaterial = mat("explicit test inherited black");
        h.scene.layout = {
          originX: -1e6,
          originZ: -1e6,
          columnSizeX: 2e6,
          columnSizeZ: 2e6,
          countX: 1,
          countZ: 1,
        };
        const hit = findNativePedFloorBelow(h.scene, [
          point[0],
          Math.fround(point[1] + 0.001),
          point[2],
        ]);
        assert.deepEqual(hit.requiredProviders, []);
        assert.notEqual(hit.height, -MAX);
        assert.ok(
          hit.height >= point[1] - 0.01 && hit.height <= point[1] + 0.002,
          `${root}/${model.name}: query remains near actual prepared floor`,
        );
        checked++;
        if (checked === 3) break;
      }
      if (checked === 3) break;
    }
    assert.equal(
      checked,
      3,
      `${root}: three actual original prepared floor MODEL resources`,
    );
  }
});

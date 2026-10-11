import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import {
  createNativeActorOrder,
  allocateNativeOrderedActor,
  knownNativeActorValue as known,
  prependNativeActor,
  removeNativeActor,
  relinkNativeActor,
  enumerateNativeActorChildren,
  resolveNativeActorInheritance,
  extractNativeActorColumns,
  orderedNativeActorColumns,
  nativeSingleActorColumn,
} from "../src/native-actor-order.ts";
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const raw = (name, children = [], fields = {}) => ({
  name,
  type: 0,
  renderStyle: 0,
  transform: [...I],
  children,
  ...fields,
});
const names = (actor) => {
  const result = [];
  enumerateNativeActorChildren(actor, (a) => {
    result.push(a.name);
    return 0;
  });
  return result;
};
const descriptor = (name, model = null) => ({
  name,
  type: model ? 1 : 0,
  renderStyle: model ? 4 : 0,
  matrix: I,
  localModel: known(model),
  localMaterial: known(null),
  bounds: known(null),
  provenance: "invented test resource",
});
const resolved = {
  resolved: true,
  evidence: "test mock, no original game mutation claimed",
};
const providers = (changes = {}) => ({
  identityColumnRelink: { evidence: "test identity tile / sibling wrapper" },
  prepareColumn: () => ({ ...resolved, blendy: null }),
  findNonCars: () => resolved,
  finishBlendy: () => resolved,
  setSmashableModel: () => resolved,
  ...changes,
});
const extraction = (state, changes = {}) =>
  extractNativeActorColumns(state, {
    root: state.roots[0],
    countX: 2,
    countZ: 2,
    defaultTrackMaterial: known({ native: "test default" }),
    austerity: false,
    providers: providers(),
    ...changes,
  });

test("raw ACT child attachments prepend, retain source paths and stable model identity", () => {
  const m = {},
    material = {},
    input = raw("root", [
      raw("first", [], { model: "shared" }),
      raw("last", [raw("grandchild")], { model: "shared", material: "mat" }),
    ]);
  const state = createNativeActorOrder([input], {
      model: () => known(m),
      material: () => known(material),
    }),
    root = state.roots[0];
  assert.deepEqual(names(root), ["last", "first"]);
  assert.equal(root.firstChild.source, input.children[1]);
  assert.equal(root.firstChild.id, "file:0/1");
  assert.equal(
    root.firstChild.localModel.value,
    root.firstChild.next.localModel.value,
  );
  assert.equal(root.firstChild.localMaterial.value, material);
  assert.equal(root.firstChild.firstChild.depth, 2);
  assert.deepEqual(
    input.children.map((a) => a.name),
    ["first", "last"],
  );
});

test("installed 51d620/51d510 synthetic capture: removed current child follows captured next and ignores newly prepended child", () => {
  const state = createNativeActorOrder([
    raw("0", [raw("1"), raw("2"), raw("3", [raw("6")])]),
    raw("4"),
  ]);
  const [parent, target] = state.roots,
    added = allocateNativeOrderedActor(state, descriptor("5")),
    visited = [];
  assert.deepEqual(names(parent), ["3", "2", "1"]);
  enumerateNativeActorChildren(parent, (actor) => {
    visited.push(actor.name);
    if (actor.name === "3") {
      prependNativeActor(parent, added);
      removeNativeActor(actor);
      prependNativeActor(target, actor);
    }
    return 0;
  });
  // Original capture: [3,2,1,99,3,2,1,99,5,2,1,99,3,99,1,2].
  assert.deepEqual(visited, ["3", "2", "1"]);
  assert.deepEqual(names(parent), ["5", "2", "1"]);
  assert.deepEqual(names(target), ["3"]);
  assert.equal(target.firstChild.depth, 1);
  assert.equal(target.firstChild.firstChild.depth, 2);
  assert.equal(parent.firstChild.next.previous, parent.firstChild);
  assert.equal(
    enumerateNativeActorChildren(parent, () => 7),
    7,
  );
});

test("relink preserves actor identity, applies explicit native matrix, renumbers and no-ops on same parent", () => {
  const state = createNativeActorOrder([
    raw("a", [raw("child", [raw("nested")])]),
    raw("b"),
  ]);
  const [a, b] = state.roots,
    child = a.firstChild,
    transformed = [...I];
  transformed[9] = 4;
  relinkNativeActor(b, child, transformed);
  assert.equal(b.firstChild, child);
  assert.equal(a.firstChild, null);
  assert.equal(child.matrix[9], 4);
  relinkNativeActor(b, child, [NaN]);
  assert.equal(child.matrix[9], 4);
  removeNativeActor(child);
  assert.equal(child.depth, 0);
  assert.equal(child.firstChild.depth, 1);
  assert.throws(() => prependNativeActor(child.firstChild, child), /cycle/);
});

test("known NULL inherits MODEL/MAT; unresolved identity and authored BOUNDS remain explicit", () => {
  const state = createNativeActorOrder([
    raw("r", [
      raw("missing", [], { model: "not loaded", material: "unknown" }),
      raw("bounds", [], { type: 5 }),
    ]),
  ]);
  const inherited = {
    model: known({ name: "inherited model" }),
    material: known({ name: "inherited MAT" }),
  };
  assert.equal(
    resolveNativeActorInheritance(state.roots[0], inherited).model,
    inherited.model,
  );
  const missing = state.actors.find((a) => a.name === "missing");
  assert.equal(
    resolveNativeActorInheritance(missing, inherited).model.resolved,
    false,
  );
  assert.equal(
    missing.localMaterial.requiredProvider,
    "native-material-identity:unknown",
  );
  assert.equal(state.actors.find((a) => a.type === 5).bounds.resolved, false);
  const nullLookup = createNativeActorOrder(
    [raw("explicit", [], { model: "missing" })],
    { model: () => known(null) },
  );
  assert.equal(
    resolveNativeActorInheritance(nullLookup.roots[0], inherited).model,
    inherited.model,
  );
});

test("column source order creates identity wrapper and puts generated blendy before actual tile", () => {
  const model = {},
    material = {},
    state = createNativeActorOrder(
      [
        raw("PP0122", [
          raw("0 0", [], { model: "ground" }),
          raw("1 1", [], { model: "ground" }),
        ]),
      ],
      { model: () => known(model) },
    );
  const events = [],
    tiles = state.roots[0].firstChild;
  const result = extraction(state, {
    defaultTrackMaterial: known(material),
    providers: providers({
      relinkMatrix: (tile, wrapper) => {
        assert.equal(wrapper.parent, tile.parent);
        events.push(`relink ${tile.name}`);
        return known(I);
      },
      prepareColumn: (tile, selected) => {
        assert.equal(tile.parent.type, 0);
        assert.equal(selected, tile);
        events.push(`prepare ${tile.name}`);
        return { ...resolved, blendy: descriptor(`blendy ${tile.name}`, {}) };
      },
      findNonCars: (tile) => {
        events.push(`noncars ${tile.name}`);
        return resolved;
      },
      setSmashableModel: (actor) => {
        events.push(`smash ${actor.name}`);
        return resolved;
      },
    }),
  });
  assert.equal(result.resolved, true);
  assert.equal(result.processedColumns.length, 2);
  assert.deepEqual(
    result.processedColumns.map((c) => c.tile.name),
    ["1 1", "0 0"],
  );
  assert.deepEqual(events, [
    "relink 1 1",
    "prepare 1 1",
    "noncars 1 1",
    "smash 1 1",
    "relink 0 0",
    "prepare 0 0",
    "noncars 0 0",
    "smash 0 0",
  ]);
  for (const c of result.processedColumns) {
    assert.deepEqual(names(c.wrapper), [`blendy ${c.tile.name}`, c.tile.name]);
    assert.equal(c.tile.localMaterial.value, material);
    assert.deepEqual(c.wrapper.matrix, I);
  }
  assert.equal(result.processedColumns[0].tile, tiles);
  assert.deepEqual(
    orderedNativeActorColumns(result).map((c) => [c.x, c.z]),
    [
      [0, 0],
      [1, 1],
    ],
  );
});

test("austerity/no local MODEL selects the first native child without ampersand, not inherited MODEL", () => {
  const m = {},
    state = createNativeActorOrder(
      [
        raw("root", [
          raw(
            "0 0",
            [
              raw("old", [], { model: "m" }),
              raw("ground", [], { model: "m" }),
              raw("&accessory", [], { model: "m" }),
            ],
            { model: "m" },
          ),
        ]),
      ],
      { model: () => known(m) },
    );
  let ground;
  const result = extraction(state, {
    austerity: true,
    providers: providers({
      prepareColumn: (tile, selected) => {
        ground = selected;
        return { ...resolved, blendy: null };
      },
    }),
  });
  assert.equal(result.resolved, true);
  assert.equal(ground.name, "ground");
});

test("X outer/Z inner column collection differs from row-major and extraction callback order", () => {
  const state = createNativeActorOrder([
    raw("root", [raw("0 0"), raw("0 1"), raw("1 0"), raw("1 1")]),
  ]);
  const result = extraction(state);
  assert.deepEqual(
    result.processedColumns.map((c) => [c.x, c.z]),
    [
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  );
  assert.deepEqual(
    orderedNativeActorColumns(result).map((c) => [c.x, c.z]),
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  );
  assert.deepEqual(
    orderedNativeActorColumns(result, {
      minX: 1,
      maxX: 1,
      minZ: 0,
      maxZ: 1,
    }).map((c) => [c.x, c.z]),
    [
      [1, 0],
      [1, 1],
    ],
  );
  assert.throws(
    () =>
      orderedNativeActorColumns(result, {
        minX: -1,
        maxX: 0,
        minZ: 0,
        maxZ: 0,
      }),
    /range/,
  );
});

test("missing migration/default/relink providers do not silently omit original actors or claim exact extraction", () => {
  const make = () => createNativeActorOrder([raw("root", [raw("0 0")])]);
  let state = make(),
    result = extraction(state, { providers: {} });
  assert.equal(result.requiredProvider, "native-prepareColumn-provider");
  assert.equal(state.actors.length, 2);
  result = extraction(state, { defaultTrackMaterial: known(null) });
  assert.equal(result.requiredProvider, "native-default-track-material");
  state = make();
  state.roots[0].firstChild.matrix = [...I.slice(0, 9), 1, 0, 0];
  result = extraction(state);
  assert.equal(result.requiredProvider, "native-column-relink-matrix-provider");
  assert.equal(state.actors.length, 3);
  assert.equal(result.processedColumns[0].tile.parent, state.roots[0]);
  assert.throws(() => orderedNativeActorColumns(result), /unresolved/);
  state = make();
  result = extraction(state, {
    providers: providers({
      prepareColumn: () => ({
        resolved: false,
        requiredProvider: "native-face-migration",
      }),
    }),
  });
  assert.equal(result.requiredProvider, "native-face-migration");
  assert.equal(
    result.processedColumns[0].tile.parent,
    result.processedColumns[0].wrapper,
  );
});

test("duplicate coordinates overwrite only table pointer, and non-PP fallback leaves root unchanged", () => {
  const state = createNativeActorOrder([
    raw("root", [raw("0 0", [], { renderStyle: 4 }), raw("0 0")]),
  ]);
  const result = extraction(state);
  assert.equal(result.processedColumns.length, 2);
  assert.equal(result.columns[0][0], result.processedColumns[1]);
  assert.equal(state.roots[0].firstChild.next.type, 0);
  const single = nativeSingleActorColumn(state.roots[0]);
  assert.equal(orderedNativeActorColumns(single)[0].wrapper, state.roots[0]);
  assert.equal(single.columns[0][0].tile, null);
});

test("invalid finite metadata, shared raw nodes and attached/cyclic list mutations fail explicitly", () => {
  const child = raw("shared");
  assert.throws(
    () => createNativeActorOrder([raw("r", [child, child])]),
    /shared/,
  );
  assert.throws(
    () =>
      createNativeActorOrder([
        raw("r", [], { transform: [NaN, ...I.slice(1)] }),
      ]),
    /finite/,
  );
  assert.throws(
    () =>
      createNativeActorOrder([
        raw("r", [], { bounds: { min: [1, 0, 0], max: [0, 0, 0] } }),
      ]),
    /bounds/,
  );
  const state = createNativeActorOrder([raw("r", [raw("c")])]);
  assert.throws(
    () => prependNativeActor(state.roots[0], state.roots[0].firstChild),
    /detached/,
  );
  assert.throws(() => extraction(state, { countX: 256 }), /bytes/);
});

for (const root of ["data", "adv_data"])
  test(`original ${root} Newcity 212-column topology using explicit MOCK preparation, not production migration`, async (t) => {
    const installation =
      process.env.CARMA2_ROOT ??
      new URL("../carma2_orig/", import.meta.url).pathname;
    try {
      await access(installation);
    } catch {
      t.skip("original installation unavailable");
      return;
    }
    const store = await createAssetStore(installation),
      prefix = `${root}/RACES/newcity1/newcity1`;
    let act, dat;
    try {
      act = await store.read(prefix + ".ACT");
      dat = await store.read(prefix + ".DAT");
    } catch {
      t.skip(`${root} original Newcity resources unavailable`);
      return;
    }
    const rawRoots = parseAct(act),
      before = JSON.stringify(rawRoots),
      models = parseDat(dat),
      identities = new Map(models.map((m) => [m.name.toLowerCase(), m]));
    const materials = new Map(),
      state = createNativeActorOrder(rawRoots, {
        model: (name) =>
          identities.has(name.toLowerCase())
            ? known(identities.get(name.toLowerCase()))
            : { resolved: false, requiredProvider: `original-model:${name}` },
        material: (name) => {
          if (!materials.has(name)) materials.set(name, { name });
          return known(materials.get(name));
        },
      });
    assert.equal(state.actors.length, 1688);
    assert.equal(state.actors.filter((a) => a.type === 5).length, 211);
    assert.ok(
      state.actors
        .filter((a) => a.type === 5)
        .every((a) => a.bounds.resolved && a.bounds.value),
    );
    const selected = [],
      result = extraction(state, {
        countX: 16,
        countZ: 16,
        providers: providers({
          prepareColumn: (tile, ground) => {
            assert.deepEqual(tile.matrix, I);
            assert.ok(ground);
            assert.ok(ground.localModel.resolved && ground.localModel.value);
            selected.push(ground);
            return { ...resolved, blendy: null }; // Deliberately no face migration, powerup/noncar normalization or reprepare.
          },
        }),
      });
    assert.equal(result.resolved, true);
    assert.equal(result.processedColumns.length, 212);
    assert.equal(state.actors.length, 1900);
    assert.equal(new Set(selected).size, 212);
    assert.equal(orderedNativeActorColumns(result).length, 212);
    let previous = -1;
    for (const c of orderedNativeActorColumns(result)) {
      const key = c.x * 16 + c.z;
      assert.ok(key > previous);
      previous = key;
      assert.equal(c.wrapper.firstChild, c.tile);
      assert.equal(c.tile.parent, c.wrapper);
    }
    assert.equal(
      JSON.stringify(rawRoots),
      before,
      "native mutable records never edit original parsed trees",
    );
  });

test("blendy identity is allocated before noncar callback but linked before final model preparation", () => {
  const state = createNativeActorOrder([raw("root", [raw("0 0")])]),
    events = [];
  const result = extraction(state, {
    providers: providers({
      prepareColumn: () => ({
        ...resolved,
        blendy: descriptor("generated", {}),
      }),
      findNonCars: () => {
        const blendy = state.actors.find((a) => a.name === "generated");
        assert.ok(blendy);
        assert.equal(blendy.parent, null);
        events.push("noncars");
        return resolved;
      },
      finishBlendy: (column) => {
        assert.equal(column.wrapper.firstChild, column.blendy);
        assert.equal(column.blendy.next, column.tile);
        events.push("finish");
        return resolved;
      },
      setSmashableModel: () => {
        events.push("smash");
        return resolved;
      },
    }),
  });
  assert.equal(result.resolved, true);
  assert.deepEqual(events, ["noncars", "finish", "smash"]);
  const missing = createNativeActorOrder([raw("root", [raw("0 0")])]);
  const fail = extraction(missing, {
    providers: providers({
      prepareColumn: () => ({
        ...resolved,
        blendy: descriptor("generated", {}),
      }),
      finishBlendy: undefined,
    }),
  });
  assert.equal(
    fail.requiredProvider,
    "native-blendy-model-preparation-provider",
  );
  assert.equal(
    fail.processedColumns[0].wrapper.firstChild,
    fail.processedColumns[0].blendy,
  );
});

test("column names require two native conversions and numeric overflow stays explicit", () => {
  const state = createNativeActorOrder([
    raw("root", [raw("0+1tail"), raw("00000512"), raw("0 -1")]),
  ]);
  const result = extraction(state);
  assert.equal(result.resolved, true);
  assert.deepEqual(
    result.processedColumns.map((c) => [c.x, c.z]),
    [[0, 1]],
  );
  const huge = createNativeActorOrder([raw("root", [raw("4294967296 0")])]);
  assert.throws(() => extraction(huge), /CRT integer overflow/);
  assert.throws(
    () =>
      createNativeActorOrder([raw("r", [], { model: "name" })], {
        model: () => known("not identity"),
      }),
    /identity/,
  );
  assert.throws(
    () =>
      createNativeActorOrder([
        raw("r", [], { transform: [1e100, ...I.slice(1)] }),
      ]),
    /Float32/,
  );
});

test("finite JS bounds and MAT ranks cannot bypass native Float32/identity validation", () => {
  assert.throws(
    () =>
      createNativeActorOrder([
        raw("bounds", [], {
          type: 5,
          bounds: { min: [0, 0, 0], max: [1e50, 1, 1] },
        }),
      ]),
    /Float32/,
  );
  assert.throws(
    () =>
      createNativeActorOrder([raw("material", [], { material: "name" })], {
        material: () => known(7),
      }),
    /identity/,
  );
});

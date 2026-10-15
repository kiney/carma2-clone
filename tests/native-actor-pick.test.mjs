import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
  removeNativeActor,
  prependNativeActor,
  allocateNativeOrderedActor,
} from "../src/native-actor-order.ts";
import {
  pickNativeActorBox,
  nativeActorPickMultiply as mul,
  nativeActorPickLPInverse as inverse,
  nativeActorPickApplyPoint as point,
  nativeActorPickTransformBounds as transformed,
  nativeActorPickBoundsOverlap as overlap,
  nativeActorPickLeafBoundsTest as leaf,
} from "../src/native-actor-pick.ts";
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  box = (min = -2, max = 2) => ({ min: [min, min, min], max: [max, max, max] });
const raw = (name, children = [], fields = {}) => ({
  name,
  type: 0,
  renderStyle: 0,
  transform: [...I],
  children,
  ...fields,
});
const rawModel = (name, children = [], fields = {}) =>
  raw(name, children, { type: 1, model: "m", ...fields });
const model = {},
  material = {},
  load = (roots) =>
    createNativeActorOrder(roots, {
      model: () => known(model),
      material: () => known(material),
    });
const query = () => ({
  matrix: I,
  originalBounds: box(-10, 10),
  realBounds: box(-10, 10),
  center: [0, 0, 0],
  radius: 20,
});
const pick = (actor, changes = {}) =>
  pickNativeActorBox({
    actor,
    query: query(),
    inheritedModel: known(null),
    inheritedMaterial: known(null),
    pMat: null,
    capacity: 10,
    emitModels: true,
    worldCallbacks: known(null),
    providers: {
      modelBounds: () => known(box()),
      emitModel: (input) => ({
        resolved: true,
        rows: input.capacity ? [input] : [],
      }),
    },
    ...changes,
  });

test("installed synthetic ActorBoxPick capture: MODEL before children, transformed notifications, pull after exhaustion", () => {
  const state = load([
      raw("root", [
        raw("bounds", [rawModel("hidden")], { type: 5, bounds: box(100, 101) }),
        rawModel("ordinary"),
        rawModel("&1"),
        rawModel("&X", [rawModel("child")]),
      ]),
    ]),
    events = [];
  const callbacks = known({
    pullActorFromWorld: (actor) => {
      events.push(`pull ${actor.name}`);
      return known({ pulled: true });
    },
    stopGroovidelic: (actor) => events.push(`stop ${actor.name}`),
  });
  const supplied = {
    modelBounds: () => known(box()),
    emitModel: (input) => {
      events.push(`emit ${input.actor.name} ${input.capacity}`);
      return { resolved: true, rows: input.capacity ? [input] : [] };
    },
  };
  const result = pick(state.roots[0], {
    capacity: 2,
    worldCallbacks: callbacks,
    providers: supplied,
  });
  // Installed invented-record capture [101,2,201,102,1,202,303,104,0,400,303,402].
  assert.deepEqual(events, [
    "emit &X 2",
    "stop &X",
    "emit child 1",
    "stop child",
    "pull &1",
    "emit ordinary 0",
  ]);
  assert.equal(result.remainingCapacity, 0);
  assert.deepEqual(
    result.rows.map((r) => r.actor.name),
    ["&X", "child"],
  );
  events.length = 0;
  const skipped = pick(state.roots[0], {
    capacity: 2,
    emitModels: false,
    worldCallbacks: callbacks,
    providers: supplied,
  });
  assert.deepEqual(events, ["pull &1"]);
  assert.equal(skipped.remainingCapacity, 2);
});

test("raw render style1 prunes unresolved model and all descendants; style0 does not inherit style", () => {
  const state = createNativeActorOrder(
    [
      raw("root", [
        rawModel("blocked", [rawModel("child")], { renderStyle: 1 }),
        rawModel("default"),
      ]),
    ],
    { model: (name) => (name === "m" ? known(model) : known(null)) },
  );
  state.roots[0].firstChild.next.localModel = {
    resolved: false,
    requiredProvider: "unused-model",
  };
  const result = pick(state.roots[0]);
  assert.equal(result.resolved, true);
  assert.deepEqual(
    result.rows.map((r) => r.actor.name),
    ["default"],
  );
});

test("local NULL MODEL/MAT inherit; actual model/material identities reach emission unchanged", () => {
  const state = load([
    raw("root", [raw("inherited", [], { type: 1 })], {
      model: "m",
      material: "mat",
    }),
  ]);
  const result = pick(state.roots[0]);
  assert.equal(result.rows[0].model, model);
  assert.equal(result.rows[0].material, material);
  state.roots[0].firstChild.localMaterial = {
    resolved: false,
    requiredProvider: "native-unknown-material",
  };
  assert.equal(
    pick(state.roots[0]).requiredProvider,
    "native-unknown-material",
  );
  state.roots[0].localModel = known(null);
  assert.equal(
    pick(state.roots[0]).rows.length,
    0,
    "MODEL with NULL exits before children or material dependency",
  );
});

test("type5/6 authored finite BOUNDS use inclusive touching admission before children", () => {
  for (const type of [5, 6]) {
    const state = load([
      raw("bounds", [rawModel("child")], { type, bounds: box(10, 11) }),
    ]);
    assert.equal(pick(state.roots[0]).rows.length, 1);
    state.roots[0].bounds = known(box(10.0001, 11));
    assert.equal(pick(state.roots[0]).rows.length, 0);
    state.roots[0].bounds = {
      resolved: false,
      requiredProvider: "authored-type-data",
    };
    assert.equal(pick(state.roots[0]).requiredProvider, "authored-type-data");
  }
  assert.equal(overlap({ min: [NaN, 0, 0], max: [1, 1, 1] }, box()), false);
  assert.equal(overlap(box(), box(2, 3)), true);
});

test("only ampersand actors rebase; non-NULL identity matrix retains borrowed pointer and notification", () => {
  const M = [...I];
  M[9] = 3;
  const ordinary = load([rawModel("ordinary", [], { transform: M })]).roots[0];
  const a = pick(ordinary).rows[0];
  assert.equal(a.pMat, null);
  assert.deepEqual(a.query.center, [0, 0, 0]);
  const amp = load([rawModel("&X", [], { transform: M })]).roots[0];
  const b = pick(amp).rows[0];
  assert.equal(b.pMat, amp.matrix);
  assert.deepEqual(b.query.center, [-3, 0, 0]);
  assert.deepEqual(b.query.originalBounds, query().originalBounds);
  assert.equal(b.query.radius, 20);
  const identityPointer = [...I],
    stops = [];
  const c = pick(ordinary, {
    pMat: identityPointer,
    worldCallbacks: known({ stopGroovidelic: (actor) => stops.push(actor) }),
  }).rows[0];
  assert.equal(c.pMat, identityPointer);
  assert.deepEqual(stops, [ordinary]);
});

test("nested ampersand composition carries full native matrix and LP-rebased query independently", () => {
  const outer = [...I];
  outer[9] = 2;
  const inner = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 3, 0];
  const state = load([
    rawModel("&outer", [rawModel("&inner", [], { transform: inner })], {
      transform: outer,
    }),
  ]);
  const result = pick(state.roots[0]);
  assert.equal(result.rows.length, 2);
  const child = result.rows[1];
  assert.deepEqual(child.pMat, mul(inner, outer));
  assert.deepEqual(
    child.query.matrix,
    mul(mul(I, inverse(outer)), inverse(inner)),
  );
  assert.deepEqual(
    child.query.center,
    point(point([0, 0, 0], inverse(outer)), inverse(inner)),
  );
});

test("native LP inverse transposes scale instead of replacing it with a mathematical inverse", () => {
  const scaled = [2, 0, 0, 0, 3, 0, 0, 0, 4, 5, 6, 7],
    inv = inverse(scaled);
  assert.deepEqual(inv, [2, 0, 0, 0, 3, 0, 0, 0, 4, -10, -18, -28]);
  assert.deepEqual(mul(scaled, inv), [4, 0, 0, 0, 9, 0, 0, 0, 16, 0, 0, 0]);
});

test("ampersand leaf requires MODEL type and inherited MODEL; missing critical metadata is explicit", () => {
  let state = load([raw("&none", [rawModel("child")])]);
  assert.equal(
    pick(state.roots[0]).rows.length,
    0,
    "no effective MODEL prunes ampersand subtree",
  );
  state = load([raw("&none", [], { model: "m" })]);
  assert.equal(
    pick(state.roots[0]).rows.length,
    0,
    "non-MODEL ampersand leaf prunes",
  );
  state = load([rawModel("&X")]);
  assert.equal(
    pick(state.roots[0], {
      providers: {
        modelBounds: () => ({
          resolved: false,
          requiredProvider: "native-model-bounds",
        }),
      },
    }).requiredProvider,
    "native-model-bounds",
  );
  state.roots[0].localModel = {
    resolved: false,
    requiredProvider: "native-model-identity",
  };
  assert.equal(pick(state.roots[0]).requiredProvider, "native-model-identity");
});

test("digit ampersand uses actual own MODEL for second gate and non-NULL pull prunes only this subtree", () => {
  const state = load([
    raw("root", [rawModel("sibling"), raw("&1", [rawModel("child")])], {
      model: "m",
    }),
  ]);
  const result = pick(state.roots[0]);
  assert.equal(
    result.requiredProvider,
    "native-digit-actor-own-model-provider",
  );
  const digit = state.roots[0].firstChild;
  digit.localModel = known(model);
  assert.deepEqual(
    pick(state.roots[0], {
      worldCallbacks: known({
        pullActorFromWorld: () => known({ removed: true }),
      }),
    }).rows.map((r) => r.actor.name),
    ["sibling"],
  );
  assert.equal(
    pick(digit, {
      worldCallbacks: {
        resolved: false,
        requiredProvider: "native-world-callback-table",
      },
    }).requiredProvider,
    "native-world-callback-table",
  );
});

test("snapshot-next survives actual stop callback removal and prepended sibling", () => {
  const state = load([
      raw("root", [rawModel("old"), rawModel("&current")]),
      raw("destination"),
    ]),
    root = state.roots[0],
    destination = state.roots[1];
  const added = allocateNativeOrderedActor(state, {
    name: "new",
    type: 1,
    renderStyle: 0,
    matrix: I,
    localModel: known(model),
    localMaterial: known(null),
    bounds: known(null),
    provenance: "synthetic",
  });
  const result = pick(root, {
    worldCallbacks: known({
      stopGroovidelic: (actor) => {
        prependNativeActor(root, added);
        removeNativeActor(actor);
        prependNativeActor(destination, actor);
      },
    }),
  });
  assert.deepEqual(
    result.rows.map((r) => r.actor.name),
    ["&current", "old"],
  );
});

test("source output capacity rejects over-emission, retains earlier rows on unresolved later metadata", () => {
  const state = load([raw("root", [rawModel("later"), rawModel("first")])]);
  const callbacks = {
    modelBounds: () => known(box()),
    emitModel: (input) =>
      input.actor.name === "first"
        ? { resolved: true, rows: [input] }
        : { resolved: false, requiredProvider: "prepared-material-order" },
  };
  const result = pick(state.roots[0], { providers: callbacks });
  assert.equal(result.resolved, false);
  assert.equal(result.requiredProvider, "prepared-material-order");
  assert.equal(result.remainingCapacity, 9);
  assert.equal(result.rows[0].actor.name, "first");
  assert.throws(
    () =>
      pick(state.roots[0], {
        capacity: 0,
        providers: {
          modelBounds: () => known(box()),
          emitModel: () => ({ resolved: true, rows: [1] }),
        },
      }),
    /capacity/,
  );
  assert.throws(() => pick(state.roots[0], { capacity: -1 }), /capacity/);
  assert.throws(
    () => pick(state.roots[0], { pMat: [1e50, ...I.slice(1)] }),
    /Float32/,
  );
});

// Safe synthetic input/output captured from installed helpers, seed871633 case0.
test("installed matrix/bounds/point captured fixture preserves each Float32 component", () => {
  const input = [
    -46.04473114013672, 17.350740432739258, -35.492191314697266,
    -14.60659122467041, -13.226574897766113, -41.19813537597656,
    -5.471827983856201, 29.4575138092041, -9.433751106262207, 8.457566261291504,
    -45.52302551269531, 12.352555274963379, -39.49001693725586,
    3.4991567134857178, -42.46702575683594, -0.6645597219467163,
    47.324771881103516, -9.516678810119629, -26.2841796875, 49.086917877197266,
    24.63916015625, 22.95565414428711, -16.763113021850586, 4.147369861602783,
    24.030378341674805, -11.150662422180176, -32.94285583496094,
    37.039180755615234, -9.540081977844238, -16.596559524536133,
    -32.53546905517578, 24.671995162963867, -23.432191848754883,
  ];
  const expected = [
    2739.65966796875, -1082.2001953125, 915.7635498046875, 1668.463623046875,
    -2699.344970703125, -268.9158935546875, 444.4647216796875,
    911.8495483398438, -280.4051513671875, -605.457763671875,
    -1535.1866455078125, 382.5643005371094, -46.04473114013672,
    -14.60659122467041, -5.471827983856201, 17.350740432739258,
    -13.226574897766113, 29.4575138092041, -35.492191314697266,
    -41.19813537597656, -9.433751106262207, 1617.703857421875,
    30.324750900268555, 1503.804443359375, -1466.8399658203125,
    -472.8101806640625, -752.6477661132812, -754.8839111328125,
    255.7258758544922, -70.37702941894531, 1274.3876953125, -1626.6175537109375,
    371.7209167480469,
  ];
  const a = input.slice(0, 12),
    b = input.slice(12, 24),
    out = transformed(
      { min: input.slice(24, 27), max: input.slice(27, 30) },
      a,
    );
  assert.deepEqual(
    [
      ...mul(a, b),
      ...inverse(a),
      ...out.min,
      ...out.max,
      ...point(input.slice(30), a),
    ],
    expected,
  );
});

test("installed live leaf boundary rejects where rounded transformed AABB would admit", () => {
  const m = [
      1.2514222860336304, -3.9323065280914307, -0.24592788517475128,
      -0.743089497089386, 1.2837576866149902, -0.8217501044273376,
      -1.2497196197509766, 2.8478188514709473, -2.1058695316314697,
      -0.18811815977096558, 4.978461742401123, -3.765671491622925,
    ],
    b = {
      min: [-1.880475640296936, 3.705972671508789, -3.514707088470459],
      max: [1.0107011795043945, 5.487290859222412, -1.237686038017273],
    };
  for (const target of [
    { min: [-1000, -1000, -1000], max: [-5.072175025939941, 1000, 1000] },
    { min: [2.7152247428894043, -1000, -1000], max: [1000, 1000, 1000] },
  ]) {
    assert.equal(leaf(b, target, m), false);
    assert.equal(overlap(transformed(b, m), target), true);
  }
});

// Retain the pre-optimization generic arithmetic as an independent differential
// oracle. Installed captures above remain the authority for operation ordering.
const storedScalar = (value) => {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new Error("native actor pick requires finite Float32 scalars");
  return Math.fround(value);
};
const storedMatrix = (value) => {
  if (value.length !== 12)
    throw new Error("native actor pick requires twelve matrix scalars");
  return Array.from(value, storedScalar);
};
const storedVector = (value) => {
  if (value.length !== 3)
    throw new Error("native actor pick requires three vector scalars");
  return value.map(storedScalar);
};
const storedBounds = (value) => {
  const min = storedVector(value.min),
    max = storedVector(value.max);
  if (min.some((v, i) => v > max[i]))
    throw new Error("native actor pick bounds are reversed");
  return { min, max };
};
function referenceMultiply(a, b) {
  const A = storedMatrix(a),
    B = storedMatrix(b),
    out = [];
  const orders = [
    [2, 1, 0],
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [0, 2, 1],
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 0, 2],
    [0, 1, 2],
    [1, 0, 2],
    [0, 1, 2],
  ];
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 3; column++) {
      const terms = [0, 1, 2].map((k) => A[3 * row + k] * B[3 * k + column]);
      const order = orders[3 * row + column];
      const sum = terms[order[0]] + terms[order[1]] + terms[order[2]];
      out.push(storedScalar(row === 3 ? sum + B[9 + column] : sum));
    }
  return out;
}
function referenceInverse(value) {
  const M = storedMatrix(value),
    out = Array(12);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      out[3 * row + column] = M[3 * column + row];
  const orders = [
    [0, 2, 1],
    [2, 0, 1],
    [2, 0, 1],
  ];
  for (let column = 0; column < 3; column++) {
    const terms = [0, 1, 2].map((k) => M[9 + k] * out[3 * k + column]);
    const order = orders[column];
    out[9 + column] = storedScalar(
      -(terms[order[0]] + terms[order[1]] + terms[order[2]]),
    );
  }
  return out;
}
function referencePoint(value, matrix) {
  const V = storedVector(value),
    M = storedMatrix(matrix);
  return [0, 1, 2].map((column) =>
    storedScalar(
      V[2] * M[6 + column] +
        V[1] * M[3 + column] +
        V[0] * M[column] +
        M[9 + column],
    ),
  );
}
function referenceTransformed(value, matrix) {
  const b = storedBounds(value),
    M = storedMatrix(matrix);
  const first = referencePoint(b.min, M),
    min = [...first],
    max = [...first];
  const extent = b.min.map((v, i) => storedScalar(b.max[i] - v));
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++) {
      const contribution = storedScalar(extent[row] * M[3 * row + column]);
      const output = contribution < 0 ? min : max;
      output[column] = storedScalar(output[column] + contribution);
    }
  return { min, max };
}
function referenceLeaf(value, target, matrix) {
  const b = storedBounds(value),
    other = storedBounds(target),
    M = storedMatrix(matrix);
  const extent = b.min.map((v, i) => storedScalar(b.max[i] - v));
  for (const column of [0, 2, 1]) {
    const terms = [0, 1, 2].map((row) => M[3 * row + column] * b.min[row]);
    const base =
      (column === 0
        ? terms[0] + terms[1] + terms[2]
        : terms[0] + terms[2] + terms[1]) + M[9 + column];
    const high = [0, 1, 2].map((row) =>
      M[3 * row + column] > 0 ? M[3 * row + column] * extent[row] : 0,
    );
    if (base + high[2] + high[1] + high[0] < other.min[column]) return false;
    const low = [0, 1, 2].map((row) =>
      M[3 * row + column] < 0 ? M[3 * row + column] * extent[row] : 0,
    );
    if (base + low[2] + low[1] + low[0] > other.max[column]) return false;
  }
  return true;
}
const outcome = (fn, args) => {
  try {
    return { value: fn(...args) };
  } catch (error) {
    return { error: error.constructor.name, message: error.message };
  }
};
const matchesReference = (fn, reference, args, label) =>
  assert.deepEqual(outcome(fn, args), outcome(reference, args), label);

test("scalar native kernels preserve pre-optimization Float32 arithmetic across adversarial inputs", () => {
  let seed = 0x19c2f32;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
  const sample = () => (random() - 0.5) * 2 ** Math.floor(random() * 60 - 30);
  for (let trial = 0; trial < 512; trial++) {
    const a = Array.from({ length: 12 }, sample),
      b = Array.from({ length: 12 }, sample);
    const min = Array.from({ length: 3 }, sample);
    const bounds = { min, max: min.map((v) => v + Math.abs(sample())) };
    const target = referenceTransformed(bounds, a);
    matchesReference(mul, referenceMultiply, [a, b], `multiply ${trial}`);
    matchesReference(inverse, referenceInverse, [a], `inverse ${trial}`);
    matchesReference(point, referencePoint, [min, a], `point ${trial}`);
    matchesReference(
      transformed,
      referenceTransformed,
      [bounds, a],
      `bounds ${trial}`,
    );
    for (let axis = 0; axis < 3; axis++) {
      const boundary = { min: [...target.min], max: [...target.max] };
      boundary.max[axis] = boundary.min[axis];
      matchesReference(
        leaf,
        referenceLeaf,
        [bounds, boundary, a],
        `leaf low ${trial}/${axis}`,
      );
      boundary.min[axis] = boundary.max[axis] = target.max[axis];
      matchesReference(
        leaf,
        referenceLeaf,
        [bounds, boundary, a],
        `leaf high ${trial}/${axis}`,
      );
    }
  }
  const extremes = [
    0,
    -0,
    Number.MIN_VALUE,
    -(2 ** -149),
    2 ** -126,
    1 + 2 ** -24,
    2 ** 24 + 1,
    -(2 ** 24 + 1),
    3.4028234663852886e38,
  ];
  for (const value of extremes) {
    const matrix = Array(12).fill(value),
      bounds = box(-Math.abs(value), Math.abs(value));
    matchesReference(
      mul,
      referenceMultiply,
      [matrix, matrix],
      `extreme multiply ${value}`,
    );
    matchesReference(
      inverse,
      referenceInverse,
      [matrix],
      `extreme inverse ${value}`,
    );
    matchesReference(
      point,
      referencePoint,
      [[value, value, value], matrix],
      `extreme point ${value}`,
    );
    matchesReference(
      transformed,
      referenceTransformed,
      [bounds, matrix],
      `extreme bounds ${value}`,
    );
    matchesReference(
      leaf,
      referenceLeaf,
      [bounds, bounds, matrix],
      `extreme leaf ${value}`,
    );
  }
});

test("scalar native kernels retain public validation before rejection and arithmetic", () => {
  for (const invalid of [NaN, Infinity, -Infinity, 1e50])
    for (let component = 0; component < 12; component++) {
      const matrix = [...I];
      matrix[component] = invalid;
      matchesReference(mul, referenceMultiply, [matrix, I]);
      matchesReference(inverse, referenceInverse, [matrix]);
      matchesReference(point, referencePoint, [[0, 0, 0], matrix]);
      matchesReference(transformed, referenceTransformed, [box(), matrix]);
      matchesReference(leaf, referenceLeaf, [box(), box(100, 101), matrix]);
    }
  for (const matrix of [I.slice(0, 11), [...I, 0]])
    matchesReference(mul, referenceMultiply, [matrix, I]);
  matchesReference(transformed, referenceTransformed, [box(2, -2), I]);
  matchesReference(leaf, referenceLeaf, [box(-3e38, 3e38), box(), I]);
  matchesReference(mul, referenceMultiply, [
    new Float32Array(I),
    new Float64Array(I),
  ]);
});

for (const root of ["data", "adv_data"])
  test(`original ${root} ACT admission topology with MOCK finite model bounds, no migration claim`, async (t) => {
    const installation =
      process.env.CARMA2_ROOT ??
      new URL("../carma2_orig/", import.meta.url).pathname;
    try {
      await access(installation);
    } catch {
      t.skip("original installation unavailable");
      return;
    }
    const store = await createAssetStore(installation);
    let actors, models;
    try {
      actors = parseAct(
        await store.read(`${root}/RACES/newcity1/newcity1.ACT`),
      );
      models = parseDat(
        await store.read(`${root}/RACES/newcity1/newcity1.DAT`),
      );
    } catch {
      t.skip("original Newcity ACT/DAT unavailable");
      return;
    }
    const resources = new Map(models.map((m) => [m.name.toLowerCase(), m])),
      materialResources = new Map(),
      state = createNativeActorOrder(actors, {
        model: (name) => known(resources.get(name.toLowerCase()) ?? null),
        material: (name) => {
          if (!materialResources.has(name))
            materialResources.set(name, { name });
          return known(materialResources.get(name));
        },
      });
    let calls = 0;
    const large = {
      matrix: I,
      originalBounds: box(-1e7, 1e7),
      realBounds: box(-1e7, 1e7),
      center: [0, 0, 0],
      radius: 1e7,
    };
    const result = pick(state.roots[0], {
      query: large,
      capacity: 76,
      providers: {
        modelBounds: () => known(box(-100, 100)),
        emitModel: (input) => {
          calls++;
          return { resolved: true, rows: input.capacity ? [input.actor] : [] };
        },
      },
    });
    assert.equal(result.resolved, true);
    assert.equal(calls, 1346);
    assert.equal(result.rows.length, 76);
    assert.equal(result.remainingCapacity, 0);
    assert.equal(new Set(result.rows).size, 76);
    // Actual authored type-5 BOUNDS and matrices are used. MODEL bounds and emission
    // are explicit MOCK providers; this is not a migrated/prepared collision prefix.
  });

test("critical primitive resource identities are rejected instead of passed as native pointers", () => {
  const state = createNativeActorOrder([raw("model", [], { type: 1 })]);
  assert.throws(
    () => pick(state.roots[0], { inheritedModel: known(17) }),
    /identity/,
  );
});

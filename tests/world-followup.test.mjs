import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";
import { NativeDelayedSideEffects } from "../src/smash-delayed.ts";
import {
  WorldFollowupRuntime,
  classifyFollowupTarget,
  followupBounds,
  followupDelayMs,
  resolveFollowupActorSpec,
} from "../src/world-followup.ts";

const matrix = (x = 0, y = 0, z = 0) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];
const effect = (overrides = {}) => ({
  target: "*.DAT",
  coordinates: "relative",
  min: [-1, -1, -1],
  max: [1, 1, 1],
  delaySeconds: [1, 1],
  direction: "away",
  strength: 10,
  ...overrides,
});
const actor = (position = [3, 4, 0], identifier = "abcde|00xxxx") => ({
  identity: {},
  readIdentifier: () => identifier,
  readTranslation: () => position,
});
const face = (owner = actor(), overrides = {}) => ({
  actor: owner,
  groupIndex: 2,
  faceIndex: 7,
  vertices: [
    [0, 0, 0],
    [3, 0, 0],
    [0, 3, 0],
  ],
  normal: [0, 0, 1],
  ...overrides,
});
function fixture(faces, extra = {}) {
  const pool = extra.delayed ?? new NativeDelayedSideEffects();
  const due = [],
    queries = [];
  let time = 100,
    draws = 0,
    clockReads = 0,
    pose = matrix(),
    velocity = [1, 2, 3];
  const source = {
    actor: {},
    readMatrix: () => pose,
    readVelocity: () => velocity,
  };
  const runtime = new WorldFollowupRuntime({
    delayed: pool,
    readTimeMs: () => {
      clockReads++;
      return time;
    },
    readTrackMatrix: () => matrix(90),
    random: () => {
      draws++;
      return 0;
    },
    collectFaces: (query, capacity) => {
      queries.push({ ...query, capacity });
      return faces;
    },
    onDue: (context) => due.push(context),
    ...extra,
  });
  return {
    runtime,
    pool,
    source,
    due,
    queries,
    setTime: (value) => (time = value),
    setPose: (value) => (pose = value),
    setVelocity: (value) => (velocity = value),
    draws: () => draws,
    clockReads: () => clockReads,
    update: (now) =>
      pool.update(now, (entry, clock) => entry.context.advance(clock)),
  };
}

test("installed target classes separate material, ordinary ACT and numbered selectors", () => {
  assert.deepEqual(
    [
      "*",
      "*.mAt",
      "*.DAT",
      "*.act",
      "&*",
      "&20",
      "a.MAT",
      "a.DAT",
      "a.act",
      "unknown",
    ].map(classifyFollowupTarget),
    [
      "all",
      "materials",
      "actors",
      "actors",
      "numbers",
      "number-name",
      "material-name",
      "actor-name",
      "actor-name",
      "all",
    ],
  );
  const owner = actor();
  owner.ordinarySpec = { trigger: { kind: "model", name: "pylon.ACT" } };
  owner.ordinarySpecProxy = true;
  owner.readIdentifier = () => "pylon.ACT";
  const f = fixture([face(owner)]);
  assert.equal(
    f.runtime.enqueue([effect({ target: "PYLON.ACT" })], f.source, 4),
    0,
  );
  assert.equal(
    f.runtime.enqueue([effect({ target: "pylon.ACT" })], f.source, 4),
    1,
  );
  const number = actor([0, 0, 0], "&20          ");
  number.numbered = { registered: true, argument: 1 };
  const n = fixture([face(number)]);
  assert.equal(n.runtime.enqueue([effect()], n.source, 4), 0);
  assert.equal(n.runtime.enqueue([effect({ target: "&2" })], n.source, 4), 0);
  assert.equal(
    n.runtime.enqueue([effect({ target: "&20more" })], n.source, 4),
    1,
  );
});

test("relative two-corner bounds read live physics and retain track-root query matrix", () => {
  const f = fixture([]);
  const rotated = [
    Math.SQRT1_2,
    Math.SQRT1_2,
    0,
    0,
    -Math.SQRT1_2,
    Math.SQRT1_2,
    0,
    0,
    0,
    0,
    1,
    0,
    10,
    20,
    0,
    1,
  ];
  f.setPose(rotated);
  f.runtime.enqueue(
    [effect({ min: [-1, -1, 0], max: [1, 1, 0] })],
    f.source,
    4,
  );
  assert.equal(
    f.queries[0].min[0],
    10,
    "two corners collapse X despite the rotated eight-corner box extent",
  );
  assert.equal(f.queries[0].max[0], 10);
  assert.equal(
    f.queries[0].min[1],
    Math.fround(20 - 2 * Math.fround(Math.SQRT1_2)),
  );
  assert.equal(f.queries[0].trackMatrix[12], 90);
  assert.equal(f.queries[0].capacity, 400);
  assert.deepEqual(
    followupBounds(
      effect({ coordinates: "absolute", min: [3, 2, 1], max: [1, 2, 3] }),
      rotated,
    ),
    { min: [3, 2, 1], max: [1, 2, 3] },
    "absolute authored endpoints are not reordered",
  );
  f.setPose(matrix(30));
  f.runtime.enqueue([effect()], f.source, 4);
  assert.equal(f.queries[1].min[0], 29);
});

test("material precedence and face cap apply before ACT eligibility; source actor is excluded", () => {
  const material = { identifier: "abcde|01xxxx" };
  const both = face(actor(), { material });
  const f = fixture([both]);
  assert.equal(
    f.runtime.enqueue([effect()], f.source, 1),
    0,
    "packed material suppresses the ACT fallback",
  );
  assert.equal(
    f.runtime.enqueue([effect({ target: "*.MAT" })], f.source, 1),
    1,
  );
  f.update(1100);
  assert.equal(f.due[0].targetKind, "material");
  assert.deepEqual(f.due[0].point, [1, 1, 0]);
  const rejected = face(actor([0, 0, 0], "unbound"));
  const cap = fixture([...Array.from({ length: 400 }, () => rejected), face()]);
  assert.equal(cap.runtime.enqueue([effect()], cap.source, 1), 0);
  assert.equal(cap.draws(), 0);
  const self = fixture([face()]);
  self.source.actor = self.queries; // arbitrary stable source identity
  const selfFace = face({ ...actor(), identity: self.source.actor });
  const excluded = fixture([selfFace]);
  excluded.source.actor = self.source.actor;
  assert.equal(excluded.runtime.enqueue([effect()], excluded.source, 1), 0);
});

test("asymmetric pending dedup retains first context across cuboids and source physics", () => {
  const owner = actor();
  const material = { identifier: "abcde|01xxxx" };
  const first = face(owner, { material });
  const f = fixture([first]);
  assert.equal(
    f.runtime.enqueue([effect({ target: "*.MAT", strength: 8 })], f.source, 4),
    1,
  );
  delete first.material;
  const otherSource = { ...f.source, actor: {} };
  assert.equal(
    f.runtime.enqueue(
      [effect({ delaySeconds: [0, 0], strength: 90 })],
      otherSource,
      100,
    ),
    0,
    "incoming ACT suppresses any pending material of that ACT",
  );
  assert.equal(f.draws(), 1);
  f.update(1100);
  assert.equal(f.due[0].magnitude, 8);
  assert.equal(f.due[0].sourcePhysics, f.source);
  const second = face(owner, { faceIndex: 8 });
  const g = fixture([second]);
  assert.equal(g.runtime.enqueue([effect()], g.source, 4), 1);
  second.material = material;
  assert.equal(
    g.runtime.enqueue([effect({ target: "*.MAT" })], g.source, 4),
    0,
    "incoming material rejects same actor/group/face pending ACT",
  );
  second.faceIndex = 9;
  assert.equal(
    g.runtime.enqueue([effect({ target: "*.MAT" })], g.source, 4),
    1,
    "incoming material can queue a different face on pending ACT",
  );
});

test("retained float32 payload uses live source pose, raw velocity, negative strength and one clock sample", () => {
  const target = face();
  const f = fixture([target]);
  f.setPose(matrix(0, 0, 0));
  assert.equal(
    f.runtime.enqueue(
      [effect({ strength: -10 }), effect({ strength: 900 })],
      f.source,
      2.5,
    ),
    1,
  );
  assert.equal(f.clockReads(), 1);
  f.setVelocity([99, 99, 99]);
  f.setPose(matrix(100));
  target.vertices[0][0] = 99;
  target.normal[0] = 8;
  assert.equal(f.update(1099), 0);
  assert.equal(f.update(1100), 1);
  const queued = f.due[0];
  assert.deepEqual(queued.sourceVelocity, [1, 2, 3]);
  assert.deepEqual(queued.point, [3, 4, 0]);
  assert.equal(queued.magnitude, 25);
  assert.deepEqual(queued.force, [
    Math.fround(Math.fround(0.6) * 25),
    Math.fround(Math.fround(0.8) * 25),
    0,
  ]);
  assert.equal(queued.face.vertices[0][0], 0);
  assert.equal(queued.face.normal[0], 0);
  assert.equal(queued.selector, 1);
  assert.equal(queued.callerFlag, 0);
  const near = fixture([face(actor([2 ** -23, 0, 0]))]);
  near.runtime.enqueue(
    [effect({ direction: "towards", strength: 3 })],
    near.source,
    1,
  );
  near.update(1100);
  assert.deepEqual(
    near.due[0].force,
    [3, 0, 0],
    "normalization under threshold falls back +X even for towards",
  );
});

test("shared pool saturation still draws every admitted delay and delay words preserve native uint16 behavior", () => {
  const pool = new NativeDelayedSideEffects();
  for (let i = 0; i < 20; i++)
    pool.enqueue({ kind: "noncar", context: { advance: () => false } });
  const f = fixture([face(), face(), face()], { delayed: pool });
  assert.equal(f.runtime.enqueue([effect(), effect()], f.source, 1), 0);
  assert.equal(f.draws(), 6);
  assert.equal(pool.count, 20);
  let draws = 0;
  assert.equal(
    followupDelayMs([0, 0], () => {
      draws++;
      return 0.999;
    }),
    0,
  );
  assert.equal(draws, 1);
  assert.equal(
    followupDelayMs([-1, -1], () => 0),
    64536,
  );
  assert.equal(
    followupDelayMs([1, 3], () => 32767 / 32768),
    3000,
  );
  assert.equal(
    followupDelayMs([3, 1], () => 0.5),
    2001,
    "reversed range truncates signed product toward zero",
  );
  assert.throws(() => followupDelayMs([0.5, 1], () => 0), /integer/);
  const wrap = fixture([face()]);
  wrap.setTime(0xfffffffe);
  wrap.runtime.enqueue([effect()], wrap.source, 1);
  wrap.update(998);
  assert.equal(wrap.due[0].dueMs, 998);
});

test("due route reads live numeric identifier and exposes bit2 AFTER mandatory pull/release", () => {
  let id = "&20          ";
  const owner = actor();
  owner.readIdentifier = () => id;
  owner.numbered = { registered: true, argument: 1 };
  const f = fixture([face(owner)]);
  assert.equal(f.runtime.enqueue([effect({ target: "&*" })], f.source, 1), 1);
  id = "&20!         ";
  f.update(1100);
  assert.equal(
    f.due[0].route,
    "numbered",
    "released state is not a due-execution suppression",
  );
  assert.equal(f.due[0].numberedArgument, 1);
  assert.equal(f.due[0].eligibleAfterRelease, false);
  assert.equal(f.pool.count, 0);
  const g = fixture([face(owner)]);
  assert.equal(
    g.runtime.enqueue([effect({ target: "&*" })], g.source, 1),
    0,
    "already released is an enqueue exclusion",
  );
  id = "&20          ";
  owner.numbered.argument = 2;
  g.runtime.enqueue([effect({ target: "&*" })], g.source, 1);
  id = "x20          ";
  g.update(1100);
  assert.equal(
    g.due[0].route,
    "world",
    "numeric dispatch is determined at execution",
  );
});

test("metadata proxy excludes material/number bindings and resolves actual model last spec; parallel is explicit", () => {
  const specs = [
    { trigger: { kind: "model", name: "Pylon.ACT" } },
    { trigger: { kind: "material", name: "Pylon.MAT" } },
    { trigger: { kind: "model", name: "Sibling.DAT" } },
    { trigger: { kind: "model", name: "pylon.dat" } },
    { trigger: { kind: "number", name: "&20", index: 20, argument: 2 } },
  ];
  assert.equal(
    resolveFollowupActorSpec(specs, [4, 2, 3, 0, 1], ["PYLON.ACT"]),
    specs[3],
  );
  assert.equal(
    resolveFollowupActorSpec(specs, [1, 4], ["PYLON.ACT"]),
    undefined,
  );
  const renamedSpecs = [
    { trigger: { kind: "model", name: "&CORE.ACT" } },
    { trigger: { kind: "material", name: "CORE.MAT" } },
    { trigger: { kind: "model", name: "&CORE.ACT" } },
  ];
  assert.equal(
    resolveFollowupActorSpec(renamedSpecs, [0, 1, 2], ["&coR0122.ACT"]),
    renamedSpecs[2],
    "Carrier runtime rename retains authoritative original model tags",
  );
  assert.equal(
    resolveFollowupActorSpec(specs, [0, 2, 3], ["unmatched-runtime.ACT"]),
    undefined,
    "a sibling union needs original per-face identity",
  );
  assert.equal(
    resolveFollowupActorSpec(specs, [0, 2, 3]),
    specs[3],
    "adapter may explicitly accept authoritative actor metadata",
  );
  let unsupported = 0;
  const f = fixture([face()], { onUnsupportedDirection: () => unsupported++ });
  assert.equal(
    f.runtime.enqueue([effect({ direction: "parallel" })], f.source, 3),
    0,
  );
  assert.equal(unsupported, 1);
  assert.equal(f.draws(), 0);
});

test("installed Stock and Advanced carrier followup executes authored bounds, delay and force", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const base of ["data", "adv_data"]) {
    const bytes = await assets.read(
      `${base}/RACES/Carrier_mission/CARRIER_mission.txt`,
    );
    assert.ok(bytes);
    const specs = parseTrackSmashables(decodeText(bytes));
    const core = specs.find(
      (s) => s.trigger.name.toLowerCase() === "&core.act",
    );
    const authored = core.connotations.sideEffects[0];
    assert.deepEqual(
      authored,
      effect({
        target: "*.DAT",
        coordinates: "absolute",
        min: [53, -50, -2.5],
        max: [58, -42, 2.5],
        delaySeconds: [2, 2],
        strength: 1001,
      }),
    );
    const owner = actor([55, -45, 0], "ordinary.ACT");
    owner.ordinarySpec = { trigger: { kind: "model", name: "ordinary.ACT" } };
    owner.ordinarySpecProxy = true;
    const f = fixture([face(owner)]);
    f.setPose(matrix(55, -45, 0));
    f.runtime.enqueue(core.connotations.sideEffects, f.source, 12);
    assert.deepEqual(f.queries[0].min, [53, -50, -2.5]);
    assert.equal(f.update(2099), 0);
    assert.equal(f.update(2100), 1);
    assert.deepEqual(f.due[0].force, [1001, 0, 0]);
  }
});

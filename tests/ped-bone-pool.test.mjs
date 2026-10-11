import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NativePedBonePool,
  NativePedBonePoolProviderError,
} from "../src/physics/ped-bone-pool.ts";
import { parsePedForm } from "../src/ped-form.ts";
import { decodeText } from "../src/formats.ts";
import { nativePedBoneMassProperties } from "../src/physics/ped-bone-body.ts";
import { mutateNativePedSever } from "../src/physics/ped-sever.ts";

const f = Math.fround;
const bone = (name, massKg, collisionType = "BOX", parent = 0) => ({
  name,
  massKg,
  mass: f(massKg / 1000),
  collisionType,
  parent,
  jointType: "FALSE",
  jointRecords: [],
});
const form = {
  maxBoned: 10,
  bones: [
    bone("ROOT", 0, null, null),
    bone("THIGH", 12),
    bone("HEAD", 4, "SPHERE"),
    bone("HAND", 1),
  ],
};
function character(name, extra = {}) {
  return {
    owner: { name },
    formKey: "BIPED1",
    bonedSlot: -1,
    removedBoneMask: 0,
    vanishedBoneMask: 0,
    physicsFlags: 1,
    ...extra,
  };
}
const snapshot = (index) => ({
  actor: { index },
  model: { name: `actual-${index}` },
  nativePose: [1, 0, 0, 0, 1, 0, 0, 0, 1, index, 2, 3],
  bounds: { min: [-1, -2, -3], max: [1, 2, 3] },
});
const request = (c, index, source = form) => ({
  index,
  slot: c.bonedSlot,
  bone: source.bones[index],
  snapshot: snapshot(index),
  rigidType: 5,
  filterA: 0x40000,
  filterB: 0x50000,
  localOmega: [1, 2, 3],
  activation: null,
  clearParentJoint: true,
  clearChildren: true,
  clearLink188: true,
});
function fixture({
  source = form,
  code,
  deferred = false,
  supportsShape = () => true,
} = {}) {
  const log = [],
    bodies = [],
    headers = new Map(),
    queued = new Set();
  const host = {
    createBone: (key, slot, index, b) => {
      const body = {
        key,
        slot,
        index,
        mass: b.mass,
        shape: { kind: b.collisionType },
        owner: null,
        ring: null,
        rigidFlags: 0x80000041,
        friction: f(0.7),
        joint2: {},
      };
      log.push(["create", key, slot, index]);
      bodies.push(body);
      return body;
    },
    prepareBone: (a, body, r, reason) => {
      log.push(["prepare", body.index, reason]);
      body.owner = a.character.owner;
      body.actor = r.snapshot.actor;
      body.model = r.snapshot.model;
      body.pose = [...r.snapshot.nativePose];
      body.v = [0, 0, 0];
      body.omega = [0, 0, 0];
      body.aux = [0, 0, 0];
      body.ec = 1;
      body.ed = 1;
      body.rigidType = 5;
      const properties = nativePedBoneMassProperties(
        body.mass,
        r.snapshot.bounds,
      );
      body.center = properties.centerOfMass.toArray();
      body.inertia = properties.inertia.toArray();
    },
    finishBone: (a, body) => {
      log.push(["finish", body.index]);
      body.filters = [0x40000, 0x50000];
      body.properties = [
        [0, 1],
        [3, 0],
        [4, 1],
        [5, 1],
        [7, 1],
        [8, f(0.3)],
        [6, 1],
      ];
    },
    registrar: {
      registerImmediate: (body) => {
        log.push(["register", body.index]);
        const result =
          typeof code === "function"
            ? code(body)
            : (code ?? (headers.has(body) ? 2 : 0));
        if (!result) headers.set(body, 1);
        return result;
      },
      header: (body) => ({
        state: headers.get(body) ?? 0,
        queued: queued.has(body),
      }),
      remove: (body) => {
        log.push(["remove", body.index]);
        if (deferred) {
          queued.add(body);
          return { code: 0, phase: "deferred" };
        }
        return { code: headers.delete(body) ? 0 : 3, phase: "complete" };
      },
    },
    clearBone: (a, body, index) => {
      log.push(["clear", index]);
      body.owner = null;
      body.ring = null;
    },
    supportsShape,
    onSlotReleased: (a) =>
      log.push(["released", a.slot, a.character.bonedSlot]),
  };
  const pool = new NativePedBonePool(host);
  pool.registerForm("BIPED1", source);
  return { pool, host, log, bodies, headers, queued };
}
function severOne(fixture, c, index = 2, source = form) {
  fixture.pool.reserve(c);
  const result = fixture.pool.registerBone(c, request(c, index, source));
  if (result.registration) c.removedBoneMask |= 1 << index;
  return result;
}

test("FORM allocates bone-major stable objects/shapes once, leaves zero-mass entries NULL", () => {
  const { pool, log, bodies } = fixture();
  assert.equal(bodies.length, 30);
  assert.deepEqual(
    log.slice(0, 11).map((r) => r.slice(2)),
    [...Array.from({ length: 10 }, (_, i) => [i, 1]), [0, 2]],
  );
  pool.registerForm("BIPED1", form);
  assert.equal(bodies.length, 30);
  const c = character("Blokebl");
  pool.reserve(c);
  assert.equal(pool.allocation(c).bodies[0], null);
  assert.equal(pool.allocation(c).bodies[2].mass, f(0.004));
  assert.deepEqual(pool.counts("BIPED1"), {
    capacity: 10,
    owned: 1,
    releasePending: 0,
    physicalResources: 30,
  });
});
test("ten source slots share personalities, exhaust without PHIL allocation or eviction", () => {
  const { pool, log } = fixture();
  const owners = Array.from({ length: 11 }, (_, i) =>
    character(`personality-${i}`),
  );
  assert.deepEqual(
    owners.map((c) => pool.reserve(c)),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null],
  );
  assert.equal(owners[10].bonedSlot, -1);
  assert.equal(pool.reserve(owners[3]), 3);
  assert.equal(
    log.some((r) => r[0] === "register"),
    false,
  );
});
test("type5 prep/register/finish order and actual FORM mass/inertia use the same body", () => {
  const fx = fixture(),
    c = character("Blokebl");
  const result = severOne(fx, c),
    body = result.registration.body;
  assert.equal(body, fx.pool.allocation(c).bodies[2]);
  assert.deepEqual(fx.log.slice(-3), [
    ["prepare", 2, "sever"],
    ["register", 2],
    ["finish", 2],
  ]);
  assert.deepEqual(body.inertia, [
    f(f(0.004) * 52 * f(0.025)),
    f(f(0.004) * 40 * f(0.025)),
    f(f(0.004) * 20 * f(0.025)),
  ]);
  assert.deepEqual(body.v, [0, 0, 0]);
  assert.equal(body.ec, 1);
  assert.deepEqual(body.filters, [0x40000, 0x50000]);
  assert.equal(body.rigidFlags, 0x80000041);
  assert.equal(body.friction, f(0.7));
});
test("ordinary registration failure retains prepared body/slot, no mask mutation or property tail", () => {
  for (const code of [1, 2]) {
    const fx = fixture({ code }),
      c = character(`failure-${code}`);
    const r = severOne(fx, c);
    assert.equal(r.code, code);
    assert.equal(r.registration, null);
    assert.equal(c.bonedSlot, 0);
    assert.equal(c.removedBoneMask, 0);
    assert.equal(fx.pool.counts("BIPED1").owned, 1);
    assert.equal(fx.pool.allocation(c).bodies[2].owner, c.owner);
    assert.equal(
      fx.log.some((r) => r[0] === "finish"),
      false,
    );
    //4090dd: a reservation with no missing-mask bits is not released here.
    assert.equal(fx.pool.releaseRemovedParts(c), "not-applicable");
    assert.equal(c.bonedSlot, 0);
  }
});
test("successful PHIL return requires a real passive header, not an invented state", () => {
  const fx = fixture(),
    c = character("false-success");
  fx.pool.reserve(c);
  fx.host.registrar.registerImmediate = () => 0;
  assert.throws(
    () => fx.pool.registerBone(c, request(c, 2)),
    /actual passive header/,
  );
  assert.equal(
    fx.log.some((r) => r[0] === "finish"),
    false,
  );
});
test("release marks every state2 part vanished before removal, including ec1 quiet bodies", () => {
  const fx = fixture(),
    c = character("active-quiet");
  const one = severOne(fx, c, 1).registration.body,
    head = severOne(fx, c, 2).registration.body;
  fx.headers.set(one, 2);
  one.ec = 1;
  fx.host.registrar.remove = (body) => {
    if (body === one) assert.equal(c.vanishedBoneMask, 2);
    fx.log.push(["remove", body.index]);
    fx.headers.delete(body);
    return { code: 0, phase: "complete" };
  };
  assert.equal(fx.pool.releaseRemovedParts(c), "complete");
  assert.equal(c.vanishedBoneMask, 2);
  assert.equal(c.removedBoneMask, 6);
  assert.equal(c.bonedSlot, -1);
  assert.equal(c.physicsFlags, 1);
  assert.equal(head.owner, null);
  assert.equal(one.owner, null);
  assert.deepEqual(fx.log.slice(-5), [
    ["remove", 1],
    ["clear", 1],
    ["remove", 2],
    ["clear", 2],
    ["released", 0, -1],
  ]);
});
test("released slot reuses exact body/shape/joint identity across personality owners", () => {
  const fx = fixture(),
    old = character("Blokebl"),
    next = character("Bandsman");
  const body = severOne(fx, old).registration.body,
    shape = body.shape,
    joint2 = body.joint2;
  fx.pool.releaseRemovedParts(old);
  body.rigidFlags = 0x4001;
  body.friction = f(0.45);
  body.v = [40, 50, 60];
  const r = severOne(fx, next);
  assert.equal(next.bonedSlot, 0);
  assert.equal(r.registration.body, body);
  assert.equal(body.shape, shape);
  assert.equal(body.joint2, joint2);
  assert.equal(body.owner, next.owner);
  assert.deepEqual(body.v, [0, 0, 0]);
  assert.equal(body.rigidFlags, 0x4001);
  assert.equal(body.friction, f(0.45));
  assert.equal(fx.bodies.length, 30);
});
test("deferred removal retains ownership and callback until actual header and queue are absent", () => {
  const fx = fixture({ deferred: true }),
    c = character("deferred");
  const body = severOne(fx, c).registration.body;
  fx.headers.set(body, 2);
  assert.equal(fx.pool.releaseRemovedParts(c), "release-pending");
  assert.equal(c.vanishedBoneMask, 4);
  assert.equal(c.bonedSlot, 0);
  assert.equal(body.owner, c.owner);
  assert.throws(() => fx.pool.reserve(c), /pending/);
  const other = character("other");
  assert.equal(fx.pool.reserve(other), 1);
  fx.headers.delete(body);
  assert.equal(fx.pool.releaseRemovedParts(c), "release-pending");
  fx.queued.delete(body);
  assert.equal(fx.pool.releaseRemovedParts(c), "complete");
  assert.equal(fx.log.filter((r) => r[0] === "remove").length, 1);
  assert.equal(fx.log.filter((r) => r[0] === "released").length, 1);
  assert.equal(fx.pool.releaseRemovedParts(c), "not-applicable");
});
test("lying removal result cannot free a live header or make a slot reusable", () => {
  const fx = fixture(),
    c = character("bad-host");
  severOne(fx, c);
  fx.host.registrar.remove = () => ({ code: 0, phase: "complete" });
  assert.throws(() => fx.pool.releaseRemovedParts(c), /released header proof/);
  assert.equal(fx.pool.counts("BIPED1").owned, 1);
});
test("reacquire visits removed&&!vanished ascending, tolerates failure and zeros velocity", () => {
  const fx = fixture({ code: (body) => (body.index === 1 ? 1 : 0) }),
    c = character("restored", {
      removedBoneMask: 14,
      vanishedBoneMask: 4,
    });
  const read = [];
  const result = fx.pool.reacquire(c, (i) => {
    read.push(i);
    return snapshot(i);
  });
  assert.deepEqual(read, [1, 3]);
  assert.deepEqual(result, {
    slot: 0,
    results: [
      { index: 1, code: 1 },
      { index: 3, code: 0 },
    ],
  });
  assert.equal(c.vanishedBoneMask, 4);
  const body = fx.pool.allocation(c).bodies[3];
  assert.deepEqual(body.v, [0, 0, 0]);
  assert.deepEqual(body.omega, [0, 0, 0]);
  assert.deepEqual(
    fx.log.filter((r) => r[0] === "prepare"),
    [
      ["prepare", 1, "reacquire"],
      ["prepare", 3, "reacquire"],
    ],
  );
});
test("missing stored part pose and unsupported shape explicitly require real providers", () => {
  const fx = fixture(),
    c = character("missing", { removedBoneMask: 4 });
  assert.throws(
    () => fx.pool.reacquire(c, () => null),
    NativePedBonePoolProviderError,
  );
  const line = {
    ...form,
    bones: [...form.bones.slice(0, 2), bone("HEAD", 4, "LINE"), form.bones[3]],
  };
  const lines = fixture({
      source: line,
      supportsShape: (b) => b.collisionType !== "LINE",
    }),
    d = character("line");
  lines.pool.reserve(d);
  assert.throws(
    () => lines.pool.registerBone(d, request(d, 2, line)),
    /analytic-LINE-shape/,
  );
  assert.equal(
    lines.log.some((r) => r[0] === "prepare"),
    false,
  );
});
test("source external slot adoption requires occupancy proof and prevents owner theft", () => {
  const fx = fixture(),
    c = character("external", { bonedSlot: 3 });
  assert.throws(() => fx.pool.reserve(c), /adoption/);
  assert.throws(() => fx.pool.adopt(c), /adoption/);
  fx.host.confirmAdoption = () => false;
  assert.throws(() => fx.pool.adopt(c), /not proved/);
  fx.host.confirmAdoption = (a) =>
    a.character.owner === c.owner && a.slot === 3;
  const a = fx.pool.adopt(c);
  assert.equal(a.slot, 3);
  assert.equal(fx.pool.reserve(c), 3);
  assert.throws(
    () => fx.pool.adopt(character("thief", { bonedSlot: 3 })),
    /another character/,
  );
});
test("unmasked stray/queued PHIL resources block slot release and fresh reservation", () => {
  const fx = fixture(),
    c = character("stray");
  severOne(fx, c);
  const stray = fx.pool.allocation(c).bodies[1];
  fx.queued.add(stray);
  assert.throws(() => fx.pool.releaseRemovedParts(c), /unreleased PHIL/);
  assert.equal(c.bonedSlot, 0);
  fx.queued.delete(stray);
  assert.equal(fx.pool.releaseRemovedParts(c), "complete");
  fx.queued.add(stray);
  assert.throws(() => fx.pool.reserve(character("next")), /release proof/);
});
test("bounded FORM allocation rejects duplicate resources, mask overflow and articulated ownership", () => {
  const fx = fixture();
  assert.throws(
    () => fx.pool.registerForm("BIPED1", { ...form, maxBoned: 9 }),
    /Conflicting/,
  );
  assert.throws(
    () => fx.pool.registerForm("huge", { ...form, maxBoned: 129 }),
    /capacity/,
  );
  assert.throws(
    () =>
      fx.pool.registerForm("wide", {
        ...form,
        bones: Array(33).fill(form.bones[1]),
      }),
    /bone count/,
  );
  assert.throws(
    () => fx.pool.reserve(character("badmask", { removedBoneMask: 16 })),
    /masks exceed/,
  );
  assert.throws(
    () => fx.pool.reserve(character("articulated", { physicsFlags: 2 })),
    /articulated/,
  );
  fx.host.createBone = () => fx.bodies[0];
  assert.throws(
    () => fx.pool.registerForm("same-resource", form),
    /distinct stable identities/,
  );
});
test("FORM registry obeys20 identities and signed-byte capacities without silently truncating", () => {
  const fx = fixture();
  for (let i = 1; i < 20; i++) fx.pool.registerForm(`FORM-${i}`, form);
  assert.throws(() => fx.pool.registerForm("FORM-20", form), /exhausted/);
  const empty = fixture({ source: { ...form, maxBoned: 0 } });
  assert.equal(empty.pool.reserve(character("none")), null);
  assert.equal(empty.bodies.length, 0);
  const largest = fixture({ source: { ...form, maxBoned: 128 } });
  const last = Array.from({ length: 128 }, (_, i) => character(`${i}`));
  last.forEach((c, i) => assert.equal(largest.pool.reserve(c), i));
  assert.equal(last[127].bonedSlot, 127);
});
test("immutable resource table cannot replace a stable physical body during preparation", () => {
  const fx = fixture(),
    c = character("stable");
  fx.pool.reserve(c);
  const array = fx.pool.allocation(c).bodies;
  assert.throws(() => {
    array[2] = {};
  }, TypeError);
  assert.equal(
    array[2],
    fx.bodies.find((body) => body.slot === 0 && body.index === 2),
  );
});
test("absent PHIL removal code3 still clears owner once and frees the source slot", () => {
  const fx = fixture(),
    c = character("already-absent");
  const body = severOne(fx, c).registration.body;
  fx.headers.delete(body);
  assert.equal(fx.pool.releaseRemovedParts(c), "complete");
  assert.equal(body.owner, null);
  assert.equal(c.vanishedBoneMask, 0);
  assert.equal(fx.log.filter((row) => row[0] === "clear").length, 1);
});
test("boned capacity exhaustion does not read stored poses or invalidate removed ownership", () => {
  const fx = fixture();
  for (let i = 0; i < 10; i++) fx.pool.reserve(character(`${i}`));
  const c = character("waiting", { removedBoneMask: 4 });
  assert.deepEqual(
    fx.pool.reacquire(c, () => assert.fail("No free boned slot")),
    { slot: null, results: [] },
  );
  assert.equal(c.removedBoneMask, 4);
  assert.equal(c.bonedSlot, -1);
});
test("collision-release gate leaves ownership untouched after flags cleared; no quiet-driven release", () => {
  const fx = fixture(),
    c = character("quiet-owned");
  const body = severOne(fx, c).registration.body;
  body.ec = 1;
  fx.headers.set(body, 2);
  assert.equal(fx.pool.counts("BIPED1").owned, 1);
  c.physicsFlags = 0;
  assert.equal(fx.pool.releaseRemovedParts(c), "not-applicable");
  assert.equal(c.bonedSlot, 0);
  assert.equal(
    fx.log.some((row) => row[0] === "remove"),
    false,
  );
});
test("pool registration failure still lets the sever kernel execute common HP/caller tail once", () => {
  const massive = {
      ...form,
      bones: [bone("ROOT", 1, "BOX", -1), ...form.bones.slice(1)],
    },
    fx = fixture({ code: 1, source: massive }),
    c = character("HP-tail");
  const state = {
    removedBoneMask: 0,
    vanishedBoneMask: 0,
    bonedSlot: -1,
    hitPoints: 100,
    physicsActive: true,
    characterVelocity: [10, 0, 0],
    cache: { stumpCounters: new Uint8Array(massive.bones.length), flags: 0 },
  };
  let hpCalls = 0,
    callerCalls = 0,
    draws = 0;
  const input = {
    normalizedDamage: 11,
    otherPresent: true,
    goreLevel: 2,
    immortal: false,
    brittle: false,
    exploding: false,
    articulated: false,
    form: { ...massive, headBone: 2, nonHumanoid: false },
    severDamage: 10,
    severChance: 100,
    dismemberSpurtCount: 1,
  };
  mutateNativePedSever(state, input, {
    nextCrtInteger: () => {
      draws++;
      return 0;
    },
    reserveBonedSlot: () => fx.pool.reserve(c),
    readBone: snapshot,
    registerBone: (r) => fx.pool.registerBone(c, r).registration,
    commitBone: () => assert.fail("Failed register must not commit"),
    commonTail: () => {
      hpCalls++;
      state.hitPoints -= 11;
      return state.hitPoints;
    },
    callerContinuation: (hp) => {
      callerCalls++;
      assert.equal(hp, 89);
    },
  });
  assert.equal(hpCalls, 1);
  assert.equal(callerCalls, 1);
  assert.equal(draws, 5);
  assert.equal(state.removedBoneMask, 0);
  assert.equal(state.bonedSlot, 0);
  assert.equal(fx.pool.counts("BIPED1").owned, 1);
});
test("original stock/Advanced human and animal FORM capacities/masses allocate exact reusable resources", async (t) => {
  for (const directory of ["data", "adv_data"]) {
    for (const name of [
      "BIPED1.TXT",
      "BIPEDF.TXT",
      "DOG1.TXT",
      "cow_form.txt",
      "deer_form.txt",
      "sheep_form.txt",
      "elephant_form.txt",
      "penguin_form.txt",
    ]) {
      let bytes;
      try {
        bytes = await readFile(
          new URL(
            `../carma2_orig/${directory}/PEDS/FORMS/${name}`,
            import.meta.url,
          ),
        );
      } catch (error) {
        if (error.code === "ENOENT") {
          t.skip("Original installation unavailable");
          return;
        }
        throw error;
      }
      const source = parsePedForm(decodeText(bytes)),
        fx = fixture({ source });
      assert.equal(source.maxBoned, 10);
      assert.equal(
        fx.bodies.length,
        source.bones.filter((b) => b.mass !== 0).length * 10,
      );
      const c = character(name);
      fx.pool.reserve(c);
      const a = fx.pool.allocation(c);
      source.bones.forEach((b, i) =>
        assert.equal(a.bodies[i]?.mass ?? 0, b.mass),
      );
      assert.equal(a.bodies[source.headBone].shape.kind, "SPHERE");
      if (name.startsWith("BIPED"))
        assert.equal(a.bodies[source.headBone].mass, f(0.004));
      if (name === "DOG1.TXT")
        assert.equal(a.bodies[source.headBone].mass, f(0.002));
      const r = fx.pool.registerBone(c, request(c, source.headBone, source));
      c.removedBoneMask = (1 << source.headBone) >>> 0;
      fx.pool.releaseRemovedParts(c);
      const next = character(`${name}-new`);
      fx.pool.reserve(next);
      const again = fx.pool.registerBone(
        next,
        request(next, source.headBone, source),
      );
      assert.equal(again.registration.body, r.registration.body);
    }
  }
});

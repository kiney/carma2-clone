import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NativePedBodyPool,
  createNativePedPoolSettings,
  nativePedCameraProcessedFlags,
  NATIVE_PHIL_HEADER_CAPACITY,
  NATIVE_PED_FORM_LIMIT,
} from "../src/ped-body-pool.ts";
import { parsePedForm } from "../src/ped-form.ts";
import { decodeText } from "../src/formats.ts";

const settings = createNativePedPoolSettings(12, 9);
const frame = (extra = {}) => ({
  cameraOrigin: [0, 0, 0],
  timeMs: 10000,
  settings,
  ...extra,
});
function character(name, extra = {}) {
  return {
    owner: { name },
    formKey: "BIPED1",
    position: [10, 0, 0],
    flags: 0,
    physicsFlags: 0,
    ...extra,
  };
}
function fixture({
  render = 2,
  simple = 2,
  phil = 100,
  registerCode,
  deferred = false,
  missing = [],
} = {}) {
  const log = [],
    headers = new Set();
  const host = {
    createRender: (key, slot) => {
      log.push(`new-render:${key}:${slot}`);
      return { key, slot };
    },
    createSimple: (key, slot) => {
      log.push(`new-body:${key}:${slot}`);
      return { key, slot, owner: null, v: [999, 999, 999] };
    },
    prepareRender: (c, r, slot) => log.push(`render:${c.owner.name}:${slot}`),
    prepareSimple: (a) => {
      log.push(`prepare:${a.character.owner.name}:${a.simpleSlot}`);
      a.body.owner = a.character.owner;
      a.body.v = [0, 0, 0];
      a.body.ec = 1;
      a.body.ed = 1;
      delete a.body.properties;
    },
    registrar: {
      registerImmediate: (body) => {
        log.push(`register:${body.owner.name}`);
        assert.deepEqual(body.v, [0, 0, 0]);
        assert.equal(body.properties, undefined);
        if (registerCode !== undefined) return registerCode;
        if (headers.has(body)) return 2;
        if (headers.size === phil) return 1;
        headers.add(body);
        return 0;
      },
      remove: (body) => {
        log.push(`remove:${body.owner.name}`);
        if (deferred) return { code: 0, phase: "deferred" };
        const present = headers.delete(body);
        return { code: present ? 0 : 3, phase: "complete" };
      },
    },
    finishSimple: (a) => {
      log.push(`finish:${a.character.owner.name}`);
      assert.equal(a.character.physicsFlags, 0);
      a.body.properties = { gravity: 1, 3: 1, 4: 1, 5: 1, 7: 1, 8: 0 };
      a.body.filters = [0x10000, 0x50000];
    },
    beforeRelease: (a) => {
      log.push(`before-release:${a.character.owner.name}`);
      return missing;
    },
    clearSimple: (a) => {
      log.push(`clear:${a.character.owner.name}`);
      a.body.owner = null;
      a.body.contactRing = null;
    },
    releaseRender: (c, r, slot) =>
      log.push(`release-render:${c.owner.name}:${slot}`),
  };
  const pool = new NativePedBodyPool(host);
  pool.registerForm("BIPED1", { maxRender: render, maxSimple: simple });
  return { pool, log, headers, host };
}
const processed = (c, f = frame()) =>
  !!(nativePedCameraProcessedFlags(c, f) & 1);

test("native process box uses strict outer and inclusive popup extents", () => {
  assert.equal(settings.innerProcessDistance, Math.fround(7.2));
  assert.equal(settings.innerPopupDistance, Math.fround(5.4));
  assert.equal(
    processed(character("x", { position: [12, 0, 0], flags: 1 })),
    false,
  );
  assert.equal(
    processed(character("x", { position: [11.99, 7, 11.99], flags: 1 })),
    true,
  );
  assert.equal(
    processed(
      character("x", {
        position: [0, settings.innerProcessDistance, 0],
        flags: 1,
      }),
    ),
    false,
  );
  assert.equal(
    processed(
      character("x", { position: [9, settings.innerPopupDistance, 9] }),
    ),
    false,
  );
  assert.equal(
    processed(
      character("x", { position: [9, settings.innerPopupDistance + 0.001, 9] }),
    ),
    true,
  );
  assert.equal(
    processed(character("x", { position: [0, 0, 0], flags: 1 })),
    true,
  );
  assert.equal(
    processed(
      character("x", { position: [0, 0, 0] }),
      frame({ pedNearness: true }),
    ),
    true,
  );
});
test("camera origin is native world and grace expires at7500 using uint32 subtraction", () => {
  const c = character("x", {
    position: [50, 0, 0],
    flags: 0x81,
    cacheEventTimeMs: 2501,
  });
  assert.equal(processed(c), true);
  c.cacheEventTimeMs = 2500;
  assert.equal(processed(c), false);
  c.cacheEventTimeMs = 0xfffffff0;
  assert.equal(processed(c, frame({ timeMs: 16 })), true);
  c.cacheEventTimeMs = 0;
  assert.equal(processed(c), false);
  c.flags = 1;
  assert.equal(processed(c, frame({ cameraOrigin: [50, 0, 0] })), true);
});
test("recent event does not bypass the separate newly appearing popup gate", () => {
  assert.equal(
    processed(character("x", { position: [0, 0, 0], cacheEventTimeMs: 9999 })),
    false,
  );
  assert.equal(
    processed(
      character("x", { position: [100, 0, 0], cacheEventTimeMs: 9999 }),
    ),
    true,
  );
});
test("FORM resources preallocate once and share across personality owners", () => {
  const { pool, log } = fixture();
  assert.equal(log.length, 4);
  pool.registerForm("BIPED1", { maxRender: 2, maxSimple: 2 });
  assert.equal(log.length, 4);
  const c = character("Blokebl"),
    d = character("Bandsman");
  const out = pool.visitFrame([c, d], frame());
  assert.deepEqual(
    out.map((r) => r.status),
    ["processed", "processed"],
  );
  assert.deepEqual(
    out.map((r) => r.allocation.simpleSlot),
    [0, 1],
  );
  assert.equal(log.filter((n) => n.startsWith("new-")).length, 4);
  assert.throws(
    () => pool.registerForm("BIPED1", { maxRender: 3, maxSimple: 2 }),
    /Conflicting/,
  );
});
test("source array order wins capacity without nearest sorting or eviction", () => {
  const { pool, log } = fixture({ render: 1, simple: 1 });
  const far = character("far", { position: [11, 0, 0] }),
    near = character("near", { position: [9.1, 0, 0] });
  const out = pool.visitFrame([far, near], frame());
  assert.equal(out[0].status, "processed");
  assert.equal(out[1].status, "exhausted");
  assert.equal(out[1].collideworthyReturn, null);
  assert.equal(near.flags & 1, 0);
  assert.equal(pool.allocation(far.owner).simpleSlot, 0);
  assert.equal(
    log.some((n) => n.startsWith("remove:")),
    false,
  );
});
test("prepare -> immediate registration -> properties/fill -> ownership/visit flags", () => {
  const { pool, log } = fixture();
  const c = character("x");
  const [r] = pool.visitFrame([c], frame());
  assert.deepEqual(log.slice(4), [
    "render:x:0",
    "prepare:x:0",
    "register:x",
    "finish:x",
  ]);
  assert.equal(r.registrationReturn, 0);
  assert.equal(r.collideworthyReturn, 0);
  assert.equal(c.physicsFlags, 1);
  assert.equal(c.flags, 0x21);
  assert.deepEqual(r.allocation.body.filters, [0x10000, 0x50000]);
  const [again] = pool.visitFrame([c], frame());
  assert.equal(again.collideworthyReturn, 23);
  assert.equal(again.registrationReturn, null);
  assert.equal(c.flags, 0x61);
  assert.equal(log.filter((n) => n.startsWith("register:")).length, 1);
});
for (const registerCode of [1, 2])
  test(`PHIL failure${registerCode} releases render before occupancy/flags commit`, () => {
    const { pool, log } = fixture({ registerCode });
    const c = character("x", { flags: 0x20 });
    const [r] = pool.visitFrame([c], frame());
    assert.equal(r.status, "exhausted");
    assert.equal(r.collideworthyReturn, 21);
    assert.equal(r.registrationReturn, registerCode);
    assert.equal(c.flags, 0x20);
    assert.equal(c.physicsFlags, 0);
    assert.equal(pool.allocation(c.owner), null);
    assert.deepEqual(pool.counts("BIPED1"), {
      renderCapacity: 2,
      simpleCapacity: 2,
      renderOwned: 0,
      simpleOwned: 0,
    });
    assert.deepEqual(log.slice(4), [
      "render:x:0",
      "prepare:x:0",
      "register:x",
      "release-render:x:0",
    ]);
  });
test("simple exhaustion releases the attempted render but preserves existing owner", () => {
  const { pool, log } = fixture({ render: 2, simple: 1 });
  const c = character("first"),
    d = character("second");
  const out = pool.visitFrame([c, d], frame());
  assert.equal(out[1].collideworthyReturn, 21);
  assert.equal(pool.counts("BIPED1").renderOwned, 1);
  assert.equal(pool.allocation(c.owner), out[0].allocation);
  assert.deepEqual(log.slice(-2), [
    "render:second:1",
    "release-render:second:1",
  ]);
});
test("failed initialization may retain partial owner writes but retry reinitializes the same free body", () => {
  const { pool, host } = fixture({ render: 1, simple: 1, registerCode: 1 });
  const first = character("failed"),
    next = character("next");
  let body;
  const prepare = host.prepareSimple;
  host.prepareSimple = (a) => {
    body = a.body;
    prepare(a);
  };
  pool.visitFrame([first], frame());
  assert.equal(body.owner, first.owner);
  assert.equal(pool.counts("BIPED1").simpleOwned, 0);
  body.v = [2, 3, 4];
  host.registrar.registerImmediate = (candidate) => {
    assert.equal(candidate, body);
    assert.equal(candidate.owner, next.owner);
    assert.deepEqual(candidate.v, [0, 0, 0]);
    return 0;
  };
  assert.equal(pool.visitFrame([next], frame())[0].status, "processed");
});
test("ordered release does not retroactively grant an earlier failed acquisition", () => {
  const { pool } = fixture({ render: 1, simple: 1 });
  const owned = character("owned"),
    earlier = character("earlier");
  pool.visitFrame([owned], frame());
  owned.position = [12, 0, 0];
  const [a, b] = pool.visitFrame([earlier, owned], frame());
  assert.equal(a.status, "exhausted");
  assert.equal(b.status, "out-of-scope");
  assert.equal(pool.counts("BIPED1").simpleOwned, 0);
  assert.equal(
    pool.visitFrame([earlier, owned], frame())[0].status,
    "processed",
  );
});
test("actual shared PHIL adapter can exhaust across separate FORM tables", () => {
  const { pool, headers } = fixture({ phil: 1 });
  pool.registerForm("DOG1", { maxRender: 2, maxSimple: 2 });
  const [a, b] = pool.visitFrame(
    [character("human"), character("dog", { formKey: "DOG1" })],
    frame(),
  );
  assert.equal(a.status, "processed");
  assert.equal(b.registrationReturn, 1);
  assert.equal(headers.size, 1);
  assert.equal(pool.counts("DOG1").simpleOwned, 0);
  assert.equal(NATIVE_PHIL_HEADER_CAPACITY, 100);
});
test("accepted passive/active halt retains pool and processed eligibility survives scope changes", () => {
  const { pool, log } = fixture({ render: 1, simple: 1 });
  const c = character("x");
  pool.visitFrame([c], frame());
  pool.visitFrame([c], frame());
  const a = pool.allocation(c.owner);
  c.physicsFlags = 5;
  pool.visitFrame([c], frame());
  c.physicsFlags = 1;
  pool.visitFrame([c], frame());
  assert.equal(pool.allocation(c.owner), a);
  assert.equal(log.filter((n) => n.startsWith("register:")).length, 1);
  c.position = [12, 0, 0];
  assert.equal(pool.visitFrame([c], frame())[0].status, "out-of-scope");
  assert.equal(c.physicsFlags, 0);
  assert.equal(c.flags, 0x60);
  assert.deepEqual(log.slice(-4), [
    "before-release:x",
    "remove:x",
    "clear:x",
    "release-render:x:0",
  ]);
  c.position = [10, 0, 0];
  pool.visitFrame([c], frame());
  assert.equal(c.flags, 0x61);
  assert.equal(pool.allocation(c.owner).body, a.body);
  assert.equal(pool.allocation(c.owner).renderSlot, 0);
});
test("deferred removal retains both resources until actual host completion", () => {
  const { pool, headers, log } = fixture({
    render: 1,
    simple: 1,
    deferred: true,
  });
  const c = character("x"),
    d = character("next");
  pool.visitFrame([c], frame());
  const a = pool.allocation(c.owner);
  c.position = [12, 0, 0];
  assert.equal(pool.visitFrame([c, d], frame())[0].status, "release-pending");
  assert.equal(pool.counts("BIPED1").simpleOwned, 1);
  c.position = [10, 0, 0];
  assert.equal(pool.visitFrame([c], frame())[0].status, "release-pending");
  assert.equal(log.filter((n) => n.startsWith("remove:")).length, 1);
  headers.delete(a.body);
  pool.completeRelease(c.owner);
  assert.equal(pool.allocation(c.owner), null);
  assert.equal(pool.visitFrame([d], frame())[0].allocation.body, a.body);
  assert.throws(() => pool.completeRelease(c.owner), /No deferred/);
});
test("missing actual offscreen outlet retains active state without pretending release", () => {
  const { pool, log } = fixture({ missing: ["falling-forever/kill callback"] });
  const c = character("x");
  pool.visitFrame([c], frame());
  c.physicsFlags = 5;
  c.position = [20, 0, 0];
  const [r] = pool.visitFrame([c], frame());
  assert.equal(r.status, "provider-required");
  assert.deepEqual(r.requiredProviders, ["falling-forever/kill callback"]);
  assert.equal(c.physicsFlags, 5);
  assert.equal(pool.counts("BIPED1").simpleOwned, 1);
  assert.equal(
    log.some((n) => n.startsWith("remove:")),
    false,
  );
});
test("removed-part provider gap reports separately while intact registration succeeds", () => {
  const { pool, host } = fixture();
  const c = character("x", { removedBoneMask: 4 });
  const [r] = pool.visitFrame([c], frame());
  assert.equal(r.status, "provider-required");
  assert.equal(r.collideworthyReturn, 0);
  assert.equal(c.physicsFlags, 1);
  assert.equal(c.flags, 0x21);
  host.acquireRemovedParts = () => [];
  assert.equal(pool.visitFrame([c], frame())[0].status, "processed");
});
test("removed-part acquisition follows new simple ownership before visit flags, not every owned visit", () => {
  const { pool, host } = fixture();
  let calls = 0;
  host.acquireRemovedParts = (a) => {
    calls++;
    assert.equal(a.character.physicsFlags, 1);
    assert.equal(pool.allocation(a.character.owner), a);
    assert.equal(a.character.flags & 0x20, 0);
    return [];
  };
  const c = character("x", { removedBoneMask: 4 });
  pool.visitFrame([c], frame());
  pool.visitFrame([c], frame());
  assert.equal(calls, 1);
});
test("camera flag prepass finishes before source ordered host callbacks", () => {
  const { pool, host } = fixture();
  const c = character("first"),
    d = character("second");
  host.prepareRender = () => assert.equal(d.flags & 1, 1);
  pool.visitFrame([c, d], frame());
});
test("preallocated FORM resources cannot alias another slot or FORM", () => {
  const { host } = fixture();
  const body = {};
  host.createSimple = () => body;
  const pool = new NativePedBodyPool(host);
  assert.throws(
    () => pool.registerForm("bad", { maxRender: 1, maxSimple: 2 }),
    /distinct/,
  );
  pool.registerForm("good", { maxRender: 1, maxSimple: 1 });
  assert.throws(
    () => pool.registerForm("other", { maxRender: 1, maxSimple: 1 }),
    /distinct/,
  );
});
test("boned/replay and foreign physics ownership require their real providers", () => {
  const { pool, log } = fixture();
  for (const [c, f] of [
    [character("boned", { physicsFlags: 2 }), frame()],
    [character("foreign", { physicsFlags: 1 }), frame()],
    [character("replay"), frame({ replay: true })],
  ])
    assert.equal(pool.visitFrame([c], f)[0].status, "provider-required");
  assert.equal(log.length, 4);
});
test("bounded FORM registry and invalid input fail before array mutations", () => {
  const { pool, log } = fixture();
  for (let i = 1; i < NATIVE_PED_FORM_LIMIT; i++)
    pool.registerForm(`F${i}`, { maxRender: 1, maxSimple: 1 });
  assert.throws(
    () => pool.registerForm("extra", { maxRender: 1, maxSimple: 1 }),
    /20/,
  );
  assert.throws(
    () => pool.registerForm("BIPED1", { maxRender: 0, maxSimple: 1 }),
    /capacity/,
  );
  const c = character("x"),
    before = log.length;
  assert.throws(() => pool.visitFrame([c, c], frame()), /Duplicate/);
  assert.equal(c.flags, 0);
  assert.equal(log.length, before);
  assert.throws(
    () =>
      pool.visitFrame(
        [c, character("bad", { position: [NaN, 0, 0] })],
        frame(),
      ),
    /finite/,
  );
  assert.equal(c.flags, 0);
  assert.throws(() => createNativePedPoolSettings(-1, 9), /Negative/);
  assert.throws(() => new NativePedBodyPool({}), /Missing/);
});
test("original stock/Advanced capacities and settings drive shared registry allocations", async (t) => {
  const names = [
    ["BIPED1.TXT", 30],
    ["BIPEDF.TXT", 30],
    ["DOG1.TXT", 15],
    ["cow_form.txt", 15],
    ["deer_form.txt", 15],
    ["sheep_form.txt", 15],
    ["elephant_form.txt", 15],
    ["penguin_form.txt", 15],
  ];
  for (const directory of ["data", "adv_data"]) {
    let settingsBytes;
    try {
      settingsBytes = await readFile(
        new URL(
          `../carma2_orig/${directory}/PEDS/settings.txt`,
          import.meta.url,
        ),
      );
    } catch (e) {
      if (e.code === "ENOENT") {
        t.skip("Original installation unavailable");
        return;
      }
      throw e;
    }
    const values = decodeText(settingsBytes)
      .split(/\r?\n/)
      .map((s) => s.split("//")[0].trim())
      .filter(Boolean);
    const authoredSettings = createNativePedPoolSettings(
      Number(values[0]),
      Number(values[1]),
    );
    assert.deepEqual(authoredSettings, settings);
    const { pool } = fixture();
    for (const [name, count] of names) {
      const form = parsePedForm(
        decodeText(
          await readFile(
            new URL(
              `../carma2_orig/${directory}/PEDS/FORMS/${name}`,
              import.meta.url,
            ),
          ),
        ),
      );
      const key = `${directory}:${name}`;
      pool.registerForm(key, form);
      const peds = Array.from({ length: count + 1 }, (_, i) =>
        character(`${key}:${i}`, { formKey: key }),
      );
      const out = pool.visitFrame(peds, frame({ settings: authoredSettings }));
      assert.equal(out.filter((r) => r.status === "processed").length, count);
      assert.equal(out.at(-1).status, "exhausted");
      assert.equal(pool.counts(key).renderCapacity, count);
      assert.equal(pool.counts(key).simpleCapacity, count);
      for (const c of peds) c.position = [100, 0, 0];
      pool.visitFrame(peds, frame({ settings: authoredSettings }));
      assert.equal(pool.counts(key).simpleOwned, 0);
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import {
  createNativePedInstance,
  selectNativePedMove,
  selectNativePedBoneModel,
} from "../src/ped-native-instance.ts";
import {
  nativePedScareHeadSequence as scare,
  nativePedCalmHeadSequence as calm,
  decideNativePedHeadSequenceStart as decideStart,
  decideNativePedHeadSequenceAdvance as decideAdvance,
  startNativePedHeadSequence as start,
  advanceNativePedHeadSequence as advance,
  clearNativePedHeadSequence as clear,
} from "../src/ped-head-sequence.ts";
const state = (changes = {}) => ({
  sequence: null,
  index: 9,
  lastChangeTimeMs: 77,
  ...changes,
});
const input = (changes = {}) => ({
  hitPoints: 100,
  renderSlot: 0,
  headBone: 1,
  timeMs: 1000,
  replay: false,
  ...changes,
});
const complete = () => ({
  status: "complete",
  requiredProviders: [],
  nativeModelReturn: 1,
});
// Numerical expected values are captured installed behavior on invented state.
// Table bytes are facts, not the differing reconstructed initializer.
test("installed scare loops three states while calm's second state is the sentinel", () => {
  assert.equal(scare.address, 0x65d050);
  assert.equal(scare.count, 3);
  assert.deepEqual(scare.poses, [1, 2, 1]);
  assert.equal(calm.address, 0x65d054);
  assert.equal(calm.count, 2);
  assert.deepEqual(calm.poses, [0, 99]);
  assert.ok(Object.isFrozen(scare) && Object.isFrozen(scare.poses));
  assert.ok(Object.isFrozen(calm) && Object.isFrozen(calm.poses));
});
test("start stores sequence/index/time before model call with alive and cache gates", () => {
  const s = state(),
    calls = [];
  const out = start(s, scare, input(), {
    setModels(request) {
      assert.equal(s.sequence, scare);
      assert.equal(s.index, 0);
      assert.equal(s.lastChangeTimeMs, 1000);
      calls.push(request);
      return complete();
    },
  });
  assert.equal(out.committed, true);
  assert.equal(out.kind, "start");
  assert.deepEqual(calls, [
    {
      kind: "bone-model",
      headBone: 1,
      poseIndex: 1,
      modelSet: 0,
      timeMs: 1000,
      phase: "start",
    },
  ]);
  for (const hp of [0, -1, -128]) {
    const before = { ...s };
    assert.equal(start(s, calm, input({ hitPoints: hp })).reason, "dead");
    assert.deepEqual(s, before);
  }
  assert.equal(start(null, scare, input()).reason, "cache-unavailable");
});
test("strict125ms gate advances once then loops index1, without elapsed catch-up", () => {
  const s = state(),
    poses = [];
  const host = {
    setModels(request) {
      poses.push(request.poseIndex);
      return complete();
    },
  };
  start(s, scare, input(), host);
  const same = advance(s, input({ timeMs: 1125 }), host);
  assert.equal(same.reason, "timer");
  assert.equal(same.committed, false);
  for (const timeMs of [1126, 1252, 1378, 1504])
    advance(s, input({ timeMs }), host);
  assert.deepEqual(poses, [1, 2, 1, 2, 1]);
  assert.equal(s.index, 2);
  assert.equal(s.sequence, scare);
  advance(s, input({ timeMs: 100000 }), host);
  assert.equal(s.index, 1);
  assert.equal(s.lastChangeTimeMs, 100000);
  assert.equal(poses.length, 6);
  advance(s, input({ timeMs: 100000 }), host);
  assert.equal(poses.length, 6);
});
test("calm sentinel clears only pointer, retaining incremented index and old timestamp", () => {
  const s = state(),
    calls = [];
  start(s, calm, input(), {
    setModels(request) {
      calls.push(request);
      return complete();
    },
  });
  assert.equal(calls[0].poseIndex, 0);
  const end = advance(s, input({ timeMs: 1126 }));
  assert.equal(end.status, "complete");
  assert.equal(end.kind, "end");
  assert.equal(end.modelRequest, null);
  assert.equal(s.sequence, null);
  assert.equal(s.index, 1);
  assert.equal(s.lastChangeTimeMs, 1000);
  assert.equal(advance(s, input({ timeMs: 9000 })).reason, "inactive");
  assert.equal(calls.length, 1);
});
test("outer replay suppresses updates while start itself has no invented replay gate", () => {
  const s = state();
  start(s, scare, input({ replay: true }), { setModels: complete });
  const before = { ...s };
  const out = advance(s, input({ timeMs: 9000, replay: true }));
  assert.equal(out.reason, "replay");
  assert.equal(out.committed, false);
  assert.deepEqual(s, before);
  assert.equal(advance(null, input({ replay: true })).reason, "replay");
});
test("installed unsigned absolute deadline wraps instead of comparing elapsed time", () => {
  // Exact installed inline-block captures, including the pre-wrap early advance.
  for (const [last, now, expected] of [
    [1000, 1125, false],
    [1000, 1126, true],
    [0xffffffb0, 0xffffffb1, true],
    [0xffffffb0, 45, false],
    [0xffffffb0, 46, true],
    [0xffffffb0, 0, false],
  ]) {
    const s = state({ sequence: scare, index: 0, lastChangeTimeMs: last });
    const out = advance(s, input({ timeMs: now }), { setModels: complete });
    assert.equal(out.committed, expected, `last=${last},now=${now}`);
    assert.equal(s.index, expected ? 1 : 0);
    assert.equal(s.lastChangeTimeMs, expected ? now : last);
  }
});
test("offscreen signed render slot suppresses ACT writes but retains sequence state", () => {
  const s = state();
  assert.equal(start(s, scare, input({ renderSlot: -1 })).status, "complete");
  const out = advance(s, input({ renderSlot: -128, timeMs: 1126 }));
  assert.equal(out.status, "complete");
  assert.equal(out.modelRequest, null);
  assert.equal(out.committed, true);
  assert.equal(s.index, 1);
  assert.equal(s.lastChangeTimeMs, 1126);
  assert.equal(advance(null, input()).reason, "cache-unavailable");
});
test("signed HP selects living/dead models on update without stopping retained sequence", () => {
  for (const hp of [127, 100, 1, 0, -1, -128]) {
    const s = state({ sequence: scare, index: 0, lastChangeTimeMs: 1000 });
    let call;
    advance(s, input({ hitPoints: hp, timeMs: 1126 }), {
      setModels(request) {
        call = request;
        return complete();
      },
    });
    assert.equal(call.modelSet, hp <= 0 ? 1 : 0);
    assert.equal(call.poseIndex, 2);
    assert.equal(s.sequence, scare);
  }
});
test("negative FORM head bone requests all actual models, not a guessed head", () => {
  const s = state();
  const out = start(s, scare, input({ headBone: -1 }), { setModels: complete });
  assert.deepEqual(out.modelRequest, {
    kind: "all-models",
    headBone: -1,
    poseIndex: 1,
    modelSet: 0,
    timeMs: 1000,
    phase: "start",
  });
  const next = advance(
    s,
    input({ headBone: -128, hitPoints: 0, timeMs: 1126 }),
    { setModels: complete },
  );
  assert.equal(next.modelRequest.kind, "all-models");
  assert.equal(next.modelRequest.headBone, -128);
  assert.equal(next.modelRequest.poseIndex, 2);
  assert.equal(next.modelRequest.modelSet, 1);
});
test("known-NULL return0 consumes source step; missing actual outlet preflight retains it", () => {
  const s = state({ sequence: scare, index: 0, lastChangeTimeMs: 1000 }),
    before = { ...s };
  const missing = advance(s, input({ timeMs: 1126 }));
  assert.equal(missing.status, "provider-required");
  assert.equal(missing.committed, false);
  assert.deepEqual(missing.requiredProviders, [
    "native-head-bone-model-AR-provider",
  ]);
  assert.deepEqual(s, before);
  const out = advance(s, input({ timeMs: 1126 }), {
    setModels: () => ({
      status: "complete",
      requiredProviders: [],
      nativeModelReturn: 0,
    }),
  });
  assert.equal(out.status, "complete");
  assert.equal(out.committed, true);
  assert.equal(out.modelResult.nativeModelReturn, 0);
  assert.equal(s.index, 1);
  assert.equal(s.lastChangeTimeMs, 1126);
  assert.deepEqual(start(s, scare, input({ headBone: -1 })).requiredProviders, [
    "native-head-all-models-AR-provider",
  ]);
});
test("supplied unresolved model outlet sees committed stores and reports exact owner gap", () => {
  const s = state({ sequence: scare, index: 0, lastChangeTimeMs: 1000 });
  const out = advance(s, input({ timeMs: 1126 }), {
    setModels() {
      assert.equal(s.index, 1);
      assert.equal(s.lastChangeTimeMs, 1126);
      return {
        status: "provider-required",
        requiredProviders: ["actual set1 unavailable"],
      };
    },
  });
  assert.equal(out.committed, true);
  assert.equal(out.status, "provider-required");
  assert.deepEqual(out.requiredProviders, ["actual set1 unavailable"]);
});
test("pure decisions do not mutate state, and explicit Kill clear preserves index/time", () => {
  const s = state(),
    before = { ...s };
  const first = decideStart(s, scare, input());
  assert.deepEqual(s, before);
  assert.equal(first.nextState.sequence, scare);
  const snapshot = { ...first.nextState };
  const next = decideAdvance(first.nextState, input({ timeMs: 1126 }));
  assert.deepEqual(first.nextState, snapshot);
  assert.equal(next.nextState.sequence, scare);
  clear(next.nextState);
  assert.equal(next.nextState.sequence, null);
  assert.equal(next.nextState.index, 1);
  assert.equal(next.nextState.lastChangeTimeMs, 1126);
  clear(null);
});
test("native byte increment wraps255 to0 before the count comparison", () => {
  for (const selected of [scare, calm]) {
    const s = state({ sequence: selected, index: 255, lastChangeTimeMs: 0 });
    const out = advance(s, input({ timeMs: 126 }), { setModels: complete });
    assert.equal(s.index, 0);
    assert.equal(out.modelRequest.poseIndex, selected.poses[0]);
  }
});
test("unknown tables, invalid native fields and unresolved empty model results reject", () => {
  assert.throws(
    () =>
      start(
        state(),
        { address: scare.address, count: 4, poses: [1, 2, 1, 99] },
        input(),
      ),
    /installed sequence table/,
  );
  assert.throws(
    () => start(state(), { address: 7, count: 2, poses: [0, 99] }, input()),
    /installed sequence table/,
  );
  for (const changes of [
    { hitPoints: 128 },
    { renderSlot: 128 },
    { headBone: 1.5 },
    { timeMs: 2 ** 32 },
    { timeMs: NaN },
  ])
    assert.throws(() => advance(state(), input(changes)), /out of range/);
  assert.throws(() => advance(state({ index: 256 }), input()), /uint8/);
  assert.throws(
    () => advance(state(), { ...input(), replay: undefined }),
    /replay state/,
  );
  assert.throws(
    () => start(state(), scare, input(), { setModels() {} }),
    /actual model outlet result/,
  );
  assert.throws(
    () =>
      start(state(), scare, input(), {
        setModels: () => ({
          status: "provider-required",
          requiredProviders: [],
        }),
      }),
    /invalid resolution/,
  );
  assert.throws(
    () =>
      start(state(), scare, input(), {
        setModels: () => ({
          status: "complete",
          requiredProviders: [],
          nativeModelReturn: 2,
        }),
      }),
    /invalid resolution/,
  );
});
function peBytesAt(bytes, address, count) {
  assert.equal(bytes.readUInt16LE(0), 0x5a4d);
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.readUInt32LE(pe), 0x4550);
  const sections = bytes.readUInt16LE(pe + 6),
    optionalSize = bytes.readUInt16LE(pe + 20);
  const base = bytes.readUInt32LE(pe + 24 + 28),
    rva = address - base;
  for (let i = 0; i < sections; i++) {
    const h = pe + 24 + optionalSize + i * 40,
      va = bytes.readUInt32LE(h + 12),
      size = bytes.readUInt32LE(h + 16),
      raw = bytes.readUInt32LE(h + 20);
    if (rva >= va && rva + count <= va + size) {
      assert.ok(raw + rva - va + count <= bytes.length);
      return [...bytes.subarray(raw + rva - va, raw + rva - va + count)];
    }
  }
  throw Error("Installed head table absent from raw PE sections");
}
test("read-only installed HW bytes verify scare count3 and neighboring terminating calm", async (t) => {
  let bytes;
  try {
    bytes = await readFile(
      resolve(process.env.CARMA2_ROOT || "carma2_orig", "carma2_HW.exe"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  assert.deepEqual(peBytesAt(bytes, scare.address, 4), [3, 1, 2, 1]);
  assert.deepEqual(peBytesAt(bytes, calm.address, 3), [2, 0, 99]);
});
test("Stock/Advanced human/animal model outlets retain stable ACTs, active root and BON clock", async (t) => {
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
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = async (path) => new Uint8Array(await store.read(path));
  const root = new Float32Array([0, 0, -1, 0, 1, 0, 1, 0, 0, 5, 7, 11]);
  let count = 0;
  for (const tree of ["data", "adv_data"])
    for (const name of ["Blokebl", "Bandsman", "twolf"]) {
      const template = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      const instance = createNativePedInstance(template, { rootPose: root });
      assert.equal(
        selectNativePedMove(instance, 30, [0, 0, 1], [0, 1, 0], 1000).status,
        "complete",
      );
      instance.physicsActive = true;
      const actors = instance.bones.map((b) => b.actor),
        beforeRoot = instance.rootPose.slice(),
        beforeClock = { ...instance.clock },
        beforeV = [...instance.nativeCharacterVelocity];
      const headBone = template.form.headBone,
        s = state(),
        calls = [];
      assert.ok(headBone >= 0 && headBone < instance.bones.length);
      const actual = { ...input(), headBone },
        host = {
          setModels(req) {
            assert.equal(req.kind, "bone-model");
            const bone = instance.bones[req.headBone],
              old = bone.model;
            const selected = selectNativePedBoneModel(
              instance,
              req.headBone,
              req.poseIndex,
              req.modelSet,
            );
            assert.equal(selected.status, "complete");
            assert.equal(
              bone.model,
              selected.nativeModelReturn === 0
                ? old
                : bone.modelSets[req.modelSet][req.poseIndex],
            );
            calls.push(req.poseIndex);
            return selected;
          },
        };
      start(s, scare, actual, host);
      advance(s, { ...actual, timeMs: 1126 }, host);
      advance(s, { ...actual, timeMs: 1252 }, host);
      assert.deepEqual(calls, [1, 2, 1]);
      assert.equal(instance.physicsActive, true);
      assert.deepEqual(instance.rootPose, beforeRoot);
      assert.deepEqual(instance.clock, beforeClock);
      assert.deepEqual(instance.nativeCharacterVelocity, beforeV);
      instance.bones.forEach((bone, i) => assert.equal(bone.actor, actors[i]));
      assert.equal(instance.group.children.length, instance.bones.length);
      count++;
    }
  assert.equal(count, 6);
});

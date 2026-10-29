import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import { NativePedPresentation } from "../src/ped-presentation.ts";
import { NativePedRenderEffects } from "../src/ped-render-effects.ts";
import { prepareNativePedDeadModels } from "../src/ped-dead-models.ts";
import {
  readNativePedMoveFSM,
  planNativePedMove,
} from "../src/ped-move-fsm.ts";
import { transformPedPoint } from "../src/ped-form.ts";

const originalRoot = resolve(
  process.env.CARMA2_ROOT ??
    new URL("../carma2_orig/", import.meta.url).pathname,
);
let sourcePromise;
async function source(t) {
  try {
    await access(originalRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Original installation unavailable");
    return null;
  }
  sourcePromise ??= (async () => {
    const store = await createAssetStore(originalRoot),
      assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (path) => {
      const bytes = await store.read(path);
      if (!bytes) throw new Error(`Missing original pedestrian asset: ${path}`);
      return new Uint8Array(bytes);
    };
    const fsm = readNativePedMoveFSM(
      new Uint8Array(await readFile(join(originalRoot, "carma2_HW.exe"))),
    );
    return { assets, fsm };
  })();
  try {
    return await sourcePromise;
  } catch (error) {
    if (error.code !== "ENOENT" && !/Original installation/.test(String(error)))
      throw error;
    t.skip("Original installation unavailable");
    return null;
  }
}
async function fixture(t, stem, extraOptions = {}) {
  const original = await source(t);
  if (!original) return null;
  const template = await loadNativePedAssets(
    original.assets,
    `PEDS/PEEPS/${stem}`,
    stem,
    "data",
  );
  const dead = prepareNativePedDeadModels(stem, template, {
    nullFaceMaterial: () => template.inheritedActorMaterial,
  });
  const effects = new NativePedRenderEffects(template, dead);
  const resolveMove = (requestedId) => {
    const plan = planNativePedMove(original.fsm, {
      requestedId,
      previousAction: 6,
      requestedAction: -1,
      walkSpeed: -1,
      pedestrianSpeedFactor: 1,
      removedBoneMask: 0,
      drunk: false,
      dancing: false,
      panicking: false,
      availableMoves: new Set(template.moves.keys()),
    });
    assert.equal(plan.status, "complete");
    return plan.moveId;
  };
  const presentation = new NativePedPresentation(template, {
    effects,
    resolveMove,
    ...extraOptions,
  });
  const parent = new THREE.Group();
  parent.position.set(10, 2, 20);
  t.after(() => {
    presentation.dispose();
    effects.dispose();
    dead.dispose();
    dead.materialRegistry.dispose();
    template.dispose();
  });
  return { template, presentation, parent, effects, resolveMove };
}
function input(parent, timeMs, extra = {}) {
  parent.updateWorldMatrix(true, false);
  const position = parent.getWorldPosition(new THREE.Vector3());
  return {
    parent,
    worldPosition: position,
    heading: 0,
    groundY: position.y,
    moveId: 30,
    periodMs: 33,
    timeMs,
    alive: true,
    ...extra,
  };
}
function close(actual, expected, epsilon = 5e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) =>
    assert.ok(
      Math.abs(n - expected[i]) <= epsilon,
      `component${i}: ${n} != ${expected[i]}`,
    ),
  );
}
function anchors(presentation) {
  const instance = presentation.instance;
  instance.group.updateMatrixWorld(true);
  for (let index = 1; index < instance.bones.length; index++) {
    const bone = instance.poseBones[index];
    close(
      transformPedPoint(instance.bones[index].pose, bone.childAttachment),
      transformPedPoint(
        instance.bones[bone.parent].pose,
        bone.parentAttachment,
      ),
    );
    close(
      new THREE.Vector3(...bone.childAttachment)
        .applyMatrix4(instance.bones[index].actor.matrixWorld)
        .toArray(),
      new THREE.Vector3(...bone.parentAttachment)
        .applyMatrix4(instance.bones[bone.parent].actor.matrixWorld)
        .toArray(),
    );
  }
  close(
    instance.bones[0].actor.getWorldPosition(new THREE.Vector3()).toArray(),
    [...instance.rootPose.subarray(9)],
  );
}
function updated(presentation, request) {
  const result = presentation.update(request);
  assert.equal(
    result.status,
    "complete",
    JSON.stringify(result.requiredProviders),
  );
  assert.deepEqual(presentation.diagnostics, []);
  anchors(presentation);
  return result;
}

test("original human and DOG1 death BONs advance and source completion selects available moves", async (t) => {
  if (!(await source(t))) return;
  for (const stem of ["Blokebl", "CitySwat", "twolf"])
    await t.test(stem, async (t) => {
      const x = await fixture(t, stem),
        { presentation: p, parent, template, resolveMove } = x;
      updated(p, input(parent, 100));
      const fall = { pitchRadians: Math.PI / 3, rootHeight: 0.075 };
      updated(
        p,
        input(parent, 200, {
          alive: false,
          action: 5,
          moveId: 91,
          deadModelSet: 1,
          legacyFall: fall,
        }),
      );
      const instance = p.instance,
        start = instance.bones.map((b) => [...b.pose]),
        period = instance.clock.periodMs;
      assert.equal(instance.moveId, 91);
      assert.equal(instance.clock.frame, 0);
      updated(
        p,
        input(parent, 200 + period, {
          alive: false,
          action: 5,
          moveId: 91,
          legacyFall: fall,
        }),
      );
      assert.equal(instance.clock.frame, 1);
      assert.notDeepEqual(
        instance.bones.slice(1).map((b) => [...b.pose]),
        start.slice(1),
        "death children follow BON frame1",
      );
      let now = 200 + period;
      const finish = (id) => {
        let result;
        let remaining =
          template.moves.get(id).motion.frameCount - instance.clock.frame;
        while (remaining > 0) {
          const steps = Math.min(5, remaining);
          now += steps * period;
          result = updated(
            p,
            input(parent, now, {
              alive: false,
              action: 5,
              moveId: id,
              legacyFall: fall,
            }),
          );
          remaining -= steps;
        }
        assert.equal(result.completedMove, true);
      };
      finish(91);
      const next = resolveMove(97);
      assert.equal(instance.moveId, next);
      if (template.moves.has(97)) {
        assert.equal(next, 97);
        finish(97);
        assert.equal(instance.moveId, 94);
      } else {
        assert.equal(template.form.nonHumanoid, true);
        assert.equal(next, 72, "installed FSM maps missing DOG1 move97 to72");
      }
    });
});

test("Stillify freezes BON time while cached corpse roots follow actual transport without CRT", async (t) => {
  if (!(await source(t))) return;
  for (const stem of ["Blokebl", "CitySwat", "twolf"])
    await t.test(stem, async (t) => {
      let draws = 0;
      const { presentation: p, parent } = await fixture(t, stem, {
        nextCrtInteger: () => {
          draws++;
          return 32767;
        },
      });
      updated(p, input(parent, 100));
      const fall = { pitchRadians: Math.PI / 2, rootHeight: 0.055 };
      updated(
        p,
        input(parent, 200, {
          alive: false,
          action: 6,
          moveId: 94,
          still: true,
          legacyFall: fall,
        }),
      );
      assert.equal(p.instance.clock.periodMs, 0);
      const angles = [...p.instance.lastPoseAngles],
        frame = p.instance.clock.frame;
      parent.position.x += 1;
      parent.rotation.z = 0.2;
      updated(
        p,
        input(parent, 233, {
          alive: false,
          action: 6,
          moveId: 94,
          still: true,
          legacyFall: fall,
        }),
      );
      assert.equal(p.instance.clock.frame, frame);
      assert.equal(draws, 0);
      assert.deepEqual([...p.instance.lastPoseAngles], angles);
      assert.ok(Math.abs(p.instance.rootPose[9] - 10) > 0.5);
      updated(
        p,
        input(parent, 266, {
          alive: false,
          action: 6,
          moveId: 94,
          still: true,
          mutantSpeed: 1,
          legacyFall: fall,
        }),
      );
      assert.equal(
        draws,
        0,
        "zero-period visit precedes mutant Stillify rate activation",
      );
      assert.equal(p.instance.clock.periodMs, 33);
      updated(
        p,
        input(parent, 299, {
          alive: false,
          action: 6,
          moveId: 94,
          still: true,
          mutantSpeed: 1,
          legacyFall: fall,
        }),
      );
      assert.equal(
        draws,
        3 * (p.instance.bones.length - 1),
        "exactly one sample per eligible XYZ child, no reanchor samples",
      );
      assert.notDeepEqual(
        [...p.instance.lastPoseAngles],
        [...p.instance.move.bones.frames[p.instance.clock.frame]],
        "mutant pose changes copied child angles, not the authored frame",
      );
      updated(
        p,
        input(parent, 299, {
          alive: false,
          action: 6,
          moveId: 94,
          still: true,
          mutantSpeed: 2,
          sameTimeGuard: true,
          legacyFall: fall,
        }),
      );
      assert.equal(
        draws,
        3 * (p.instance.bones.length - 1),
        "unchanged outer time suppresses shared CRT draws",
      );
      assert.equal(
        p.instance.clock.periodMs,
        33,
        "Stillify does not replace a nonzero period for a changed nonzero multiplier",
      );
      assert.deepEqual(
        [...p.instance.lastPoseAngles],
        [...p.instance.move.bones.frames[p.instance.clock.frame]],
        "same-time visit uses authored angles without compounding a prior perturbation",
      );
      updated(
        p,
        input(parent, 332, {
          alive: false,
          action: 6,
          moveId: 94,
          still: true,
          mutantSpeed: 0,
          legacyFall: fall,
        }),
      );
      assert.equal(p.instance.clock.periodMs, 0);
      assert.equal(draws, 3 * (p.instance.bones.length - 1));
    });
});

test("death selects real set1/head2 resources and revival restores set0 models", async (t) => {
  if (!(await source(t))) return;
  for (const stem of ["Blokebl", "CitySwat", "twolf"])
    await t.test(stem, async (t) => {
      const { presentation: p, parent } = await fixture(t, stem);
      updated(p, input(parent, 100));
      const actors = p.instance.bones.map((b) => b.actor);
      updated(
        p,
        input(parent, 200, {
          alive: false,
          action: 6,
          moveId: 91,
          deadModelSet: 1,
        }),
      );
      assert.equal(p.instance.modelSet, 1);
      const head = p.template.form.headBone;
      for (const bone of p.instance.bones) {
        assert.equal(bone.actor, actors[bone.index]);
        const targetPose = bone.index === head && bone.modelSets[1][2] ? 2 : 0;
        assert.equal(bone.model, bone.modelSets[1][targetPose]);
      }
      assert.equal(p.reset(input(parent, 300)).status, "complete");
      assert.equal(p.instance.modelSet, 0);
      for (const bone of p.instance.bones)
        assert.equal(bone.model, bone.modelSets[0][0]);
      anchors(p);
    });
});

test("living scare/calm head models advance on125ms clock while BON period is zero", async (t) => {
  if (!(await source(t))) return;
  for (const stem of ["Blokebl", "CitySwat"])
    await t.test(stem, async (t) => {
      const { presentation: p, parent } = await fixture(t, stem);
      const visit = (timeMs, headSequence) =>
        updated(
          p,
          input(parent, timeMs, { moveId: 0, periodMs: 0, headSequence }),
        );
      visit(100, "scare");
      const head = p.instance.bones[p.template.form.headBone],
        root = [...p.instance.rootPose];
      assert.equal(head.model, head.modelSets[0][1]);
      visit(225, "scare");
      assert.equal(head.model, head.modelSets[0][1]);
      visit(226, "scare");
      assert.equal(head.model, head.modelSets[0][2]);
      visit(352, "scare");
      assert.equal(head.model, head.modelSets[0][1]);
      assert.equal(p.instance.clock.frame, 0);
      assert.equal(p.instance.clock.periodMs, 0);
      close([...p.instance.rootPose], root);
      visit(400, "calm");
      assert.equal(head.model, head.modelSets[0][0]);
      visit(526, "calm");
      assert.equal(head.model, head.modelSets[0][0]);
      close([...p.instance.rootPose], root);
    });
});

test("living morph receives nonzero source time, retains authored frames and adds no reanchor RNG", async (t) => {
  if (!(await source(t))) return;
  const { presentation: p, parent } = await fixture(t, "Blokebl", {
    nextCrtInteger: () => {
      throw new Error("healthy pedestrian must not draw mutant CRT");
    },
  });
  updated(p, input(parent, 100));
  const authored = p.instance.move.bones.frames.map((frame) => [...frame]);
  updated(
    p,
    input(parent, 200, { moveId: 31, morphArgument: 1000000, mutantSpeed: 1 }),
  );
  assert.ok(p.instance.morph, "nonzero selection time allocates native morph");
  assert.equal(p.instance.morphActive, true);
  assert.ok(p.instance.morph.progress > 0 && p.instance.morph.progress < 1);
  assert.equal(p.instance.clock.frame, 0);
  const before = p.instance.morph.progress;
  parent.position.z += 0.25;
  updated(
    p,
    input(parent, 233, { moveId: 31, morphArgument: 1000000, mutantSpeed: 1 }),
  );
  assert.ok(p.instance.morph.progress > before);
  assert.equal(p.instance.clock.frame, 0);
  const target = p.instance.move.bones.frames.map((frame) => [...frame]);
  assert.ok(target.length > 0);
  assert.equal(authored.length, 30);
  updated(p, input(parent, 266, { moveId: 30, mutantSpeed: 0 }));
  assert.equal(p.instance.morph, null);
  assert.deepEqual(
    p.instance.move.bones.frames.map((frame) => [...frame]),
    authored,
  );
});

test("original human90/92 complete to97 and96 completes directly to94", async (t) => {
  const x = await fixture(t, "Blokebl");
  if (!x) return;
  const { presentation: p, parent, template } = x;
  let now = 100;
  for (const id of [90, 92, 96]) {
    assert.equal(p.reset(input(parent, now)).status, "complete");
    now += 100;
    updated(p, input(parent, now, { alive: false, action: 5, moveId: id }));
    let remaining = template.moves.get(id).motion.frameCount,
      result;
    while (remaining > 0) {
      const steps = Math.min(5, remaining);
      now += steps * 33;
      result = updated(
        p,
        input(parent, now, { alive: false, action: 5, moveId: id }),
      );
      remaining -= steps;
    }
    assert.equal(result.completedMove, true);
    assert.equal(p.instance.moveId, id === 96 ? 94 : 97);
    now += 100;
  }
});

test("scale refresh uses supplied support, retains BON phase and does not draw RNG", async (t) => {
  let draws = 0;
  const x = await fixture(t, "CitySwat", {
    nextCrtInteger: () => {
      draws++;
      return 1234;
    },
  });
  if (!x) return;
  const { presentation: p, parent, effects } = x;
  updated(p, input(parent, 100));
  updated(p, input(parent, 133));
  const clock = { ...p.instance.clock },
    rootY = p.instance.rootPose[10];
  effects.setBodyScale([2, 2, 2]);
  p.refreshScaledPose(2, () => 2);
  assert.ok(
    Math.abs(p.instance.rootPose[10] - Math.fround((rootY - 2) * 2 + 2)) < 2e-6,
  );
  assert.deepEqual(p.instance.clock, clock);
  assert.equal(draws, 0);
  anchors(p);
  const y = p.instance.rootPose[10];
  effects.setHeadScale(4);
  p.refreshScaledPose(1, () => {
    throw Error("head scale must not query support");
  });
  assert.equal(p.instance.rootPose[10], y);
  assert.deepEqual(p.instance.clock, clock);
  assert.equal(draws, 0);
  anchors(p);
});

test("scaling a corpse preserves its refreshed root through subsequent rigid transport", async (t) => {
  const x = await fixture(t, "Blokebl");
  if (!x) return;
  const { presentation: p, parent, effects } = x;
  updated(p, input(parent, 100));
  const corpse = {
    alive: false,
    action: 6,
    moveId: 91,
    legacyFall: { pitchRadians: 0.7, rootHeight: 0.055 },
  };
  updated(p, input(parent, 200, corpse));
  const oldY = p.instance.rootPose[10];
  effects.setBodyScale([2, 2, 2]);
  p.refreshScaledPose(2, () => 2);
  const scaledY = p.instance.rootPose[10];
  assert.ok(Math.abs(scaledY - Math.fround((oldY - 2) * 2 + 2)) < 2e-6);
  updated(p, input(parent, 233, corpse));
  assert.ok(
    Math.abs(p.instance.rootPose[10] - scaledY) < 3e-6,
    "the old frozen-root cache must not undo body scaling",
  );
  anchors(p);
});

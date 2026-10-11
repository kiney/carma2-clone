import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTwt } from "../server/assets.mjs";
import { decodeText, parseDat } from "../src/formats.ts";
import { parsePedMotion } from "../src/pedestrians.ts";
import {
  parsePedForm,
  parsePedRemap,
  parsePedPersonalitySimpleBody,
  remapPedVector,
  buildPedRootMotion,
  composePedRootPose,
  transformPedPoint,
} from "../src/ped-form.ts";
import {
  quantizeNativePedAngle,
  nativePedMatrixToAngleBytes,
  buildNativePedBoneMotion,
  nativePedAnglesToMatrix,
  composeNativePedBonePose,
  poseNativePedBones,
} from "../src/ped-bone-pose.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function close(actual, expected, epsilon = 2e-6) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= epsilon,
      `component${i}: ${actual[i]} != ${expected[i]}`,
    );
}
function bone(
  parent,
  childAttachment = [0, 0, 0],
  parentAttachment = [0, 1, 0],
) {
  return {
    parent,
    childAttachment: parent < 0 ? null : childAttachment,
    parentAttachment: parent < 0 ? null : parentAttachment,
  };
}
function input(overrides = {}) {
  return {
    bones: [bone(-1), bone(0), bone(1), bone(2), bone(0)],
    angles: new Uint8Array(15),
    rootPose: [...identity.slice(0, 9), 7, 11, 13],
    characterOrientation: identity,
    currentPoses: Array.from({ length: 5 }, (_, i) => [
      ...identity.slice(0, 9),
      20 + i,
      30 + i,
      40 + i,
    ]),
    removedBoneMask: 0,
    mode: 0,
    selectedMoveValid: true,
    renderAvailable: true,
    physicsActive: false,
    boned: false,
    temporaryMatricesAvailable: false,
    morphActive: false,
    mutantSpeed: 0,
    ...overrides,
  };
}
test("angle16 double conversion truncates toward zero before unsigned wrap/high byte", () => {
  assert.equal(quantizeNativePedAngle(-0.00001), 0);
  assert.equal(quantizeNativePedAngle(0), 0);
  assert.equal(quantizeNativePedAngle(Math.PI / 2), 64);
  assert.equal(quantizeNativePedAngle(-Math.PI / 2), 192);
  assert.equal(quantizeNativePedAngle(Math.PI), 128);
  assert.equal(quantizeNativePedAngle(-Math.PI), 128);
  const K = 10430.378350470453;
  assert.equal(quantizeNativePedAngle((256 - 1e-6) / K), 0);
  assert.equal(quantizeNativePedAngle((256 + 1e-6) / K), 1);
  assert.equal(quantizeNativePedAngle(-(256 - 1e-6) / K), 255);
  assert.equal(quantizeNativePedAngle(-(256 + 1e-6) / K), 255);
  for (const n of [NaN, Infinity, 4])
    assert.throws(() => quantizeNativePedAngle(n));
});
test("XYZ_S rotation uses native row bases and Float32 table values", () => {
  close(
    nativePedAnglesToMatrix([64, 0, 0]),
    [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0],
  );
  close(
    nativePedAnglesToMatrix([0, 64, 0]),
    [0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  );
  close(
    nativePedAnglesToMatrix([0, 0, 64]),
    [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0],
  );
  for (const angles of [
    [17, 29, 41],
    [127, 0, 63],
    [128, 5, 192],
    [200, 99, 7],
  ]) {
    const m = nativePedAnglesToMatrix(angles);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const dot =
          m[a * 3] * m[b * 3] +
          m[a * 3 + 1] * m[b * 3 + 1] +
          m[a * 3 + 2] * m[b * 3 + 2];
        assert.ok(Math.abs(dot - (a === b ? 1 : 0)) < 2e-7);
      }
  }
  assert.throws(() => nativePedAnglesToMatrix([0, -1, 256]), /angle byte/);
});
test("matrix-to-angle singular threshold is strict greater than2^-19", () => {
  const m = [...identity];
  m[0] = 2 ** -19;
  m[1] = 0;
  m[2] = -1;
  m[5] = 1;
  m[8] = 0;
  m[7] = -1;
  m[4] = 1;
  assert.deepEqual(nativePedMatrixToAngleBytes(m), [32, 63, 0]);
  m[0] = Math.fround(2 ** -19 + 2 ** -42);
  assert.deepEqual(nativePedMatrixToAngleBytes(m), [64, 63, 0]);
  m[0] = 0;
  assert.deepEqual(nativePedMatrixToAngleBytes(m), [32, 64, 0]);
});
test("child rotation follows character orientation independently of rotated parent", () => {
  const parent = nativePedAnglesToMatrix([0, 0, 64]);
  parent.set([3, 5, 7], 9);
  const child = composeNativePedBonePose(
    [0, 0, 0],
    identity,
    parent,
    [1, 0, 0],
    [0, 2, 0],
  );
  close(child.slice(0, 9), identity.slice(0, 9));
  close(child.slice(9), [0, 5, 7]);
  close(
    transformPedPoint(child, [1, 0, 0]),
    transformPedPoint(parent, [0, 2, 0]),
  );
  const O = nativePedAnglesToMatrix([64, 0, 0]);
  const posed = composeNativePedBonePose(
    [0, 0, 64],
    O,
    parent,
    [1, 2, 3],
    [-2, 1, 4],
  );
  close(
    posed.slice(0, 9),
    composePedRootPose(nativePedAnglesToMatrix([0, 0, 64]), O, [0, 0, 0]).slice(
      0,
      9,
    ),
  );
  close(
    transformPedPoint(posed, [1, 2, 3]),
    transformPedPoint(parent, [-2, 1, 4]),
  );
});
test("null-orientation SetBoner alternate still satisfies joint anchors", () => {
  const p = [...identity.slice(0, 9), 3, 4, 5];
  const child = composeNativePedBonePose(
    [64, 0, 0],
    null,
    p,
    [0, 1, 0],
    [1, 2, 3],
  );
  close(child.slice(0, 9), nativePedAnglesToMatrix([64, 0, 0]).slice(0, 9));
  close(transformPedPoint(child, [0, 1, 0]), [4, 6, 8]);
});
test("full root basis stays untouched while children connect in FORM order", () => {
  const p = input(),
    before = p.currentPoses.map((m) => [...m]);
  p.rootPose = [
    ...nativePedAnglesToMatrix([41, 17, 29]).slice(0, 9),
    7,
    11,
    13,
  ];
  const r = poseNativePedBones(p);
  assert.deepEqual(Array.from(r.poses[0]), p.rootPose);
  assert.deepEqual(r.updatedBoneIndices, [1, 2, 3, 4]);
  for (let i = 1; i < p.bones.length; i++) {
    const b = p.bones[i];
    close(
      transformPedPoint(r.poses[i], b.childAttachment),
      transformPedPoint(r.poses[b.parent], b.parentAttachment),
    );
  }
  assert.deepEqual(
    p.currentPoses,
    before,
    "pure kernel must not mutate host matrices",
  );
});
test("active simple mode3 reposes children around solver root", () => {
  const p = input({ physicsActive: true, mode: 3 });
  p.rootPose = [...nativePedAnglesToMatrix([0, 0, 64]).slice(0, 9), -7, 2, 9];
  p.characterOrientation = nativePedAnglesToMatrix([0, 0, 64]);
  const r = poseNativePedBones(p);
  assert.deepEqual(Array.from(r.poses[0]), p.rootPose);
  close(r.poses[1].slice(9), [-8, 2, 9]);
  assert.equal(r.status, "posed");
});
test("removed own/immediate-parent bits freeze source matrices; partial subtree is not expanded", () => {
  const p = input({ removedBoneMask: 2 });
  const r = poseNativePedBones(p);
  assert.deepEqual(r.retainedBoneIndices, [1, 2]);
  assert.deepEqual(r.updatedBoneIndices, [3, 4]);
  assert.deepEqual(Array.from(r.poses[1]), p.currentPoses[1]);
  assert.deepEqual(Array.from(r.poses[2]), p.currentPoses[2]);
  close(r.poses[3].slice(9), [22, 33, 42]);
  const full = poseNativePedBones(input({ removedBoneMask: 2 | 4 | 8 }));
  assert.deepEqual(full.retainedBoneIndices, [1, 2, 3]);
  assert.deepEqual(full.updatedBoneIndices, [4]);
});
test("source move/render/mode/active-boned gates retain indexed child poses", () => {
  for (const override of [
    { selectedMoveValid: false },
    { renderAvailable: false },
    { mode: 1 },
    { mode: 2 },
    { physicsActive: true, boned: true },
  ]) {
    const p = input(override),
      r = poseNativePedBones(p);
    assert.equal(r.status, "retained");
    assert.deepEqual(r.updatedBoneIndices, []);
    for (let i = 1; i < 5; i++)
      assert.deepEqual(Array.from(r.poses[i]), p.currentPoses[i]);
  }
  assert.equal(
    poseNativePedBones(
      input({
        physicsActive: true,
        boned: true,
        temporaryMatricesAvailable: true,
        mode: 3,
      }),
    ).status,
    "posed",
  );
});
test("morph and mutant branches expose required providers without posing a generic rig", () => {
  for (const [override, provider] of [
    [{ morphActive: true }, "native-ped-morph-pose-provider"],
    [{ mutantSpeed: 1 }, "native-mutant-angle-rng-provider"],
  ]) {
    const p = input(override),
      r = poseNativePedBones(p);
    assert.equal(r.status, "provider-required");
    assert.deepEqual(r.requiredProviders, [provider]);
    assert.deepEqual(r.updatedBoneIndices, []);
    assert.deepEqual(Array.from(r.poses[1]), p.currentPoses[1]);
  }
});
test("animation matches exact FORM names, export flips first, and diagnoses missing/duplicate bones", () => {
  const motion = {
    bones: [{ name: "extra" }, { name: "child" }, { name: "root" }],
    frameCount: 1,
    matrices: new Float32Array([...identity, ...identity, ...identity]),
  };
  const r = buildNativePedBoneMotion(motion, ["root", "child"]);
  assert.deepEqual(Array.from(r.frames[0]), [0, 0, 0, 0, 0, 0]);
  assert.throws(
    () => buildNativePedBoneMotion(motion, ["missing"]),
    /missing animation bone/,
  );
  assert.throws(
    () =>
      buildNativePedBoneMotion(
        {
          ...motion,
          bones: [{ name: "root" }, { name: "root" }, { name: "child" }],
        },
        ["root"],
      ),
    /names/,
  );
});
test("native early returns precede morph and mutant dispatch; no child call needs no mutant RNG", () => {
  for (const p of [
    input({ selectedMoveValid: false, morphActive: true, mutantSpeed: 1 }),
    input({
      physicsActive: true,
      boned: true,
      morphActive: true,
      mutantSpeed: 1,
    }),
    input({ mode: 1, mutantSpeed: 1 }),
    input({ renderAvailable: false, mutantSpeed: 1 }),
    input({ removedBoneMask: 31, mutantSpeed: 1 }),
  ]) {
    const r = poseNativePedBones(p);
    assert.deepEqual(r.requiredProviders, []);
    assert.deepEqual(r.updatedBoneIndices, []);
  }
});
test("highest native32-bit missing mask does not become a negative/out-of-range host mask", () => {
  const p = input({
    bones: Array.from({ length: 32 }, (_, i) => bone(i ? 0 : -1)),
    currentPoses: Array.from({ length: 32 }, () => identity),
    angles: new Uint8Array(96),
    removedBoneMask: 0x80000000,
  });
  const r = poseNativePedBones(p);
  assert.deepEqual(r.retainedBoneIndices, [31]);
  assert.equal(r.updatedBoneIndices.length, 30);
});
test("invalid masks/attachments/tree/matrices reject before host mutation", () => {
  for (const p of [
    input({ removedBoneMask: 32 }),
    input({ removedBoneMask: -1 }),
    input({ angles: [-1, ...Array(14).fill(0)] }),
    input({ characterOrientation: [...identity.slice(0, 9), 1, 0, 0] }),
    input({ rootPose: [NaN, ...identity.slice(1)] }),
  ])
    assert.throws(() => poseNativePedBones(p));
  const p = input();
  p.bones[1].parent = 2;
  assert.throws(() => poseNativePedBones(p), /parents/);
  p.bones[1].parent = 0;
  p.bones[1].childAttachment = null;
  assert.throws(() => poseNativePedBones(p), /attachment/);
});
async function readOriginal(path, t) {
  try {
    return await readFile(
      new URL(`../carma2_orig/data/PEDS/${path}`, import.meta.url),
    );
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original local installation absent");
      return null;
    }
    throw e;
  }
}
function attachments(text, form, remap) {
  const rows = text
      .split(/\r?\n/)
      .map((s) => s.split("//")[0].trim())
      .filter(Boolean),
    result = Array(form.bones.length);
  let at = rows.indexOf("START OF BONES") + 1;
  for (let k = 0; k < form.bones.length; k++) {
    const name = rows[at++];
    at++;
    const index = form.bones.findIndex((b) => b.name === name),
      parent = form.bones[index].parent;
    if (parent < 0) {
      result[index] = bone(-1);
      continue;
    }
    const child = rows[at++].split(/[,\s]+/).map(Number),
      p = rows[at++].split(/[,\s]+/).map(Number);
    result[index] = bone(
      parent,
      remapPedVector(child, remap.get(name)?.general ?? null),
      remapPedVector(p, remap.get(form.bones[parent].name)?.general ?? null),
    );
  }
  return result;
}
for (const [person, formName, frameCapture, mass, bounds] of [
  [
    "Blokebl",
    "BIPED1",
    [127, 0, 63, 127, 0, 63, 128, 5, 192, 128, 27, 192],
    68,
    { min: [-0.15, -0.065, -0.03], max: [0.135, 0.065, 0.03] },
  ],
  [
    "Bandsman",
    "BIPEDF",
    [127, 0, 62, 127, 0, 63, 127, 4, 190, 127, 28, 189],
    68,
    { min: [-0.15, -0.065, -0.03], max: [0.135, 0.065, 0.03] },
  ],
  [
    "twolf",
    "DOG1",
    [0, 0, 0, 7, 0, 0, 7, 0, 0, 0, 0, 232],
    47,
    { min: [-0.028, -0.114, -0.085], max: [0.028, 0.09, 0.085] },
  ],
])
  test(`original ${person} attachments/${formName} animation: native frame angles, model remaps and joint anchors`, async (t) => {
    const fb = await readOriginal(`FORMS/${formName}.TXT`, t);
    if (!fb) return;
    const form = parsePedForm(decodeText(fb)),
      rb = await readOriginal(`REMAPS/${form.remapFilename}`, t),
      archive = await readOriginal(`PEEPS/${person}.TWT`, t);
    if (!rb || !archive) return;
    const entries = parseTwt(archive).entries,
      entry = entries.find(
        (e) => e.name.toLowerCase() === person.toLowerCase() + ".txt",
      ),
      text = decodeText(
        archive.subarray(entry.offset, entry.offset + entry.size),
      ),
      remap = parsePedRemap(decodeText(rb)),
      profile = parsePedPersonalitySimpleBody(text, form, remap),
      bones = attachments(text, form, remap);
    // Bandsman itself names BIPED1. BIPEDF has the same indexed bones/remaps;
    // this comparison also exercises its distinct female animation, without
    // claiming an articulated-physics or actual personality switch.
    assert.equal(
      form.bones.reduce((s, b) => s + b.massKg, 0),
      mass,
    );
    close(profile.bounds.min, bounds.min);
    close(profile.bounds.max, bounds.max);
    const move = form.moves.find((m) => m.id === 30),
      mb = await readOriginal(`MOVES/${move.filename}`, t);
    if (!mb) return;
    const motion = parsePedMotion(mb),
      native = buildNativePedBoneMotion(
        motion,
        form.bones.map((b) => b.name),
      ),
      roots = buildPedRootMotion(motion, form.bones[0].name, move.resetAxes);
    assert.deepEqual(Array.from(native.frames[0].slice(0, 12)), frameCapture);
    if (person !== "twolf")
      close(
        bones[2].childAttachment,
        person === "Blokebl" ? [-0.007, -0.014, 0] : [-0.009, -0.012, 0],
      );
    const O = nativePedAnglesToMatrix([0, 37, 0]);
    for (const frame of [0, 5, 15]) {
      const rootPose = composePedRootPose(roots[frame], O, [2, 3, 4]);
      const r = poseNativePedBones({
        ...input(),
        bones,
        angles: native.frames[frame],
        rootPose,
        characterOrientation: O,
        currentPoses: bones.map(() => identity),
      });
      assert.deepEqual(Array.from(r.poses[0]), Array.from(rootPose));
      for (let index = 1; index < bones.length; index++) {
        const b = bones[index];
        close(
          transformPedPoint(r.poses[index], b.childAttachment),
          transformPedPoint(r.poses[b.parent], b.parentAttachment),
          5e-6,
        );
      }
      if (person !== "twolf")
        assert.ok(
          rootPose[1] > 0.65,
          "native longX still points upward under world yaw",
        );
    }
    // Current model bounds are remapped independently of the authored simple body.
    const models = entries
        .filter((e) => /\.dat$/i.test(e.name))
        .flatMap((e) =>
          parseDat(archive.subarray(e.offset, e.offset + e.size)),
        ),
      rootModel = profile.modelsByBone.get(form.bones[0].name)[0],
      model = models.find(
        (m) => m.name.toLowerCase() === rootModel.toLowerCase(),
      );
    assert.ok(model);
    const vertices = Array.from(
      { length: model.positions.length / 3 },
      (_, i) =>
        remapPedVector(
          Array.from(model.positions.slice(i * 3, i * 3 + 3)),
          remap.get(form.bones[0].name)?.general ?? null,
        ),
    );
    const meshMin = [0, 1, 2].map((axis) =>
      Math.min(...vertices.map((v) => v[axis])),
    );
    assert.notDeepEqual(meshMin, profile.bounds.min);
  });

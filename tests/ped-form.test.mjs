import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTwt, createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parsePedMotion,
  parsePedGroups,
  parsePedSpawnSpecs,
} from "../src/pedestrians.ts";
import {
  parsePedForm,
  parsePedRemap,
  parsePedPersonalitySimpleBody,
  parsePedPersonalityOptions,
  parsePedPersonalityMoves,
  remapPedVector,
  nativePedBoxInertia,
  flipPedExportMatrix,
  lpNormalisePedMatrix,
  buildPedRootMotion,
  composePedRootPose,
  transformPedPoint,
  rotatePedMatrixCos,
  buildPedOrientation,
  pedRootMotionDirection,
  reorientPedRootPose,
  stepPedRootPose,
  groundPedRootOrigin,
  advancePedAnimationClock,
} from "../src/ped-form.ts";

const f = Math.fround;
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const formText = `3\n2\n4\n1\nROOT.TXT\nSTART OF BONES\nroot\n100\nBOX\nNONE\nNEXT BONE\nchild\n20\nLINE\nFALSE\n0\nEND OF BONES\nSTART OF MOVES\n30\n25\nXZ\n0,0,1\nwalk.BON\n0\nEND OF MOVES\nHUMANOID\n1\n-1\n1`;
const remapText = `START OF BONES\nroot\n+Y\n+X\n-Z\n+X\n+Y\n+Z\nEND OF BONES`;
const personalityText = `FORM\nDEFAULT\nSTART OF BONES\nroot\nBODY.ACT\nchild\nHEAD.DAT,NULL\n0,0,0\n0,1,0\nEND OF BONES\nSTART OF MOVES\n30\n0.5\nGROUND\n0.2\nEND OF MOVES\n-1,-2,-3\n1,2,3\n0,0.4,0\nSOUNDS.TXT`;
test("installed personality callback reads only its first optional token and next-line scalar", () => {
  const parse = (tail = "") =>
    parsePedPersonalityOptions(personalityText + tail);
  assert.deepEqual(parse(), { soundFilename: "SOUNDS.TXT", jumpHeight: 0 });
  assert.equal(parse("\nJuMpHeIgHt ignored\n1.25 trailing").jumpHeight, 1.25);
  assert.equal(parse("\nJUMPHEIGHT,9\n-0.2/ignored").jumpHeight, f(-0.2));
  assert.equal(parse("\nUNKNOWN\nJUMPHEIGHT\n1").jumpHeight, 0);
  assert.equal(parse("\nOPTIONS\nJUMPHEIGHT\n1").jumpHeight, 0);
  assert.equal(parse("\nJUMPHEIGHT\n1\nJUMPHEIGHT\n2").jumpHeight, 1);
  for (const tail of [
    "\nJUMPHEIGHT 1",
    "\nJUMPHEIGHT\nNaN",
    "\nJUMPHEIGHT\n1e1000",
  ])
    assert.throws(() => parse(tail), /scalar/);
  assert.throws(() =>
    parsePedPersonalityOptions(personalityText.replace("SOUNDS.TXT", "")),
  );
  const profile = parsePedPersonalitySimpleBody(
    personalityText + "\nJUMPHEIGHT\n0.2",
    parsePedForm(formText),
    parsePedRemap(remapText),
  );
  assert.equal(profile.jumpHeight, f(0.2));
  assert.equal(profile.soundFilename, "SOUNDS.TXT");
});

test("form sums every bone regardless of collision keyword and retains native pools/moves", () => {
  const p = parsePedForm(formText);
  assert.equal(p.mass, 0.12000000476837158);
  assert.deepEqual(
    [p.maxSimple, p.maxBoned, p.maxRender, p.maxStoredDismembered],
    [3, 2, 4, 1],
  );
  assert.equal(p.bones[1].collisionType, "LINE");
  assert.equal(p.bones[1].parent, 0);
  assert.deepEqual(p.moves[0], {
    id: 30,
    periodMs: 40,
    resetAxes: "XZ",
    direction: [0, 0, 1],
    filename: "walk.BON",
    flags: 0,
  });
});
test("root remap uses original components; bounds are reordered and COM is authored", () => {
  const p = parsePedPersonalitySimpleBody(
    personalityText,
    parsePedForm(formText),
    parsePedRemap(remapText),
  );
  assert.deepEqual(p.bounds, { min: [-2, -1, -3], max: [2, 1, 3] });
  assert.deepEqual(p.centreOfMass, [f(0.4), 0, -0]);
  assert.equal(p.radius, 3);
  assert.deepEqual(p.modelsByBone.get("child"), ["HEAD.DAT", null]);
  assert.deepEqual(p.attachmentsByBone.get("child"), {
    child: [0, 0, 0],
    parent: [1, 0, -0],
  });
  assert.deepEqual(remapPedVector([2, 4, 6], [4, 2, 0]), [-4, 6, 2]);
  const reordered = personalityText.replace(
    "root\nBODY.ACT\nchild\nHEAD.DAT,NULL\n0,0,0\n0,1,0",
    "child\nHEAD.DAT,NULL\n0,0,0\n0,1,0\nroot\nBODY.ACT",
  );
  assert.deepEqual(
    parsePedPersonalitySimpleBody(
      reordered,
      parsePedForm(formText),
      parsePedRemap(remapText),
    ).bounds,
    p.bounds,
  );
});
test("personality anchors independently use child and FORM-parent remaps", () => {
  const remaps = parsePedRemap(
    remapText.replace(
      "END OF BONES",
      "NEXT BONE\nchild\n-Y\n-X\n-Z\n+X\n+Y\n+Z\nEND OF BONES",
    ),
  );
  const profile = parsePedPersonalitySimpleBody(
    personalityText.replace("0,0,0\n0,1,0", "0.014,0.007,0\n0.014,0.007,0"),
    parsePedForm(formText),
    remaps,
  );
  assert.deepEqual(profile.attachmentsByBone.get("child"), {
    child: [-f(0.007), -f(0.014), -0],
    parent: [f(0.007), f(0.014), -0],
  });
  assert.equal(profile.attachmentsByBone.has("root"), false);
});
test("native inertia uses .025 and retains author COM independent of geometric centre", () => {
  assert.deepEqual(
    nativePedBoxInertia(2, { min: [0, 0, 0], max: [2, 4, 6] }),
    [2.6000001430511475, 2, 1],
  );
  assert.throws(
    () => nativePedBoxInertia(1, { min: [0, 0, 0], max: [0, 1, 1] }),
    /degenerate/,
  );
});
test("personality overrides merge after defaults without synthesizing missing records", () => {
  const defaults = "START OF MOVES\n30\n0.35\nNONE\n0.9\nEND OF MOVES";
  assert.deepEqual(
    parsePedPersonalityMoves(defaults, parsePedForm(formText)).get(30),
    { scale: f(0.35), groundingMode: -1, groundingOffset: f(0.9) },
  );
  const p = parsePedPersonalitySimpleBody(
    personalityText,
    parsePedForm(formText),
    parsePedRemap(remapText),
    defaults,
  );
  assert.deepEqual(p.movement.get(30), {
    scale: 0.5,
    groundingMode: 0,
    groundingOffset: f(0.2),
  });
  assert.equal(p.movement.size, 1);
  assert.throws(
    () =>
      parsePedPersonalityMoves(
        defaults.replace("\n30\n", "\n31\n"),
        parsePedForm(formText),
      ),
    /missing from form/,
  );
});
test("malformed/truncated/oversized and non-finite inputs are rejected before allocation", () => {
  for (const text of [
    formText.replace("3\n2\n", "256\n2\n"),
    formText.replace("\n100\n", "\n-100\n"),
    formText.replace("END OF BONES", ""),
    formText.replace("walk.BON", "../../walk.BON"),
    formText.replace("\n25\n", "\n0\n"),
    formText.replace("0,0,1", "0,Infinity,1"),
  ])
    assert.throws(() => parsePedForm(text));
  assert.throws(() => parsePedForm("x".repeat(2_000_001)), /size/);
  assert.throws(
    () =>
      parsePedPersonalitySimpleBody(personalityText, parsePedForm(formText)),
    /required remap/,
  );
  assert.throws(() => parsePedRemap(remapText.replace("+Y", "+Q")), /axis/);
  assert.throws(
    () =>
      parsePedRemap(
        remapText.replace("END OF BONES", "NEXT BONE\nEND OF BONES"),
      ),
    /separator/,
  );
  assert.throws(() =>
    parsePedPersonalitySimpleBody(
      personalityText.replace("0,0.4,0", "0,NaN,0"),
      parsePedForm(formText),
      parsePedRemap(remapText),
    ),
  );
});
test("export transform conjugates rotation and maps translation into BRender coordinates", () => {
  assert.deepEqual(
    Array.from(flipPedExportMatrix([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
    [1, 3, -2, 7, 9, -8, -4, -6, 5, 10, 12, -11],
  );
  assert.deepEqual(
    Array.from(lpNormalisePedMatrix([3, 0, 0, 1, 4, 0, 0, 0, 2, 7, 8, 9])),
    [
      0.9701424837112427, -0.24253562092781067, 0, 0.24253562092781067,
      0.9701424837112427, -0, 0, 0, 1, 7, 8, 9,
    ],
  );
  const degenerate = lpNormalisePedMatrix(new Array(12).fill(0));
  assert.deepEqual(
    Array.from(degenerate),
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  );
});
test("root motion takes exact named bone and cumulative reset deltas, including frame0", () => {
  const matrices = [];
  for (const p of [
    [5, 20, 30],
    [7, 24, 36],
    [10, 30, 45],
  ])
    matrices.push(...identity, ...identity.slice(0, 9), ...p);
  const motion = {
    bones: [{ name: "other" }, { name: "root" }],
    frameCount: 3,
    matrices,
  };
  const frames = buildPedRootMotion(motion, "root", "XZ");
  assert.deepEqual(
    frames.map((m) => Array.from(m.slice(9))),
    [
      [-5, 6, 10],
      [2, 6, -4],
      [3, 9, -6],
    ],
  );
  assert.throws(() => buildPedRootMotion(motion, "unknown"), /invalid root/);
  assert.deepEqual(
    Array.from(
      buildPedRootMotion(
        { bones: [{ name: "root" }], frameCount: 1, matrices: identity },
        "root",
      )[0].slice(9),
    ),
    [0, 0, 0],
  );
});
test("root pose and COM transform preserve full frame basis and explicit world origin", () => {
  const frame = [0, 1, 0, -1, 0, 0, 0, 0, 1, 999, 999, 999];
  const pose = composePedRootPose(frame, identity, [2, 3, 4]);
  assert.deepEqual(Array.from(pose), frame.slice(0, 9).concat([2, 3, 4]));
  assert.deepEqual(transformPedPoint(pose, [0.04, 0, 0]), [
    2,
    f(3 + f(0.04)),
    4,
  ]);
  assert.throws(
    () => composePedRootPose(identity.slice(1), identity, [0, 0, 0]),
    /4x3/,
  );
  assert.throws(
    () => transformPedPoint(identity, [Infinity, 0, 0]),
    /non-finite/,
  );
});

function near(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= epsilon,
      `${i}: ${actual[i]} vs ${expected[i]}`,
    );
}
test("native direction builds cardinal yaw, opposite-direction fallback and slope tilt", () => {
  near(buildPedOrientation([0, 0, 1], null, [0, 0, 1]).orientation, identity);
  near(
    buildPedOrientation([1, 0, 0], [0, 1, 0], [0, 0, 1]).orientation,
    [0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  );
  near(
    buildPedOrientation([0, 0, -1], [0, 1, 0], [0, 0, 1]).orientation,
    [-1, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0],
  );
  const slope = buildPedOrientation([0, 0, 1], [0.6, 0.8, 0], [0, 0, 1]);
  near(slope.orientation.slice(3, 6), [0.6, 0.8, 0]);
  near(slope.movement, slope.orientation);
  near(rotatePedMatrixCos([0, 1, 0], 2), identity);
});
test("installed animation clock retains a remainder rounded to1 until its next call", () => {
  for (const [input, timeMs, expected, nextTime, next] of [
    [
      { frame: 4, fraction: f(0.95), periodMs: 20, lastTimeMs: 2302 },
      2363,
      { advance: 3, fraction: 1, lastTimeMs: 2363, initialPose: false },
      2364,
      { advance: 1, fraction: f(0.05), lastTimeMs: 2364, initialPose: false },
    ],
    [
      {
        frame: 24,
        fraction: f(0.3030302822589874),
        periodMs: 33,
        lastTimeMs: 915,
      },
      971,
      { advance: 1, fraction: 1, lastTimeMs: 971, initialPose: false },
      972,
      { advance: 1, fraction: f(1 / 33), lastTimeMs: 972, initialPose: false },
    ],
  ]) {
    const result = advancePedAnimationClock(input, timeMs);
    assert.deepEqual(result, expected);
    const retained = {
      ...input,
      frame: input.frame + result.advance,
      fraction: result.fraction,
      lastTimeMs: result.lastTimeMs,
    };
    assert.deepEqual(advancePedAnimationClock(retained, nextTime), next);
    assert.deepEqual(advancePedAnimationClock(retained, timeMs), {
      advance: 1,
      fraction: 0,
      lastTimeMs: timeMs,
      initialPose: false,
    });
    assert.throws(
      () => advancePedAnimationClock({ ...retained, fraction: 1.01 }, nextTime),
      /clock/,
    );
  }
});

test("installed clock operation order preserves half-ULP boundaries and tiny residuals", () => {
  const source = advancePedAnimationClock(
    {
      frame: 24,
      fraction: 0.18360379338264465,
      periodMs: 5855,
      lastTimeMs: 400000,
    },
    445765,
  );
  assert.deepEqual(source, {
    advance: 8,
    fraction: 3.591040353967401e-8,
    lastTimeMs: 445765,
    initialPose: false,
  });
  for (const [fraction, advance, retained] of [
    [0.4999999403953552, 0, 0.9999999403953552],
    [0.4999999701976776, 0, 1],
    [0.5, 1, 0],
  ]) {
    assert.deepEqual(
      advancePedAnimationClock(
        {
          frame: 24,
          fraction,
          periodMs: 2,
          lastTimeMs: 100,
        },
        101,
      ),
      {
        advance,
        fraction: retained,
        lastTimeMs: 101,
        initialPose: false,
      },
    );
  }
});

test("movement matrix separately pitches the ground-plane direction into actual travel", () => {
  const result = buildPedOrientation([0, 0.6, 0.8], [0, 1, 0], [0, 0, 1]);
  near(result.orientation, identity);
  near(transformPedPoint(result.movement, [0, 0, 1]), [0, 0.6, 0.8]);
  near(result.orientation.slice(3, 6), [0, 1, 0]);
});
test("direction change preserves animated root roll and world origin", () => {
  const frame = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0],
    old = buildPedOrientation([0, 0, -1], null, [0, 0, 1]).orientation,
    next = buildPedOrientation([1, 0, 0], null, [0, 0, 1]).orientation;
  const before = composePedRootPose(frame, old, [5, 6, 7]),
    after = reorientPedRootPose(before, old, next);
  near(after, composePedRootPose(frame, next, [5, 6, 7]));
  assert.throws(
    () => reorientPedRootPose(before, new Array(12).fill(0), next),
    /singular/,
  );
});
test("frame root step uses scaled delta and movement basis while grounding offset remains unscaled", () => {
  const orientation = buildPedOrientation([1, 0, 0], null, [0, 0, 1]);
  const frame = identity.slice(0, 9).concat([0, 0, 2]),
    old = identity.slice(0, 9).concat([10, 20, 30]);
  const result = stepPedRootPose(
    old,
    frame,
    orientation.orientation,
    orientation.movement,
    0.35,
  );
  near(result.slice(9), [f(10 + f(0.7)), 20, 30]);
  near(
    stepPedRootPose(
      old,
      frame,
      orientation.orientation,
      orientation.movement,
      0.35,
      false,
    ).slice(9),
    [10, 20, 30],
  );
  assert.deepEqual(groundPedRootOrigin([10, 20, 30], 2, 0.154), [
    10,
    f(2 + f(0.154)),
    30,
  ]);
});
test("ordinary animation clock retains fractions, clamps ten frames and supports signed replay/wrap", () => {
  const clock = { frame: 2, fraction: 0.25, lastTimeMs: 100, periodMs: 100 };
  assert.deepEqual(advancePedAnimationClock(clock, 150), {
    advance: 0,
    fraction: 0.75,
    lastTimeMs: 150,
    initialPose: false,
  });
  assert.deepEqual(advancePedAnimationClock(clock, 2100), {
    advance: 10,
    fraction: 0.25,
    lastTimeMs: 2100,
    initialPose: false,
  });
  assert.equal(
    advancePedAnimationClock({ ...clock, periodMs: -100 }, 150).advance,
    -1,
  );
  assert.equal(
    advancePedAnimationClock({ ...clock, lastTimeMs: 0 }, 150).initialPose,
    true,
  );
  assert.equal(
    advancePedAnimationClock(
      { ...clock, lastTimeMs: 0xfffffff0, periodMs: 16 },
      0x20,
    ).advance,
    3,
  );
  assert.equal(
    advancePedAnimationClock({ ...clock, periodMs: 0 }, 999).advance,
    0,
  );
  assert.throws(
    () => advancePedAnimationClock({ ...clock, fraction: NaN }, 150),
    /non-finite/,
  );
});
test("source motion direction respects reset flags and native stationary default", () => {
  const frames = [
    identity.slice(0, 9).concat([1, 0, 2]),
    identity.slice(0, 9).concat([1, 3, 2]),
  ].map((a) => new Float32Array(a));
  const moving = pedRootMotionDirection(frames, [0, 0, 0], "Y");
  near(moving.sourceDirection, [1 / Math.sqrt(5), 0, 2 / Math.sqrt(5)]);
  assert.equal(moving.stationary, false);
  assert.deepEqual(
    pedRootMotionDirection(frames, [0, 0, 0], "X").sourceDirection,
    [0, 0, 1],
  );
  assert.equal(pedRootMotionDirection(frames, [0, 0, 2], "X").stationary, true);
});

async function original(path, t) {
  try {
    return await readFile(new URL(`../carma2_orig/${path}`, import.meta.url));
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return null;
    }
    throw e;
  }
}
test(
  "original humanoid and animal FORM pool and per-bone native mass vectors",
  { concurrency: false },
  async (t) => {
    for (const [file, mass, bones, pool, nonHumanoid] of [
      ["BIPED1.TXT", 0.06800000369548798, 10, 30, false],
      ["BIPEDF.TXT", 0.06800000369548798, 10, 30, false],
      ["DOG1.TXT", 0.04699999839067459, 16, 15, true],
      ["cow_form.txt", 0.12300000339746475, 12, 15, true],
      ["deer_form.txt", 0.12300000339746475, 12, 15, true],
      ["elephant_form.txt", 4.409999370574951, 11, 15, true],
      ["penguin_form.txt", 0.03799999877810478, 7, 15, true],
      ["sheep_form.txt", 0.05499999597668648, 11, 15, true],
    ]) {
      const bytes = await original(`data/PEDS/FORMS/${file}`, t);
      if (!bytes) return;
      const p = parsePedForm(decodeText(bytes));
      assert.equal(p.mass, mass);
      assert.equal(p.bones.length, bones);
      assert.equal(p.maxSimple, pool);
      assert.equal(p.maxRender, pool);
      assert.equal(p.nonHumanoid, nonHumanoid);
    }
  },
);
test("original humanoid and quadruped personalities provide independent remapped bodies", async (t) => {
  for (const [person, formFile, remapFile, mass] of [
    ["Blokebl", "BIPED1", "MAN", 0.06800000369548798],
    ["Bandsman", "BIPED1", "MAN", 0.06800000369548798],
    ["twolf", "DOG1", "DOG", 0.04699999839067459],
  ]) {
    const archive = await original(`data/PEDS/PEEPS/${person}.TWT`, t);
    if (!archive) return;
    const e = parseTwt(archive).entries.find(
      (e) => e.name.toLowerCase() === person.toLowerCase() + ".txt",
    );
    assert.ok(e);
    const bytes = await original(`data/PEDS/FORMS/${formFile}.TXT`, t),
      remap = await original(`data/PEDS/REMAPS/${remapFile}.TXT`, t);
    if (!bytes || !remap) return;
    const profile = parsePedPersonalitySimpleBody(
      decodeText(archive.subarray(e.offset, e.offset + e.size)),
      parsePedForm(decodeText(bytes)),
      parsePedRemap(decodeText(remap)),
    );
    assert.equal(profile.mass, mass);
    assert.ok(profile.inertia.every((n) => n > 0));
    assert.equal(
      profile.attachmentsByBone.size,
      parsePedForm(decodeText(bytes)).bones.length - 1,
    );
    if (formFile === "BIPED1") {
      const decimal = person === "Blokebl" ? [0.014, 0.007] : [0.012, 0.009];
      const bone2 = parsePedForm(decodeText(bytes)).bones[2].name;
      assert.deepEqual(profile.attachmentsByBone.get(bone2), {
        child: [-f(decimal[1]), -f(decimal[0]), -0],
        parent: [f(decimal[1]), f(decimal[0]), -0],
      });
      assert.deepEqual(profile.bounds, {
        min: [f(-0.15), f(-0.065), f(-0.03)],
        max: [f(0.135), f(0.065), f(0.03)],
      });
      assert.deepEqual(profile.centreOfMass, [f(0.04), 0, -0]);
      assert.deepEqual(
        profile.inertia,
        [
          0.00003484999979264103, 0.00014420253864955157,
          0.00016681253327988088,
        ],
      );
    }
  }
});

test("Stock and Advanced humanoid FORM moves retain initialized personality defaults before authored overlays", async (t) => {
  for (const root of ["data", "adv_data"])
    for (const person of ["Blokebl", "Bandsman"]) {
      const archive = await original(`${root}/PEDS/PEEPS/${person}.TWT`, t);
      if (!archive) return;
      const entry = parseTwt(archive).entries.find(
        (entry) => entry.name.toLowerCase() === `${person.toLowerCase()}.txt`,
      );
      assert.ok(entry);
      const text = decodeText(
        archive.subarray(entry.offset, entry.offset + entry.size),
      );
      const rows = text
        .split(/\r?\n/)
        .map((row) => row.split("//")[0].trim())
        .filter(Boolean);
      const formBytes = await original(`${root}/PEDS/FORMS/${rows[0]}.TXT`, t);
      const defaultBytes = await original(
        `${root}/PEDS/MOVES/${rows[1]}.TXT`,
        t,
      );
      if (!formBytes || !defaultBytes) return;
      const form = parsePedForm(decodeText(formBytes));
      const remapBytes = await original(
        `${root}/PEDS/REMAPS/${form.remapFilename}`,
        t,
      );
      if (!remapBytes) return;
      const defaults = decodeText(defaultBytes);
      const authored = new Map([
        ...parsePedPersonalityMoves(defaults, form),
        ...parsePedPersonalityMoves(text, form),
      ]);
      const profile = parsePedPersonalitySimpleBody(
        text,
        form,
        parsePedRemap(decodeText(remapBytes)),
        defaults,
      );
      assert.equal(profile.movement.size, form.moves.length);
      for (const id of [4, 5, 6]) {
        assert.ok(form.moves.some((move) => move.id === id));
        assert.equal(
          authored.has(id),
          false,
          `${root}/${person}/${id} has no authored override`,
        );
        assert.deepEqual(profile.movement.get(id), {
          scale: 1,
          groundingMode: -1,
          groundingOffset: 0,
        });
      }
      for (const [id, move] of authored)
        assert.deepEqual(
          profile.movement.get(id),
          move,
          `${root}/${person}/${id} preserves authored overlay`,
        );
    }
});

test("Stock and Advanced callback jump distances come from original personality options", async (t) => {
  for (const root of ["data", "adv_data"]) {
    for (const [person, expectedJump, expectedSounds] of [
      ["Blokebl", 0, "MALESOUNDS.TXT"],
      ["Elephant", 1, "ELEPHANTSOUNDS.TXT"],
      ["sheep", 1, "SHEEPSOUNDS.TXT"],
    ]) {
      const archive = await original(`${root}/PEDS/PEEPS/${person}.TWT`, t);
      if (!archive) return;
      const entry = parseTwt(archive).entries.find(
        (e) => e.name.toLowerCase() === `${person}.txt`.toLowerCase(),
      );
      assert.ok(entry);
      const options = parsePedPersonalityOptions(
        decodeText(archive.subarray(entry.offset, entry.offset + entry.size)),
      );
      assert.equal(options.jumpHeight, expectedJump);
      assert.equal(options.soundFilename.toUpperCase(), expectedSounds);
    }
  }
});
test("installed stock/Advanced spawn groups retain all readable original simple-body profiles", async (t) => {
  let store;
  try {
    store = await createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    );
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw e;
  }
  const text = async (path) => {
    const bytes = await store.read(path);
    assert.ok(bytes, path);
    return decodeText(bytes);
  };
  const groups = parsePedGroups(await text("data/PEDS/settings.txt")),
    names = new Set();
  for (const entry of store.manifest.filter((e) =>
    /^(data|adv_data)\/races\/[^/]+\/[^/]+\.txt$/i.test(e.path),
  ))
    for (const spec of parsePedSpawnSpecs(await text(entry.path)))
      for (const name of groups.get(spec.group) ?? [])
        names.add(name.toLowerCase());
  const forms = new Map(),
    formCounts = new Map();
  let readable = 0;
  for (const name of names) {
    const prefix = `data/peds/peeps/${name}/`;
    if (
      !store.manifest.some(
        (e) =>
          e.path.toLowerCase().startsWith(prefix) &&
          /^[^/]+\.act$/i.test(e.path.slice(prefix.length)),
      )
    )
      continue;
    const personality = await text(`${prefix}${name}.txt`),
      lines = personality
        .split(/\r?\n/)
        .map((s) => s.split("//")[0].trim())
        .filter(Boolean),
      key = lines[0].toLowerCase();
    let data = forms.get(key);
    if (!data) {
      const form = parsePedForm(await text(`data/PEDS/FORMS/${lines[0]}.TXT`)),
        remap = form.remapFilename
          ? parsePedRemap(await text(`data/PEDS/REMAPS/${form.remapFilename}`))
          : undefined;
      data = { form, remap };
      forms.set(key, data);
      for (const move of form.moves) {
        const bytes = await store.read(`data/PEDS/MOVES/${move.filename}`);
        assert.ok(bytes, move.filename);
        const motion = parsePedMotion(bytes);
        if (key === "dog1" && move.id === 93) {
          assert.ok(!motion.bones.some((b) => b.name === form.bones[0].name));
          assert.throws(
            () =>
              buildPedRootMotion(motion, form.bones[0].name, move.resetAxes),
            /invalid root/,
          );
        } else {
          const frames = buildPedRootMotion(
            motion,
            form.bones[0].name,
            move.resetAxes,
          );
          assert.equal(frames.length, motion.frameCount);
          assert.ok(
            pedRootMotionDirection(
              frames,
              move.direction,
              move.resetAxes,
            ).sourceDirection.every(Number.isFinite),
          );
        }
      }
    }
    const profile = parsePedPersonalitySimpleBody(
      personality,
      data.form,
      data.remap,
      await text(`data/PEDS/MOVES/${lines[1]}.TXT`),
    );
    assert.ok(profile.inertia.every((n) => Number.isFinite(n) && n > 0));
    assert.equal(profile.modelsByBone.size, data.form.bones.length);
    formCounts.set(key, (formCounts.get(key) ?? 0) + 1);
    readable++;
  }
  assert.equal(readable, 129);
  assert.equal(formCounts.get("biped1"), 122);
  assert.equal(formCounts.get("dog1"), 2);
  for (const key of [
    "cow_form",
    "deer_form",
    "elephant_form",
    "penguin_form",
    "sheep_form",
  ])
    assert.equal(formCounts.get(key), 1);
});
test("original root BON matrices produce finite normalized native bases", async (t) => {
  const bytes = await original("data/PEDS/FORMS/BIPED1.TXT", t);
  if (!bytes) return;
  const form = parsePedForm(decodeText(bytes)),
    move = form.moves.find((m) => m.id === 30);
  assert.ok(move);
  const motionBytes = await original(`data/PEDS/MOVES/${move.filename}`, t);
  if (!motionBytes) return;
  const motion = parsePedMotion(motionBytes),
    frames = buildPedRootMotion(motion, form.bones[0].name, move.resetAxes);
  assert.equal(frames.length, motion.frameCount);
  const source = pedRootMotionDirection(frames, move.direction, move.resetAxes);
  near(source.sourceDirection, [0.001240854267962277, 0, 0.9999992251396179]);
  const orientation = buildPedOrientation(
    [1, 0, 0],
    [0, 1, 0],
    source.sourceDirection,
  );
  const root = composePedRootPose(
    frames[0],
    orientation.orientation,
    [0, 0.154, 0],
  );
  assert.ok(
    root[1] > 0.9998,
    "Native local X is transformed to the humanoid world up axis",
  );
  for (const frame of frames) {
    assert.ok(frame.every(Number.isFinite));
    for (let i = 0; i < 3; i++)
      assert.ok(
        Math.abs(Math.hypot(...frame.slice(i * 3, i * 3 + 3)) - 1) < 1e-6,
      );
  }
});

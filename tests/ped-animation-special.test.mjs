import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareNativePedMorph,
  advanceNativePedMorph,
  sampleNativePedMorphAngles,
  nativePedMorphVelocity,
  sampleNativePedMorphRootDelta,
  sampleNativePedMorphSourceDirection,
  perturbNativePedMutantAngles,
} from "../src/ped-animation-special.ts";

const f = Math.fround;
function morph(overrides = {}) {
  return prepareNativePedMorph({
    startAngles: [0, 0, 0, 0, 0, 0],
    targetAngles: [0, 0, 0, 64, 0, 0],
    morphArgument: 6,
    ...overrides,
  });
}
test("native angular-speed scale uses mean child delta across all FORM bones", () => {
  // Two bones, angular sum64, scale6: reciprocal duration =384/(64*6)=1.
  // Reconstructed rec2's multiplication by3*boneCount would instead give1/36.
  assert.equal(morph().rate, 1);
  assert.equal(morph({ morphArgument: 12 }).rate, 0.5);
  const rootChanged = morph({ targetAngles: [128, 128, 128, 64, 0, 0] });
  assert.equal(
    rootChanged.rate,
    1,
    "root rotation is excluded from angular sum",
  );
  const moreBones = morph({
    startAngles: new Uint8Array(9),
    targetAngles: [0, 0, 0, 64, 0, 0, 0, 0, 0],
  });
  assert.equal(
    moreBones.rate,
    1.5,
    "bone count includes root and unmoving bones",
  );
});
test("morph deltas wrap signed bytes, including root, and truncate across zero", () => {
  const m = morph({
    startAngles: [255, 127, 128, 255, 250, 5],
    targetAngles: [1, 128, 127, 1, 5, 250],
  });
  assert.deepEqual([...m.startAngles], [-1, 127, -128, -1, -6, 5]);
  assert.deepEqual([...m.deltaAngles], [2, 1, -1, 2, 11, -11]);
  m.progress = 0.25;
  assert.deepEqual(
    [...sampleNativePedMorphAngles(m)],
    [0, 127, 128, 0, 253, 2],
  );
  m.progress = 0.75;
  assert.deepEqual(
    [...sampleNativePedMorphAngles(m)],
    [0, 127, 128, 0, 2, 253],
  );
});
test("clock stores Float32 progress, uses unsigned elapsed, and does not clamp completion", () => {
  const m = morph();
  m.rate = f(0.001);
  assert.deepEqual(advanceNativePedMorph(m, 250), {
    active: true,
    progress: f(250 * f(0.001)),
    requiredProviders: [],
  });
  const second = advanceNativePedMorph(m, 1000);
  assert.equal(second.active, false);
  assert.equal(second.progress, 1.25);
  assert.throws(() => sampleNativePedMorphAngles(m), /completed morph/);
  const large = morph();
  large.rate = f(2 ** -32);
  assert.equal(advanceNativePedMorph(large, 0xffffffff).progress, 1);
  assert.throws(() => advanceNativePedMorph(morph(), -1));
  assert.throws(() => advanceNativePedMorph(morph(), 0x100000000));
});
test("zero angular difference retains source Infinity and exposes zero-elapsed NaN", () => {
  const m = morph({ targetAngles: [32, 64, 96, 0, 0, 0] });
  assert.equal(m.rate, Infinity);
  const zero = advanceNativePedMorph(m, 0);
  assert.equal(Number.isNaN(zero.progress), true);
  assert.deepEqual(zero.requiredProviders, [
    "native-ped-degenerate-morph-numerics-provider",
  ]);
  assert.equal(m.progress, 0, "nonfinite result does not poison world state");
  const next = advanceNativePedMorph(m, 1);
  assert.equal(next.active, false);
  assert.equal(next.progress, Infinity);
});
test("morph velocities retain old/new authored vector distinction and signed16 rates", () => {
  assert.deepEqual(
    nativePedMorphVelocity([12, 24, -36], 3, 2, false),
    [2, 4, -6],
  );
  assert.deepEqual(
    nativePedMorphVelocity([12, 24, -36], 3, -2, false),
    [-2, -4, 6],
  );
  assert.deepEqual(
    nativePedMorphVelocity([12, 24, -36], 3, 0, false),
    [0, 0, 0],
  );
  assert.deepEqual(
    nativePedMorphVelocity([12, 24, -36], 3, 2, true),
    [0, 0, 0],
  );
  assert.throws(() => nativePedMorphVelocity([1, 2, 3], 0, 2, false));
  assert.throws(() => nativePedMorphVelocity([1, 2, 3], 1, 32768, false));
});
test("root drift blends velocity at new progress and applies movement basis without translation", () => {
  const m = morph({ oldVelocity: [1, 2, 3], newVelocity: [5, 6, 7] });
  m.progress = 0.25;
  // local midpoint-weighted velocity[2,3,4] *elapsed10 ->[20,30,40].
  // +90 degree Y native row rotation sends it to[40,30,-20].
  const matrix = [0, 0, -1, 0, 1, 0, 1, 0, 0, 101, 102, 103];
  assert.deepEqual(sampleNativePedMorphRootDelta(m, 10, matrix), [40, 30, -20]);
  assert.deepEqual(sampleNativePedMorphRootDelta(m, 0, matrix), [0, 0, 0]);
  const retained = morph({ morphArgument: 0x40000006 });
  assert.equal(retained.retainRoot, true);
  assert.equal(retained.rate, 1, "retained-root flag is masked from rate");
});
test("morph source direction blends old+40 to selected+40 then normalizes", () => {
  const m = morph({ oldSourceDirection: [3, 0, 0] });
  assert.deepEqual(
    sampleNativePedMorphSourceDirection(m, [0, 0, 4]),
    [1, 0, 0],
  );
  m.progress = 0.5;
  assert.deepEqual(sampleNativePedMorphSourceDirection(m, [0, 0, 4]), [
    f(0.6),
    0,
    f(0.8),
  ]);
  assert.deepEqual(
    sampleNativePedMorphSourceDirection(m, [-3, 0, 0]),
    [1, 0, 0],
  );
});
function mutant(overrides = {}) {
  return {
    angles: [5, 250, 128],
    mutantSpeed: 1,
    health: 0,
    action: 6,
    sameTimeGuard: false,
    ...overrides,
  };
}
test("mutant XYZ draws share CRT integer sequence and include both endpoints", () => {
  const samples = [0, 32767, 16384],
    seen = [];
  const source = mutant({
    nextCrtInteger: () => {
      const n = samples.shift();
      seen.push(n);
      return n;
    },
  });
  const result = perturbNativePedMutantAngles(source);
  assert.deepEqual(result, {
    angles: [231, 24, 128],
    randomDrawCalls: 3,
    requiredProviders: [],
  });
  assert.deepEqual(seen, [0, 32767, 16384]);
  assert.deepEqual(
    source.angles,
    [5, 250, 128],
    "helper does not alter authored frame bytes",
  );
  assert.deepEqual(
    perturbNativePedMutantAngles(
      mutant({
        mutantSpeed: -2,
        health: -128,
        nextCrtInteger: () => 16384,
      }),
    ).angles,
    [5, 250, 128],
  );
});
test("mutant gates consume no RNG and request a provider only for actual perturbation", () => {
  for (const overrides of [
    { mutantSpeed: 0 },
    { mutantSpeed: Number.MIN_VALUE },
    { health: 1 },
    { action: 5 },
    { sameTimeGuard: true },
  ]) {
    assert.deepEqual(perturbNativePedMutantAngles(mutant(overrides)), {
      angles: [5, 250, 128],
      randomDrawCalls: 0,
      requiredProviders: [],
    });
  }
  assert.deepEqual(perturbNativePedMutantAngles(mutant()).requiredProviders, [
    "native-mutant-angle-rng-provider",
  ]);
  let calls = 0;
  assert.equal(
    perturbNativePedMutantAngles(
      mutant({
        health: 127,
        nextCrtInteger: () => {
          calls++;
          return 0;
        },
      }),
    ).randomDrawCalls,
    0,
  );
  assert.equal(calls, 0);
});
test("malformed frames, flags, health and CRT results fail explicitly", () => {
  for (const overrides of [
    { startAngles: [0, 0] },
    { targetAngles: [0, 0, 0] },
    { startAngles: [0, 0, 0, 256, 0, 0] },
    { morphArgument: 0 },
    { morphArgument: 0x40000000 },
    { oldVelocity: [0, Infinity, 0] },
  ])
    assert.throws(() => morph(overrides));
  for (const overrides of [
    { health: 128 },
    { mutantSpeed: NaN },
    { nextCrtInteger: () => 32768 },
    { nextCrtInteger: () => -1 },
    { nextCrtInteger: () => 0.5 },
  ])
    assert.throws(() => perturbNativePedMutantAngles(mutant(overrides)));
});

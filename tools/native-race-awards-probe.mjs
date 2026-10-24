// Optional original-function capture. Never imported by npm test or browser code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { wastedCarCredits } from "../src/race-awards.ts";
import { NativePedAwardCounter } from "../src/ped-awards.ts";
import { RacePayout } from "../src/race-payout.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const original = path.resolve(
  process.env.CARMA2_ROOT ?? path.join(project, "carma2_orig"),
  "carma2_HW.exe",
);
const expectedHash =
  "698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c";
if (process.platform !== "linux" || !["x64", "ia32"].includes(process.arch))
  throw new Error(
    "This optional probe needs Linux x86 with IA32 syscall support",
  );
const bytes = await readFile(original);
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256,
  expectedHash,
  "Refusing to execute a different original binary",
);
const pe = bytes.readUInt32LE(0x3c);
const identity = {
  sha256,
  machine: bytes.readUInt16LE(pe + 4),
  timestamp: bytes.readUInt32LE(pe + 8),
  imageBase: bytes.readUInt32LE(pe + 24 + 28),
  entryRva: bytes.readUInt32LE(pe + 24 + 16),
};
assert.equal(identity.machine, 0x14c);
assert.equal(identity.imageBase, 0x400000);
assert.equal(identity.entryRva, 0x177eb0);

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const baseContext = {
  cachePresent: true,
  killerDriver: 8,
  cacheFlags: 0,
  height: 0,
  napalmDeadlineMs: 0,
  killerAngularVelocity: v(),
  killerUpY: 1,
  killerActorOriginY: 0,
  pedestrianY: 0,
  pedVelocity: v(),
  pedStartingVelocity: v(),
  localPedPosition: v(0, 0, -1),
  killerLocalVelocity: v(0, 0, -1),
};
// Same synthetic inputs as the C switch; the C program stores native fields.
const pedestrianInputs = [
  { height: 1.00000001 },
  { height: 1.0000001192092896 },
  { killerAngularVelocity: v(5.00000001) },
  { killerAngularVelocity: v(-5.000000476837158) },
  { killerAngularVelocity: v(0, 0, -5.00000001) },
  { killerAngularVelocity: v(0, 0, 5.000000476837158) },
  { killerUpY: Math.fround(0.1) - 1e-10 },
  { killerUpY: 0.09999999403953552 },
  { killerActorOriginY: Math.fround(0.05) + 1e-10 },
  { killerActorOriginY: 0.05000000447034836 },
  { pedVelocity: v(1, 1 - 1e-10) },
  { pedStartingVelocity: v(1, 1 - 1e-10) },
  { pedVelocity: v(1, 0.9999999403953552) },
  { localPedPosition: v(0.5 - 1e-10, 0, -1), killerLocalVelocity: v(2, 0, -1) },
  { localPedPosition: v(0.5, 0, -1), killerLocalVelocity: v(1 + 1e-10, 0, -1) },
  {
    localPedPosition: v(0.5, 0, -1),
    killerLocalVelocity: v(1.0000001192092896, 0, -1),
  },
  { localPedPosition: v(0.5, 0, -1), killerAngularVelocity: v(0, 600 + 1e-7) },
  {
    localPedPosition: v(0.5, 0, -1),
    killerAngularVelocity: v(0, 600.0000610351562),
  },
  {
    localPedPosition: v(0, 0, Number.MIN_VALUE),
    killerLocalVelocity: v(0, 0, 1),
  },
  { localPedPosition: v(0, 0, 2 ** -149), killerLocalVelocity: v(0, 0, 1) },
  { height: Number.MIN_VALUE, killerAngularVelocity: v(6) },
  { killerActorOriginY: 0.0625, pedestrianY: 0.012499998323619366 },
];
const softness = [
  0.05,
  0.1,
  0.125,
  0.13,
  0.2,
  0.25,
  0.3,
  0.35,
  0.4,
  0.46,
  0.5,
  0.6,
  0.7,
  0.8,
  0.999,
  1,
  1.4,
  1.5,
  1.8073922282301278,
  1.1832159566199232,
  0.9438798074485389,
  0.8082903768654761,
  0.7181848464596079,
  0.001,
  0.0001,
  1e-8,
  1e-12,
  2 ** -149,
  1e-100,
  1e100,
];
// Native state, now, start, live credits, timerMs, displayed bonus, rate,
// last rattle, original credit snapshot, completion bonus.
const payouts = [
  [1, 499, 0, 1000, 2999, 0, 15, 0, 1000, 120],
  [1, 500, 0, 0x7fffffff, 2999, 0, 15, 0, 0x7fffffff, 120],
  [1, 1032, 2000, -500, 2999, 0, 15, 0, -500, 120],
  [2, 1999, 0, 1120, 2999, 0, 15, 0, 1000, 120],
  [2, 2000, 0, 1120, 2999, 0, 15, 0, 1000, 120],
  [2, 1984, -16, 1120, 2999, 0, 15, 0, 1000, 120],
  [3, 15, 0, 1120, 2999, 0, 15, 0, 1000, 120],
  [3, 16, 0, 1120, 2999, 0, 15, 0, 1000, 120],
  [3, 31, 0, 1120, 2999, 0, 15, 0, 1000, 120],
  [3, -1, 0, 1120, 2999, 0, 15, 0, 1000, 120],
  [3, 16, 0, 1120, 2000, 0x7fffffff, 15, 0, 1000, 120],
  [3, 16, 0, 1120, 0, 30, 15, 0, 1000, 120],
  [4, 999, 0, 1120, 0, 30, 15, 0, 1000, 120],
  [4, 1000, 0, 1120, 0, 30, 15, 0, 1000, 120],
  [5, 15, 0, 0x7fffffff, 0, 30, 15, 0, 0x7fffffff, 120],
  [5, 16, 0, 0x7fffffff, 0, 30, 15, 0, 0x7fffffff, 120],
  [5, 16, 0, 1000, 0, 30, 0x10000000, 0, 1000, 120],
  [5, -1, 0, 0x7fffffff, 0, 1000000000, 15, 0, 0x7fffffff, 120],
  [5, 16, 0, 1120, 0, 0, 15, 0, 1000, 120],
  [6, 1999, 0, 1150, 0, 0, 15, 0, -500, 120],
  [6, 2000, 0, 1150, 0, 0, 15, 0, -500, 120],
  [6, 2000, 0, 1150, 0x7fffffff, 0, 0x7fffffff, 0, 0x7fffffff, 120],
];

const temporary = await mkdtemp(path.join(tmpdir(), "carma-native-awards-"));
const checkedRun = (command, args, timeout) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stderr ?? ""}`,
    );
  return result.stdout;
};
try {
  const executable = path.join(temporary, "native-awards");
  checkedRun(
    "gcc",
    [
      "-m32",
      "-O2",
      "-nostdlib",
      "-fno-pie",
      "-no-pie",
      "-fno-stack-protector",
      "-fno-builtin",
      "-fno-strict-aliasing",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      executable,
      path.join(project, "tools/native-race-awards-probe.c"),
    ],
    20000,
  );
  const output = checkedRun(executable, [original], 5000);
  const captures = [];
  const failures = [];
  let controlWord;
  for (const line of output.trim().split("\n")) {
    const [kind, ...tokens] = line.split(" ");
    const values = tokens.map(Number);
    assert.ok(values.every(Number.isFinite), `Invalid probe line: ${line}`);
    if (kind === "CW") {
      controlWord = values[0];
      continue;
    }
    let actual, native;
    if (kind === "WASTE") {
      const [index, base, amount] = values;
      actual = wastedCarCredits(base, softness[index]);
      native = amount;
    } else if (kind === "MAX") {
      actual = wastedCarCredits(0x7fffffff, 0.7);
      native = values[0];
    } else if (kind === "PAYOUT") {
      const [index, ...captured] = values;
      const [
        state,
        now,
        start,
        credits,
        timerMs,
        displayedBonus,
        rate,
        lastRattleMs,
        snapshotCredits,
        completionBonus,
      ] = payouts[index];
      const payout = new RacePayout({
        snapshotCredits,
        completionBonus,
        timeLeft: timerMs / 1000,
        rate,
        suppressPresentation: false,
      });
      // Isolated native-state fixture, without making test-only production APIs.
      Object.assign(payout, {
        state,
        credits,
        displayedBonus,
        stateStartMs: start >>> 0,
        lastRattleMs: lastRattleMs >>> 0,
      });
      payout.update(0, now >>> 0);
      actual = [
        payout.totalBonus,
        payout.credits,
        payout.state,
        payout.timerMs,
        payout.displayedBonus,
        payout.lastRattleMs | 0,
        payout.stateStartMs | 0,
        payout.finished ? 1 : 10000,
      ];
      native = captured;
    } else if (kind === "PED") {
      const [index, credits, fancyIndex, seconds] = values;
      const scored = new NativePedAwardCounter().score(
        2000,
        { points: [300, 200, 150], time: [15, 10, 5] },
        0,
        { ...baseContext, ...pedestrianInputs[index] },
      );
      actual = [scored.credits, scored.fancyIndex ?? -1, scored.seconds];
      native = [credits, fancyIndex, seconds];
    } else throw new Error(`Unexpected probe line: ${line}`);
    const capture = { kind, values, actual, native };
    captures.push(capture);
    if (JSON.stringify(actual) !== JSON.stringify(native))
      failures.push(capture);
  }
  assert.equal(
    controlWord,
    0x027f,
    "Actual initializer must select PC53/nearest rounding",
  );
  assert.equal(captures.filter((x) => x.kind === "WASTE").length, 90);
  assert.equal(captures.filter((x) => x.kind === "MAX").length, 1);
  assert.equal(captures.filter((x) => x.kind === "PED").length, 22);
  assert.equal(captures.filter((x) => x.kind === "PAYOUT").length, 22);
  const report = path.join(project, "artifacts/native-race-awards-probe.json");
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(
    report,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        identity,
        controlWord,
        scope:
          "Original arithmetic/classification with synthetic inputs; clock/HUD/output capture stubs only; no gameplay/contact-provider claim",
        captures,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  assert.equal(failures.length, 0, `Native consumer mismatches; see ${report}`);
  console.log(
    `Matched 91 native waste, 22 native pedestrian and 22 native payout captures; CW027f. Report: ${report}`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

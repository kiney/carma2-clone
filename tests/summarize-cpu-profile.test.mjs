import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadVerifiedSourceMaps,
  summarizeCpuProfile,
} from "../tools/summarize-cpu-profile.mjs";

test("CPU profile source attribution verifies bundle bytes and separates self from inclusive time", async () => {
  const root = await mkdtemp(join(tmpdir(), "carma-cpuprofile-")),
    mapDir = join(root, "mapped"),
    bundleDir = join(root, "production"),
    file = "assets/index-test.js",
    code = "(()=>{})();\n",
    map = {
      version: 3,
      file: "index-test.js",
      sources: ["src/main.ts"],
      names: ["sourceWork"],
      mappings: "AAAAA",
    };
  try {
    await Promise.all([
      mkdir(join(mapDir, "assets"), { recursive: true }),
      mkdir(join(bundleDir, "assets"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(mapDir, file), code),
      writeFile(join(bundleDir, file), code),
      writeFile(join(mapDir, `${file}.map`), JSON.stringify(map)),
    ]);
    const { maps, verification } = await loadVerifiedSourceMaps(
      mapDir,
      bundleDir,
    );
    assert.equal(verification.length, 1);
    const profile = {
      nodes: [
        {
          id: 1,
          callFrame: {
            functionName: "minifiedRoot",
            url: `http://localhost/${file}`,
            lineNumber: 0,
            columnNumber: 0,
          },
          children: [2],
        },
        {
          id: 2,
          callFrame: {
            functionName: "minifiedChild",
            url: `http://localhost/${file}`,
            lineNumber: 0,
            columnNumber: 0,
          },
        },
      ],
      startTime: 0,
      endTime: 6000,
      samples: [1, 2, 1, 2],
      timeDeltas: [1000, 2000, -2, 3000],
    };
    const report = summarizeCpuProfile(profile, maps);
    assert.equal(report.totalSampledMs, 6);
    assert.equal(report.rawTimeDeltaTotalMs, 5.998);
    assert.equal(report.negativeTimeDeltaCount, 1);
    assert.equal(report.negativeTimeDeltaTotalMs, -0.002);
    assert.equal(report.profileSpanMs, 6);
    assert.equal(report.profileSpanMinusRawDeltaMs, 0.002);
    assert.equal(report.mappedSampledMs, 6);
    assert.equal(report.mappedSampleFraction, 1);
    assert.equal(report.topSourceFunctionsBySelfTime[0].selfMs, 6);
    assert.equal(report.topSourceFunctionsByInclusiveTime[0].inclusiveMs, 11);
    assert.match(report.warnings[0], /clamped to zero/);
    assert.match(report.interpretation, /must not be added together/);
    assert.throws(
      () =>
        summarizeCpuProfile(
          { ...profile, timeDeltas: [-60_000_001, 2000, -2, 3000] },
          maps,
        ),
      /-60s sanity limit/,
    );

    await writeFile(join(bundleDir, file), "changed bytes");
    await assert.rejects(
      loadVerifiedSourceMaps(mapDir, bundleDir),
      /bundle bytes differ/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

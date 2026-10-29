import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BoundedCaptureRing } from "../src/bug-capture/ring.ts";
import { createCaptureBlob } from "../src/bug-capture/format.ts";
import { runCaptureCli } from "../tools/read-bug-capture.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);

async function fixture(directory) {
  const ring = new BoundedCaptureRing({
    maxBytes: 128 * 1024,
    reserveBytes: 0,
    maxRecords: 16,
  });
  const numeric = new Uint8Array(16);
  const numericView = new DataView(numeric.buffer);
  numericView.setFloat64(0, 1.25, true);
  numericView.setFloat64(8, -9, true);
  ring.push(100, 1, numeric);
  ring.push(120, 4, new TextEncoder().encode('{"event":"impact"}'));
  const path = join(directory, "sample.c2bug");
  await writeFile(
    path,
    Buffer.from(
      await createCaptureBlob(ring.snapshot(), {
        schemas: { 1: ["x", "y"] },
        label: "tiny",
      }).arrayBuffer(),
    ),
  );
  return path;
}

async function run(args) {
  let stdout = "";
  await runCaptureCli(args, {
    write: (chunk) => {
      stdout += chunk;
    },
  });
  return JSON.parse(stdout);
}

test("prints concise summary and streams decoded JSON records", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "c2bug-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = await fixture(dir);
  const summary = await run([input]);
  assert.equal(summary.recordCount, 2);
  assert.deepEqual(summary.kindCounts, { 1: 1, 4: 1 });
  assert.deepEqual(summary.timeRangeMs, { start: 100, end: 120 });
  assert.equal(summary.metadata.label, "tiny");
  assert.ok(summary.fileBytes > 20);

  const output = join(dir, "decoded.json");
  await run([input, "--json", output]);
  const decoded = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(decoded.records[0].payloadValues, [1.25, -9]);
  assert.deepEqual(decoded.records[1].payload, { event: "impact" });
  assert.deepEqual(decoded.metadata.schemas["1"], ["x", "y"]);
});

test("rejects bad arguments and truncated files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "c2bug-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(run([]), /Usage:/);
  await assert.rejects(run(["input.c2bug", "--bad"]), /Usage:/);
  const path = join(dir, "truncated.c2bug");
  await writeFile(path, "C2BUGCAP");
  await assert.rejects(run([path]), /Truncated capture header/);
});

test("exclusive JSON output preserves existing targets and blocks input overwrite", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "c2bug-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = await fixture(dir);
  const originalInput = await readFile(input);
  const existing = join(dir, "existing.json");
  await writeFile(existing, "keep this file");
  await assert.rejects(
    run([input, "--json", existing]),
    /EEXIST|already exists/,
  );
  assert.equal(await readFile(existing, "utf8"), "keep this file");
  await assert.rejects(
    run([input, "--json", input]),
    /EEXIST|cannot overwrite the input/,
  );
  assert.deepEqual(await readFile(input), originalInput);
});

test("preserves non-finite Float64 values as explicit strings in full JSON", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "c2bug-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ring = new BoundedCaptureRing({
    maxBytes: 128 * 1024,
    reserveBytes: 0,
    maxRecords: 16,
  });
  const payload = new Uint8Array(24);
  const values = new DataView(payload.buffer);
  values.setFloat64(0, Number.NaN, true);
  values.setFloat64(8, Number.POSITIVE_INFINITY, true);
  values.setFloat64(16, Number.NEGATIVE_INFINITY, true);
  ring.push(10, 1, payload);
  const input = join(dir, "nonfinite.c2bug");
  await writeFile(
    input,
    Buffer.from(await createCaptureBlob(ring.snapshot(), {}).arrayBuffer()),
  );
  const output = join(dir, "nonfinite.json");
  await run([input, "--json", output]);
  const decoded = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(decoded.records[0].payloadValues, [
    "NaN",
    "Infinity",
    "-Infinity",
  ]);
});

test("blocks output traversal into repository sources and original assets", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "c2bug-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = await fixture(dir);
  const sourceTarget = join(root, "src", "forbidden-bug-capture.json");
  await assert.rejects(
    run([input, "--json", sourceTarget]),
    /must be under \/tmp or the repository artifacts/,
  );
  const originalTarget = join(
    root,
    "carma2_orig",
    "forbidden-bug-capture.json",
  );
  // Original data is deliberately absent from CI. Missing parents are rejected
  // before scope validation; an installed directory must reach the scope guard.
  const originalDirectoryExists = await stat(join(root, "carma2_orig")).then(
    (entry) => entry.isDirectory(),
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  await assert.rejects(
    run([input, "--json", originalTarget]),
    originalDirectoryExists
      ? /must be under \/tmp or the repository artifacts/
      : /Output directory must already exist/,
  );
});

test("rejects missing output directories without creating them", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "c2bug-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = await fixture(dir);
  const missingDirectory = join(dir, "absent");
  await assert.rejects(
    run([input, "--json", join(missingDirectory, "decoded.json")]),
    /Output directory must already exist/,
  );
  await assert.rejects(stat(missingDirectory), { code: "ENOENT" });
});

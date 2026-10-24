import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyAct,
  inspectActEnvelope,
} from "../tools/audit-actor-compatibility.mjs";

const rootActor = () => {
  const text = Buffer.from("ROOT\0");
  const header = Buffer.alloc(16);
  header.writeUInt32BE(0x12, 0);
  header.writeUInt32BE(8, 4);
  header.writeUInt32BE(1, 8);
  header.writeUInt32BE(2, 12);
  const actor = Buffer.alloc(8 + 2 + text.length);
  actor.writeUInt32BE(0x23, 0);
  actor.writeUInt32BE(2 + text.length, 4);
  actor[8] = 1;
  actor[9] = 0;
  text.copy(actor, 10);
  const end = Buffer.alloc(8);
  return Buffer.concat([header, actor, end]);
};

test("ACT envelope scanner follows multiple zero-length END records before reporting suffix", () => {
  const bytes = Buffer.concat([rootActor(), Buffer.from("\n")]);
  const found = inspectActEnvelope(bytes);
  assert.equal(found.endOffset, bytes.length - 1);
  assert.equal(found.endCount, 1);
  assert.equal(found.trailingBytes, 1);
  assert.deepEqual(
    classifyAct("fixture.ACT", bytes).classification,
    "complete-act-with-trailing-whitespace",
  );
});

test("multiple root records remain valid and unsupported chunks are not labeled complete", () => {
  const one = rootActor();
  const twoRoots = Buffer.concat([one, one.subarray(16)]);
  const result = classifyAct("multi-root.ACT", twoRoots);
  assert.equal(result.classification, "complete-act");
  assert.equal(result.parseResult.roots, 2);
  const unsupported = Buffer.concat([
    one.subarray(0, one.length - 8),
    Buffer.from([0, 0, 0, 0x7f, 0, 0, 0, 0]),
    one.subarray(-8),
  ]);
  assert.equal(
    classifyAct("unsupported.ACT", unsupported).classification,
    "act-with-unverified-chunk-tags",
  );
});

test("ACT envelope scanner rejects a chunk extending beyond the file", () => {
  const bytes = rootActor();
  bytes.writeUInt32BE(100, 20);
  const found = inspectActEnvelope(bytes);
  assert.equal(found.endOffset, null);
  assert.equal(found.malformedAt, 16);
});

test("actual PROG and Advanced DIGGA classifications are stable when installed assets exist", async (t) => {
  const installRoot = process.env.CARMA2_ROOT ?? "carma2_orig";
  const cases = [
    ["data/ACTORS/PROG.ACT", "text-placeholder-without-brender-header"],
    ["adv_data/ACTORS/PROG.ACT", "text-placeholder-without-brender-header"],
    ["adv_data/CARS/DIGGA/DIGGA.ACT", "complete-act-with-trailing-whitespace"],
  ];
  for (const [path, expected] of cases) {
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(`${installRoot}/${path}`));
    } catch {
      t.skip(`local original asset missing: ${installRoot}/${path}`);
      return;
    }
    const result = classifyAct(path, bytes);
    assert.equal(result.classification, expected, path);
    if (path.endsWith("PROG.ACT")) {
      assert.equal(result.bytes, 13);
      assert.equal(result.printableText, "i am fiddling");
    } else {
      assert.equal(result.endOffset, 2656);
      assert.equal(result.trailingHexPrefix, "0a");
      assert.equal(result.parsedRootsAfterAuditTrim, 1);
    }
  }
});

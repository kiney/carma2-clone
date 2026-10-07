import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAssetStore, parseTwt } from "../server/assets.mjs";

function makeTwt(entries) {
  const tableLength = 8 + entries.length * 56;
  const payloadLength = entries.reduce(
    (n, entry) => n + ((entry.data.length + 3) & ~3),
    0,
  );
  const result = Buffer.alloc(tableLength + payloadLength);
  result.writeUInt32LE(result.length, 0);
  result.writeUInt32LE(entries.length, 4);
  let offset = tableLength;
  entries.forEach(({ name, data }, index) => {
    const at = 8 + index * 56;
    result.writeUInt32LE(data.length, at);
    result.write(name, at + 4, 52, "utf8");
    data.copy(result, offset);
    offset += (data.length + 3) & ~3;
  });
  return result;
}

test("parseTwt reports padded payload offsets and rejects malformed bounds", () => {
  const archive = makeTwt([
    { name: "one.dat", data: Buffer.from("abc") },
    { name: "two.dat", data: Buffer.from("WXYZ") },
  ]);
  const parsed = parseTwt(archive);
  assert.deepEqual(parsed.entries, [
    { name: "one.dat", size: 3, offset: 120 },
    { name: "two.dat", size: 4, offset: 124 },
  ]);
  assert.throws(
    () => parseTwt(archive.subarray(0, archive.length - 1)),
    /total length/,
  );
  const badCount = Buffer.from(archive);
  badCount.writeUInt32LE(0xffffffff, 4);
  assert.throws(() => parseTwt(badCount), /table/);
  const badName = makeTwt([{ name: "../escape", data: Buffer.from("x") }]);
  assert.throws(() => parseTwt(badName), /Unsafe/);
  const badSize = Buffer.from(archive);
  badSize.writeUInt32LE(0xffffffff, 8);
  assert.throws(() => parseTwt(badSize), /bounds/);
});

test("asset store indexes loose and virtual archive assets, prioritizes loose files, and confines reads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "carma-assets-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "carma-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "data"));
  await writeFile(
    path.join(root, "data.twt"),
    makeTwt([
      { name: "Config.txt", data: Buffer.from("from archive") },
      { name: "inside.bin", data: Buffer.from([1, 2, 3]) },
    ]),
  );
  await writeFile(path.join(root, "data", "CONFIG.TXT"), "loose wins");
  await writeFile(path.join(root, "data", "loose.bin"), "loose");
  await writeFile(path.join(outside, "secret"), "secret");
  await symlink(outside, path.join(root, "linked"));

  const store = await createAssetStore(root);
  assert.equal((await store.read("DATA/config.txt")).toString(), "loose wins");
  assert.deepEqual(await store.read("data/inside.bin"), Buffer.from([1, 2, 3]));
  assert.equal((await store.read("data/loose.bin")).toString(), "loose");
  assert.equal(await store.read("../secret"), null);
  assert.equal(await store.read("/etc/passwd"), null);
  assert.equal(await store.read("linked/secret"), null);
  assert.equal(
    store.manifest.some(
      (item) => item.path.toLowerCase() === "data/config.txt",
    ),
    true,
  );
  assert.equal(
    store.manifest.some((item) => item.path.toLowerCase() === "linked/secret"),
    false,
  );
});

test("real sample archives parse and virtual loose-tree assets are indexed when present", async (t) => {
  const root = path.resolve("carma2_orig");
  try {
    const store = await createAssetStore(root);
    assert.ok(store.manifest.length > 0);
    for (const asset of ["data/General.txt", "adv_data/General.txt"]) {
      const found = store.manifest.find(
        (item) => item.path.toLowerCase() === asset.toLowerCase(),
      );
      if (found) assert.equal((await store.read(asset)).length, found.size);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("carma2_orig sample assets are absent");
      return;
    }
    throw error;
  }
});

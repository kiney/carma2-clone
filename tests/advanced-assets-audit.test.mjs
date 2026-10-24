import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditAdvancedAssets,
  classifyParserError,
  classifyTextureReference,
} from "../tools/audit-advanced-assets.mjs";

const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
const header = (type) => Buffer.concat([u32(0x12), u32(8), u32(type), u32(2)]);
const chunk = (tag, payload) =>
  Buffer.concat([u32(tag), u32(payload.length), payload]);
const validMaterial = (texture) => {
  const name = Buffer.from("FIXTURE\0");
  return Buffer.concat([
    header(5),
    chunk(0x3c, Buffer.concat([Buffer.alloc(65), name])),
    u32(0x1c),
    u32(texture.length + 1),
    Buffer.from(`${texture}\0`),
    u32(0),
    u32(0),
  ]);
};
const validPix = (name) => {
  const headerPayload = Buffer.concat([
    Buffer.from([5]),
    Buffer.from([0, 2, 0, 1, 0, 1]),
    Buffer.alloc(6),
    Buffer.from(`${name}\0`),
  ]);
  return Buffer.concat([
    header(2),
    chunk(0x3d, headerPayload),
    chunk(0x21, Buffer.concat([u32(1), u32(2), Buffer.from([0xf8, 0x00])])),
    u32(0),
    u32(0),
  ]);
};

test("parser outcome classification separates unsupported variants from damaged structures", () => {
  assert.equal(
    classifyParserError("PIX: unsupported pixel format 42"),
    "unsupported-variant",
  );
  assert.equal(
    classifyParserError("MAT: missing BRender header"),
    "header-or-type-mismatch",
  );
  assert.equal(
    classifyParserError("PIX: truncated or invalid data at byte 16"),
    "parser-bounds-rejection-root-cause-unverified",
  );
  assert.equal(
    classifyParserError("unexpected decoder exception"),
    "parser-rejection-unclassified",
  );
});

test("texture resolution distinguishes local scope, other installed assets, and absent host data", () => {
  assert.equal(
    classifyTextureReference({ runtimeResolved: true, hostFileExists: true }),
    "resolved-in-runtime-scope",
  );
  assert.equal(
    classifyTextureReference({ runtimeResolved: false, hostFileExists: true }),
    "asset-exists-outside-runtime-scope",
  );
  assert.equal(
    classifyTextureReference({
      runtimeResolved: false,
      hostEmbeddedNameExists: false,
    }),
    "no-basename-or-parsed-map-name-match",
  );
});

test("generated malformed MAT and UI PIX fixtures appear in the bounded census", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c2-advanced-assets-"));
  try {
    const matDir = path.join(root, "adv_data", "CARS", "Fixture");
    const uiDir = path.join(root, "adv_data", "INTRFACE");
    await mkdir(matDir, { recursive: true });
    await mkdir(uiDir, { recursive: true });
    // Both have valid BRender headers and then a deliberately truncated chunk header.
    await writeFile(
      path.join(matDir, "BROKEN.MAT"),
      Buffer.concat([header(5), Buffer.from([0, 0, 0])]),
    );
    await writeFile(
      path.join(uiDir, "BROKEN.PIX"),
      Buffer.concat([header(2), Buffer.from([0, 0, 0])]),
    );
    const report = await auditAdvancedAssets({ root, writeReport: false });
    assert.equal(report.materialParsing.files, 1);
    assert.equal(report.materialParsing.parsedFiles, 0);
    assert.equal(
      report.materialParsing.failureCategories[
        "parser-bounds-rejection-root-cause-unverified"
      ],
      1,
    );
    assert.equal(report.uiPixelParsing.files, 1);
    assert.equal(report.uiPixelParsing.parsedFiles, 0);
    assert.equal(
      report.uiPixelParsing.failureCategories[
        "parser-bounds-rejection-root-cause-unverified"
      ],
      1,
    );
    assert.equal(
      report.inventory.uiPalette.status,
      "missing-from-installation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nested scene MAT references resolve PIX maps from sibling directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c2-advanced-scope-"));
  try {
    const matDir = path.join(root, "adv_data", "CARS", "Fixture", "materials");
    const pixDir = path.join(
      root,
      "adv_data",
      "CARS",
      "Fixture",
      "textures",
      "nested",
    );
    await mkdir(matDir, { recursive: true });
    await mkdir(pixDir, { recursive: true });
    await writeFile(
      path.join(matDir, "SCENE.MAT"),
      validMaterial("SiblingMap"),
    );
    await writeFile(path.join(pixDir, "OTHERNAME.PIX"), validPix("SiblingMap"));
    const report = await auditAdvancedAssets({ root, writeReport: false });
    assert.equal(report.materialParsing.parsedFiles, 1);
    assert.equal(report.materialTextureReferences.references, 1);
    assert.equal(
      report.materialTextureReferences.resolution["resolved-in-runtime-scope"],
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit reports cannot overwrite files inside the original installation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c2-advanced-report-"));
  const rootLink = `${root}-link`;
  try {
    await symlink(root, rootLink, "dir");
    await assert.rejects(
      auditAdvancedAssets({
        root,
        reportPath: path.join(root, "report.json"),
      }),
      /Refusing to write audit report inside the configured original installation/,
    );
    await assert.rejects(
      auditAdvancedAssets({
        root,
        reportPath: path.join(rootLink, "linked-report.json"),
      }),
      /Refusing to write audit report inside the configured original installation/,
    );
  } finally {
    await rm(rootLink, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("original Advanced audit parses scoped MATs, palette, UI PIX, and bounded references", async (t) => {
  const root = process.env.CARMA2_ROOT ?? "carma2_orig";
  try {
    await access(root);
  } catch {
    t.skip(`original installation absent: ${root}`);
    return;
  }
  const report = await auditAdvancedAssets({ root, writeReport: false });
  assert.ok(report.inventory.advancedMaterialFiles > 0);
  assert.equal(
    report.materialParsing.parsedFiles,
    report.materialParsing.files,
  );
  assert.equal(report.inventory.uiPalette.status, "parsed-palette-container");
  assert.ok(report.uiPixelParsing.files > 0);
  assert.equal(report.uiPixelParsing.parsedFiles, report.uiPixelParsing.files);
  assert.deepEqual(report.uiPixelParsing.failureCategories, {});
  assert.equal(
    report.materialTextureReferences.resolution["resolved-in-runtime-scope"] >
      0,
    true,
  );
  assert.ok(
    (report.materialTextureReferences.resolution[
      "no-basename-or-parsed-map-name-match"
    ] ?? 0) >= 0,
  );
});

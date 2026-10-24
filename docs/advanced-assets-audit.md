# Advanced MAT and UI pixelmap compatibility audit

## Findings

The read-only census indexed 16,312 visible assets from the configured installation. All **1,029 Advanced MAT files** parsed into 17,650 material records; there were no MAT parser rejections. The runtime's shared stock `data/Reg/PALETTES/DRRENDER.PAL` container parsed as one PIX palette map and was supplied to indexed Advanced PIX/P16 files, avoiding a false palette-missing result.

The selected Advanced UI inventory contains **321 PIX/P16 files** under `INTRFACE`, `32X20X8`, and `64x48x8`. All 321 now parse into **2,392 maps**. The 96 formerly rejected files are 8,238-byte standalone 64x64 format-5 RGB565 fragments in 14 `INTRFACE/CarImage/*CI/PIX16` directories. They omit the standard `0x12` file header. In representative `69mach1a.PIX`, the `0x3d` header tag starts at byte 0, its fields start at byte 8, six reserved bytes occupy offsets 15–20, and its empty NUL-terminated name is at byte 21. A sequential reader reaches the `0x21` data tag at byte 22. Its declared data length is 8,192, matching 4,096 pixels of two bytes; payload begins at byte 38 and ends at byte 8,229, followed by the exact eight-byte zero END record at bytes 8,230–8,237. The `0x3d` length field (21) is stale for this header shape and cannot be used to seek between records. The old reader treated it as a standard chunk boundary, then interpreted pixel data as chunk headers. A public BRender PIX reader independently handles missing file headers and sequential `0x3d`/`0x21` records, and identifies format 5 as C2 16-bit RGB565. A Carmageddon II CarEd tutorial says its “Create Menu Images” command emits six individual PIX files under `INTRFACE/CarImage/<carname>CI/PIX16` for use by the game's car-selection screen. This confirms that these assets are intended standalone UI fragments. The equivalent 8-bit `69mach1A.PIX` also parses as a standard BRender-header file.

The texture-reference pass covered **17,327 MAT texture references** across **1,029 Advanced MAT files**. It resolved 17,238 within the current browser loader's scope: local embedded PIX/P16 map names, the shared stock libraries loaded by `Assets.common()`, or a valid nested local TIFF fallback. Another 38 names match an installed basename or parsed embedded map outside that scope. The remaining 51 have no matching host basename or parsed PIX/P16 map name in the audited libraries. That last result does not prove that a texture is absent: an unparsed container may still carry the name, and the audit deliberately does not promote an unresolved label to a missing-file claim. Examples include `69MACH1.MAT` labels `64chrome3`, `69M1horse`, `64MUdoormid`, and `64MUfrfenmid`; outside-scope examples include the `37FORD/37BKWIN4.mat` `engside` family and shared `adv_data/MATERIAL` materials. All 2,173 nested TIFF files that the scoped material pass needed to check parsed successfully.

## Runtime scope and classification

The audit uses `createAssetStore` to include loose assets and fully indexed TWT entries. Reads and parser calls run serially. It follows the browser material loader's name lookup: the `key()` extension rules, embedded names in P16 containers, all maps and TIFFs below the owning `data|adv_data/{RACES|CARS}/<scene>` root (including sibling subdirectories), shared stock PIX/P16 libraries loaded by `Assets.common()`, and nested TIFFs loaded by `Assets.scene()` only when a PIX/P16 map has not claimed the key. For other MAT path shapes, the containing directory is used as the local scope. Advanced files elsewhere in the installation are evidence that a name exists on disk, not proof that the current browser scene will load it.

Parser errors are categorized from their actual bounded error text. Explicit unsupported formats remain separate from structural failures; ambiguous bounds errors retain an unresolved root cause. The PIX reader adds only the identified standalone C2 RGB565 form; MAT parsing, ordinary PIX chunk parsing, texture lookup, and original assets remain unchanged. Representative failure examples are capped at 20; per-file parser details and payload bytes are not written to the report.

## Reproduction and follow-up

Run `node --import tsx tools/audit-advanced-assets.mjs` for the default ignored report at `artifacts/advanced-assets-audit.json`. Set `CARMA2_ROOT` to use another local installation. Pass `--stdout` to print the report without writing it. Report destinations inside the configured installation are rejected after resolving existing parent paths, including symlinked directories. Run `node --import tsx tests/advanced-assets-audit.test.mjs` for generated corrupt MAT/PIX fixtures, nested sibling-directory resolution, output-path protection, and an optional original-installation census that skips when assets are absent. The original census completed in about four seconds locally, including serial reads and parse checks across the indexed corpus.

The 96 legacy fragments now use a narrow format-5 reader that requires the exact header shape, six zero reserved bytes, matching row/data dimensions, and a terminal END record with no trailing bytes; ordinary chunk parsing remains strict. The car-selection preview also falls back to six individual PIX16 fragments when packed PIXIES files are absent, then to individual PIX8 fragments with the game palette. Resolve the 51 unmatched labels by tracing their owning ACT/MAT consumer and checking any format containers the current scene loader does not parse; retain the distinction between “not found in audited scope” and “missing from the installation.”

## Follow-up scope trace (2026-10-24)

The 38 outside-scope occurrences represent 15 distinct labels: 30 occurrences
have candidates in Advanced `PIXELMAP`, while eight refer to other car/race
packages. Their presence alone does not authorize cross-package name lookup.
An additional read-only pass parsed all 374 Advanced P08 containers without
errors; none supplies the 21 distinct unmatched labels.

Of the 51 unmatched occurrences, 40 concern ten destroyed Carrier aircraft
textures across four tracks. Their owning DAT models reference the material
names, so they are not merely unused MAT-directory records. Five car-label
occurrences lack local DAT/ACT references; six REG labels still need procedural
consumer tracing. These categories describe audited consumers, not proof that
every unresolved texture is missing from the installation.

Installed HW `LoadInRegistees` at `0x486cb0` builds the application `REG` path;
`0x486d00–0x486d24` loads its `REG/PIXELMAP`. `RealLoadPixelmap` at `0x48eaa0`
searches graphics-root `PIXELMAP` and then configured pedestrian-root
`PIXELMAP`, proving an on-demand path rather than a blanket startup library.
The [rec2 loader](https://github.com/madebr/rec2/blob/master/src/carma2/common/loading.c)
provides the symbol map; installed addresses differ. DAT-06 remains open until
the relevant caller/registration order, PIX16/TIFF precedence and Stock/Advanced
namespace ownership are established. No runtime lookup was broadened on the
strength of matching basenames.

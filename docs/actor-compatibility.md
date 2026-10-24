# ACT compatibility anomaly audit

## Findings

The two `ACTORS/PROG.ACT` files in the observed Stock and Advanced installation are both 13 bytes, have the same SHA-256 (`7b443367eb88b4127d2d64446cc9ca297ca8b9304c1c1297f4d09f18ae555502`), and contain exactly the printable ASCII text `i am fiddling`. Neither contains a BRender header or chunk stream. They are text placeholders with ACT filenames, not truncated BRender actor files. Both installed executables contain one ASCII `PROG.ACT` literal in a nearby resource-name string table: HW offset 2,445,096 (SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`) and SW offset 2,421,992 (SHA-256 `15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d`). The surrounding names include `ACTORS`, `MODELS`, `MATERIAL`, `PIXELMAP`, and `GENERAL.TXT`; this establishes a binary reference string but does not identify the call site or prove that the placeholder is successfully parsed. The local installation has no rec2 checkout. Do not infer that the files are unused or add parser leniency from this evidence.

Advanced `CARS/DIGGA/DIGGA.ACT` is 2,657 bytes and has a valid BRender header. Its bounded top-level chunk stream ends with the zero-length ACT `END` record at bytes 2648–2655. The sole following byte, offset 2656, is line feed (`0a`). The existing strict parser rejects that extra byte as truncated/invalid input; trimming only the post-END line feed in this read-only audit allows `parseAct` to parse one root. This is trailing whitespace after a complete hierarchy, not truncation. The original asset and production parser remain unchanged.

## Consumer context and confidence

Production ACT loading goes through `Content` and the shared `parseAct` reader (`src/content.ts`, `src/formats.ts`). The DIGGA file is the selected car's actor hierarchy, so its failed parse prevents that Advanced car scene from loading. No source/config text reference to `PROG.ACT` was found. The executable literals show an original binary reference, but without call-site disassembly and a local rec2 checkout its loading context and purpose remain unresolved. The placeholder classification is high confidence from exact bytes.

## Reproduction

Run `node --import tsx tools/audit-actor-compatibility.mjs` to print paths, byte counts, hashes, parser outcomes, bounded END offsets, classifications, and direct ASCII/UTF-16 string search results in HW/SW executables. It reads from `CARMA2_ROOT` when set and otherwise `./carma2_orig`; missing originals are reported as skipped. Run `node --import tsx --test tests/actor-compatibility.test.mjs` for synthetic bounds checks and optional original-installation assertions. The scanner follows multiple ACT root END records and labels ACT data complete only when the production parser accepts it and all chunk tags are in the audited known set. The audit never writes to the installation, changes parser behavior, or commits source-derived asset bytes.

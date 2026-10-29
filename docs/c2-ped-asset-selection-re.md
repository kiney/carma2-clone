# Native pedestrian MODEL selection and resource ownership

## Evidence and corrected interpretation

The installed HW/SW executable hashes and PE metadata were rechecked against
[the binary inventory](c2-physics-re.md). `madebr/rec2` supplied the function map;
its MPL-2.0 `COPYING` was inspected. The browser implementation is independent;
no reference implementation code or original binary/asset contents are copied.

Verified in the installed HW executable:

- `405c25–405c4a` creates every FORM render bone with
  `BrActorAllocate(BR_ACTOR_MODEL, NULL)` and sets faces rendering. It does not
  load a personality ACT or copy an ACT transform or material.
- The allocator at `51d7e0` creates an identity matrix; its resource allocation
  reaches `526c00–526c23`, which zeroes the allocated memory. The fresh actor's
  MODEL, material and parent pointers therefore start NULL.
- `406d3c–406d68` passes the personality MODEL token directly to `BrModelFind`
  and rejects a missing result. `.ACT` in a MODEL identifier is part of its
  name, not an instruction to replace it with `.DAT`.

rec2 `BonerReadPersonalityModels` maps directory resource registration before
these lookups; `ReadPersonality` maps remapped MODEL vertices, all authored
variants and per-bone child/parent attachment vectors. `SetCharacterBonePositions`
then supplies the native root and bone matrices. The authored package ACT graph
is not the animated skeleton. In particular, CitySwat's authored default ACT tilt
must not survive as a flat FORM bone basis.

This corrects the earlier browser assumption that the first alphabetically
selected package ACT supplies root material inheritance. The NULL-face discussion
in [dead MODEL notes](c2-ped-dead-model-re.md) still applies to raw MODEL pointers,
but its reference to the prior loader is superseded here: new FORM actors inherit
the BRender render context/default, not a material borrowed from an unrelated
package ACT node. The current standalone template supplies the existing BRender
default material. No per-personality material-name alias is introduced.

## Implemented resource contract

`Assets.scene(..., {resourceOnly: true})` registers the directory's original
MODEL/MAT/PIX resources without requiring or traversing an ACT. Existing scene
loading remains unchanged for other callers. `loadNativePedAssets` resolves each
personality MODEL through exact native registry lookup, retains explicit NULLs,
keeps attachment vectors, remaps a private vertex buffer and creates flat identity
bone actors. Head variants remain distinct exact MODEL identities.

Render materials use the MODEL's captured native MAT pointer bindings. A missing
named MAT pointer that became NULL at MODEL load inherits the same default as a
raw slot zero; a later normalized material-name map cannot rebind it. Raw face
slots remain intact for dead-model preparation.

Personality scenes share a root-specific native pedestrian storage, matching
`gPedStorage`; exact MODELs borrowed from another loaded personality therefore
remain alive while any scene retains that storage. A template's idempotent
`dispose()` releases its remapped geometry and scene ownership. Instances borrow template materials/textures/geometries and must be
released first. Failed construction also releases its scene and any partial
remapped geometry. BON/SKL parsing is cached by Assets identity and resolved
root/path; rejected reads are retryable. Source motion objects and bone tables
are frozen and borrowed read-only, including their matrix buffers.

## Installed data limitations and validation

A serial loader inventory initializes 138 of 160 TXT records in each installed
data tree. The remaining records are reported as structured
`NativePedAssetError.diagnostics`, with source path and exact missing MODEL,
bone and variant index where applicable. They are not repaired with guessed
aliases:

- Twelve personality directories with no ACT also contain no DAT resources;
  removing the false ACT prerequisite exposes the actual missing MODELs.
- Eight other records declare missing MODEL identities. CHEF1's root
  `FATBCH.ACT` and first head `HECH` resolve correctly, while its declared
  `HECHB.DAT`/`HECHC.DAT` do not exist in that package. Its differently named
  `HEH3B.DAT`/`HEH3C.DAT` are not replacements. CHEF2 similarly lacks its
  declared `CHECBA.DAT`. Native global lookup may resolve an exact identity
  already registered by another package; this loader does not invent a load
  order or preload unrelated packages to conceal an absent dependency.
- GOATY/SHEEPY begin with the undeclared FORM name `Ped` and include draft
  placeholders; the absent FORM remains a source-resource diagnostic.
- The valid `Copy of deer` and `Copy of penguin` backup personality filenames
  now pass safe path validation. They still use their declared original MODELs.

Seven dedicated asset tests cover Stock/Advanced CitySwat, Bandsman, deer and
penguin, original parent attachments, distinct head variants, no authored ACT
basis, exact CHEF1 missing-model diagnostics, path safety, independent geometry
ownership, idempotent release and shared BON/SKL parsing. Related dead-model,
instance and dog-reaction suites pass. Runtime presentation/browser validation
belongs to the integrating population change; this loader inventory alone does
not establish complete animation or gameplay fidelity.

## Classification of the historical 24 loader failures

Rechecked serially on 2026-10-29, with a new standalone Assets instance per
data tree, no world/common resources preloaded, and each successful template
disposed before the next record. Stock and Advanced produce the same 138 loaded
TXT records and 22 remaining failures, with identical relative paths, MODEL
identifiers, bone names and variant indices. This classifies the former 24
failures as 12 absent package libraries + eight missing-identity records + two
draft FORM records + two fixed spaced backup filenames. These are TXT inventory
counts, not a claim that every native race reference or all 136 earlier browser
fixtures have complete animation, dead-model, gameplay or dependency support.

The native registry is global within an Assets context. A world/common MODEL or
another still-loaded personality can supply an exact identity absent from a
package, so an already-loaded world context may resolve more records than this
clean inventory. Such a result needs its actual registration/load-order evidence;
this table does not label those names globally absent from the installation.
Neither context justifies an identifier alias.

The following paths are relative to `<data root>/PEDS/PEEPS/`; they apply to
both `data` and `adv_data`.

| Absent package resource library (12) | Confirmed prerequisite                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `ARMY1/Army1.txt`                    | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `BISMAN/bisman.TXT`                  | No package ACT or DAT; 12 exact MODEL declarations unresolved in the clean registry. |
| `CLEAN01/CLEAN01.TXT`                | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `CLEAN02/Clean02.txt`                | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `COP2/COP2.TXT`                      | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `DOCTOR3/DOCTOR3.TXT`                | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `DOCTOR4/DOCTOR4.TXT`                | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `FLAG/flag.TXT`                      | No package ACT or DAT; 12 exact MODEL declarations unresolved in the clean registry. |
| `Holidayhb/HOLIDAYHB.TXT`            | No package ACT or DAT; 12 exact MODEL declarations unresolved in the clean registry. |
| `SMART4/SMART4.TXT`                  | No package ACT or DAT; 10 exact MODEL declarations unresolved in the clean registry. |
| `Steward1/Steward1.TXT`              | No package ACT or DAT; 12 exact MODEL declarations unresolved in the clean registry. |
| `Steward2/Steward2.TXT`              | No package ACT or DAT; 12 exact MODEL declarations unresolved in the clean registry. |

| Missing MODEL identity record (8) | Exact MODEL → FORM bone / zero-based variant                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captain/CAPTAIN.TXT`             | `HECA.DAT` → `Bip01 Head` / 0; `HECAB.DAT` → `Bip01 Head` / 1; `HECAC.DAT` → `Bip01 Head` / 2                                                                                                                                                                                                                                                                                                                                 |
| `chef1/CHEF1.TXT`                 | `HECHB.DAT` → `Bip01 Head` / 1; `HECHC.DAT` → `Bip01 Head` / 2                                                                                                                                                                                                                                                                                                                                                                |
| `Chef2/CHEF2.TXT`                 | `CHECBA.DAT` → `Bip01 Head` / 1                                                                                                                                                                                                                                                                                                                                                                                               |
| `Director/DIRECTORPD.TXT`         | `MANBT3.ACT` → `Bip01 Spine` / 0                                                                                                                                                                                                                                                                                                                                                                                              |
| `Holiday10/Holiday10.TXT`         | `HEHJA.DAT` → `Bip01 Head` / 1; `HEHJB.DAT` → `Bip01 Head` / 2                                                                                                                                                                                                                                                                                                                                                                |
| `Holiday7/HOLIDAY7.TXT`           | `FEMFHG.ACT` → `Bip01 Spine` / 0; `CHEHG.DAT` → `Bip01 Head` / 0; `LTOPLHG.DAT` → `Bip01 L Leg` / 0; `LBOTLHG.DAT` → `Bip01 L Leg1` / 0; `RTOPLHG.DAT` → `Bip01 R Leg` / 0; `RBOTLHG.DAT` → `Bip01 R Leg1` / 0; `LTOPAHG.DAT` → `Bip01 L Arm1` / 0; `LBOTAHG.DAT` → `Bip01 L Arm2` / 0; `RTOPAHG.DAT` → `Bip01 R Arm1` / 0; `RBOTAHG.DAT` → `Bip01 R Arm2` / 0                                                                |
| `Lumber2/FATBLOKE2.TXT`           | `FATBH3.ACT` → `Bip01 Spine` / 0; `HEH3.DAT` → `Bip01 Head` / 0; `HEH3B.DAT` → `Bip01 Head` / 1; `HEH3C.DAT` → `Bip01 Head` / 2; `LTOPLH3.DAT` → `Bip01 L Leg` / 0; `LBOTLH3.DAT` → `Bip01 L Leg1` / 0; `RTOPLH3.DAT` → `Bip01 R Leg` / 0; `RBOTLH3.DAT` → `Bip01 R Leg1` / 0; `LTOPAH3.DAT` → `Bip01 L Arm1` / 0; `LBOTAH3.DAT` → `Bip01 L Arm2` / 0; `RTOPAH3.DAT` → `Bip01 R Arm1` / 0; `RBOTAH3.DAT` → `Bip01 R Arm2` / 0 |
| `Pilot2/PILOTPB.TXT`              | `MANBT3.ACT` → `Bip01 Spine` / 0                                                                                                                                                                                                                                                                                                                                                                                              |

| Draft source (2)    | Confirmed prerequisite                                           |
| ------------------- | ---------------------------------------------------------------- |
| `GOATY/GOATY.TXT`   | Declares FORM `Ped`; `<data root>/PEDS/FORMS/Ped.TXT` is absent. |
| `SHEEPY/SHEEPY.TXT` | Declares FORM `Ped`; `<data root>/PEDS/FORMS/Ped.TXT` is absent. |

| Fixed loader path restriction (2) | Verified result                                                             |
| --------------------------------- | --------------------------------------------------------------------------- |
| `deer/Copy of deer.txt`           | Declared MODELs load with the original space-containing TXT stem; no alias. |
| `penguin/Copy of penguin.txt`     | Declared MODELs load with the original space-containing TXT stem; no alias. |

The backup TXT successes establish source path/MODEL loading only. Their filenames
do not define normal native package names, and this inventory does not test the
name-derived blood texture/dead-model prerequisites for those backup names.
The full generated loader diagnostics remain outside source control in
`/tmp/native-ped-loader-classification.json`; no proprietary geometry, texture
or executable content is included in this classification.

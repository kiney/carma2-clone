# Native track ACT loading pass

## Evidence and scope

`src/native-track-actor-load.ts` independently implements installed HW `FindNonCarsCB(0x40d1f0..40d52a)`, the name/target portion of `SetSmashableModel(0x4f5a50..5c47)`, and `AssertNonCars` inlined in `ExtractColumns(0x40ce83..cef9)`. Rec2 `common/brucetrk.c`, `loading.c` and `powerups.c` provide symbol/structure maps; code is not copied. Original HW SHA256: `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32/i386, image base `0x400000`, entry point `0x577eb0`. The detailed installed branch audit is in [c2-native-track-models-re.md](c2-native-track-models-re.md).

A private 32-bit mapper executes the installed instructions after CRT/FPU initialization (`0x5798e0`) and replaces only diagnostic printing. Sixteen matrix/registration/return captures comprise four original Stock/Advanced canopy ACTs and twelve generated numeric/invalid-ID cases. The released module matches every captured matrix scalar, return value, registration ID and type_data result. A separate native capture verifies the last matching MODEL name becomes `ABCDE|01.ACT`. Original files are read-only; all proprietary probe inputs/outputs remain under `/tmp`.

## Public host contract

The module takes actual mutable `NativeOrderedActor` nodes from `native-actor-order.ts`. Native local MODEL/MAT bindings and topology remain authoritative. It never resolves an inherited MODEL, creates a render substitute, allocates a physical noncar or enrolls PHIL.

`NativeTrackActorLoadContext` contains the original noncar allocation (`rawSlots` with explicit NULL entries), mutable `count`, `trackCount`, `capacity`, ordered smash specs with actual loaded MODEL object identities, unsigned source target WORD at spec `+0x2ac`, explicit race/net state, pixel bit depth and host callbacks. Supply the whole allocation, including original extra capacity of 250; compaction retains the allocation and trailing contents.

- `setNativeTrackSmashableModel(actor, context)` applies each actual MODEL-pointer match in spec order. The MODEL identifier provider must distinguish native NULL from an existing string. Native names preserve their last four characters, overwrite the old suffix with eight spaces, then put `|%02d` at byte 5 using the **zero-based** spec index. The minimum width is two; index 100 is three digits. Short source names preserve fewer original prefix characters. Last matching spec wins. Race/net eligibility invokes the actual `AddSmashableRaceTarget(model, actor, -1)` outlet after that match's rename. Managed strings represent the resulting name; original BRender identifier allocation addresses are not synthesized.
- `findNativeTrackNonCars(actor, context)` includes the supplied actor. `findNativeTrackNonCarChildren(parent, context)` begins at its native child list, matching the original enumeration seam. Both return 0/1. SetSmashableModel runs first. Any `&` actor needs its own local MODEL. Only byte 1 is checked for the numeric branch; the four ID bytes use signed-char arithmetic without digit validation. Invalid IDs return 1 before matrix/list/type_data mutation. Valid IDs normalize the local ACT, write the raw registration slot, call the actual type_data-NULL outlet and return without recursing. Sibling iteration saves `next` before the callback; nonzero stops propagate to enclosing enumerations. Duplicate raw IDs overwrite the previous registration.
- `compactNativeTrackNonCars(context)` runs separately after model traversal. It scans the original raw IDs in increasing order, compacts non-NULL actors into the same prefix, writes `name.slice(0,4)+sprintf("%04d",newIndex)`, and decreases all three source counts by the number of NULLs. For ordinary four-digit indices the native terminator truncates the name at byte 8. Trailing slots are neither cleared nor shrunk. Actor resources/topology remain allocated.

Host resource callbacks are concrete requirements when their source branch executes: `clearTypeData`, `smoothificatePowerups`, `setSpinningPowerup`, `setChangingPowerup`, and `addSmashableRaceTarget`. Missing callbacks raise `NativeTrackActorLoadError("provider-required",...)`. These errors can follow earlier ordered mutations/outlets; they are not transactional rollback. `clearTypeData` and unsafe-normalization checks are preflighted before committing that registration's matrix/list mutation. The host must not report full loading/preparation solely because a pass returned metadata.

Powerup callbacks own the **whole** native operation. Smoothification is invoked only for pixelBits 16 with a local MODEL; it mutates the local ACT/raw-face shared MAT resources (ambient/diffuse 1, flags LIGHT|SMOOTH with PRELIT cleared, source user value, conditional real material update). Its installed old-ambient threshold is double `0.9999`. Signed two-byte ID arithmetic follows smoothification. IDs 66..85 invoke spinning with opacity 0; IDs 86..87 invoke changing. Spinning includes local `(0,float32(.1),0)` pretranslation and MODEL CUSTOM/callback fields. Changing also requires the actual shared PowArm/PowPow/PowOff MODEL preparation/substitution or the original resource-loading fallback. The module neither invents these resources nor silently approximates their callbacks.

## Exact transform and numerical boundaries

`normalizeNativeTrackNonCarMatrix(matrix12)` takes finite stored Float32 ACT scalars and returns the new matrix, shift/normalization booleans and stored squared row lengths. It does not mutate MODEL geometry, bounds or the input array.

For each basis row, calculate `rawN=(x*x+y*y)+z*z` with double arithmetic, then `N=float32(rawN)`. The **first** undersize comparison uses `rawN[0]<double(.999)`; rows 1/2 use their stored `N`. If any undersize condition holds, local translation X becomes `float32(X+2000)`. Independently, if any stored `N>double(1.001)`, normalize every row with `reciprocal=float32(1/sqrt(N))` followed by Float32 component products. Sqrt is not prematurely rounded to Float32. This preserves shear and row direction rather than orthogonalizing the basis.

A source-confirmed boundary has raw squared length `0.9989999845939751`, stored `0.9990000128746033`: row 0 shifts X while the identical length in row 1 does not. A mixed small/large matrix both shifts and normalizes. Zero axes alone retain source shift behavior, but zero axes combined with an oversized axis would produce a nonfinite native matrix; the safe helper reports `unsafe-native-output` instead of inventing a replacement direction. Overflow/nonfinite matrix values, missing readable name bytes and unsafe native scratch-name lengths similarly fail explicitly. Counts and WORD fields are range-checked without clamping.

The New City `&07c0533.ACT` and `&07c0069.ACT` canopies in both datasets have squared row lengths approximately `2.07360053` and `1.44000006`; normalization retains their translations, local MODEL identities, MODEL geometry/flags and ACT bounds. The host must rebuild any transformed query bounds from the **mutated local ACT**, after this pass and before collision metadata. Authored raw source IDs must be kept distinct from the subsequent compacted native IDs.

## Validation and remaining integration

The committed tests use generated safe numeric/name/topology fixtures, including saved-next traversal mutation, callback ranges/order, last MODEL match, signed ID parsing, early abort, duplicate registration, finite diagnostics and count/allocation retention. Original-installation tests load both canopy ACTs and their actual DAT MODEL resources from Stock and Advanced at runtime, verify unchanged MODEL data and local normalization, then verify raw-ID compaction order. They skip cleanly when the original installation/track is absent. No original-derived fixture is committed.

Validation: **12/12 focused tests pass**, including both original datasets with no skips; all **16 installed captures plus rename** match the module. `npx tsc --noEmit`, focused formatting and diff checks pass. No production build or shared runtime integration is performed in this ownership pass. Root-owned model/MAT registries, race targets, powerup resource callbacks, type_data state and collision-metadata propagation remain separate integration work.

## Removal and collision eligibility

Installed `SmashObject` removal mode3 at `4f4d7b..4f4d93` checks for an already
NONE-style ACT, otherwise sets render style1 and calls `PipeModelChange(NULL)`.
The ACT's local MODEL, identifier and topology remain allocated. `4c8710` records
piping event0x21; it is not a collision-removal routine. `ActorBoxPick` at
`45fe02..45fe1b` prunes the style1 actor and its whole subtree before MODEL/child
collection. Repeated removal retains `changed=0`; `DoConnotations` at `4f4e98` is
therefore skipped. Removed geometry cannot furnish a second mission-variable
increment merely by being directly bashed again.

Stock/Advanced Carrier's WIGGLYBIT has track-positioned DAT geometry within the
CORE follow-up box despite an identity ACT translation. The current test removes
it before CORE. Native style1 pruning supports its later exclusion, so reselecting
or double-awarding that removed actor is not a valid fix for the remaining18/19
mission result. Initial mission-variable/target accounting remains under review.

## Carrier mission initialization and the nineteenth target

Installed `InitRace(0x481770)` calls `InitSmashTargets(0x497630)` at `0x481783`, then `ClearAllRuntimeVariables(0x4e7220)` at `0x481788`. Clear loads EAX=0, ECX=250 and EDI=`0x6b87e0`, then performs `rep stos DWORD`: all **1000 runtime bytes start at zero**, including variable 1. The separate smash-target count at `0x748d80` is also reset to zero. Neither operation initializes mission progress to one. Rec2 `common/init.c`/`racemem.c` supply the symbols, but its addresses and unsigned-byte declaration differ from the installed signed-byte consumer.

The installed runtime helpers are Set `0x4e7190` (low byte assignment), Get `0x4e71b0` (signed-byte extension), Add `0x4e71d0` (low-byte wrap then signed extension), Toggle `0x4e71f0` (zero→1, nonzero→0) and Clear `0x4e7220`. Bounds are addresses 0 through 999. A full installed-disassembly cross-reference scan finds runtime-block immediate references only in these helpers. Set has no direct callsites. The only direct Add callsites are connotation changes at `0x4ed575` and qualifying pedestrian death at `0x4ccfdb`; Toggle's only direct callsite is connotation `0x4ed582`. Thus no discovered race-start/end or target-registration writer supplies an automatic unit before the first smash. Invalid native helper returns are not a specification for safe browser behavior.

The actual **Stock** `RACES.TXT` Hard Core entry is native race type **5 / smash-and-ped**, not type 4: variable 1, target 19, required pedestrian group **56**. Actual Carrier ACT/DAT/spec inspection gives eighteen authored ACT increments: eight GUN01 instances, eight TGUN02 instances, CORE and WIGGLYBIT. `PEDS/settings.txt` maps group 56 to **ADMIRAL**. Carrier's spawn specification uses material **CAPTIN**, group 56, movement 0 and density -1 (one per qualifying face). The Advanced Carrier assets retain those ACT/spawn definitions, but the audited Advanced race catalog has no matching variable-1/target-19 entry; its shared assets alone do not prove the same catalog mission.

During native spawning, `0x4d3002..4d3055` tests race type 5, computes the source group's index by `(groupPointer-gPed_groups)/8`, and compares it to race `+0x1fc`. For a match it sets pedestrian WORD flag `0x200` (byte OR at ped `+9`) and calls `AddSmashableRaceTarget(NULL,NULL,pedIndex)`. Actor target registration `0x497640` only appends a 12-byte MODEL/ACT/ped-index record to a separate capacity-300 array (`0x68af28`) and increments `0x748d80`; it does **not** change runtime variables. The eighteen ACT targets plus admiral target therefore account for nineteen target records independently of the progress counter.

On death, `OneLessPed(0x4ccf10)` first rejects an already-set WORD flag `0x100` (`0x4ccf10..29`) and sets that once-only latch. At `0x4ccfb8..4ccfdb`, native race type 5 plus pedestrian WORD flag `0x200` calls `AddRuntimeVariable(race[+0x1f4],1)`. It then reads the counter and compares it to race `+0x1f8`; reaching the target calls race completion reason 3 at `0x4ccfff..4cd004`. This branch has no killer/driver-credit eligibility check. Nonqualifying pedestrians do not add a mission unit, and repeated death count calls do not add twice. Connotations perform the corresponding immediate completion check after their ordered variable-change list (`0x4ed597..5c8`).

The current `MissionVariables.clear()` zero initialization is source-correct. `main.ts` now routes the source once-only `OneLessPed` outlet through its population `onCount` adapter with the actual spawn group/count, independently of the later `onHit` scoring callback. This increments smash-and-ped mission counters and checks completion before scoring; original and native counting share the same population owner. The Stock/Advanced native gameplay harness verifies the real application counters. Full native population spawning remains PED-06. An ACT-only Hard Core harness correctly stops at 18/19. Complete traversal requires the admiral death; seeding progress to one, reducing the authored target, or awarding a removed ACT twice is not a supported fix. The former removal section's unresolved initial-accounting question is resolved by this source/catalog evidence.

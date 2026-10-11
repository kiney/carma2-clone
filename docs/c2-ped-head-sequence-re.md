# Installed pedestrian head-model sequences

`src/ped-head-sequence.ts` independently implements the bounded head sequence
start/update state and explicit model outlet. It changes process-cache sequence
fields only. ACT model selection, replay recording, resource ownership,
physics and the BON clock remain with their actual hosts.

## Evidence and table correction

The original HW executable is strictly read-only. SHA-256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE base400000, entry577eb0, timestamp1998-10-18 20:13:36 UTC.
rec2 `pedestrn.c`/`piping.c` and `rec2_types.h` provide names/layouts; installed
instructions and table bytes establish this implementation.

| Installed table | Bytes         | Meaning                                                                             |
| --------------- | ------------- | ----------------------------------------------------------------------------------- |
| `65d050`        | `03 01 02 01` | Scare: count3, poses1/2/1; repeatedly alternates indices1/2 after the initial pose. |
| `65d054`        | `02 00 63`    | Calm: count2, pose0 then sentinel99, ending the sequence.                           |

The rec2 scare initializer has count4/poses1,2,1,99. That is **not** the installed
HW table: copying it would stop head animation after three states instead of
retaining the source alternating sequence. Calm agrees with the installed data.
The tables are immutable constants in the independent module; arbitrary,
unrecovered sequence tables are rejected explicitly.

Source process-cache fields are pointer `+1c`, uint8 index `+1a` and uint32
last-change time `+78`. They are distinct from BON frame/fraction/time, the
character modelset byte `+0a`, FORM signed head-bone byte `+4d`, and character
signed render-slot byte `+04`. Render availability does **not** mean that the
head's current model pose index is nonnegative.

## Start sites and first model

The source SetPedHeadAnim behavior is inlined in this installed build. Its
ordinary alive/cache gates store the selected sequence pointer, time=now and
index0, then request the first sequence pose at modelset0. A negative render
slot skips the model call while retaining those stores. The start operation
itself has no replay gate; each caller owns its replay/action/HP branch.

| Installed caller | Verified placement                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `4d10bf..4d1154` | Rejected-halt reaction replacement93, followed by scare start, before retry RNG/settling.                  |
| `4d12fb..4d1399` | Accepted-halt reaction replacement93, followed by scare start, before forced grounding/recovery selection. |
| `4cbea6..4cbf2f` | Move-completion96/97 chooses living93, then starts scare, before borrowed ground-list release.             |
| `4cc4cc..4cc54e` | Separate forced-reaction helper chooses living93, then starts scare, before actual activation if needed.   |
| `4cf5d1..4cf653` | PedScanForObjects reaction starts scare before its later movement/direction choices.                       |
| `4cf183..4cf1b2` | PedScanForObjects selects walking30, then starts calm.                                                     |
| `4d6c1b..4d6c44` | CalmDownAllPeds selects walking30, then starts calm.                                                       |

The ordinary halt membership90/91/92/97/113 and completion membership96/97 are
owned by the existing halt/completion kernel, not guessed by this module.
Kill's eligible model/gore branch clears only the sequence pointer at
`4ccd44`; it preserves sequence index/time. Its actual gore/volume eligibility
belongs to KillPedestrian, so `clearNativePedHeadSequence` performs the requested
pointer clear without independently treating every HP0 as that kill branch.

## Exact outer update

The installed update is inline at **4d4cab..4d4da8**, not a separate callable
MungePedHeadAnim entry. Its order is:

1. Nonzero replay global6751b4 skips the entire update.
2. Missing process cache or NULL sequence returns without changes.
3. Compute `deadline = uint32(lastChangeTimeMs + 125)`. Advance only when
   `now > deadline`, using unsigned comparison (`4d4cd5..4d4cda`). It does not
   compare an elapsed-time difference or accept equality.
4. Increment index as uint8 (`4d4ce0..4d4ce5`). If the incremented index is
   greater than or equal to the count, store index1 (`4d4cee..4d4cf5`). Thus
   even index255 wraps to0 before comparison, rather than automatically to1.
5. If the selected pose equals99, clear only the sequence pointer and exit
   (`4d4d04..4d4d12`). The incremented index remains; timestamp is unchanged.
6. Otherwise store time=now before calling the model outlet (`4d4d17..4d4d1d`).
   Select modelset1 for signed HP<=0, modelset0 for HP>0. Negative render slot
   suppresses the model call after the source sequence/time stores.
7. Signed nonnegative headBone uses the one-bone AR model wrapper; signed
   negative headBone uses the all-models wrapper (`4d4d50..4d4da8`).

There is **one** increment per processed outer visit, including after a long
pause. No125ms catch-up loop, random draw, physics velocity, root pose or BON
clock update occurs in this head-state step. The absolute uint32 comparison has
observable wrap behavior: last=`ffffffb0`, deadline45; now=`ffffffb1` advances
although only1ms has elapsed; now45 does not, and now46 does. This behavior is
preserved rather than corrected by a generic elapsed-time comparison.

The source processed pedestrian phase first advances BON at `4d4bc4`, copies
passive character V at `4d4bee..4d4c0c`, handles corpse stillification, copies
current actor translation to ped.pos at `4d4c95..4d4ca8`, then updates the head
sequence and continues to bleeding at `4d4dad`. Schedule the update at that
actual outer phase for active and passive processed characters. It is not a
physics substep timer, a pre-BON grounding step or a moved/halt callback tick.
First-pose start effects execute immediately at their callers instead.

## API and actual model outlet

Persistent `NativePedHeadSequenceState` contains `sequence`, `index` and
`lastChangeTimeMs`; NULL state means the real process cache is absent. A NULL
sequence inside present state preserves its other fields. The module exposes:

- `decideNativePedHeadSequenceStart` / `decideNativePedHeadSequenceAdvance`:
  pure decisions containing proposed state and nullable model request.
- `startNativePedHeadSequence` / `advanceNativePedHeadSequence`: source field
  stores followed by optional actual `setModels` outlet.
- `clearNativePedHeadSequence`: explicit pointer-only clear for the real owner.

Inputs are signed-byte HP/renderSlot/headBone, uint32 source time and, for
advancement, explicit replay state. No current animation frame, yaw, guessed
head model or walking velocity is substituted. A request identifies one-bone
or all-models, signed FORM headBone, requested pose, target modelset and phase.
The actual `setModels` provider returns a structurally compatible native
instance result: complete or provider-required, explicit provider names, and
optional native model return0/1. Native known-NULL requested model return0 is
ordinary completed execution; it must not undo index/time or block later ticks.

Missing provider preflight preserves live state and reports the exact bone/all
AR owner gap. A supplied provider runs **after** source field stores; its explicit
unresolved result retains those committed stores and reports the gap. `committed`
distinguishes that case from a missing-provider preflight. Invalid storage or
contradictory outlet results throw instead of silently omitting the update.

The source AR wrapper requires this model/replay chronology:

```text
one head bone:
  retain old char.modelset (40b590) and current ACT.model pointer (40b570)
  PipeSinglePedModelChange4c8a30(headBone, oldModel, requestedPose,
                               oldModelSet, targetModelSet)
  SetCharacterBoneModel40b420(headBone, requestedPose, targetModelSet)

negative headBone:
  retain old char.modelset
  PipeSinglePedModelChange4c8a30(headBone, NULL, -1,
                               oldModelSet, targetModelSet)
  SetCharacterModel40b530(requestedPose, targetModelSet)
    -> SetCharacterBoneModel for actual FORM bones in ascending index order
```

The provider must explicitly own enabled or disabled replay recording; absence
of a recorder must not become a fake record. With recording explicitly disabled,
existing `NativePedRuntime.selectModel` supplies the one-bone ACT/model operation;
the negative-head provider loops the actual FORM bone count in source order.
For complete recording it additionally needs actual old MODEL resource identity
and the retained old modelset before selection, rather than inferring either
from a model name or a procedural head. Stable ACT/body identities are preserved.
Model changes do not initialize physics, resize a collision shape or advance BON.

## Released runtime/gameplay bridge

`NativePedRuntime.prepareFrame` now invokes `hooks.afterPose` once after a
successful processed BON visit, passive matrix/character-V synchronization and
`beforeSaveRoot` (ordinary Stillify), then `saveRoot` (including ped.pos).
Stillify observes the previous ped.pos and current ACT, whereas head animation
observes the committed new ped.pos. Unprocessed, released, vanished and unresolved
pre-pose visits do not run this hook. An unresolved post-pose outlet is reported
in the separate visit `afterPose` result: completed BON/root stores remain
committed and are never retried or rolled back. Active and passive ordinary
simple characters use the same outer hook, preserving active physical roots.

`NativePedGameplay.hooks.afterPose` advances the released head kernel using the
actual gameplay replay global, signed character HP, `runtime.allocation(owner)`
render slot and enrolled personality's signed FORM head index. `runtime.headBone`
reads that immutable authored FORM field rather than indexing a procedural head.
The persistent fields live in the existing `state(owner).cache.headSequence`:
`address` is the nullable pointer, `index` the byte, and legacy `startTimeMs` the
source last-change timestamp. Accessors map these fields directly to the pure
kernel; there is no separate head-state Map. New host cache storage defaults to
pointerNULL/index0/time0. Reused cache owners must retain/pass their actual scalar
fields; render/PHIL release does not destroy this process cache. A genuinely NULL
process cache remains NULL. Kill's existing eligible clear callback now clears
only `address`, preserving index/time.

Halt reaction and completion96/97 head-start effects immediately call
`gameplay.startHeadSequence(owner, nativePedScareHeadSequence, timeMs)` after the
source move selection. The halt kernel emits this start operation even for a
negative render slot, because sequence fields are stored offscreen. Its
`head.renderSlot` is explicit; `head.modelState` remains a compatibility alias for
the signed slot, **not** a MODEL pose. Gameplay replaces the supplied legacy gate
with the actual pool slot. Completion no longer reads `bones[headBone]`, so the
negative-head all-models branch is safe. Direct start accepts the calm table too,
for actual walking30/CalmDownAllPeds/PedScan caller owners when those are available.
It does not independently choose walking/running moves or invent an AI trigger.

Actual AR model handling requires `NativePedGameplayOptions.headModelRecording`:

- `"disabled"` explicitly records no packet, then executes the real stable-ACT
  model operation through `runtime.selectModel`.
- `{record}` receives the retained old modelset and current ACT model reference
  before selection. It owns any original resource-pointer serialization. The
  positive-head packet carries the requested pose and actual old model. A signed
  negative head emits **one** packet with oldModelNULL/requestedPose−1, followed
  by ascending selection of all actual FORM bones using the real requested pose.
- Missing recording ownership returns `native-head-model-AR-recording-owner`;
  no packet or ACT selection is fabricated. Head pointer/index/time stores that
  preceded this supplied outlet remain committed. A recorder's explicit missing
  dependencies likewise propagate instead of pretending to complete recording.

Known-NULL target MODEL return0 is ordinary complete execution: the sequence
step remains consumed, ACT/model/pose retained, and both instance and runtime
character modelset are synchronized to the changed source set byte. An absent
set1 provider remains unresolved. The all-model wrapper ignores ordinary
individual return0 without inventing a native aggregate return value. Negative
head Kill model selection uses the same ascending-all ACT semantics. These model
changes retain ACT/body identities and do not adjust physical bounds.

This is runtime/gameplay wiring, **not normal-population production completion**.
`src/pedestrians.ts` still owns the legacy displayed population; main does not
construct this gameplay bridge. The native source process-cache allocator/reuse
owner, PedScan/forced-reaction/CalmDownAllPeds start owners, full AR serialization,
and corpse-stillification-before-head/bleeding-after-head outer owners remain
separate integration requirements. Existing recovery outlets still own ground
cache/direction/proximity/status/slick effects; adding a head owner does not
silently satisfy those unrelated callbacks. The requested `ped-runtime-state.ts`
path is absent: real persistent gameplay state currently resides in
`NativePedGameplay.records` and its supplied process cache.

## Related halt host distinctions

The nearby halt effect currently named `status-physical-level5` records replay
state; **it does not request physical level5**. At `4d1257..4d1285` the source
calls PipeSinglePedStatus**4c8840**, recording literal5 plus existing character
slots/direction/up/orientation, then increments impact serial. The actual setter
is SetCharacterPhysicsLevelAR**4cc610**, which calls core**409570**. Actual level5
copies character V, clears ec, activates PHIL, enables gravity1/properties and
sets active bit4; `NativePedRuntime.activate` supplies the ordinary registered
simple-host equivalent. Invoking it for the halt status packet would reactivate
an accepted sleeping body. A status-recording host may explicitly have recording
disabled; it must not invent an activation or header mutation.

Completion's `release-selected-face-cache` name also needs precise ownership:
`4cbf90..4cbfa9` clears borrowed faceCache.owner(+14) and processCache.faceCache
(+b0). It neither destroys the process cache nor erases direction/floor/head/run
fields, face records, selected-face(+30) storage or pool order. The narrow mapping
is ground pool.release(owner), retained process state's cache=NULL, preserving
its other fields. Whole NativePedGrounding.release deletes process state and is
too broad; invalidate retains slot ownership and is too weak. Global pool.reset
is unrelated to this completion operation.

Ordinary living halt forces recache at4d13da, applies source slope direction,
selects recovery, rescans proximity at4d1849, scans objects at4d1854, then accepts
its basis/mask/volume tail. Rescan needs the actual borrowed list and selected
face, copies that face normal into processCache+00..08, then runs its later rays.
PedScan reseeds shared CRT with the actual pedestrian pointer at4ced54 before
its first FRandomBetween(.8,1.2); a browser object name is not that pointer.
These providers remain separate from head animation. Ordinary dead corpse slick
also skips replay at4d18f1, draws75 before bit10/gore checks, then calls4ec9b0
with actual root matrix407b00 and spec6928c8. Head state introduces no substitute
for missing proximity, pointer-RNG, gore/slick or volume ownership.

## Validation

Sixteen focused tests pass. They cover exact installed tables, immediate writes,
strict125 equality, persistent scare looping, calm sentinel retention, uint32
and uint8 wrap, replay/cache/render gates, signed HP, negative head, actual model
return0 versus missing/unresolved providers, pure decisions and bounded errors.
Read-only installed PE table checks and six Stock/Advanced Blokebl/Bandsman/twolf
instances validate original authored model selection, stable ACT identities,
retained active roots/V and unchanged BON clocks. Both original tests skip
cleanly when the installation is absent.

The bridge adds ten focused cases across the existing runtime/gameplay/halt
tests: post-pose ordering and skipped visits, passive/active ownership, retained
successful BON on unresolved recording, immediate source AR order, known-NULL
set changes, negative-head completion/Kill, offscreen/cache-absent lifecycle,
strict125/replay/one-step/calm behavior, and Stock/Advanced Blokebl/Bandsman/twolf
ACT/PHIL stability. Original animal missing pose variants explicitly exercise
ordinary return0 rather than inventing extra models. These installation cases
skip when original assets are absent; no proprietary fixture is committed.

A private32-bit harness executes the actual inline **4d4cab..4d4da8** with invented
state and actual GetModel/SetModel instructions. It replaces only private
replay-recording and continuation boundaries; original files remain unchanged.
**1,000 cases /13,000 state, ACT-model and recording components /44 model calls
match exactly with zero differences.** It includes dead, offscreen, negative
head/all-models, cacheNULL, replay, exact125/126 and wrap cases. No proprietary
fixture or binary dump is committed; private probes remain under `/tmp`.
TypeScript and owned-file formatting checks pass. The module is released for
host integration; this note does not claim production displayed pedestrians
already execute the new head sequence provider.

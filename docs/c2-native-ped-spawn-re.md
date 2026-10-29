# Native pedestrian face spawning

## Evidence and scope

This note separates direct inspection of the installed HW executable from rec2's reconstructed source. The installed executable is `carma2_HW.exe`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c` (PE32 i386, image base `0x400000`). The addresses below are installed addresses. No numerical spawn capture has been made; RNG chronology and formulas below are static analysis, not experimentally captured output.

The caller path is installed `ProcessModelsCB` at `0x40cf10` → `MungeFaces` at `0x40d530` → `SpawnPedsOnFace` at `0x4d2a80`. `ProcessModelsCB` selects the actor's local MODEL when it exists and global `0x689fbc` is zero. Otherwise it scans children, skips identifiers beginning with `&`, and selects the first remaining child. `MungeFaces` visits model faces in order and calls `SpawnPedsOnFace(face, model)` before checking whether a face must be made updateable. It adjusts its face index after removing a face, so the next face remains visited.

## Installed eligibility and inputs

ReadTrack calls `ReadPedSpecs 0x4ca7a0` at `0x5055bd` before
`ExtractColumns 0x40cc50` at `0x5055ce`. ReadPedSpecs resolves all spawn,
exclusion and exception MAT pointers before its marking pass
`0x4caa43..0x4cab28`. That pass pads short identifiers by replacing their final
four characters with `xxxxxxxx.MAT`, then always writes byte7=`?`. This is
why ordinary unmarked names in the original MAT files satisfy the later
predicate. The installed padding address is `buffer+strlen-4`; rec2's append
at `buffer+strlen` is a transcription error. See
[marker evidence](ped06-spawn-materials-re.md) for exact branches and malformed
identifier boundaries.

The installed `SpawnPedsOnFace` checks, in order, that network mode is off (`0x68a058`), the face normal's Y component is above the maximum-slope cosine, the face has a material and its identifier is non-NULL, `strlen(identifier) - 4 > 7`, `identifier[7] == '?'`, and the global pedestrian count is below 2,000. The byte check is `cmp [esi+7],0x3f; jne exit` at `0x4d2ade–0x4d2ae2`: identifiers with any other byte there are rejected.

The face's three vertex indices address the selected model's vertex array. The callee reads each vertex's authored model-space position; it is invoked before track face migration. It receives the face and model, not an ACT actor or world transform. Therefore the source triangle is raw MODEL geometry, and any ACT transform application must be established by another native caller/context rather than inferred from the callee.

Spawn specs are scanned in their configured order and matched by material pointer identity, not by identifier text. In the original loader, spawn and exclusion materials are resolved to BRender material pointers; a same-named but distinct material is not equivalent. Spec fields used here are movement row, group, density and per-spec fractional carry. The caller's precise source resource/identity mapping must be preserved through track preparation to reproduce this behavior.

## Density, cap, movement, and mission behavior

For density `d >= 0`, installed code computes `carry + WORLD_SCALE² * area * d / 1000`, floors the result, and stores its fractional remainder after processing the face. The XZ triangle area is the absolute shoelace area divided by two; the installed constant corresponding to `WORLD_SCALE` is 6.9. For negative density, the candidate count is `-d`. The carry is stored on the matched spawn spec, so it continues across its faces. If the global capacity is reached during the spawn loop, the function returns before writing the new remainder. Capacity is 2,000 and is checked both on entry and before each pedestrian.

The per-candidate sequence in the installed disassembly is group-member selection, animal exclusion check, two `SRandomPosNeg(1)` calls for X/Z direction components, then triangle-point generation, followed by pedestrian construction. `SRandomPosNeg(1)` produces signed floating-point samples; these are not discrete `+1/-1` signs. An excluded animal consumes the group-selection draw but skips direction, point, construction and pedestrian-count increment. The triangle point uses two random coefficients in `[0.1, 0.9)`, reflecting both when their sum exceeds one, then derives the third barycentric coefficient. Installed `BuildPedestrian 0x4d2dd0` receives the configured movement row.
At `0x4d2f27..0x4d2f4c`, nonzero movement DWORD+0c selects move 30 with an
integer sample between movement DWORD+08/+0c. Zero selects move 0 with speed−1,
which requests the selected FORM move's authored period rather than period 0.
`SetPedMove 0x4cba70` owns move substitution/fallback; the constructor's requested
ID is not proof that this personality supplies that move. HP 100 and speed
factor 1 are stored at `0x4d2f13` and `0x4d2f1d`. Direction normalization follows
at `0x4d2f51..0x4d2fdc`. These are installed static instructions; no numerical
native construction capture is claimed.

After successful construction, installed race-type handling assigns objective
ownership before incrementing the pedestrian count:

- Type 5 (`SmashNPed`), `0x4d3014..0x4d3055`: compare the spawn group's actual
  index `(groupPointer-gPed_groups)/8` with race+1fc. A match ORs flag `0x200`
  and calls `AddSmashableRaceTarget(NULL,NULL,pedIndex)`. This branch does not
  increment the type 2 initial target total.
- Type 2 (`Peds`), `0x4d3064..0x4d30df`: signed count at race+1f4 below 0
  marks every spawn and increments initial target total `0x7429ac` once.
  Count 0 selects none. A positive count scans DWORD group IDs beginning at
  race+1f8; the pointer explicitly advances four bytes at `0x4d30b0`. The
  first match marks/increments once and exits, including duplicate configured
  groups. rec2's repeated comparison against the same union field is a
  transcription error.

`AddSmashableRaceTarget 0x497640` appends at most 300 records; capacity exhaustion
silently skips the append after the objective flag has already been set.
These flags, initial totals and registrations belong to population creation,
not merely hit-time score accounting.

## RNG evidence and production integration

Installed helpers are `IRandomBetween 0x512f00`, `SRandomBetween 0x513000`,
`SRandomPosNeg 0x513030`, and shared CRT `srand/rand 0x575f70/0x575f80`.
rec2 annotates SpawnPedsOnFace as `0x4d2cc0` for its different target revision.
Installed BuildPedestrian is `0x4d2dd0`; `0x407990` is character-instance construction,
not that pedestrian constructor. The newcommon pedestrian file remains a stub
map. The per-candidate draw chronology above is verified static evidence,
not a captured original population/RNG trajectory.

The normal race loader now resolves actual MAT bindings, marks the live spawn
identifiers, and supplies `NativePedPopulationPlan.visit` to
`prepareNativeWorldScene`'s load-time `spawnPedsOnFace` outlet. Visits arrive
from ordered native ACT/MODEL preparation before each face migration. The plan
consumes selected MODEL-local indexed triangles, reconstructed original face
normals, actual MAT identity, per-spec carry and `sharedNativeRandom`. It
retains each authored personality/group/triangle identity, sampled direction,
position, initial walk period and objective policy for later actor creation.
`PedestrianSystem.create` consumes those entries; it does not recalculate a
production population from render batches.

Personality packages load asynchronously after that plan. In the inspected
normal path, `NativePedPresentation` construction and the initial frame0,
nonmorph pose introduce no additional CRT draws: the instance merely retains
its CRT callback, and mutant perturbation defaults off. Initial 0/30 selection
uses the installed FSM table with actual loaded moves. A stationary movement's
zero walk-period value remains a selection sentinel; the selected idle FORM
period is used for animation. There is no added random phase or per-pedestrian
turn-deadline draw at spawn; bounded process initialization schedules turns
when an owner is actually processed.

Production binds these same identities through `OrdinaryPedRuntime` into
FORM/render/PHIL admission, the 100-record process pool and 85-slot ground pool.
The ordinary source scanner receives actual live `0x54` records in browser-owned
Wasm memory. Its pointer reseeds use those record byte offsets. This is an
explicit host allocation policy, not Windows heap emulation or a guarantee of
the same RNG choices as a historical Windows run. Unknown pointer fields are
not fabricated, and missing asset/process/prepared-group owners retain explicit
provider boundaries. The rendered `collectPedSurfaces` path remains a
compatibility/fixture fallback when no native population plan is supplied.

## Remaining evidence and limits

There is still no independently captured original spawn output establishing
bitwise RNG/population parity. The static source algorithms, production
ownership, and host address policy must be distinguished from that stronger
claim. Numerical area/point/direction arithmetic and JS transcendental helpers
also do not establish exhaustive x87 equivalence. Source MAT identity, raw
face chronology and bounded runtime admission are now represented; they are
no longer missing solely because the renderer batches meshes. Full production
validation results belong to the completed integration report. See
[production boundaries](ped06-production-integration.md) and
[ordinary movement](ped06-ordinary-move-re.md).

# C2 race rules: exclusions and time awards

## Evidence and implemented paths (RAC-03)

The installed HW executable has SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Addresses below are virtual addresses in its PE32 image (base `0x400000`).
The shared SW executable has SHA-256
`15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d`.
Original files are inspected read-only; no binary dumps are distributed.

The public symbol map is [rec2](https://github.com/madebr/rec2), inspected at
commit `249f6be9925b7632295b74a47e3d4b07857b1649`. Critical powerup handlers
remain stubs there; the behavior below was checked in installed HW disassembly.
This is an independent implementation, not copied reference code.

| Path                | Evidence                                                                                                                                                      | Browser behavior                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exclusion parsing   | `LoadRaces`, negative termination at `0x48c221–0x48c23e`; loader uses whitespace, comma and slash delimiters and a 50-entry temporary list                    | Zero-based definition indices; stop at first negative token; reject invalid integers and oversized lists. rec2's loader currently omits the negative termination check.                                                |
| Pickup substitution | `GotPowerupEarwig` at `0x4d8b10`, exclusion test `0x4d8bdf–0x4d8bff`, fallback call `0x4d8ec7`; `GotPowerupX` at `0x4d8f30`, substitution `0x4d8ffc–0x4d9006` | Keep authored actors visible and collectable. Replace an excluded effect with definition 0 exactly once, including debug grants and charged abilities. Use definition 0's original parameters, not a fabricated award. |
| Random pickup       | `PickAtRandom`, `0x4de5a0–0x4de5c9`                                                                                                                           | Draw once from the full authored integer list, preserving duplicate weights. Substitute an excluded result; do not remove entries or reroll.                                                                           |
| Time awards         | `AddTimeAward` at `0x44baf0`, current race `no_time` check at `0x44bb21–0x44bb2e`; `GotTimeOrPower` at `0x4dc270` calls it at `0x4dc2ad`                      | Route ordinary checkpoint, pedestrian, opponent and powerup time additions through `awardRaceTime`. Suppress them when `disableTimeAwards` is set. Credits and objective progress are unaffected.                      |
| Catalog selection   | Implied by separate original `data/RACES.TXT` and `adv_data/Races.txt`                                                                                        | Select definitions from the track's own root, including menu names, exclusions, mission type and time flag.                                                                                                            |

Time-award callsites also occur in wasting (`0x440ee9`), rolling
(`0x4410b1`), pedestrian (`0x4cd3e1`) and stunt (`0x4ed45e`) paths. Future
implementations must use the same helper. The opt-in debug **+60 seconds**
control is an explicit administrative override and bypasses ordinary awards.

## Separate compatibility gaps

RAC-04 remains separate: the installed `IncrementCheckpoint` at
`0x502f70–0x503079` awards credits without calling `AddTimeAward`, consistent
with rec2's `structur.c`. The browser still has its earlier checkpoint time
bonus approximation; RAC-03 gates it correctly but does not establish native
checkpoint award fidelity. Pedestrian/opponent award quantities also require
the broader native award work. Do not infer that these quantities are verified
from this flag implementation.

Tests cover parsing, substitution, weighted random choices, collection,
charge exclusion, time suppression and original Stock/Advanced race catalogs.
Browser regression uses the installed missions and ordinary runtime grant
path; generated screenshots and reports remain in ignored `artifacts/`.

## Smash missions (RAC-01)

Installed HW evidence resolves several differences from a simple object-count
mission implementation:

| Native path                                                               | Verified behavior                                                                                                             | Browser implementation                                                                                                                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetRuntimeVariable` `0x4e71b0`                                           | Read memory `0x6b87e0` using signed-byte extension; 1000 slots                                                                | `MissionVariables.get`, signed `Int8Array`. rec2's unsigned getter differs from the installed instruction. Invalid reads deliberately return 0 rather than native unspecified EAX. |
| Add `0x4e71d0`, toggle `0x4e71f0`, clear `0x4e7220`                       | Byte wrap, toggle zero to 1 and any nonzero to 0, clear all slots                                                             | Independent methods; clear for each new race.                                                                                                                                      |
| `ReadVariableChanges`                                                     | Text pairs are address, delta; storage reverses their order into unsigned-16 address and signed-16 delta. Delta 9999 toggles. | Preserve parser pairs; apply native-width conversions at dispatch.                                                                                                                 |
| Smash connotations `0x4ed200`, mutation `0x4ed552`, completion `0x4ed597` | Apply entire variable-change list, then compare signed mission variable **>=** authored target; complete with reason 3        | Dispatch through real world smash callbacks, then check the mission immediately. An intermediate crossing inside a list is insufficient.                                           |
| `OneLessPed` `0x4ccf10` (rec2 annotation differs)                         | Selected type-5 pedestrian increments the same variable by 1; accounted flag `0x100` prevents duplicate deaths                | Existing alive-to-dead transition emits the spawn group once; selected group increments the same byte and checks immediately.                                                      |
| Ped target selection `0x4d3019`                                           | Compare `(spawnGroupPtr - gPed_groups) / 8` with authored mission group; selected flag `0x200`                                | Use original `ped.spec.group`, not actor name or personality.                                                                                                                      |

`smashAndPed` is additive: targets and selected pedestrian kills contribute to
one counter. It does not require a separate "all pedestrians" victory condition.
Completion freezes once won, so a later event wrapping/subtracting the counter
cannot undo victory. The event-time check matters; checking only after a frame
could miss a valid crossing followed by another event.

Stock catalog missions preserve these values: **EYE OF THE BEAVER** variable 1,
target 11; **HARD CORE** variable 1, target 19, pedestrian group 56;
**OIL BE BLOWED** variable 1, target 7; **CARPOCALYPSE NOW** variable 1, target 15.
Advanced **CARPOCALYPSE AGAIN** also uses variable 1, target 15.
Satellite, carrier weapons/core, pump and silo records author `[1, 1]` changes;
actual actor instances, not distinct record counts, determine available targets.

This restores objective parsing and accounting. World side-effect scripts and
room links remain separate WLD-05 gaps, particularly relevant to original silo
mission traversal. Existing pedestrian contact fidelity is still PED-03; its
current death event is integrated here without claiming native collision parity.
Completion award amounts remain RAC-04.

## Validation

RAC-03: original Stock and Advanced catalogs, synthetic parser/error and
weighted/charged/collection tests pass. Actual Chromium checks load Boulder
Dash, The Bruise Brothers, Nice Beaver and an Advanced mission. They confirm
excluded Hot Rod becomes credits without engine changes; the unexcluded time
flask is suppressed in The Bruise Brothers and adds time normally in Nice
Beaver. ArrowUp drives the stock car. No console errors, failed requests or
WebGL errors were observed. Chrome DevTools MCP is unavailable in this session;
validation uses the project's Playwright/Chromium harness, not a compile-only
claim. Screenshots were inspected and remain ignored.

RAC-01: Chromium inventory finds exactly eleven authored satellite actors in
Eye of the Beaver (one comsat1, ten comsat2). Real destruction-handler contacts
replace all eleven models, advance variable 1 from 0 to 11 and complete the
mission; repeating the first actor does not count again. Completion voice 8011
is dispatched once. A real pedestrian sweep in Hard Core kills one group-56
pedestrian and increments the shared variable by one. These are deterministic
integration checks, not proof of every mission's natural driving traversal.
Carrier/Desert/Silo traversal and script dependencies still need broader checks.
The existing Chromium regression also retains 16 ordered gate crossings, race
completion, stock Quarry and Advanced Acid Reign loading without fatal errors.

# Inactive retained-root recovery moves

`src/ped-recovery-move.ts` implements the ordinary primary move core needed by
`NativePedGameplayOptions.setRecoveryMove` after the halt wrapper clears the
character's active bit. It preserves that inactive state and the actual ACT
root. It does not infer get-up motion, activate a body, set a heading or change
PHIL registration.

## Installed evidence

Original HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 base `0x400000`, entry `0x577eb0`; metadata and related evidence are in
[active moves](c2-ped-active-move-re.md). rec2's `common/pedestrn.c`
`SetCharacterMove` is an address/structure map; the installed code resolves its
incorrect negative-speed old-move lookup. The implementation is independently
written using existing root and bone math helpers.

| Installed address                        | Verified behavior                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x40c620/0x40c630`                      | Set/clear retained-root global `0x675ad4`.                                                                                                               |
| `0x4d1058/0x4d1162`, `0x4d1294/0x4d13ac` | Halt/recovery callers bracket their move/model work with that global.                                                                                    |
| `0x40a08a–0x40a0c0`                      | Select the actual current matrix from character-owned storage, temporary matrices, or its FORM render ACT; no active-bit check.                          |
| `0x40a119–0x40a132`                      | Primary nonnegative ID writes selected index, completion byte bit2 and queued index−1.                                                                   |
| `0x40a17e–0x40a19f`                      | Negative speed uses the **newly selected** move's authored period, truncates, then stores signed16.                                                      |
| `0x40a1b7–0x40a1df`                      | Same unforced ID and period-only−1 return1 without reset or pose.                                                                                        |
| `0x40a26a–0x40a28b`                      | Changed/forced primary ID resets frame, fraction, timestamp and queue; relinquishes existing morph ownership.                                            |
| `0x40a62a–0x40a6bc`                      | Global retained-root branch, independent of active bit: `O = LPInverse(newFrame0.root) * currentACT`, zero O translation, pose mode3.                    |
| `0x407b38–0x407b61`                      | Early return requires **active4 AND boned2 AND no temporary matrix**. Inactive boned characters do not take that return; posing clears halted byte bit1. |
| `0x407caf–0x407cbe`                      | Mode3 prevents reconstruction of the root even after active4 is cleared.                                                                                 |
| `0x4cbbc9`, `0x4cbc1c` onward            | SetPedMove invokes the core and handles native missing-ID fallback; it does not call SetCharacterDirection.                                              |

Numerical probes call the installed core inside a private 32-bit PE mapper.
Only the private process image is mutated; the installation is read-only.
Thirty calls with active4 clear and another thirty with only boned2 set have
identical outputs: ten synthetic retain on/off, period-only, same, forced,
changed and missing-ID cases, followed by twenty actual prepared frame0 inputs
from Stock/Advanced Blokebl/Bandsman90/94/96/97 and twolf30/40. Their retained
root12, orientation12 and native return values also match the earlier active
probes exactly. The new recovery implementation separately matches all 500
installed output components for those twenty retained-root calls. Temporary
harnesses and results are under `/tmp/c2-recovery-*`, never committed.

## Provider contract

`setNativePedRecoveryMove` takes the inactive instance, actual current native12
root, event time, `{id,speed,completion,retainRoot}`, and optionally the live
character callback byte/index and completion function. A concrete ID changes
completion and clears the queued index even when it is the same ID. ID−1 only
changes the period. Missing ID reports native2 before changing instance state.
The forced-ID bit is `0x40000000`; otherwise same ID returns1. Changed/forced
retained moves return0 after resetting frame/fraction/time to **zero**, deriving
orientation from the new frame0 and applying mode3. Event time is validated but
does not replace the source zero timestamp. The next animation visit stamps it
without advancing. Existing movement/heading/up anchors, character velocity,
body velocity/omega, quiet state, filters and header remain untouched.

`createNativePedRecoveryMoveCallback(host)` directly supplies the gameplay
`setRecoveryMove` option. It checks that the physical body uses this instance's
stable root ACT, reads the live root with `nativePedRootPose`, and consumes the
request without a direction setter. PHIL header2 may still be present during
halt; the adapter checks the inactive character state rather than inventing a
header1 requirement. The optional host reads the gameplay-owned callback byte
and replay state and supplies the existing completion outlet. Render ownership
must still be held; released or rebound ACT sets are explicit provider errors.
Model resources and ACT identities are preserved, with physically detached
actors excluded from matrix writes.

Mode3 does not perform a ground lookup, including moves whose personality
record normally grounds the root. Eligible children use existing quantized
angles, remapped attachment anchors and immediate-parent removal checks.
DOG1's exact-name misses retain source zero storage: move93 has a zero prepared
root and therefore zero O, while the actual root stays unchanged. This is the
authored/source outcome, not an identity-root substitution.

## Bounded limitations and validation

Changed non-retained recovery selection, morph ownership/release, queued
secondary moves, reverse playback, replay recording and mutant-angle RNG remain
explicit provider requirements. Missing move fallback/substitution remains the
gameplay owner's task. The module does not implement the wider recovery FSM,
cache allocation, reactivation or inferred get-up physics. Normal later
animation visits are still owned by the runtime; this adapter is a move
transition, not a replacement per-frame animator.

Nine focused tests cover captured transition fields, full rotated roots,
grounding bypass, inactive-boned halted clearing, preserved velocity/model/ACT
identity, completion timestamp behavior, detached actor retention, live body
ownership and twelve actual Stock/Advanced human/dog93/94 transitions. Original
installation checks skip cleanly when absent. TypeScript validation passes;
no production build or shared runtime edit is part of this implementation.

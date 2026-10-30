# PED-13: panic completion resumes fleeing

## Failure and root cause

In the live Stock TIMBER scene, healthy `climber` and `lumber1` pedestrians
within1.4model units of the player stayed in action2/move2 and looped their
fear animation. Both reported `nonordinary-completion-dispatch-provider`.
The original fear animation was working; its native gameplay completion branch
was missing. Normal native population ownership bypasses the older elapsed-time
reaction implementation in `pedestrians.ts`.

The fix extends the existing positive BON completion callback. It does not add
another timer, run a second movement loop, alter vehicle collision behavior or
replace authored animation transport with estimated displacement.

## Installed evidence

Direct static checks of the original HW/SW binaries establish the following.
Their hashes and PE metadata are retained in the earlier binary-audit notes;
original files were only read. rec2 supplies the symbol map but this callback
is a stub there, so it is not treated as reconstructed proof.

| Completed move      | HW callback arm                       | Result                                                                                                                                              |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–6,10,11           | `CBMoveCompleted4cbcc0`, arm `4cbd0d` | Reverse the full character direction through `SetPedXZDirection4cc060`, distance0/current time, unless suicidal; request run41/action1/completion0. |
| 13                  | `4cbdfa`                              | Request run40/action1/completion0; no reversal.                                                                                                     |
| 80–85               | `4cbf52`                              | Existing get-up completion; its blind/Valium gates and running-time store remain separate.                                                          |
| Other moves below90 | Default `4cbf90`                      | No invented move/action transition; retain the shared completion tail.                                                                              |

SW independently has the corresponding callback at `4c7be0–4c7ee0`, with
jump tables `4c7ee4/4c7f04`; HW tables are `4cbfc4/4cbfe4`.

For the fear arms, an existing process cache and neither missing-leg bit8/32
cause cached period100 and Float32 acceleration factor`.09` to be stored before
normal `SetPedMove`. Otherwise speed−1 leaves period selection to the usual
planner. Source rows40/41 substitute missing legs into50/51, and the ordinary
planner may then clear cached speed. Fear completion has no CRT call,
blind/Valium gate, flag mutation or running-time timestamp write. Completed13
is specifically run40, correcting the earlier ambiguous documentation.

Direction is dispatched before move selection, and the borrowed selected-face
cache is released afterward. Actual ordinary grounding/direction, move planner,
clock and pool owners execute these operations. The existing callback clears
completion once, uses the updated move/period, and stops remaining traversal.
No callback is synthesized from a guessed animation duration.

The original fear arm can stop a retained playing sound handle before turning.
The browser's current pedestrian vocals are one-shot outlets without those
native retained-handle fields; this change neither introduces a fake handle
nor claims that sound-stop lifecycle parity. It does not block fleeing.
Likewise optional suicidal input is supported by the kernel without claiming
completion of the separately tracked pedestrian powerup globals.

## Regression tests

`tests/ped-panic-completion.test.mjs` drives actual synthetic three-frame BON
animations through `NativePedRuntime` and `NativePedGameplay`. All19 scenarios
failed before the engine change and pass without changing their assertions:
all seven fear IDs,13, callback timing/one-shot release/order, cached/default
period, suicidal direction exception, blind/Valium independence, unchanged
running timestamp and six real-planner missing-leg substitutions.
The test direction outlet is explicit; full grounding-aware direction execution
is checked separately with original assets in Chromium.

`npm run test:ped-panic` runs the production bundle with Stock Timber/lumber1
and Advanced Newcity1/holidahe. It selects an existing healthy, passive,
supported population owner and requests authored move2 through the normal
planner. The actual16-frame/33ms animation ends after14×40ms controlled visits,
then selects41 exactly once, reverses through real steering and stores100/.09.
Two subsequent100ms run frames transport both roots approximately`.05838`
native units. The normal threat scanner stays active; HP, masks, running
timestamp, physical ownership and original body/instance identity are retained.
Reports include console/network/WebGL results, backend and drawing buffer;
SwiftShader results are correctness checks, not a hardware FPS benchmark.

## Preserving the user's scene

The reported browser was not reloaded. After red/green tests, the corrected
completion method was loaded from an ignored temporary module compiled from
the same engine source. Previously stalled living fear moves were rearmed once
so their next real BON end could execute the callback that the old build had
already consumed. This is migration of the broken live state, not a recurring
engine timer or additional fallback.

In2.5seconds the scene advanced91 game updates without new exceptions or WebGL
errors. All five rearmed fear moves reached41/action1. The nearest climber then
ran away by about1.65native units; other pedestrians could return to walking
under the existing calm-down scanner because the stationary player no longer
provided a moving threat. All retained HP100. The game was paused again.

## Validation results

- All19 new BON completion cases pass; existing halt18 and native gameplay35
  cases remain green. Full original-installation suite:3,779 pass,6 optional
  skips,0 failures.
- Asset-free CI:3,277 pass,439 original-dependent skips,0 failures.
- Production build/TypeScript passes after integration.
- Original Stock/Advanced production browser:2/2 pass with no console,
  failed-request, provider or WebGL errors, SwiftShader1280x800.
- The preserved user scene runs the corrected callback in hardware Chromium
  through DevTools: ANGLE AMD/radeonsi gfx1150, drawing buffer3792x1948;
  91 game updates, five observed panic exits, zero new errors/WebGL errors.
  Screenshots and diagnostic JSON remain ignored local artifacts. No scene
  reload, vehicle repair or pedestrian HP/mask edits were needed.

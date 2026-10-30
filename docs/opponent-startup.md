# Atomic opponent startup (AI-05)

## Executive Summary

Opponent asset loading no longer exposes a partially initialized physical fleet.
All cars, animations and effects are prepared privately; after the final asset
await, the complete grid is checked against the current player, props and other
staged cars, then admitted together. Failure or a race switch disposes the staged
resources without publishing cars. Original collision, suspension and damage
formulas are unchanged; genuine subsequent AI crashes can still waste opponents.

## Evidence and scope

The old intermittent Newhawk/Bigdump report retained no failing roster or seed.
Earlier passing captures were not equivalent: Bigdump's roster lacked Newhawk.
They could not close the reported symptom.

A targeted Chrome DevTools run selected an eleven-car DUNE/Bigdump grid including
Newhawk, recording initial poses, personalities and contacts. All cars started
supported and undamaged. Newhawk survived that four-second run; Cobra was wasted
after real Bigdump/Junker collisions. A later fixture likewise recorded ordinary
post-start damage. Universal four-second survival would require suppressing valid
crash behavior and is not an appropriate placement invariant.

The asynchronous startup defect is independently reproduced: hold the second
opponent model request. Before the fix, the simulation already contains Bigdump
and Bugtoo5 while the remaining roster is still loading. Those cars participate
in gravity and contacts even while AI is held under parking brakes. This differs
from synchronous native `InitOpponents`. The same test now contains only the
player until the fleet is ready. This establishes a browser startup defect, not
proof that it was the sole cause of the unavailable historical Newhawk event.

## Implementation

- `main.ts::loadRivals` retains the original grid origin/heading and generation,
  stages all model/body/animation owners, and does not publish `opponentFleet`,
  `rivals`, scene cars or physics bodies during asset awaits.
- After loading, existing `placeCarAtStart` checks four source wheel supports,
  full hull/world clearance and reservations against the **live** player/props
  and earlier staged cars. The ordinary search and failure-only radius-four
  search retain their previous rules. No await occurs before publication.
- `VehicleSimulation.addCars` preflights the native PHIL capacity and duplicate
  identities. Synchronous admission rolls back headers, car lookup and callbacks
  if initialization fails. This is an initial-roster transaction, not a general
  runtime car-removal/transfer mechanism.
- `NativeOpponentFleetHooks.initialTimeMs` seeds initialization deadlines from
  the publication clock. It preserves `firstFrame` and native first-objective
  selection; calling an empty `update()` to move the clock would consume them.
  Race reload also resets the published diagnostic game time alongside the game
  clock, so a paused new race cannot inherit its predecessor's timestamp.
- Cancellation or failure releases animations/FUNK frame ownership before models
  and groups. A stale asynchronous completion cannot modify the new population.
- Existing population availability remains authoritative: an opponent-required
  mission cannot succeed with a partial roster. A classic race with a failed
  optional opponent alternative retains its available lap/pedestrian alternatives
  and displays the load failure; it need not become free drive.

The safe-grid search and atomic browser publication are explicit integration
extensions. Native motion, contact impulses, crush and wastage thresholds are
not retuned. The wheel-distance/bumpiness history discrepancy is separately
tracked in PHY-20; its cause and correction require original-initialization
verification. AI-01 now routes selection through the shared native CRT and reserves
per-instance repair/visibility before quota personalities, ahead of asset awaits.
Publication binds timestamps without more draws. The updated held-model fixture
uses native seed4, including Newhawk; older xorshift seed1 evidence below is
historical. See [AI-01 completion and limits](ai01-production-integration.md).

## Validation

Run `npm run test:opponent-startup`. The focused Vite/Chromium fixture uses two
explicit xorshift32(seed 1) test streams for selection and personality, plus the
native CRT stream for subsequent AI. It asserts the actual authored opponent IDs
and includes Newhawk; global stream seeding alone would not establish that fleet.

The fixture checks delayed loading with an otherwise playable/moving player,
eleven supported and undamaged cars on publication, publication-time deadlines,
a short normal-AI window, injected third-model failure, and a race switch to
Boulder Dash while the second model is blocked. The old completion disposes both
staged models and cannot replace the new race or its population flags. Numerical
reports and proprietary-derived snapshots stay under ignored `artifacts/`.

Headless tests cover batch capacity, duplicate admission, rollback/retry, native
callbacks and translated first-frame/visibility/grudge timing. Existing slope
placement tests retain their source hull and wheel assertions. The older
four-grid spawn/pair browser regression now requires successful loading and
records damage-producing contacts instead of treating every valid AI crash as a
spawn failure.

Chrome DevTools MCP separately verified the held-model boundary on AMD Radeon
through ANGLE/radeonsi with a 2066×1429 drawing buffer: only the player was physical
while waiting, the player moved, all eleven cars published supported and undamaged,
and the fleet's initial clock matched game time with `firstFrame=true`. Console
and WebGL errors were absent. This is correctness evidence, not an FPS benchmark;
the reproducible lifecycle fixture uses SwiftShader separately.

The full isolated suite passed 3,285 tests with five optional ignored-capture
checks skipped; the retained captures were then read-only copied into ignored
artifacts and their focused regression group passed 23/23. The four production
spawn grids (11/11/11/6 cars) and frontal/oblique pair release passed with GL error
zero, no fatal console errors and no failed asset requests. The general smoke
fixture now caps render-smoothing observation by simulation time and starts its
independent checkpoint case with a fresh normal race rather than a body damaged
during the preceding driving sample.

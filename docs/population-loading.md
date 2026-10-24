# Population loading and unavailable objectives

QUA-02 fixes asynchronous completion traps. Opponents used to leave their ready
flag false forever if a later model failed after earlier vehicles had loaded.
Pedestrian creation could return successfully after failing an entire required
personality group, leaving a mission at zero targets or silently reducing its
selected target population.

Each population now settles independently as `loading`, `ready` or `failed`.
`window.carma.populationLoadState` exposes those states, loader reasons, usable
objective paths and any practice fallback reason. Settlement from an older race
generation cannot change the current race. A partially loaded opponent fleet
can still run its AI; objective readiness is separate from load settlement.

This is an explicit **browser compatibility policy**, not a claim that native C2
recovers from missing required files this way:

- Loading populations never count as empty or completed goals.
- A required opponent/population failure or a settled empty required target set
  changes the loaded mission to clearly labelled Free Drive. Driving, repair and
  normal timed effects continue; race countdown, checkpoint victory and completion
  payout are disabled. A persistent English reason is visible in the HUD and
  pause menu. Reload retries the mission with a fresh load state.
- Classic races retain their other victory paths when an optional population
  fails. A partial opponent fleet cannot satisfy the all-opponents objective.
  If neither a usable route nor complete combat population remains, the race
  uses the same explicit Free Drive fallback.
- Pedestrian creation records population failures separately from optional
  visual/audio warnings. A missing personality group blocks a mission that
  selects it, while an unrelated group's failure does not block selected groups.
  An authored group with zero spawns and no loading failure still contributes
  zero to the existing native-style sum; no substitute targets are invented.
- Mixed smash/pedestrian missions wait for their required pedestrian population
  before testing their shared mission counter. Pure smash/checkpoint missions do
  not acquire unrelated population dependencies.

The static selector availability check remains separate: it catches missing
track actors/starts and unusable required routes before replacing the scene.
Runtime population failure does not permanently mark an installed map unavailable
or cache an unsuccessful attempt. Full original mission scripts, physical
reachability and PED-09 cause providers remain separate compatibility gaps.

## Validation

Seven deterministic tests cover pending states, partial failures, selected IDs,
known missing versus authored empty groups, optional classic objectives and a
real synthetic pedestrian creation with one missing personality package.
`npm run test:population-availability` runs the actual headless Chromium
application with original New City/Eagle assets and controlled **in-memory**
loader failures. It checks delayed rejection after one valid rival, required
Free Drive/no payout, optional classic checkpoints retained, required pedestrian
failure, visible pause-menu diagnostics and rejection from an old generation.
The original installation is never modified. No fatal console/page errors or
failed network requests occurred. This is SwiftShader functional validation,
not a physical-display playthrough or a hardware performance measurement.

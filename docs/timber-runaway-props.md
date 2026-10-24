# Timber freeze: runaway physical world props (2026-10-24)

## Observed live state

Production checkpoint `103bdad` (including PERF-23 and PHY-17), visible Chromium
on AMD/radeonsi, original Stock Timber / green Eagle. The reported freeze was a
responsive but severely stalled simulation, with no console warnings/errors.
The retained minimal probe recorded a maximum physics tick of **9,226.7 ms** and
frame physics update of **16,037 ms**. Subsequent updates commonly cost
350–480 ms, executing five catch-up ticks each; displayed FPS was 2. These
measurements come from the running scene before pausing, not paused rendering.

There were only 34 physical bodies: seven cars, seventeen loose body parts and
ten admitted noncars. Several noncars had enormous finite velocities and had
travelled far outside the world. Actor `&33p0036` had angular speed
897,550.5 rad/s, linear speed 33,338.5 world units/s and position approximately
`[122229, 823812, -309854]`. Other props had angular speeds 5,788, 15,297 and
2,552 rad/s. Cobra was also about a million world units away. Hull sizes were
ordinary; this was not a huge collision hull created by deformation. All ten
captured noncars were free (`attached=false`), without a current parent joint.

The page was paused without reloading and body state, authored mechanics and
timing rings were copied into ignored artifacts. No additional simulation tick
was executed in the retained live scene. The records do not reconstruct the
earlier contact event that first injected the extreme energy.

## Confirmed continuing cost

`computeAdvanceWorldContacts` uses up to 128 angular samples.
`createHierarchyMotionPhase` evaluates those poses through `advanceRigidBody`,
whose high-angle integration performs up to 400 gyro substeps per pose. Thus a
single free spinner can request roughly 51,200 substeps per sweep before finding
that no world faces are nearby. The guard is independent of rendering, so hiding
or facing away from the objects does not remove this work.

A short, serial Node reproduction hydrated **copies** of four captured props
and ran one guard per variant against an explicitly empty world. It never
attached to or advanced the live browser:

| Captured actor | Captured angular speed | Empty-world guard CPU | Queries | Zero-spin diagnostic CPU / queries |
| -------------- | ---------------------: | --------------------: | ------: | ---------------------------------: |
| `&33p0036`     |               897550.5 |               39.4 ms |     256 |                         5.5 ms / 2 |
| `&24!0029`     |                 5788.2 |               18.9 ms |     256 |                         0.6 ms / 2 |
| `&24!0028`     |                15296.7 |               20.2 ms |     256 |                         0.5 ms / 2 |
| `&24!0033`     |                 2552.3 |               14.9 ms |     256 |                         0.5 ms / 2 |

Every variant returned full clearance and zero contacts. These one-shot,
JIT/host-sensitive Node timings isolate avoidable guard cost; they are not a
full-tick profile, browser FPS benchmark or proof of the original 9-second spike.
The 1,024 empty queries and approximately 93 ms combined guard time nevertheless
establish substantial continuing work in empty space.

## Attribution and next investigation

The creation of the excessive energy remains unresolved. Candidate paths include
ill-conditioned contact/joint solves and high-angle integration. The normal
solver accepts finite solutions without a physical residual/energy failure result;
the local retry host does not report a solve failure. Existing spin limits are
conditional on friction or tumble processing, so they do not reliably address
an already free, off-world object. These are code observations and hypotheses,
not a recovered original C2 diagnosis.

PHY-17 adds a vertex-plane certificate only when a nearby face exists; it adds
no sampling loop and is not evaluated in these empty-world sweeps. This excludes
its direct certificate cost as the explanation here. It does **not** exclude an
indirect earlier contact change. Do not declare the new fix innocent or guilty
without a controlled original-contact reproduction.

The follow-up should trace the first implausible impulse/angular-energy increase,
test solver/integration failures with original prop mass/inertia, and remove
unnecessary off-world trajectory work using valid complete-motion clearance.
Preserve normal strong crashes, in-world fast rotating objects, re-entry and
nearby third-body contacts. Avoid treating an arbitrary global speed cap, blanket
guard disable or an FPS rendering tweak as a demonstrated root-cause fix.

Ignored evidence: `artifacts/freeze-20261024-state.json`,
`artifacts/freeze-20261024-bodies.json`,
`artifacts/reproduce-freeze-20261024.mjs`,
`artifacts/freeze-20261024-clone-sweeps.json`. These local captures contain
original-derived geometry/mechanics and must not be committed.

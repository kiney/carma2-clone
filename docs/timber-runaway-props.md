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

PHY-19 tracks the first implausible impulse/angular-energy increase separately.
The user explicitly authorized containment without first proving that initiating
cause. PHY-18 implements the backstop and continuing-cost correction below; it
does not claim to prevent every initial extreme-energy event or long collision
solve inside the track.

## Implemented containment

At the start of each normal physics tick, free noncars and fully detached car
parts are checked against the retained authored track footprint. A conservative
whole-hull sphere must be entirely outside the X/Z footprint or below its minimum
Y, with padding `max(32, worldDiagonal * 0.25)`. This padding is an explicit
browser policy, not a recovered C2 constant. Missing/invalid bounds disable the
extension. High Y alone, high speed and high spin are not deletion criteria.
Cars, split secondaries, attached/jointed bodies and physical parents are retained.

Escaped noncars are hidden/disabled and leave PHIL, physical slots, dynamic world
participation and quiet/contact caches through the existing reclaim lifecycle.
Native ACT return uses the valid original pose, avoiding pathological column and
Float32 coordinates. Original mechanics, ACT and model identities remain owned;
no resources are disposed and no mission destruction reward is fabricated.
Detached parts retain their original DamageSystem actor, phase and ownership.
Removing their scene attachment leaves visibility intact so repair can restore
them. A current phase-2 and actor-identity check protects parts already repaired
before the next ordinary debris cleanup. Shared contact rings and both current
and overshoot camera contact sets forget retired bodies.

## Implemented complete-path clearance

A native parent-free body's world COM follows an exact line through free
integration. The line expanded by the maximum local vertex-to-COM radius bounds
all gyro poses, including full turns. When this complete tube misses current
ownerless world geometry, the browser guard evaluates only the final pose.
Native contact solving, body/body guarding and nearby world contacts remain live.
Unknown/custom trajectories/providers and analytic sphere bodies retain the
existing sampled path. Hull/COM changes are read afresh.

`WorldCollision.ownerlessGuardBoundsClear` checks a conservative aggregate of
actual ownerless surface publications, including triangles too large for the
legacy grid. It never treats a capped query's empty result as clearance. The
aggregate grows during existing surface publication and resets on a full rebuild;
deletions may retain extra conservative bounds. Queries take constant work and
never rescan the track after prop admission, geometry edits or revision changes.
Nonfinite publication disables the certificate until a rebuild.

This certificate bounds physical geometry. The old inverse-frame world-vertex
interpolation can produce artificial remote contacts at large turns outside that
physical tube; those artifacts are deliberately not preserved. Actual re-entry
and the existing angular-vertex regression continue through the sampled guard
when the complete tube overlaps scenery.

## Validation of the correction

Four copied captured bodies were compared once per implementation in the same
Node process against an empty world. Angular samples fell **512 -> 0**, world
queries **1024 -> 0**, with exactly identical final candidate positions and
quaternions. Combined CPU was 154.4 -> 4.6 ms in that one comparison. These
JIT/host-sensitive Node numbers are not browser FPS or a full-tick speedup claim;
the work counts and pose equality are the stable evidence.

Visible Chromium/AMD loaded a separate production Timber race and applied all ten
recorded free-prop states to matching original actors (matching the source ID,
whose release marker changes in play). All ten retired, physical prop slots
returned to zero, PHIL retained the seven cars, and subsequent W-key driving
advanced normally with clean console and GL. Initial authored joints were
explicitly removed in this controlled post-release fixture, matching the capture;
the initiating collision was not replayed. The automated production browser
regression also passes Stock Timber and Advanced Carrier with six controlled
escaped original props each, retained identities and continued driving.

Numerical checks cover complete turns, offset COM, hull/COM changes, re-entry,
large unindexed triangles, capped queries, geometry mutation, no whole-track
query scans, lifecycle cleanup, preserved in-world/high-flight objects,
physical parents, missing bounds and repair both before and after retirement.
The four-car production crash core and grounded/airborne Porker2 browser
split/repair checks pass. The integrated full suite passes all 3,140 tests with
zero failures/skips, and the production build succeeds. Original installation
data remains read only. The old reference target later timed out in
`Runtime.evaluate`; candidate validation used a separate Chromium context. After
preserving the evidence and completing validation, that unresponsive tab was
replaced by a fresh integrated production playtest.

Ignored evidence: `artifacts/freeze-20261024-state.json`,
`artifacts/freeze-20261024-bodies.json`,
`artifacts/reproduce-freeze-20261024.mjs`,
`artifacts/freeze-20261024-clone-sweeps.json`. These local captures contain
original-derived geometry/mechanics and must not be committed.
Correction evidence: `artifacts/phy18-copied-state-comparison.json`,
`artifacts/browser-escaped-bodies.json`, `artifacts/phy18-full-tests.log` and
`artifacts/phy18-build.log`. Isolated candidate reports are under
`/tmp/carma-phy18/artifacts/` until integration.

## PHY-19 bounded causal investigation and accepted limitation

2026-10-29 follow-up: [a single-plane, generated-box reproduction and bounded
original-solver oracle](runaway-contact-root-cause.md) now demonstrate a real
contact/solver energy-injection mechanism. Native and angular guard contacts
are individually benign but their merged packet produces enormous impulses in
the browser. The original numerical routine rejects that packet with bounded
partial output. This is stronger evidence than the earlier prescribed-contact
experiment below, while FAIR's actual historical first packet remains unknown.
PERF-24 owns implementation. The new oracle also shows that the final native
residual-correction tail changes scratch values without updating returned
impulses in the tested case; do not treat that tail as an effective safeguard.

On 2026-10-24 the user limited further investigation to approximately fifteen
minutes unless a strong actionable cause emerged, accepting occasional
explosions while PHY-18 prevents their ongoing off-world simulation cost.
Investigation started at 14:54 UTC and closed within that window. No solver,
physics coefficient or live playtest state was changed during this investigation.

### Excluded and unproven paths

- All ten captured props retain authored `mass * inertiaPerMass`, within about
  `2.3e-8` relative error. There is no persistent factor-50 scaling error.
- Waking/admitting or releasing a noncar invalidates the solve before cached
  impulses are applied. Released mass/inertia is finalized before the following
  matrix construction. No transient callback mismatch was demonstrated.
- Captured free props have no motor/world joint/tumble force producer. Their
  current force path only applies gravity. Free gyro integration preserves world
  angular momentum algebraically and cannot itself create linear velocity.
- Contact coupling and joint Jacobian signs are consistent with symmetric
  `J M^-1 J^T`; no isolated sign/COM response coding defect was found.

### Reproduced artificial amplification

Eight bounded prescribed-contact solves used captured original prop mass/inertia
and three constructed normals: normalized `(epsilon,+1,0)`,
`(epsilon,-1,0)` and `(0,0,-1)`. Initial velocity was `(0,0,1)`, with no initial
spin and production-style deferred friction. At `epsilon=1e-6`, a lever offset
of `.04` produced speed **4047.3** and spin **89084.4 rad/s**. At zero lever
offset it produced speed **6667.2**. Nearly dependent biased contact demands can
therefore amplify motion substantially in the browser solver.

This is a constructed numerical counterexample, **not** a replay of the first
Timber impact. Native world reduction rejects nearby opposing normals and keeps
one aligned normal prefix. Browser angular augmentation groups directions before
reduction and can retain opposing groups, but its geometric entering-motion
gates still have to pass. The prescribed Vz-only contact fixture does not prove
those gates or the native/angular merge admitted this exact packet.

Nine additional bounded geometry cases used the captured original prop hulls and
mechanics against procedural nearly opposing surfaces, translations and ordinary
10 rad/s rotations. One case retained opposing guard contacts, but **none**
reproduced an explosion; speed stayed approximately 3.08–3.18 and spin at most
11.13 rad/s. This narrows the admission question without proving the historical
event or excluding other configurations.

### Verified native safeguards not yet reproduced

Installed HW SHA-256 remains
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Static inspection confirms:

| HW address                      | Observation                                                                                                                                                 | Confidence                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `0x4c3937–0x4c3962`             | Single-row diagonal at most `.0001` yields zero impulse.                                                                                                    | Verified binary.                                                                        |
| `0x4c3ad2–0x4c3b0d`             | Compare earlier entries in the final triangular-factor row against `abs(lastDiagonal * 100000)`. A larger earlier entry selects active-row removal/rebuild. | Verified binary; factor helper uses orthogonal rotations, not ordinary Gaussian pivots. |
| `0x4c3ce8–0x4c3d6e`             | Remove an active row and rebuild the factor.                                                                                                                | Verified binary control flow.                                                           |
| `0x4c446c–0x4c4492`             | Final residual discrepancy beyond `.01` triggers a correction pass.                                                                                         | Verified binary; not an immediate failure return.                                       |
| `0x4c3a11`, `0x4c43cb–0x4c43e2` | Fifty-iteration exhaustion returns `-1`.                                                                                                                    | Verified binary; existing native three-report handling remains distinct.                |

The browser instead regularizes dense Gaussian elimination and lacks the same
dependence handling and final residual correction/status. Native protection is
relevant to the artificial near-dependent packet, but its exact outcome was not
executed. Substituting `100000` into an unrelated Gaussian-pivot check would not
faithfully port the native triangular-factor rule. No such speculative patch was
made.

### Closure meaning

PHY-19 is closed **as investigated with an accepted remaining compatibility
gap**, not as a fixed or proven initiating cause. The saved scene lacks its first
contact packet, and the bounded geometry experiments did not reproduce it.
Occasional extreme impulses remain possible; PHY-18 containment and empty-space
clearance remain the operational protection. Reopen if explosions become common,
in-world spikes remain disruptive, or a first-event contact packet becomes
available. This closure does not assert that every possible frame stall is fixed.

Ignored experiment scripts/reports: `artifacts/phy19-biased-wedge.{mjs,json}` and
`artifacts/phy19-world-admission.{mjs,json}`. No proprietary fixtures or executable
contents were committed.

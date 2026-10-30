# PED-14: shallow terrain seams injected runaway collision energy

## Live evidence

The user reported another severe TIMBER stall after PED-12/PED-13. This time
there was no new exception loop. The page still listed historical PED-12
errors, but the bounded unpaused capture recorded **zero new errors**.

Two actual gameplay callbacks took4,961.6ms and2,518.0ms. They were not window
suspension outliers: a requested1.8second continuation completed just two game
updates in7.485seconds. Re-slicing CPU samples to these callbacks attributes
more than94% to simulation, principally local response, world-contact queries
and trajectory guards. Rendering contributed less than0.4% per long callback.
Paused-frame rendering costs must not be mixed into that attribution.

A subsequent single measured outer update took3,047ms for five physics ticks.
One active ordinary pedestrian body (`Bip01 Spine`, owner50926, recorder body10)
accounted for1,585ms of world-contact work, including1,541ms collecting faces,
150 contact collections and25,964 sweep tests. Other individual bodies cost
orders of magnitude less. Its current speed was approximately14,000 native
units/sec, with almost no committed displacement because collision protection
kept rejecting the motion. The resulting huge query envelopes repeatedly
traversed much of the level.

The three-minute local capture was saved before intervention:216,124,284bytes.
Captures, decoded contacts/geometry and CPU traces are ignored local evidence;
none is embedded in source or bundled with the game.

## First causal event

The recorded rigid body activated normally nine ticks before the first burst.
At tick8339 its starting speed was`.553` native units/sec. Exact replay of its
recorded normal-response packets reproduces the impulses and post-normal
velocities, independently of rendering or subsequent gameplay updates.

The first destructive packet has five world rows on adjacent original faces20
and21 of the same actor. Opposed edge/vertex normals have dot approximately
`-.99287`, OLD points are about`.03` apart, and source faces differ only1.33°.
The solver reports `solved`; impulses up to217.765 increase kinetic energy
approximately1,647times before friction. Later that tick a larger packet
amplifies the motion again; subsequent samples exceed one million units/sec.
Removing either the opposing edge row or the conflicting vertex rows produces
a small, dissipative response instead.

The recorder does not serialize `worldFeature`, so the exact captured chord/
angular origins and encounter fractions cannot be reconstructed. This is exact
**contact response replay**, not a claimed full-game or full-emitter replay.

## Root correction

The browser's chronological contact-admission rule already rejects opposed
encounters in one local plane neighborhood, before sampled rows are grouped by
normal and again while merging full-tick chord contacts. Its plane qualifier
previously required nearly exact coplanarity. A shallow connected mesh seam
therefore bypassed both protections and could feed mutually contradictory
positive demands to the unchanged native-informed normal solver.

`world-contact-admission.ts` now also recognizes a shallow shared-edge patch:

- Both source surfaces are static and belong to the same known source actor.
- Two distinct vertices match within1e-6 and form a nonzero shared edge.
- Source normals differ by at most5°, allowing winding reversal.
- Third vertices lie on opposite sides of the shared edge; overlapping
  triangle interiors do not qualify.
- Existing response-normal dot `< -.95` and OLD-point distance² `< .0045`
  conditions, or matching hull vertex, still determine a local conflict.

Five degrees is an explicit conservative **browser trajectory policy**, not an
original C2 constant. The original coplanar behavior remains intact. Unknown
actor identity, separate actors, single-vertex adjacency, narrow parallel gaps,
sharp corners, larger creases, dynamic owners and separated levers do not gain
this additional equivalence. Contact and source normals have separate roles.

The predicate is shared by sampled admission **and** chord/sample merging.
Patching only the first stage fixed one fixture but left nearby phases with
28–34times energy when merge reintroduced a conflicting chord row. Fractions
from the two trajectory domains are still not compared. Safe-prefix motion
commitment continues to see all crossings.

No normal RHS, impulse solver, friction coefficient, damage multiplier, velocity
cap, simulation timestep or vehicle-specific branch changed. This corrects
which browser-generated encounters may be solved together, rather than masking
the result with a generic energy clamp or suppressing world collision.

## Frozen redistributable regressions

The regression fixture is an independently generated box and two finite
triangles with a1.33° shared diagonal. It contains no original geometry,
captured proprietary fixture or hardcoded car/track identity.

Before the engine change,16 tests had9 passes and7 expected failures: three
missing admission cases and four real-emitter energy explosions. The four
normal-only energy ratios were58.49,34.37,31.18 and28.27. The frozen tests now
pass unchanged, requiring at most1.05times initial energy (allowing native bias),
finite nonnegative impulses, meaningful collision response and bounded load
relative to the native-only control. The first corrected ratio is approximately
`.72346`. Edge/vertex and edge/edge rows without vertex metadata are covered.
All nine independent-constraint controls already passed and remain passing.

Frozen SHA256:

- `tests/shallow-seam-contact.test.mjs`:
  `7d77d52342e6a280f8051314a5e03960820d8d956b1ff7fbfb2d489942b82213`
- `tests/support/shallow-seam-fixture.mjs`:
  `26015c6a7b29aad8d42683d79e711ee47a3ca70a621be081e0d926313cb6b1cf`

Existing14 runaway-contact regressions also pass. See
[the earlier solver/admission correction](runaway-contact-root-cause.md) for
native RHS evidence and the distinction between solver failures and incompatible
browser-generated contact geometry.

## Original-world before/after comparison

A separate Chromium tab loaded the original TIMBER world. The bounded
`tools/ped14-original-probe.mjs` receives local captured kinematics/properties
as caller data, then runs actual chord, sampled and merged collectors plus
normal response on a private unregistered body. ACT pulls and GROOVE stops
are counted and suppressed; neither occurred in this case. It does not advance
the application's simulation, damage callbacks or gameplay roster.

Building the same probe with only the old admission module substituted produces
the historical first-burst five-row packet and217.764678 impulse. The fixed
module emits three rows instead. The earlier bounded response is unchanged.

| Original-world stage       | Old merged rows / energy ratio | Fixed merged rows / energy ratio | Largest old / fixed impulse |
| -------------------------- | ------------------------------ | -------------------------------- | --------------------------- |
| First bounded response     | 3 / .995102                    | 3 / .995102                      | .001510 / .001510           |
| First destructive response | 5 / 1647.436279                | 3 / .903695                      | 217.764678 / .002541        |

The baseline identifies four sampled rows and one chord row in the destructive
packet; the fixed sampled admission retains two. Geometric point/normal
matches establish the recorded emitter-level case, while preparation indices
and human-readable actor/model labels belong to their respective load. The
historical candidate poses and world queues are not fully recorded, so this
remains a bounded contact reconstruction, not a restored whole race.

The probe source embeds no captured state or original geometry. To bundle it
for a local diagnostic session:

```sh
node_modules/.bin/esbuild tools/ped14-original-probe.mjs --bundle --format=esm --outfile=dist/ped14-original-probe.js
```

Call exported `runPed14OriginalProbe(window.carma.collision, payload)` in a
separate paused tab. The payload supplies `body` bounds, old position/quaternion,
properties and1–4 `stages` with incoming velocity/angular velocity and optional
expected contacts. Reports contain original-derived geometry and belong only
in ignored local artifacts. A later production build clears temporary files.

## Preserved scene, performance and limits

After retaining the original capture, the tested simulation methods owning
sample admission and merge were installed into the paused live simulation.
Existing state/providers and native fast-path identities were retained. All
three call sites (`step`, `computeAdvanceWorldContacts`, `sweepWorldTrajectory`)
must come from the corrected module: an earlier partial diagnostic replacement
left the old sweep's lexical helper binding alive and reproduced the same wedge.
That failed diagnostic was not treated as evidence against the source fix.

The already invalid body's position/orientation and velocity/omega were restored
from its last ordinary pre-runaway kinematics. HP remained0 and removed/vanished
masks remained0; no pedestrian was revived, vehicle repaired, race reloaded or
other body reset. After the complete update the body stayed at ordinary speeds
(~.59–.90); no new errors or WebGL errors occurred. No active pedestrian above
10native units/sec remained in the subsequent inspection.

This removes the measured seconds-long failure, but does **not** establish good
steady-state performance. A short hardware capture of the preserved crash scene
still recorded median50.8ms/p95209.8ms over25 frames; a later uninstrumented
1.273second continuation produced19 game frames, median66.6ms/p95100.1ms with
55 participating bodies. Physics remains dominant. These are evolving,
mixed-module live-state measurements after kinematic repair, not a controlled
whole-build FPS A/B. They must not be advertised as a general performance win.
The remaining crowded-scene throughput is separately **PERF-26/TASK-141**, P1
in `next`, starting with complete-production-build profiling.

Hardware: ANGLE AMD Radeon/radeonsi gfx1150, OpenGL4.6,3792×1948 drawing buffer,
DPR1.484375 and4×MSAA. GPU samples after recovery were around2ms per frame;
resolution and rendering were not the source of the original multi-second stall.
The game remains paused for the user's next playtest.

## Final validation

- Frozen16-case regression: initially9 pass/7 fail; all16 pass unchanged after
  the engine correction. Two additional review controls distinguish a true
  shared-edge narrow slot from a reversed-winding continuous seam; both pass.
- Existing14 runaway-contact conformance cases pass. The complete original-data
  suite records3,795 passes,6 optional skips and0 failures; the two additional
  review controls were run separately afterward.
- Asset-free CI:3,294 pass,439 original-dependent skips; the sole failure is
  the already tracked intermittent Vite HMR shutdown timeout (QUA-15/TASK-138).
  No collision/regression assertion failed; no timeout was increased or hidden.
- Production build/TypeScript passes after integration.
- Existing original Stock/Advanced pedestrian PHIL contact/sever/scope tests and
  both original car-contact reaction browser cases pass without reported
  console, network or WebGL failures.
- Hardware DevTools verifies the original-world before/after contact packet
  and the preserved scene's recovery. New browser exceptions and WebGL errors
  were absent during the bounded recovered continuations. An initial probe
  bundle build failed under sandbox process restrictions and caused one missing
  diagnostic-module request; it was a tool setup failure, not a game exception.

Full compatibility with every larger crease or arbitrary previously corrupted
velocity is not claimed. PERF-24 retains broader runaway workload/lifecycle
scope; PERF-26 records the concrete remaining steady-state performance issue.

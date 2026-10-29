# C2 physics reconstruction

## Executive Summary

The ordinary stock-car path has source-based motion, contact, persistent WAM crush, component damage, structural bending/splitting, and detachable parts, with numerical and prior Chromium validation. Water, oil, moving platforms, world destruction, noncars, and mines now have integrated source-based paths and headless coverage; these paths now have Chromium regression. Original binaries, decompiler databases and disassembly stay outside Git.

## Evidence and binary revisions

PHY-16 corrects the extra guard's prior-recovery prerequisite: that flag selects
the native contact emitter, while ordinary CCD also handles OLD overlap.
[Fresh binary evidence and full-world before/after reproduction](shallow-contact-recovery.md)
document the shallow bumper contact that stalled a coupled Timber pile.

| Binary        | SHA-256                                                            | PE metadata                                                           |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| carma2_HW.exe | `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c` | PE32 i386, base 0x400000, entry RVA 0x177eb0, 1998-10-18 18:13:36 UTC |
| carma2_SW.exe | `15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d` | PE32 i386, base 0x400000, entry RVA 0x172ef0, 1998-10-18 19:16:25 UTC |
| carma2.exe    | `52158e3b39601c9189c0f8256758628f99ae07708c9a83d3349613b414dc6cbf` | Small launcher, not the gameplay target                               |

HW and SW have .text/.rdata/.data sections. SW additionally imports DDRAW. Same-RVA byte comparison is weak because code is shifted; instruction-flow matching identifies shared gameplay functions. The rec2 target HW hash is a different revision (`9b896c2cbb170c01b3e9f904ce5e1808db29fe5b51184a5d55a6d19b1799b58d`). Never apply its addresses directly to this installation. Addresses below are absolute VA; subtract 0x400000 for RVA.

References: [rec2](https://github.com/madebr/rec2), [Dethrace](https://github.com/dethrace-labs/dethrace). Reconstruction source is consulted as evidence, not copied into the MIT engine. C1 behavior is a hint until verified for C2. Ghidra 12.1.4 is checksum-verified and runs under /tmp with installed Java 21; `tools/re` contains our own export helpers, not proprietary output.

## Runtime audit of baseline 77daf1a

Chromium DevTools confirmed original New City/Eagle loading and rendering. Controlled wall crashes at 4 and 10 world units/s, an oblique 10-unit/s crash, and head-on/side-on original-car crashes were run using normal frame updates and driving input.

- Vehicle state has only position, linear velocity, scalar heading/speed/health. No mass/inertia/COM, angular velocity, suspension displacement, gears, or component damage participate in collisions.
- Walls use a horizontal swept sphere; normal velocity is multiplied by a hard-coded 1.12 impulse. No contact point or torque is computed.
- Car contacts use fixed center distance 0.48 and symmetric velocity changes regardless of mass; health loss differs arbitrarily between player and opponent.
- All three wall tests retain exactly the initial heading; no crash rotation exists. Head-on car crash has no angular state and immediately wastes the opponent.
- Dents use incoming velocity as a guessed normal and a guessed impact position. Arbitrary growing radius, squared radial attenuation, and maximum displacement replace C2's crush algorithm. Geometry changes have no effect on collision shape. No parts detach, including WAM-declared detach parts.
- Suspension is static, grounded motion snaps vertical velocity to zero, and overall health arbitrarily reduces acceleration.
- Existing tests validate the approximation, not C2 conformance; those assertions must be replaced as the solver changes.
- Baseline rendering defects discarded DAT smoothing masks and replaced null face materials with gray. Both are corrected; screenshots remain local /tmp artifacts.

## Current function map

| Subsystem        | Local HW VA | Local SW VA / rec2 symbol                | Evidence and behavior                                                                                                                                                              |
| ---------------- | ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick             | 0x4b63d0    | SW 0x4b2330; PHILDoPhysics rec2 0x4b6630 | Verified shared flow; 40 ms tick, maximum five catch-up steps, 30 local retries; three normal-solver failure reports (not three successful impacts); pre, integrate, collide, post |
| Collision        | 0x4ba450    | SW 0x4b63b0; DoCollisions rec2 0x4ba6b0  | Verified prologue/flow; rec2 stub; contact group solver and friction                                                                                                               |
| Contact matrix   | 0x4bf230    | rec2 collision core stub                 | Normal effective inverse mass includes both lever-arm/inertia terms                                                                                                                |
| Contact RHS      | 0x4bac60    | —                                        | Impact group if any closing >0.01; RHS 0.01+1.001\*max(closing,0). Rest group uses start/predicted transform drift times 25                                                        |
| Normal apply     | 0x4b7700    | —                                        | Delta v = impulse / mass; delta omega = inverse inertia times r cross impulse; local diagonal inertia, rotation-lock flag 0x800                                                    |
| Friction         | 0x4c0870    | —                                        | Pair cap 0.35*normalImpulse*(1+objectFrictionA)\*(1+objectFrictionB); world cap includes face friction and 1+worldFriction                                                         |
| Impact callback  | 0x41c1d0    | SW 0x41c1f0; ProcessForcesCallback       | Crush/smash/damage callback before normal application; not the wheel-force integrator                                                                                              |
| Car frame        | 0x4168e0    | not reconstructed in rec2                | Ordinary motion calls controls 0x415320 and wheel forces 0x418870                                                                                                                  |
| Wheel forces     | 0x418870    | rec2 unfinished                          | Verified ordinary road load/friction equations, metric/model conversions, drivetrain and fault episodes; implemented                                                               |
| Crush queue      | 0x42d350    | QueueCarCrush                            | Impulse magnitude times car softness; reject <=0.06, queue cap10, max4 contact points/events                                                                                       |
| Crush            | 0x436340    | CrushCar rec2 0x4363f0                   | rec2 stub; calls actor callback0x431d70 and vertex deformation0x432ad0                                                                                                             |
| Vertex region    | 0x42b410    | CrushLimitNumber                         | Original packs MIN in low2/MAX in high2 bits per axis; rec2 has swapped bits and invalid initialization discrepancy                                                                |
| Detached setup   | 0x433640    | SetUpDetachedBitObject                   | Inherits parent velocity plus omega cross COM offset, transformed consistently; original part mass and box inertia, no random launch kick                                          |
| Component damage | 0x43f820    | DoDamage rec20x43f930                    | Ignore increments<5; twelve units capped99; increment<10 crossing99 is rejected                                                                                                    |

## Data and equations established

`ReadMechanics` establishes original root COM, mass, inertia dimensions, wheel geometry, suspension give/damping/slip, friction angles, traction multiplier, rolling resistance, collision shapes and transmission scalars. Diagonal inertia is mass times the sum of the other two squared authored dimensions /12. `src/mechanics.ts` preserves all these inputs; original geometry is not modified.

`GetDamageProgram` establishes six impact programs (top, bottom, left, right, front, rear). Strict comparisons address normalized body coordinates, and all matching clauses execute. Twelve units are engine, transmission, driver, steering, four brakes and four wheels. `src/damage-program.ts` parses their authored weakness factors.

GENERAL crush constants verified in original data/binary: radius squared0.01, minimum force0.06, maximum applied force0.5, force-to-movement1.5, distortion0.0135, detachment baseline0.1, maximum detach time5000ms. For current vertex p, weight is 1-sqrt(distanceSquared/contactRadiusSquared), clipped at zero. Movement is weight*partSoftness*min(queuedForce,0.5)/contactCount\*1.5 along the local direction, subject to dominant-axis region eligibility and WAM planes. Original-position falloff, squared weight and arbitrary cumulative displacement caps are incorrect. Root collision hull treatment differs from visual vertices and must be preserved.

## Status and open evidence

PERF-24 now has a [procedural contact-energy reproduction and original numerical
oracle](runaway-contact-root-cause.md): browser-added angular contacts can oppose
native chord contacts, and the Gaussian fallback lacks native RQ dependence /
failure handling. The original unsigned impact RHS is verified and should not
be replaced casually. The new research tools are separate from the game runtime;
this is an established mechanism awaiting a production correction, not a claim
that the captured FAIR event has been fully replayed.

The mechanics/damage parsers and crush/contact kernels run through `src/physics/simulation.ts` at 40 ms, with source mechanics and three-dimensional COM/angular state. Water, oil, moving-platform, noncar, world-smash, and mine paths are integrated with headless coverage. Original-asset Chromium regression now checks mine damage/repair, oil, water, lift travel and localized world destruction; parser or math tests alone are not treated as runtime acceptance.

## Integrated evidence

The runtime reads original four-wheel mechanics, six damage programs and WAM actor records. Mass, COM, source diagonal inertia, suspension give/damping, traction angles, rolling resistance, gears/redline/torque and per-material road coefficients feed the simulation. Separate rendering and collision-shape crush paths follow C2: WAM104 intentionally preserves shapes; ordinary root-shape crush suppresses X and positive Y, retains wheel envelope stops, and chooses nearest linked model softness. Mesh dents do not define the physical hull.

Original callback `0x41ded0` receives grouped normal impulses directly in model units, with **no 6.9 multiplication**. Its base factor is .2; human visual crush receives an additional .5 and opponent visual crush1.5. Authored car softness, skill, armor/offense and protection have distinct roles. Easy stock initial armor/offense levels are1. Components use the lambda-weighted impact point, while crush uses the deduplicated contact primitive. Human engine/transmission/driver99 or all four wheels99 trigger wasting and the source ten-second race-end countdown.

Original detachment accumulates capped force times maximum vertex influence before softness/region eligibility. Types distinguish jointed and free parts. Normal scheduling spaces entries by1000ms; full detachment limit24 percar, semi limit3 percar and32 joints globally. Child linear velocity inherits parent COM velocity plus omega cross center offset, with no launch kick. Ordinary joints select an authored part vertex using part/car-boundary geometry (`0x42baf0`), not a guessed dent center. Ball anchors and angular planes participate in the same contact inverse-mass matrix. Original quick-hinge hidden-row projection is performed before candidate transforms. Its coupled normal response is implemented through the algebraically equivalent full five-row system; an independently constructed three-hidden/two-explicit Schur complement agrees numerically within1e-8. Source conflicting quick hinges downgrade; source free friction remains unprojected.

Rotation `0x4c1990/0x4c1cc0` transports angular momentum through local diagonal inertia, rotates about COM, quantizes BRender angle units and uses original angle-dependent midpoint substeps. The renderer shows full body orientation and original suspension lengths, wheel RPM/spin and damage tilt; damage offsets feed the tyre solver. Steering/transmission fault episodes use original damage thresholds, probabilities and durations.

Incremental repair `0x43abd0` restores each coordinate by at most `.00005*dtMilliseconds`. Component repair is proportional to repaired/remaining L1 deflection; stock Easy price10 credits per component level, rounded down in tens. Repair happens before billing; source spending clamps credits atzero. Wasted cars cannot hold-repair. Full powerup repair restores model/shape/component/attachment/material state.

Chromium validation: Eagle settles at its original floor origin, four source wheel loads sum to mass\*10, throttle uses reconstructed gears. Head-on wall crashes stop with localized persistent deformation and queued body parts; an oblique wall crash produces substantial yaw, retained tangential motion and region damage. Screenshots and proprietary analysis remain under `/tmp`/ignored artifacts. Browser execution alone does not establish completion.

Integrated corrections include original float-stored pair contact ties, attached plastic flap motion, bending/splitting, world and pair recovery, safe hull swaps and complete body-level contact selection. Quick-hinge preprocessing is verified and integrated; original convex-hull topology ordering is directly verified against the binary for all59 stock shapes. Water and oil source formulas have stock tests and prior MCP checks. Moving-platform contact uses relative-frame finite-triangle sweeps, but exact native platform callback behavior is not established. Original car-pair candidate-only SAT was rejected by a deterministic Eagle test: it chose a top-face normal after overlap and let cars pass through. The replacement uses independently derived original moving-feature CCD with separate old-frame levers for both cars.

A verified rendering error discarded DAT smoothing masks. `src/render-geometry.ts` now supports corner normals with mask-controlled adjacency and preserves authored vertex IDs for WAM/joint/crush mapping. `content.ts` consumes it; deformed normals follow the same masks. Additional unused DAT LOD models are loaded but are not rendered unless referenced by ACT actors.

## Further verified local functions and integration

All addresses here refer to the SHA-identified installed HW binary, not rec2's revision. `rec2` provides symbol/structure maps; decompilation supplies missing algorithms. No decompiled source text or proprietary fixtures are included.

| Local HW VA                                                | Subsystem / inputs and outputs                                                                                                               | Evidence, implementation, confidence                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x415320`, `0x418870`                                     | Controls, gear/RPM/torque, four source wheel positions, spring/damper loads, axle traction/slip and road coefficients → linear/angular force | Verified ordinary-road branches; `motion.ts`. Model coordinates×6.9 are force/metric positions; torque conversions preserve model inertia. No generic μN tyre solver.                                                                                                                         |
| `0x4277c0`, `0x427f20`                                     | Prior overlap flag, old convex edges/planes and point velocities → type6 pair recovery                                                       | Verified; `geometry.ts`. Geometric overlap alone sets recovery; impulses require positive closing and source center-facing normal gate. No SAT MTV substitute.                                                                                                                                |
| `0x422800`, `0x4235f0`                                     | Independent world recovery flag, old edges, finite track triangles → suppressed vertices and type1 contacts                                  | Verified; ordinary cars initialize world flag false; split halves initialize true. Whole-body four-contact cap, `.95` prefix normal gate; COPLANAR flags and float fractions preserved.                                                                                                       |
| `0x41fe70`, `0x428fc0`, `0x428d10`                         | Pending hull, old COM, world/body obstruction → placement normal                                                                             | Verified; COM-star world sweeps and expanded `.005` body clipping, with source summed-normal escape direction.                                                                                                                                                                                |
| `0x434910`                                                 | Pending shape flags/geometry and optional pending COM → accepted hull or previous active shape                                               | Verified; ordinary crush contracts against current hull and WAM bounds; repair/bend probes ten placements with `.007246377` starting step and source doubling rule, rolls position back on failure and retains pending flags.                                                                 |
| `0x431d70`, `0x432ad0`, `0x436340`                         | Current vertices, authored stop planes, contact primitive, softness and queued force → permanent local bodywork                              | Verified; fixed radius squared `.01`, force range `.06`..`.5`, movement1.5, accumulated dents; distinct physical-root versus visual-model branches.                                                                                                                                           |
| `0x433bc0`                                                 | Impact vector/contact and WAM bendability/pivots → quantized two-ended bend                                                                  | Verified; structural transforms bend body, collision shapes, COM and six wheel GROOVEs; front yaw feeds `.03` curvature per degree. No recomputed mass/inertia.                                                                                                                               |
| `0x430d80`, `0x430730`                                     | Solved world-edge impulses, first two nearby world triangles, WAM snap/driver/bounds → eligible XZ cut                                       | Verified; source angle, proximity, quantization and driver-facing gates; no invented speed threshold.                                                                                                                                                                                         |
| `0x42df20`, `0x4ba2f0`, `0x42e230`                         | All XZ attempts, then roof contact groups, source cut plane → two independently colliding halves                                             | Verified; roof requires every qualifying point above authored cut and strict summed force threshold. Mass/COM/inertia partition, pre-impact point velocity inheritance, old solve invalidation and same-tick recollection (30-pass guard). Child joints transfer by parent-anchor plane sign. |
| `0x42d730`, `0x433640`, `0x438850`                         | WAM part accumulated force/ease/type, global queue and joint state → queued/jointed/free object                                              | Verified; global16 queue and1000ms spacing; per-car semi3/free24, global32 joints. Quarter-width child COM shift, density-volume mass, source box inertia, inherited linear/angular velocity. Ordinary timeout requires source geometric predicate; no particle-only detachment.              |
| `0x431260`                                                 | Solved type11 angular LIMIT, KEV hinge axis and child mass → torn joint/restart                                                              | Verified; strict lambda>mass×GENERAL2, negative child-local coefficient dot hinge axis. Splitting precedes tearing; bilateral hinge constraints cannot trigger it.                                                                                                                            |
| `0x43f820`, `0x43f620`                                     | Source normalized impact position/energy, all matching six-side damage clauses → twelve capped units and persistent wasting                  | Verified; human probability/NPC randomness, increment<5 ignore and crossing99 rule; driver protection, functional component fault episodes. Once-knackered survives a late repair; human acceleration/reverse disabled, suspension still runs; ten-second race countdown persists.            |
| `0x43abd0`, `0x43b400`, `0x43b630`, `0x439460`, `0x439910` | Held/full repair → repaired bodywork/shape, parts, levels and source bill                                                                    | Verified; each visual coordinate `.00005*dtMs` toward compressed U16[-10,+10] target; collision shape snapshots are exact Float32. Proportional component repair and skill fee, rounded tens. Full repair restores halves/parts but not persistent knackered race state.                      |

## Browser and numerical conformance evidence

Chromium through Chrome DevTools MCP has driven original New City cars into broad walls head-on and obliquely, car-car head-on and side-on, and the original building wedge at x51.307678/z32.224792. The wedge splits Eagle into physical halves of masses `.749865703582701` and `.750134296417299` from original mass1.5, with their own velocities/hulls; pre-split rows are disabled before recollection. A wall bumper becomes a jointed object, repeated dents persist, and held repair restores bodywork and reattaches parts. Ordinary pair contacts exchange momentum and off-center impacts rotate cars.

Original buggy mass1.150008, Eagle1.5 and dumper35.282787 drive separate inertia, spring, contact response and damage/crush behavior. Numerical tests verify source mass-ratio velocity exchange and momentum, off-center torque/inertia, force-scaled regional component damage, multiple speeds, repeated/localized crush, thresholds, XZ and authored roof cuts, zero-snappability rejection, repair and split teardown. All52 stock mechanics/shape pipelines parse (59 poly shapes; no stock sphere/wire root shapes).

Production browser regression drives real track gates to completion, loads stock Quarry and Advanced Acid Reign, preserves controls/audio/opponents/pedestrians, checks geometry, and reports no fatal console errors or failed requests. MCP screenshots inspect actual original geometry, damage and materials, with WebGL `getError()==0`. The MCP GUI instance hung in this environment; an isolated headless Chromium instance uses the installed Chrome DevTools MCP server and software WebGL for these checks. This establishes software-rendered Chromium behavior, not physical GPU performance.

Rendering fixes preserve original DAT smoothing/vertex IDs and correct null material slots to BRender's inherited/default material; named face groups retain their materials. Track roots now supply the native palette-227 default-track descriptor. Camera framing follows each authored car's bounds to avoid clipping inside large vehicles. Remaining full-game limits include analytic sphere/wire dispatch, campaign/mission/AI fidelity and unsupported effects. Newer world and mine integration also has production Chromium and MCP checks, described below.

The production finite world collector now executes prepared MODEL/ACT ordering,
interleaved GROOVE stop/pull notifications, current geometry ownership and the
separate first-50 PHIL drivable wheel phase. Mutable smashed/replaced tables keep
original DAT provenance and invalidate prepared revisions without changing other
instances. See [production collector evidence](c2-wld-production-collector-re.md).
Original MAT coefficients, directional Gouraud/rational specular, local fog and
race-scoped global resource lifetime now reach the actual WebGL shader; see
[material rendering evidence](c2-native-material-render-re.md). Native death
counting also reaches actual population/group/mission counters before scoring;
full native population movement and articulated-body integration remain separate
PED-06 through PED-09 work.

Detached receivers intentionally remain rigid after detachment: `0x41df24` rejects driver≤5 before crush/component processing. Semi driver1 and free driver2 have their own physical boxes/joints; subsequent dents are not forwarded to the owner. A car hit by a piece still gets the source armor/protection branch while skipping attacker offense/softness and world inactivity factors. `0x440550` follows saved owner attribution only for free drivers2/3/4 and excludes self-owned hits. BOX setup `0x43372f` preserves exact bounds, including the original planar Ford pickup plate; `box-hull.ts` supports its zero-width box without invented thickness. A read-only52-car audit checked256 eligible parts, including all authored hinge/poly indices.

Repair coordination preserves source shell-model guard and principal-LOD early completion. It waits for an expanding hull to be accepted before the next bodywork step, supports1200ms double-tap auto repair, and blocks recovery after wasting. Clean held-repair cleanup clears the global detach queue, preserving force histories/timestamp, while full repair cancels only the repaired car's entries. Split teardown reunites private geometry before disposal so reloading does not leak either half.

`ConvexHull3D` (`0x420fd0`; seed `0x421210`, growth `0x4217b0`) is independently implemented, including observable float32/x87 spill boundaries. A temporary32-bit read-only Linux probe directly called only the original hull function: all59 stock vertex/edge orders and face counts match, with maximum plane coefficient difference5.96e-8. The original logmachine nearly-flat-seed quirk is preserved. General hull storage retains authored indexing for model references; initial physical car polygons are separately compacted before positional crush metadata is built. Bounds and feature sweeps visit compact points only. Artificial malformed interior seeds are rejected rather than reproducing uninitialized original scratch data. The browser never invokes the original executable.

PHY-11 browser robustness extension (2026-10-26): a deterministic six-point, full-volume input reproduces undefined near-coplanar horizon incidence beyond the earlier exact-collinear precision correction. Only failed topology uses actual stored-point QuickHull recovery, with authored IDs, merged coplanar surface facets and closed-surface/containment validation. Successful native stock/bent paths remain unchanged. The old Porker2 chronology was not captured; see [hull recovery evidence and validation](native-hull-re.md).

## Damage pickups and suspension state

Verified timed handlers: invulnerability `0x4dc630/0x4dc660` sets both crush and component immunity; free repairs `0x4dc6a0/0x4dc6e0` skips billing without skipping repair; damage magnifier `0x4dcd90/0x4de580` multiplies human-attacker damage; granite `0x4de9c0/0x4dea00` divides human-receiver damage/crush by the authored protection factor, without changing offline physical mass/inertia. Cancellation invokes reset handlers. Due detachment reservations are consumed while immune (`0x436a20`, `0x436cb0`, `0x4332a0`), preserving accumulated force; existing joints/flaps continue simulating and releasing. Instant repair's `0x439ae0` guard is a race-entry deadline, not a pending-hull flag.

APO handlers `0x4dc030`, `0x4dc1e0`, `0x4dc2d0` use three original integer parameters. A single full type tries both neighboring types in one randomly selected direction; all-type requests never redirect. Negative level gains fill available slots. Slot gains clamp to GENERAL maxima. Entirely unchanged requests receive the distinct GENERAL level/slot substitution award. These pickups feed the existing armour, engine power and offense factors.

BendWheels `0x435260`, UnBendWheels `0x43a970` and full repair `0x439460` reset suspension via `0x41fc80`. Axle stiffness/damping derive from current mass and wheel-Z/COM-Z ratio and authored give/damping. Temporary modifiers are setter events; reapplying them every frame would incorrectly undo a bend/repair reset. Splitting `0x42e230` preserves stiffness/damping/height and resets old wheel lengths to ride height. Friction-angle normalization remains unchanged. Auxiliary `bb2.minY` includes wheel ray length but is not physical chassis geometry. The shared persistent 300-face cache now uses this extended box before wheel forces and during body contact collection; see [face-cache evidence](c2-world-face-cache-re.md). Analytical and integrated original-car regressions cover these state changes.

## Final ordinary-motion branches and validation

Crest downforce (`0x419c6a`..`0x419e5d`) preserves the previous grounded count and a latch: four prior contacts plus two currently extended front wheels trigger a front-center, actor-Y wheelbase support probe. Missing support latches the COM-dependent downforce reduction and pitch moment; front recontact clears it. Split clears the prior grounded count.

The stop timer at `0x677c98` is BSS-initialized to zero and shared process-wide, surviving car/race loads. `0x41bbae`..`0x41bc32` advances it once per actual WheelForces invocation, including failed stationary gates; skipped XZ-split motion does not advance it. Strict thresholds, the100 sentinel, bounce rejection and float32 accumulation are preserved.

Material bumpiness (`0x418f8e`..`0x419068`) changes wheel travel before suspension/damage tests. It samples metric wheel position **plus** normal×raw ray distance, folds signed/truncated512 phases at2048/1024, folds the sum again, subtracts400 and clips atzero. Distance offset is delta×authored bumpiness×2.358490564802196e-5×localNormalY. Source float spills are retained. Dedicated numerical tests cover crest force/torque/latching, the shared timer and spatial bump/suspension effects.

Earlier ordinary-motion verification included a production build, Chromium stock/Advanced driving and race regression, and a read-only stock robustness sweep of312 impact/repair cases across52 cars (120 bends). Native hull comparisons cover59 stock shapes plus bent Eagle/Buggy hulls. Coplanar dangling edges and planes without auxiliary polygons remain collision features, matching the executable rather than imposing an additional manifold-mesh requirement. The separate15-scenario report records physical/damage/deformation/part state. Original executable hashes are unchanged, and no original bytes are tracked in Git.

Prior MCP checks validate keyboard driving, ordinary wall/car contacts, physical body splitting and thrown/jointed pieces, repair, multiple stock masses, water/oil and damage-powerup collection. Invulnerability blocks crush/components; granite protection50 leaves mass unchanged; magnifier5 feeds attacker scaling; free repair restores engine damage30→0 without spending; APO collection updates original factors. The newer production and MCP regression described below separately verifies world, platform, noncar and mine integration. Campaign, AI, animation and remaining effects retain the full-game limits documented separately.

## Runtime bug audit, 2026-10-08

- **Render cadence:** the simulation remains at40ms, but raw poses previously repeated between ticks. `render-pose.ts` now interpolates the two committed poses, including camera targets and detached bodies. Reset epochs prevent interpolation across recovery. Render transforms are restored before subsequent simulation. Actual MCP sampling at48fps recorded46 repeated physics poses in90 frames and zero repeated rendered poses.
- **False texture holes:** original D3D `SetupD3DBuffer` treats RGB565 as unblended; `LoadTiffTexture_16BitRGB` distinguishes RGB from RGBA. Fabricated transparency on black RGB565/TIFF texels was removed. Eagle `ewheel6` had664 incorrectly transparent black texels of1024; New City `block5w2` and `tower3w` had78 and69. Real RGBA4444 tree/fence cutouts remain transparent. `BR_MATF_ALWAYS_VISIBLE` also disables face culling, as in BRender `PrepareMaterial`.
- **Post-impact tunnelling:** a finite road/wall test previously lost the Eagle below the road bytick62 after wall-induced pitch. Its lowest hull point now remains above0.00920 through150ticks. Five crash/fall/rotation scenarios, including120rad/s pitch, test persistent crush and source parts. A separate obstructed-joint test prevents anchor projection from teleporting a piece through terrain. Leaving a genuinely finite map still permits falling. The new post-impulse/angular/projection sweeps and bounded conservative movement fallback are an **independent browser integration safety extension**, not an assertion of exact original timestep orchestration. They reuse the reconstructed finite-feature/contact/damage paths without inventing an infinite floor or replacing crush with a rigid solver.
- **Pickups:** stale engine/grip timers no longer cancel renewed effects; swept pickup order follows encounter order. Random pickups use the original weighted table; unsupported outcomes are explicitly notified. Freeze-timer action8 is implemented. Installed handler table0x65d480 maps credits0x4dbf60, time0x4dc270 and random0x4de5a0 to the inclusive15-bit integer sampler0x512f00. Credits truncate to hundreds. Actions12/30 dispatch to model-crush and mine-hit paths; actions34/35 own negative-initial-value charge inventories. The supported action set reduces New City warnings to27 definitions. Earlier MCP collection confirms random selection and engine8/grip1.5 from the original nitrous definition.
- **Scale:** original Eagle ACT root/children have unit scale. Transformed DAT extents are0.3834×0.2530×0.8068 game units, or2.645×1.746×5.567m using source `WORLD_SCALE=6.9`. Car and world ACT/DAT transforms are applied without a car-specific scale adjustment. Its unusual width is authored data, not a conversion mismatch.

Earlier validation for these fixes included automated original-data transparency and finite-road crash regressions. The production Chromium regression preserves race completion, stock/Advanced loading, controls, audio, opponents and pedestrians. Actual MCP original-track crash at `(52.3,-0.70,28)` with velocity `(-10,-2,0.5)` remains near road height−0.825 through150ticks, with engine90/transmission27 and a physical detached part; console and WebGL report no fatal errors.

## Newer world and powerup paths

### Terrain contact follow-up (PHY-08)

The installed `MultiRayCheckSingleFace` (`HW 0x45f5d0`, rec2 `0x45f0d0`), called by `WheelForces 0x418870`, permits signed wheel hits. Original plane numerator tolerance is −.001, endpoint slack +.003 with fraction clamped to1, barycentric slack −.0001/1.0001, and segment/normal parallel threshold2^-22. The local executable constants are at0x589050/0x589040/0x589030/0x589038/0x588fe4. The previous generic Three ray lost these slightly penetrated contacts. `wheel-ray.ts` now independently expresses the finite-face equations; only suspension queries use them. The broad phase includes the accepted backwards suspension interval `.5/6.9`; generic camera/oil rays keep forward semantics.

The browser safety guard also discarded the whole40ms tick whenever a single angular sample still found a crossing. A pristine Eagle with10mm lowest-hull clearance and velocity `(1,−.5,0)` consequently received zero movement. Final commitment now bisects the rejected interval and accepts only prefixes whose actual integrated poses pass finite triangle sweeps. Its measured accepted fraction is.32636924, tangent displacement.01305477, and remaining lowest-hull clearance.00347262. Eagle and Monster Beatle regressions cover this without changing source impulse selection or inventing an infinite floor. This refinement is an explicit browser integration extension.

Original Snow Way Out probes also find genuine steep snowbank constraints (normalY≈.26), which throttle alone cannot overcome. Detailed Eagle probes reproduce the reported location with local upY≈−.964: the car is on its roof. Such contacts remain solid. Original Eagle and Monster Beatle tests drive and reverse over finite 15%/30% ramps and regain wheel contacts after crest flight. A zero guard fraction by itself is not proof of an artificial lock.

The former recovery path also projected onto the nearest AI path and retained the stranded heading, sometimes returning directly to the same snowbank. Recovery now uses native safe-pose history. Recording is inlined in installed HW `ControlOurCar 0x414cd0` (SW `0x414ce0`), starting at `0x4150ee`. Twenty complete matrices start at spawn. Sample every5000ms; a rejected save leaves the timer at4000ms. Require strictly compressed four suspensions, tyre friction≥Float32(.1), local upY≥Float32(.8), gravity exactly1, no split/disabled state or dynamic wheel support (`field_0x195c`). Each newest-five distance² must be≥8.401596069335938; there is no speed gate. The browser records its local human car.

Installed `FlipUpCar` is HW `0x4428a0`, SW `0x442980` (rec2 `0x4429b0`). Select history index1 only when four suspensions are compressed and distance² to newest≤8.301596641540527; otherwise0. Restore full rotation/translation, add world-up .28985506296157837 only with clear overhead, and consume selectedIndex+1 entries. Native sensible-placement checking permits ten escape nudges ×.07246376574039459; only failed placement retries older history, at most three attempts. rec2's unconditional three attempts differ from this revision. Restore velocity to savedRotation×(0,0,Float32(−.0002)) in model units/second; reset angular velocity, curvature, gear/RPM and wheel lengths to rideHeight. Attached pieces follow the recovered parent; damage is not repaired. Split-body welding during recovery remains the separate WLD-04 limitation. Six focused source tests cover history cadence/gates/consumption and both original cars; the real R-key browser regression restores Snow Way Out's Monster Beatle and verifies it can reverse away with four grounded wheels.

These systems have headless integration, stock-data coverage, production Chromium regression and independent Chrome DevTools MCP checks.

- Water detection/update follows `0x414930`, `0x4feeb0`, `0x4ff1a0` and `0x4ff360`; source formulas have stock tests and earlier MCP verification. Oil uses reconstructed placement, projection, tire effect and lifetime formulas; stock tests and earlier MCP checks exist.
- Noncar loading follows `0x487d60`. Force, wake, lift and torque paths use `0x418270`, `0x4158b0`, `0x418250` and `0x4bac60`. Activation uses `0x4efa60`, `0x4ed5d0`, `0x4ed890`, `0x4eaef0` and `0x4ec9f0`: thresholds are evaluated per smash row, not summed across a group; the first row caps at type9 and skips ordinary crush. World smash state and activation are integrated headlessly.
- World GROOVE poses preserve actors through batching, and 212 stock blocks parse. Moving-platform contact is expressed in relative coordinates against finite triangles. This does not prove exact native platform callback behavior. Original stop-animation behavior remains tracked by ANI-02.
- Mine actions30 and34 use `0x4de850` and `0x4dd500`; lifecycle functions are InitMine `0x4dd1f0`, LaunchMine `0x4dd390`, contact `0x4dda20`, processing `0x4ddc20`, and explosion `0x4dd8b0`. Mass comes from GENERAL; sphere inertia is `r²M/6`. Analytic mine sphere contact remains approximated by sampled hulls (PHY-05). Action12 performs model/hull spam, forced part detachment and source structural attempts without direct component damage.
- TotallySpam `0x431560` casts ten rays from opposing model faces and uses packed WAM stop records for local cumulative vertex damage. Forced detach applies the initial `8/6.9` kick plus owner motion. Random split `0x435c90` uses model validator `0x430730` without the ordinary world-edge gate. Common damage protection uses the `protection === 1` gate. Direct action30 component damage uses `0x413ce0`; physical mine damage uses `0x43f820`, including the human driver-unit-2 skip and 99 cap. Explosion animation follows the source 5400 effect and GENERAL's original frames and integer periods `trunc(1000/FPS)`; explosions have no radial damage.
- The installed physical-mine component loop has an EBX pool-index bug; the reconstruction intentionally uses the correct mine/component indices. Rendering keeps original mine actors and hierarchies while sleeping props use instance batches. Three stock OILDRUM definitions exceed the native 32-polyvertex limit: the source would fail; the engine reports a warning and retains static fallback behavior.

The fixed source tick is40ms, with up to five catch-up ticks; each contact group permits30 retries and reports at most three impact solves. Rotation uses up to400 source substeps. The browser safety guard currently uses eight passes, `.05` maximum angular increments and up to128 samples, with conservative earlier-fraction/project clipping and body-pair recollection. These are deliberate integration extensions, not claims of exact native timestep behavior.

## Priority-world integration validation

Production Chromium checks original New City mine collection (10→9 charges through F), physical contact at −4 model units/s, persistent local shape changes, component damage, free parts, and full repair. Oil inventory (5→4) produces a projected original PIX texture and source grip for all four sampled wheels. Finite original water gives depth1, gravity.2/viscosity50; underwater ability gives.52/30; recovery onto dry road restores1/1. These paths do not add radial explosion damage.

Carrier1's original `&98l0341.ACT` lift uses mass266.911224, axisY and authored travel9.98. Native four-wheel support wakes its motor. MCP observes lift rise2.0056723 after60 ticks, four grounded wheels and zero component damage, then its upper end stop and pause. The bound is measured from COM: its original COM-Y is−.146371, not actor-origin Y. Thirty-two original turret/barrel GROOVE actors retain hierarchy and nonzero angular velocity. New City's `&20s0358.ACT` wakes on a car impact and moves independently; the Airport door changes only its hit UV tile to `airhut_smash`/passthrough, preserving neighboring solid faces. No fatal console, failed local request or WebGL error was observed. Existing production regression still completes the original checkpoint race and loads stock Quarry/Advanced Acid Reign with opponents, pedestrians and audio.

Two final robustness corrections have source/fixture regressions:

- Installed hull growth `0x4217b0` accepts stock monorail collinear boundary points with undefined second-plane incidence. A bounded retry removes only exact interior segment points during construction, remaps authored vertex IDs and checks all original halfspaces. Original surface/bevels remain; successful59 car feature-order paths are unchanged. All five Airport monorail instances load.
- Native wire type2 uses authored points/lines in world `0x422800`, pair dispatcher `0x425c00`, and edge CCD `0x4286f0`. Point-vs-wire `0x428480` returns without an interior test. Noncar wire hulls therefore have no planes or invented thickness; symmetric wire/world/poly/edge tests validate this. All212 valid stock definitions construct complete bodies.

After every impulse solve the browser guard refreshes predicted poses for every body, including `IGNORE_WORLD_COLLISIONS` props. A stale candidate previously repeated an old pair bounce, generated energy and missed a third object; the regression now checks same-tick third-body contact, momentum, bounded energy, forty independent wake groups and no stationary fake impulse. This guard remains an independently expressed integration safety extension; it is not a claim that eight passes reproduce the native timestep orchestration exactly. Native GROOVE interruption, analytic spheres, custom-car wire/crush integration and remaining smash effect/script connotations stay explicitly open in TODO.

Final validation: `npm test` passes531 tests (zero failures/skips with the local installation); `npm run test:browser` builds the production bundle and passes both original-content suites. The final source preserves executable SHA-256 hashes and tracks no original assets or generated proprietary caches.

## PHY-09 / AI-05: interlocking and unsafe grid placement

Fix date: 2026-10-08. Existing native contact/impulse/crush paths are retained.

| Evidence                                                                                            | Inputs / behavior                                                                                                                                                       | Correction and confidence                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed HW `0x427b56–0x427c67`, RVA `0x27b56–0x27c67`                                             | Collision shape bounds at object+`24..38` are averaged, transformed using object matrix+`8c`, then compared in the other object's frame.                                | **Verified from binary:** recovery uses transformed **local** bounds centers, not centers of world AABBs. Asymmetric rotated stock Eagle reproduces two formerly missing type6 rows.                                                                                                                |
| Installed HW recovery `0x427f20`                                                                    | Old edge clipping, exactly one endpoint inside, center-facing normal, positive closing speed.                                                                           | **Verified earlier and rechecked:** preserved. Complete containment can report overlap without a contact. A generic MTV/penetration impulse would change the specification. Native row suppression compares immediate parents; browser recursive-root suppression is a separate PHY-14 discrepancy. |
| Stock Eagle high-angular oblique crash                                                              | Initially disjoint pair; normal damage enabled, nine contact collections, final committed penetration `0.05652491207` despite solver contacts.                          | **Experimentally reproduced:** eight recollections alone do not guarantee a safe nonlinear final trajectory. New independent pair commit guard reduces it to at most `1e-6` world units. Subsequent ticks separate normally.                                                                        |
| rec2 `car.c::InitialiseCar2`, annotated HW `0x413f70`; installed HW `0x413f90` (wrapper `0x414420`) | Zero linear/angular velocity, copy accepted transforms into old/safe matrices, initialize `oldd` from `ride_height`. Installed stores occur around `0x4140fa–0x414155`. | **Reconstructed by rec2 and matched to binary:** accepted initial pose must seed history and suspension. Browser seeds actual supported wheel distances to avoid a first-tick slope damper kick.                                                                                                    |
| Original wheel anchors, suspension give/length, authored hulls                                      | Four wheel rays and finite original road triangles, local heading and hull geometry.                                                                                    | **Implied by original data, independent safety placement:** slope fit and nearby clear-pose search replace the unsafe single-center-height start. Search is not claimed to reproduce native grid-search ordering.                                                                                   |

`pair-guard.ts` is an integration safety extension outside `resolveContactGroups` and damage processing. It adds no impulse, fictitious damage, replacement boxes or scale change. It samples actual post-solver integrator poses after each body's world fraction is known, verifies solid-hull SAT depth, and checks native feature crossings between angular samples. PHY-13 now admits native-qualified old hull pairs for the captured phase without monotone-depth clipping; initially clear hull pairs and new third-body/world contacts remain guarded. A fresh phase starting clear rearms re-entry protection even with prior-recovery flags still set. See [evidence, policy limits and validation](old-overlap-recovery.md). Tolerance-only/resting/separating feature hits cannot freeze the pair. Total angular travel is bounded from momentum/principal inertia, and regressions include complete turns with identical endpoint quaternions. Sampling remains bounded at 128 intervals: contrived extreme rotations far beyond ordinary post-contact angular limits can still alias that budget. Pose refinement reruns the actual quantized source integrator.

The initial guard shared a trajectory parameter across broadphase-connected movable groups. This could freeze a clear airborne car beside a blocked prop, independently reproduced and corrected in [PHY-12](guard-coupling-fix.md). Attachment groups and actual conflicting trajectories now share a prefix; unequal independent prefixes are revalidated to prevent new third-body crossings. Bounded revalidation falls back conservatively only over the affected allowed broadphase component. Attached children retain their own hinge trajectory; recursive ancestry suppresses internal group-volume checks. Rotation bounds enclose arcs about moving COMs. PERF-14 incorporates native hierarchy anchor placement into the guarded trajectory and removes the later independent projection/second guard. This is conservative integration clipping, not a claim that the eight-pass browser orchestration is the native solver. Plane-less wire shapes retain native feature handling without invented solid thickness. Animated GROOVE actors remain on their existing finite-triangle contact path and are not converted into convex pair bodies.

`spawn.ts` checks all four authored wheel supports, fits pitch/roll while retaining horizontal heading, validates finite world triangles and existing cars/noncars, searches within two world units, and only commits a validated pose. Bridge probes select the supporting layer nearest the original grid rather than the highest unrelated deck. Unsupported/blocked candidates leave state unchanged; a player start reports a useful failure. Opponent loading stages the complete roster and publishes only after every safe pose and PHIL admission succeeds; failure discards the batch and reports unavailable population rather than silently shrinking it. Final reservations use the live player/props after asynchronous loading. See [atomic startup and validation](opponent-startup.md). Moving-world scenery continues to use its existing triangle path rather than a new placement hull approximation.

Headless regressions cover touching/separating/sliding pairs, native-qualified old-overlap admission, conservative nonqualified overlap, next-phase re-entry, clear-endpoint crossings, rotation arcs/full turns, recursive joint roots, different final world fractions, native center recovery, and the ordinary stock crash above. Existing light/heavy momentum tests remain green. Original Eagle, Buggy, Monster Beetle and Bigdump settle on slopes for two simulated seconds without a start kick.

The dedicated production Chromium suite tests DUNE grids with green Eagle, Buggy and Bigdump, and a NEW CITY control. Initial grids check successful complete-population loading, zero measured road/car penetration, four supported wheels and no wasted bodies. A short subsequent AI window checks motion/finite state and records genuine damage-producing collisions; a later valid crash can waste a car without implying unsafe placement. DUNE frontal/oblique crashes produce original damage and permanent geometry revisions, zero measured committed overlap, and actual ArrowDown-key escape. Chrome DevTools independently confirms DUNE ground orientation, live opponents, crash damage and reverse release, with no fatal console errors. `npm run test:spawn-pairs` records screenshots and numerical results under ignored `artifacts/`.

Final fix validation: `npm test` passes 595 tests; `npm run test:browser` builds production and passes all four Chromium suites, including dedicated spawn/pair checks. The existing steering smoke test now holds input for actual simulation time and compares heading change, rather than assuming wall-clock time and an absolute initial yaw. HW/SW executable hashes still match the recorded originals; no original assets or generated caches are tracked.

### Shallow barrier overlap follow-up (PHY-10)

**Experimentally reproduced browser guard defect:** a rolled stock Eagle whose corner already crosses a finite two-sided wedge face by .001 world units can be forbidden from exiting. The ordinary two-sided emitter reports an underside contact, and the additional trajectory guard mistakes this exit for a new entry. A synthetic wedge test uses its actual authored hull, 20-degree roll and velocity `(-.2,0,-1)`. The old guard accepts fraction0 even though the minimum signed distance improves from−.001 to+.000940285.

`recoverShallowWorldContacts` is an **independent browser safety extension**, confined to `sweepWorldTrajectory`. It checks existing solid-hull intersection within the original emitter's .003 endpoint slack, then uses the existing native finite edge rays and COM-facing recovery normals. Suppression is per world face; improving/tangent drift remains free, inward drift keeps a contact, and an independent new wall still blocks. It adds no push, impulse, damage, friction or tyre-force change. Wire/edge-only/passthrough shapes and deep overlaps do not acquire invented recovery. .003 is in world units (about20.7mm at the source scale), not metres.

**Verified binary distinction:** installed HW `0x422800` gates `0x4235f0` on prior object+`ed`; ordinary vertex/edge emissions do not set that flag. Native `worldContacts`, recovery flags and solver formulas remain unchanged. This extension is not claimed as a recovered native bug fix. Original-car tests verify outgoing, tangent and incoming drift, independent wall contacts and actual reverse motion after the shallow wedge clears.

**Actual screenshot-location audit:** SNOW WAY OUT's `chevrnsnow` face14/15 near checkpoint4 is one-sided, with sloping normal approximately `(.44806,.75363,.48092)`. Across1930 non-deepening trajectories, no equivalent false-exit freeze was reproduced there. A rolled upper-side Eagle leaves the original barrier normally; Chromium confirms reverse movement and restored four-wheel support. A lower-side seeded trap behaves identically before/after: final guard fraction1, rear wheel loads/tyre forces0, only front-left support, and ordinary snow contacts. It is resting on the body with its driven rear axle unloaded, rather than movement being rejected by the guard. Do not claim this particular reported trap is cured. Preserve its source traction response and use R recovery; exact original-runtime comparison and other reported wedging configurations remain PHY-10.

Follow-up validation: 609 automated tests pass. The four existing Chromium regression suites and the new actual-event audio suite pass against the production build. DevTools confirms original SNOW barrier exit, the retained unloaded-rear-axle trap and real R-key recovery (four supported wheels,250 credits charged), without fatal console/WebGL errors. Installed HW/SW hashes remain unchanged.

### Custom noncar volume gravity correction

Installed HW NonCarCalcForce `0x418270–0x418863`, specifically
`0x4183c8–0x41840a`, applies `-dt*10*rawVolumeGravity/6.9` (or raw value one
without a volume). This differs from depth-mixed car/generic-body gravity and
contains no global gravity pickup read. The browser previously multiplied this
raw value by immersion depth; that extra factor is removed. Deterministic
actual-simulation tests exercise depth .1/.8 and global gravity 0/.2/4 with
a redistributable noncar fixture. Motor thrust remains independent.
See [motion powerup notes](c2-motion-powerups-re.md) for the separate driver
guard and settling calculation. Evidence: verified from installed binary.

### PERF-13 query implementation and immutable collision generations

The browser now distinguishes mutable DamageSystem shape vertices from published
collision hull generations. Built-in cars/NONCARs opt into frozen source hulls;
accepted crush/repair, split and detachment publish independently built snapshots.
Motion, masks, attachments and custom mutable sources remain fully validated.
Independent depth/fraction queries and scalar moving-edge/clipping arithmetic
remove discarded manifold work and transient allocations, preserving the existing
native-derived numerical outputs. These are implementation optimizations, not
new physics formulas or permission to omit solver/damage callbacks.

Installed HW `DoCollisions` at `0x4ba450` retains local retries through the
`0x4bac60` response path and a conditional global traversal restart. rec2's
incomplete reconstruction does not establish our eight global correction rounds
as native C2 behavior. All existing steps/restarts/guards remain unchanged here.
See [implementation, differential evidence and hardware limits](guard-kernel-performance.md).

## Captured own-debris correction and native retry outcome

Verified from the installed HW executable (hash/PE metadata above); rec2
provides symbol guidance for a different address revision. Static disassembly
stays outside Git. No source code or proprietary instruction dump is copied.

| Installed HW address               | Behavior                                                                                                                                               | Confidence / implementation consequence                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `0x4ba62e`, `0x4ba658`, `0x4ba662` | DoCollisions local retries stop at30; call `0x4c5f90`, a return-only function, then visit the next object. No exhaustion-specific pose/velocity write. | Verified instructions; do not justify damping fast trapped bodies from this limit.                                 |
| `0x4ba637`, `0x4bb869`             | A separate global counter at `0x692734` limits retries at3; increment follows nonzero normal-solver result from `0x4c3900`.                            | Verified control flow; semantic name remains uncertain. This is not returned status3.                              |
| `0x4ba670`, `0x4b951e`             | Global traversal restarts only on list-position update flag `0x69145c`.                                                                                | Verified; our eight nonempty global rounds are not proven original orchestration.                                  |
| `0x4bbe7a`–`0x4bbf13`, `0x4baba2`  | Awake response ring members restore saved transform, integrate literal .04 s, rebuild bounds/callback, then commit actor matrix into body state.       | Verified inspected path; no fractional commitment guard found here, not a statement about all uninspected callees. |
| `0x4bab5c`–`0x4bab83`              | Ordinary quiet gates zero velocity/omega, including speed²<.001 and angular-energy<.00009.                                                             | Verified; independent of retry exhaustion, unsuitable for a fast trapped cluster.                                  |
| `0x42f430`, `0x4c61c0`, `0x4bd900` | Full detachment unlinks parent/sibling and clears joint; collector excludes direct parent pairs but no saved-owner exclusion before pair emitter.      | Verified; released own debris remains eligible for ordinary collision.                                             |
| `0x434860`, `0x4348d5`, `0x4388dd` | Full-release admission uses an authored angular cone dot product >Float32(.707107), followed by elapsed-percentage gate.                               | Verified; admission does not certify hull clearance.                                                               |

The bounded partial captured-body replay now confirms real type6 contact and
joint impulses across eight rounds on only the five-body Cerby cluster. Missing
world/forces/damage state prevents claiming a complete native/browser tick replay.
See `perf13-root-cause-analysis.md` and `tools/replay-captured-corrections.mjs`.
No retry limit, damping, former-owner mask or sampling rule changes are made.

Recovery velocity follow-up: installed `0x4b97dc`–`0x4b981e` transforms world
velocity into solver-local `+0x1a8`; `0x4c19d1`–`0x4c19ee` snapshots local
omega into `+0x1c0` before candidate rotation. Recovery `0x4280d5`–`0x428353`
uses these pre-candidate quantities; normal application restores auxiliary
omega at `0x4bb27a`–`0x4bb292` and updates local/world velocity consistently.
Mathematically `R_old*(V_local + omega_local × (p_local-COM_local))` equals the
browser's `V_world + Omega_world × (p_world-COM_world_old)`.
`advanceRigidBody(..., true)` leaves committed motion untouched, so the ordinary
car/free/ball-jointed Cerby path does not exhibit a demonstrated pre-/post-rotation
velocity mismatch. Native Float32/x87 versus browser double/quaternion rounding
is not claimed bit-identical. Do not substitute predicted/end omega as a cure.

Native detected recovery overlap (`0x427d9c`–`0x427df0`) sets next-tick flag0x200
and replaces ordinary CCD even when no rows emit. Center-facing/closing gates
select contacts, not safe displacement directions. A native-admitted initial
hull-overlap escape policy could therefore address the browser-only monotone
SAT commitment gate, but permitting penetration to increase would change its
safety behavior. This paragraph records the pre-PHY-13 investigation. The native-qualified
phase admission is now implemented, with independent new hull/body/world
checks and next-phase re-entry protection; see [PHY-13](old-overlap-recovery.md).
Within-phase deepening or exit/re-entry of an admitted hull pair is deliberately
allowed, not claimed as continuous interlock prevention.

## Hierarchy-aware candidate movement discrepancy

Verified from the installed HW disassembly during the 2026-10-13 structural
audit; binary hash/PE metadata is recorded above. rec2 supplies symbols/types.
No original code or instruction dump is reproduced. Implementation is queued
as PERF-14 / TASK-100.9, before PHY-13 recovery and guard redesign.

`MoveJointedObject 0x4b8c80` enters child mover `0x4b8fd0`. Null/type0 child
joints take free/root translation. Ordinary type3 ball and type2 universal
children rotate through `0x4c1990`, then align anchors at
`0x4b9298`–`0x4b9317`:

```text
childCandidatePosition += parentCandidateAnchor - childCandidateAnchor
```

That branch has no independent child-world-velocity translation. Hinge/type1
and quick-hinge/type4 share `0x4b9156`: inherit parent finite rotation and add
relative hinge-axis motion before alignment. Type5 world translation uses a
separate joint field/path. Parent prediction precedes recursive child movement
at `0x4b9397`–`0x4b93ba`. The selected ancestor at child `+0x230` normally is
the direct parent; flag0x400 inherited-motion paths need separate handling.

At baseline `f3ee9c3`, browser `candidate()` and `createRigidBodyPosePath()` integrate each
body independently; `projectJointPositions()` aligns poses only after guarded
commitment. `prepareJointVelocities()` constrains instantaneous velocity rather
than finite-step anchor coincidence. This is a verified structural discrepancy.
Exact original runtime flags are absent from the saved Cerby snapshot; ordinary
ball-joint construction supports the mapping, rather than an observed native run.

A clone-only 40ms candidate probe after preparing the three ball joints produces
front-bumper anchor error0.026445 model units (18.25cm) and rear-right-wing
error0.008609 units (5.94cm). An anchor-aligned shadow retaining browser endpoint
orientations changes pair10/14 guard fraction8.0794e-5 to4.8655e-4, still nearly
blocked. These probes omit forces, world, damage and a complete tick; they verify
prediction sensitivity, not a standalone lockup or FPS cure.

The user authorizes reversible structural/guard changes with Git checkpoints
and intermediate playtests. Native/gameplay expectations supersede mandatory
bitwise preservation of browser-only guards or eight global correction rounds.
PHY-13 owns the recovery/guard remedy; PERF-15 owns local retry orchestration.

PERF-14 now connects parent-first candidate, guard and commitment paths through
an isolated hierarchy phase. Ordinary ball/universal, hinge/quick-hinge and
world-translation formulas are implemented; shared temporal caps and ancestor
cache certificates keep those phases coherent. The old later anchor projection
is removed. See [implementation, limitations and validation](hierarchy-motion-performance.md).
Flag0x400 inherited-affine metadata and upward descendant WORLD-joint corrections
remain unsupported variants; this does not claim full hierarchy parity or a
completed PHY-13 lockup fix.

## Local collision traversal and deferred friction (PERF-15)

Verified against the installed HW executable, using rec2 symbols as the map:
`DoCollisions 0x4ba450`, stable OLD actor-X insertion sort `0x4ba4bb–0x4ba568`,
local response `0x4bac60`, geometry collector `0x4bd780`, ring join `0x4bdb70`.
Geometry joins/wakes before lambda application (`0x4bd970–0x4bda86`). World
contacts do not join every object through an infinite world body.

The zero-count exit at `0x4bafb8` counts world/body geometry and active authored
angular/travel-limit rows (`0x4bc7b0`). Stored bilateral anchor/hinge constraints
are gathered **after** that exit (`0x4bb1a5–0x4bb1fe`); a free joint's residual
alone must not schedule repeated collision solves. Normal response callbacks
precede impulse application (`0x4bbbf5`, joint callback `0x4bbc13`, apply
`0x4bbc30`). Shape/split invalidation stops the stale solve. Ring reintegration
`0x4bbe7a–0x4bbef5` replaces candidate poses from saved OLD at literal40ms.

Local retries are bounded30. Counter692734 increments only when the normal
solver `0x4c3900` returns nonzero (`0x4bb869`); the native internal50-iteration
failure path returns−1 (`0x4c43cb–0x4c43e2`). Ordinary positive impulses are
not failure reports. The browser active-set solver does not expose that native
failure status; it does not invent a three-successful-impact cap. Conditional
traversal restart `0x4ba670` is a prepared-list update, not another full physics
preparation or an unconditional reset of all processed tags.

Accepted positive normal rows except types9/11 append to a shared50-record
friction pool (`0x4bbcb2–0x4bbcf7`); retries append, never deduplicate/overwrite.
The pool resets at entry `0x4ba486`, not list restart `0x4ba578`, and flushes
at `0x4ba688–0x4ba6a3`, before quiet/postprocessing `0x4ba6ab`. Records retain
OLD-local COM levers and normals, but friction reads the latest accepted
candidate orientation (`0x4c09a0–0x4c09c0`) and candidate-local gyro. The shared
local linear-velocity cache initializes with OLD basis. Friction updates V/omega
for the next tick without another pose integration. Additional native filter
byte+1dd remains unmapped; the browser filters removed registered bodies.

Implemented in `src/physics/local-response.ts`, `DeferredContactFriction` and
`VehicleSimulation.step`. Eager support-ring closure, exact zero-response early
exit, a tick-bounded per-seed30 allowance, conservative traversal restart on
fixed/world edits, and final CCD guards are explicit browser adaptations. Source
saved-next ring traversal, native active-set failure reporting and exceptional
joint/PHIL metadata are not claimed exact. Collection-time activation and
geometry changes discard stale rows and rediscover against the full roster.
See [PERF-15 evidence](local-response-performance.md) for validation and costs.

## Local NONCAR physical participation (PERF-16)

Retained scenery now stays in static MODEL/triangle queries until successful
physical-slot and PHIL admission; local response discovers/prepares the new
candidate in the same collection. Original type-dedicated/forty-global-extra
occupancy is shared with connotation debris. Supported source-quiet leaves
return to static native columns/root/additional while retaining ACT resources,
then can be pulled again. Reclaim uses authored OWN MODEL and retained face-query
cache bounds at the original outer-frame cadence, with a process-lifetime clock.
Supported car/part/jointed-prop quiet ownership is integrated in PERF-17;
unknown/tumble eligibility still cannot authorize sleep. See
[hierarchy gates and the explicit split startup correction](c2-hierarchy-quiet-re.md). Native header-failure
rollback, Three/native matrix rebasing and broad face-cache invalidation are
explicit browser adaptations, not verified original unchecked-failure behavior.
See [runtime and numerical evidence](noncar-participation-performance.md),
[wake/pull addresses](c2-noncar-wake-pull-re.md) and
[reclaim formulas](c2-noncar-slot-reclaim-re.md).

## DMG-06: selected-car WAM scope (2026-10-15)

Evidence: **reconstructed by rec2**, not newly verified against the installed
binary. `LoadCar` (`0x488f70`) opens the authored WAM token under the selected
car directory; if missing, it retries the selected TXT basename with `.WAM` in
that same directory. `LoadCarCrush` (`0x42a280`) reports a missing file, whereas
invalid contents do not select another car's data. See
[loading.c](https://github.com/madebr/rec2/blob/master/src/carma2/common/loading.c#L3907)
and [crush.c](https://github.com/madebr/rec2/blob/master/src/carma2/common/crush.c#L646).
The browser previously searched global basenames and preferred Stock paths even
for Advanced selections. Player and opponent loading now pass their selected
configuration path to DamageSystem. Only local authored/fallback candidates are
used; parse errors and unmatched WAM actors produce diagnostics. Exact actor
matching is retained. Unlike native fatal errors, the browser keeps its existing
warning/geometry-only behavior for invalid optional damage data.

`gSoftness_names` (`0x58f808`) also contains spaced `very soft` / `very hard`;
`LoadCarCrushDataEntry` (`0x42a550`) maps these to 4/0.25. The parser now accepts
these native names as well as the existing underscore spelling. Advanced OK
exposed this independent WAM parsing error.

Run `node --import tsx tools/audit-car-wam.mjs` for a read-only complete census;
the asset-derived report and hashes stay in ignored `artifacts/car-wam-audit.json`.
All 122 catalog cars were inspected (52 Stock, 70 Advanced). Previously each scope
had 14 zero-binding and 2 missing-WAM cars. All 11 Eagle recolors now match 18/18
parts, including their principal body; Green/Purple/White previously matched
only 4/2/1. Corrected selection yields no missing WAM or zero bindings. Advanced
DIGGA still needs an audit-only ACT trailing-newline trim and is **not** claimed
production-loadable by this result (DAT-01).

Partial authored actor coverage remains for Stock Cerby, Cobra, Dondump, Junker1,
Razorback2, Screw28, Semi2 and Wideboy; Advanced additionally 69mach1, DIGGA, OK,
Ped-o-matic2000 and Semi1. Some absent entries are explicitly uncrushable;
OK's FIREWALL actor has no local model. Bugtoo5's main rendered actor and Advanced
Ped-o-matic's base actor lack matching WAM entries even under the correct file.
These are retained data/interpretation gaps, not grounds for fuzzy name matching
or whole-car squash. Full WAM binding alone does not certify every mesh crushes.

Regression coverage checks both resource scopes, authored-token precedence,
selected-filename fallback despite stale TXT names, missing/invalid data and
binding diagnostics. Original Gold/Green/Blue/Mustang tests check actual
principal-body vertices, cumulative local dents, collision-hull deformation,
detachment requests and repair. The separate Chromium regression exercises
loaded scene geometry and the runtime detachment/repair path.

## PERF-20: motion-certified browser commitment guard (2026-10-16)

Evidence: mathematical derivation over the implemented native-informed motion
producers, checked by numerical/original-asset tests; this is **browser guard
infrastructure**, not a newly recovered original executable algorithm.
Whole-phase separating-plane witnesses use captured COM translation, global
OLD-relative angular momentum bounds and explicit ball/hinge anchor-error
envelopes. Fixed-orientation paths use continuous SAT time intervals. Native
quantization prevents assuming a smooth local angular rate; unsupported paths
and unresolved rotating contact cells retain sampled feature CCD. Native
OLD-overlap admissions, normal/friction response, damage and world contacts
remain their existing paths. See [implementation and retained adverse
measurements](perf20-adaptive-movement-guard.md). PERF-13 remains open; persistent
data and rediscovery are PERF-21/PERF-22.

## PERF-21: collision-data lifetime (2026-10-16)

Evidence: independent browser-engine infrastructure, not a recovered native
physics formula. Moving/fixed BVH topology now persists with exact leaf validation,
refits and quality-triggered rebuilding. One weak endpoint geometry owner supplies
bounds and lazily completed hull planes without duplicate vertex transforms;
response-input certificates persist without retaining solved contacts/impulses.
Crush/repair/split replacements, mutable sources, wake and roster edits invalidate
through their actual shape/pose/classification inputs. Normal/friction equations,
source ordering, damage and timestep remain unchanged. See
[implementation and measurements](perf21-persistent-collision-data.md).
PERF-22 retains redundant rediscovery; PERF-13 retains scene-level performance.

## PERF-22: collision rediscovery lifetime (2026-10-16)

Evidence: independent browser-engine orchestration using the existing native
feature equations. Tick-owned candidate adjacency re-queries changed sources
against the whole roster; raw pair features certify geometric inputs separately
from solver state. C2 HW `0x425c00` / `0x4277c0` OLD relative vertex arrays and
inside flags remain valid when only NEXT changes. HW `0x427f20` OLD edge/hull
intersections and center-facing normals are likewise separate from live positive
point-velocity and attachment admission. Every source/OLD-pose mutation changes
the retained endpoint identity; unknown providers bypass reuse. This separation
does not change thresholds, feature ordering, normal/friction formulae or damage.

Native face-ring access, ACT/groove/water collection, preparation, positive
stress callbacks and replay of empty overlap evidence still run at their former
semantic boundaries. Only raw post-collection static feature emission is reusable;
moving-owner/custom collection remains live. Exact original Stock/Advanced crash,
repair and captured-interlock checks are recorded with the measurements in
[PERF-22](perf22-contact-rediscovery.md). PERF-13 retains whole-scene stall acceptance.

## PERF-13: residual guard and retry interpretation (2026-10-16)

Verified from installed HW static code: `DoCollisions` at `0x4ba61e`/`0x4ba64a`
repeats while response `0x4bac60` returns nonzero. The local retry count is 30
(`0x4ba62e`), with three failure reports (`0x4ba637`). Response `0x4bafb8`
returns zero when aggregate geometry/unilateral row count is zero; its ordinary
`0x4bbf07`–`0x4bbf15` tail returns the saved row count, negated for the relevant
mutation/callback status. Stable positive stresses are not a verified native
termination condition. Do not infer that repeated zero/small impulses make
callbacks or re-collection dispensable.

The existing native free integration's first-order branch has affine COM and a
fixed rotation axis when the entire captured interval has OLD-local
`|omega|² * dt * dt <= 0.00800000037997961`. Below `1e-7`, rotation is absent;
otherwise unsigned 16-bit angle quantization and the small-rotation gate create
explicit events. This supports interval-specific curvature certificates without
assuming that the general high-angle/jointed path is Lipschitz. Captured first-order
metadata and exact native poses drive the new temporal SAT browser guard.

Browser movement-guard tolerance is a policy, not a recovered C2 constant:
`max(1e-6, min(.001, .05 * minimum local hull thickness))`. Thickness includes
face-normal widths so diagonal thin geometry is protected. The .001 ceiling is
smaller than the existing native-informed .005 contact skin; native contact
rows, impulses, damage and repair are unchanged. See
[the residual investigation](perf13-residual-physics.md) for adverse experiments,
implementation scope and validation.

Empty native endpoint CCD was evaluated as an additional continuation shortcut,
but is **not implemented**. Clear OLD/NEXT geometry does not certify an
intermediate full-turn arc. Such evidence also does not survive common-prefix
clamps under the existing pair-component merge rules. Native discovery ownership
and continuous interval clearance must remain distinct certificate types.

## PHY-17: grounded split-secondary guard (2026-10-24)

Evidence: bounded original Porker2 data and experimentally isolated browser
commitment defect. An old separating support touch could cap a PHIL-active split
secondary at fraction zero. A per-sample common-halfspace certificate now excludes
only moving hull features in the independent guard; inverse-frame world-vertex
features, recovery and native contact response remain live. No new original
binary constant or impulse rule is asserted. See
[reproduction, angular counterexample and scope](grounded-split-recovery.md).

## PHY-18: escaped props and free-motion world clearance (2026-10-24)

Evidence: experimentally captured runaway original props, original mechanics
comparison and the browser's native-informed free-integrator algebra. Inertia
still matches authored mass/inertiaPerMass; current free forces cannot explain
the original excessive launch impulse. Native below-world/quiet reclaim is
retained. User-authorized padded X/Z/below-world retirement is an explicit
browser extension for escaped free props/fully detached parts, preserving
resources, physical ownership cleanup and repair. No global speed/spin cap or
new original-binary constant is asserted.

The exact linear free COM trajectory plus complete local radius provides a
whole-motion world-clearance tube, eliminating expensive off-world angular
sampling without changing final integration. Current ownerless geometry is
enclosed at publication, including unindexed large triangles. See
[evidence, restrictions and tests](timber-runaway-props.md). The initiating-energy
gap is recorded by PHY-19, separate from this completed containment path.

## PHY-19: bounded numerical-cause audit (2026-10-24)

Verified installed HW normal-solver differences: single-row diagonal gate
`.0001` at `0x4c3937–0x4c3962`; triangular-factor dependence check against
`abs(lastDiagonal * 100000)` at `0x4c3ad2–0x4c3b0d`, followed by active-row
removal/rebuild; final `.01` residual correction at `0x4c446c–0x4c4492`;
fifty-iteration failure returns `-1`. The factor uses orthogonal rotations;
these are not thresholds for a generic Gaussian pivot. Browser parity remains
incomplete. A prescribed original-inertia biased wedge amplifies motion, but
nine geometry-admission cases did not reproduce the historical explosion.
Noncar callback mass/inertia ordering and basic Jacobian signs showed no defect.
User accepted this remaining gap after the bounded audit; PHY-19 is closed as
investigated, without a solver change. See the
[full confidence and closure record](timber-runaway-props.md#phy-19-bounded-causal-investigation-and-accepted-limitation).

## PUP-18: authored powerup overlap (2026-10-24)

Verified installed HW `GotPowerupX 0x4d9017–0x4d9153` removes other active
definitions with intersecting uint16 group masks before the incoming handler.
Renewal skips the same definition; timers and reset traversal use catalog order.
Engine/grip/suspension assignments and resets now follow that lifecycle, including
Hot rod being removed by either grip or suspension pickups. Numeric Stock/Advanced
and original Eagle/Buggy tests plus headless Chromium application checks pass.
No new force equations or render validation are asserted; see
[the evidence and remaining boundaries](c2-powerup-overlap-re.md).

## PUP-20: accepted-bend powerup removal (2026-10-24)

Installed HW `BendCar 0x433bc0`, call `0x433d6a`, removes active flag-`0x04`
powerups through `0x4dee90` before an accepted structural transformation. Only
the owning local driver 8 loses those effects; missing, immune or already bent
cars do not enter this boundary. The browser now uses the ordinary lose handlers
and immediately updates live engine, grip, suspension and protection fields.
Ordinary repair and vehicle splitting are separate operations. Stock/Advanced
and original-car numerical cases cover the predicates and ordering. See the
[exact evidence and remaining icon boundary](c2-powerup-overlap-re.md#structural-bending-removes-flag-sensitive-effects-pup-20).

### DMG-01 WAM effect and repair completion (2026-10-27)

Installed source evidence corrected native default crush for eligible omitted MODEL actors, principal-MODEL links/centroids, visual shrapnel visibility, queued ACT versus retained car ownership and the held/full glass repair distinction. The shared 25-slot animation advances at most one tier per due 150 ms outer-frame update after glass movement; redamage cancels it. Race-scoped ghost/noncar preparation and explosion texture/frame ownership reuse the existing providers. [WAM evidence](c2-wam-effects-re.md) records exact addresses, tests and the separately tracked whole-engine RNG / unresolved split-topology boundaries. Original assets remain external and read-only.

### WLD-05 / DMG-03 world and effect integration (2026-10-28)

Native source-edge masks now publish coherently to collision and prepared MODEL
readers before deferred texture tiers. Followups retain the native finite face
prefix and distinct generated ACT identities, while real pickup ACTs use shared
deferred grants, once-only hide/audio and original-ACT respawns. Rejected mine
pickups use core4d9ad0 impulses rather than action30 damage/crush. Replacement
MODEL changes start authored mode-zero fire from current prepared vertices;
unrelated car repair cannot expire them. Actual retained MAT objects supply live
host-resource addresses, not guessed ranks or historical Windows heap claims.
Original SCROLLERS fonts, HUD slots and shared fancy/WASTED priority are integrated.
See [collector/edge evidence](c2-world-smash-source-edges-re.md),
[pickup equations](c2-pickup-act-re.md), [replacement fire](c2-replacement-fire-re.md)
and the [producer census and remaining scopes](c2-effect-producer-audit.md).

### PED-04 / ANI-01 native render integration (2026-10-29)

Personality MODEL identifiers now resolve exactly through the registered source
resources; FORM actors start flat/identity and use source BON/SKL root/bone poses.
A package ACT's saved default matrix is not an animation root. The production
population uses the existing verified pose kernels through a render-only bridge,
while current gameplay remains the sole displacement/count owner. Both Stock and
Advanced Newcity1 render all791 actors through that bridge, including upright
CitySwat and advancing original frames. Ordinary legacy corpse/repulsion transport
remains explicit. ANI-01 is still open for remaining animation/render providers;
PHIL, grounding, severing and causes remain the selected PED-06/07/08/09 work.
See [asset-selection evidence](c2-ped-asset-selection-re.md) and
[presentation scope/validation](c2-ped-presentation-re.md).

## PERF-24 normal response correction (2026-10-29)

Verified original HW normal routine `0x4c3900` and caller `0x4bb860` now guide
the browser's independent RQ/dependence/failure path. Preserve the verified
unsigned impact RHS; changing it would disguise the actual compatibility gap.
The native three-report failure budget is now wired separately from positive
response retries and geometry-change rejection. The angular guard's temporal
admission is a browser adaptation, not source C2 behavior. See
[root-cause evidence and deviations](runaway-contact-root-cause.md) and
[the frozen red/green regression contract](perf24-tdd.md).

## PERF-25 fixed WORLD scenery phase correction (2026-10-29)

Verified HW `0x4bac72` fresh contact collection, `0x4b8890` WORLD force rows,
`0x4b8d80` anchor positioning, `0x4bbe7a` full 40 ms reintegration and `0x420380`
snap callback distinguish native contact response from the browser's extra
trajectory guard. A fixed COM and alternating biased support contacts can retain
spin while our guard freezes the OLD pose indefinitely. Native-qualified finite
OLD faces now permit ordinary WORLD ball-joint phase progress; new faces and
released/movable/unsupported bodies remain guarded. This is a native-informed
browser adaptation, not a recovered original temporal guard. Two original
Fridge Racer cones fall from 2,400 responses over 40 ticks to 318, then release
and settle normally. See [formulas, frozen tests and browser evidence](perf25-world-joint-phase.md).

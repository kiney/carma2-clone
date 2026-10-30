# C2 pedestrian reconstruction

Current native completion integration: [PED-13 panic-to-flee fix](ped13-panic-completion.md). Historical elapsed-time reaction notes below do not describe a second native movement owner.

## Executive Summary

The race population now follows the original face density calculation and 2000-person limit. New City1 has 791 pedestrians, Airport1 has 573 and Carrier1 has 249. The runtime reads every requested original personality and movement specification, retains walking/running floor restrictions, processes pedestrians near the camera, predicts threats from the supplied collision objects, and applies the recovered panic, running, smooth-turn and repeated-fear transitions. Obstacle and excluded-floor avoidance projects finite triangles through the original body-width planes and ranks both native tangent candidates. Blood uses the original cloud textures, giblet geometry, force-dependent quantities, lifetimes and persistent ground materials.

The existing vehicle swept contact and corpse motion remain PED-03 work. They supply an explicitly estimated impact force and settling/contact positions to the recovered blood effects. Full skeletal BON/SKL playback remains ANI-01: locomotion currently integrates the authored average root displacement rather than playing each root frame. These boundaries must not be mistaken for recovered native collision impulses or skeletal animation.

## Evidence

Primary evidence is read-only `carma2_orig/carma2_HW.exe`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, original race files and `data/PEDS`. The [rec2 project](https://github.com/madebr/rec2) supplies names, layouts and reconstructed functions. Its target is another revision: addresses from its annotations cannot be used directly in this installation. Dethrace was consulted only as a semantic hint. Decompiler output and original assets are not tracked.

| Function/evidence                       | Installed HW address         | Conclusion                                                                                      |
| --------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| SpawnPedsOnFace                         | 0x4d2a80; rec2 0x4d2cc0      | Projected XZ area; fractional remainder per spawn specification; limit 2000                     |
| ReadSettings walk period instructions   | 0x4cad7b                     | Multiply multiplier by 30 before dividing 1000                                                  |
| SetPedXZDirection                       | 0x4cc060                     | Smooth-turn target, dot 0.95 guard, duration formula and 500 ms limit                           |
| PedScanForObjects                       | 0x4ced30; rec2 stub 0x4cef80 | All eligible collision objects; relative velocity corridor prediction; 10-second reaction gates |
| Ped reaction move tables                | 0x65cfd8 / 0x65cff8          | Initial `[2,2,2,2,2,2,3,4]`; repeated `[2,2,2,10,11,13,-41,-41,-41]`                            |
| CBMoveCompleted                         | 0x4cbcc0, vtable 0x65c2e8    | Fear move completion, direction reversal, run acceleration; move 13 omits reversal              |
| RescanPedProximity                      | 0x4cf860                     | Finite-face projection, body-width strip, wall/floor flags and original edge algebra            |
| RecacheAndSetFace / face-cache creation | 0x4d1b30 / 0x4d1e20          | Character-oriented bounds, 75-face cache, movement margin and changed-point invalidation        |
| DoGiblets                               | 0x4ccda0                     | Strict cloud thresholds; native giblet creation                                                 |
| Giblet size allocation/count            | 0x4cc919                     | Minimum force and per-instance force formula                                                    |
| CBActiveHalted blood spill call         | 0x4d18fa                     | Once per corpse, 75% chance, QueueSpill with original GIBSLICK settings                         |
| SRandomBetween / IRandomBetween         | 0x513000 / 0x512f00          | 15-bit sample; upper float endpoint excluded; signed integer division                           |

`SmoothTurnPedestrian`, `RandomWander`, `CheckForAvoidingAction`, `AcceleratePed`, `PossiblePedSmear` and `MakeRandomPointInTriangle` have usable rec2 bodies; stubbed functions above were checked against the installed executable. The callback table identifies the actual installed completion function instead of inferring completion from a neighboring symbol.

## Population and movement

For an upward-facing triangle with `normal.y > cos(maxSlope)`, let `A = abs(cross(b-a,c-a).y)/2`. A positive density accumulates `expected = remainder + 6.9² * A * density /1000`, emits `floor(expected)`, and retains the fraction for the same race spawn specification. Negative density emits `floor(-density)` per matching face. Constants are double 47.61 at 0x589b68 and float -0.001 at 0x589b70; the reversed determinant accounts for that negative sign. The original configuration comment suggesting a 100 m² denominator conflicts with the installed instructions. Renderer material batching is reversed using source-face metadata so traversal and cap behavior retain original face order.

Spawn coordinates draw alpha and beta from `[.1,.9)` using the native 15-bit sample. If their sum exceeds 1, both become `1-value`; gamma is `1-alpha-beta`. There is no player-start weighting, spacing rejection, per-face ground-placement retry, 80/240-person cap or ten-template cap.

Stock settings are process distance 12, popup distance 9, vertical extents 0.6 times either distance, maximum slope 25°, reach 0.5 and avoidance distance 4. Processing uses the original axis-aligned camera boxes. Popup hysteresis prevents a previously inactive pedestrian appearing inside the inner box until nearness resets. Inactive people remain in population/victory totals.

Walk period is `trunc(1000/(30*multiplier))`: stock multiplier endpoints 0.7 and 1.7 yield 47 and 19 ms. rec2's `1000/multiplier*30` expression is a 900-fold transcription error, proven by the installed multiply/divide instructions and constants 30/1000. Reversed IRandomBetween endpoints use signed truncation, including the native endpoint behavior. Authored turn intervals are 2..30 seconds, and turn angles use the native 65536-angle circle with minimum 10°.

Personality TXT selects the form/default-move files. Each form identifies its root bone and six-line move records; defaults provide each move's translation scale and grounding offset, then personality MOVES records override them. Personality bounds and optional JUMPHEIGHT also control the native avoidance strip and face-cache volume. Root displacement comes from the named form bone in the original BON/SKL matrices, using exporter X/Y planar axes and the original scale. Frame 0 repeats the first root delta where the looping translation axis is not reset. Locomotion currently uses the resulting per-frame mean; exact skeletal/root-frame remapping is ANI-01. Stationary movement specs use move 0. Minimal test fixtures without motion packages remain stationary.

Measured full stock counts, including all requested groups and without template warnings:

| Race     | Count | Groups               |
| -------- | ----: | -------------------- |
| newcity1 |   791 | 63,64,65             |
| airport1 |   573 | 22,24,25,26,27,29,30 |
| carrier1 |   249 | 10,11,12,13,14,15    |

New City1 counts by spawn material are crossing 7, parkbay1 37, slabs 66, sidewlk1 255, sidewlk3 33, 2rokgras64 259, CITROOF01 35, CITROOF02 95 and CARPET01 4.

## Reactions and direction

The scanner considers all eligible collision objects, not only the player car. Source driver types 2..5 are excluded when the object has an associated driver. Root integration supplies all cars/rivals and moving noncars. An object must lie inside the strict 5-unit XYZ box. For relative planar velocity `v = objectVelocity - pedVelocity` and offset `d = objectPosition - pedPosition`:

```
lineDistanceSquared = (vz*dx - vx*dz)^2 / (vx^2 + vz^2)
timeToClosest = -(vx*dx + vz*dz) / (vx^2 + vz^2)
threat = lineDistanceSquared < 2*object.radius_squared
         && 0 <= timeToClosest < 7*random(.8,1.2)
```

Panic additionally requires the object's complete velocity squared to exceed 1. Walking pedestrians face the threat and choose the initial native move table. Completing fear moves 2..6/10/11 reverses direction, chooses run 41 and starts at 100 ms/frame; move 13 starts run 40 without reversal. Form-unavailable moves follow the source fallback chain: 3/4/10→2→1,11/13→10,41→40. Running reduces frame period by `.09*framePeriodMs`, truncating and clamping 30 ms. After ten seconds continuously threatened, the scanner samples the repeated table; positive entries select panicking, negative entries select running. The initial fear timestamp is not reset by this branch in the installed code. After ten seconds without threat the scanner resumes move 30 with a freshly sampled authored walk period. Head poses and vocal playback belong to the visual/audio animation path.

SetPedXZDirection keeps a pending target when its direction dot the requested target is greater than 0.95. Its duration is `min(.5, characterPeriod * requestedDistance / length(characterVelocity) * float32(1/30))` seconds; the end time truncates to milliseconds. SmoothTurnPedestrian interpolates old/new direction vectors then normalizes through the direction setter. Wander requests distance 1; avoidance uses `min(.5,max(0,distance-reach)*random(.7,1))`. Object avoidance updates every 200..500 ms. Only Walking/Running moves with authored translation perform movement AI. A wall proximity flag shields an object threat unless `lineDistanceSquared/proximityDistanceSquared < .25`.

RescanPedProximity uses the shared finite world faces, including nonsolid faces. The cache is in character axes, with local X `[-3/6.9,3/6.9]`, Y `[-2.5/6.9-jumpHeight,2.5/6.9+jumpHeight]`, and Z `[-2/6.9,10/6.9]`. Finite triangle/box overlap selects at most 75 faces. It is rebuilt when the root leaves the cached world bounds with a `1.5/6.9` margin, for moving-owner faces, or on world-geometry change notifications after smashing. The root uses the current move's authored grounding offset. This is personality-bound projection; per-bone body collision is not needed for this scanner.

The scan projects each finite triangle against the forward plane and two lateral planes, offset by `1.3*personality.bounds.max.x`. Each plane must have at least one triangle vertex on its positive side. Wall candidates additionally use the face-plane intersection, with the original `.001` parallel threshold and maximum distance 20. Facing walls and two-sided back faces above the current floor plane set flag 2; one-sided back faces below the root plane set flag 1. Exceptions remove wall candidates. Excluded floor faces set flag 8; their unsigned-byte exclusion flag permits running when nonzero, while walking still avoids them. Flags are not interpreted as a bitmask.

The installed floor edge calculation contains two observable quirks, checked against 0x4d0520..0x4d08c1 and covered by source-derived tests. All three edge numerators reuse `shared=A.x*B.z-B.x*A.z`; each edge uses `t=(shared+root.z*edgeDX-root.x*edgeDZ)/(edgeDZ*flatDirX-edgeDX*flatDirZ)`. Parallel/negative intersections are rejected, and strict pairwise comparisons select the third edge on a first/second tie. The chosen normal is `(edgeDX,0,-edgeDZ)`. Replacing these with a conventional geometric edge calculation changes original results.

CheckForAvoidingAction constructs the first tangent with the native cross products and moving-object velocity preference. After rescanning that candidate, remaining flags and a noncoincident contact cause the opposite tangent to be scanned. It replaces the first only if its proximity distance is strictly greater; ties retain the first. Both scans use the same finite cache and feed the recovered smooth-turn setter. Native excluded-floor steering therefore happens before an attempted step, including finite wall corners that a center ray misses. Tests exercise this in actual actor updates with authored motion fixtures. Native ragdoll falls/get-up and per-bone contacts remain PED-03; an unsupported height step still uses the existing reverse-direction adapter.

## Blood particles and ground traces

DoGiblets selects SMALL/MED/LARGE blood clouds at strictly greater than 0.05/0.25/0.5. Inputs are float32: a source `.05f` value is slightly greater than the double 0.05 comparison. Original cloud groups provide quantities 1..3,3..6,6..10, scales, rates, offsets and BIGBL01..05 texture sequences. ExplosionRuntime supplies the recovered sprite sizing, flip, timing and 50-slot cloud behavior.

Each giblet size uses `force>=minForce ? min(maxCount,trunc((force-minForce)/instanceForce+1)) :0`, with force and authored parameters stored as float32. Source thresholds are 0.1/0.05/0.02/0.003/0.0002, instance forces 0.1/0.05/0.02/0.006/0.002, and caps 1/2/3/6/20: at high force 32 chunks. CHUNK01..05 DAT geometry is loaded read-only; authored scales are 1,2,2,2,1.4 and native last-size adjustment 0.75 makes the final scale 1.05. Source sphereclumped placement uses radius 0.1, a normalized random cube direction and a random radius. Radius/range scales velocity and spin. Stock inherited velocity factor 1, signed random velocity 3, added up velocity 0..4, spin 70 and lifetime 500..1500 ms are retained. The native 200-debris limit is enforced within the pedestrian effects allocator; allocation shared with other debris is a later cross-subsystem refinement.

After a corpse settles, the original 75% once-only spill chance queues GIBSLICK. Its 300 ms delay, growth 0.00001..0.00007 per millisecond, initial half-size 0.001 and final half-size 0.05..0.15 come from settings. It persists until the native 32-slot pool replaces an older entry, with no invented fade lifetime. Ground placement uses the floor ray, its normal and the original oil surface predicate: normal.y>=.97 and neighboring-plane checks. Slick and smear meshes follow that normal rather than assuming a horizontal floor.

PossiblePedSmear uses PEDSMEAR and SkidSection. The source width is contact lateral maximum-minus-minimum plus 0.1; the native 100-skid pool retains traces until replacement. The current contact bridge uses body width plus 0.1 and emits segments while the existing corpse is sliding. Exact native accumulated multi-bone contact patches depend on PED-03. Giblet transport currently uses ballistic gravity/ground stopping; native debris rigid-body collisions also depend on the shared contact path. These adapters do not alter the recovered assets, cloud selection, chunk quantities or authored expiry.

## Validation

`tests/ped-rules.test.mjs` covers source-derived area/carry, negative densities, slope and triangle sampling, flags/exceptions, relative threat prediction, settings and 15-bit RNG, 2000-cap/no-start-bias populations, processing hysteresis, actual walking/running material restrictions, smooth actor turning and ten-second repeated fear. `tests/ped-proximity.test.mjs` covers finite body-width clipping, facing/two-sided wall rules, exact excluded-floor edge algebra and tie behavior, oriented cache bounds, jump-height expansion, and strict opposite-tangent distance ranking. `tests/ped-blood.test.mjs` covers strict float thresholds/counts, original texture/model packages, cloud/giblet expiry, normal-aligned ground traces, slick/skid persistence/capacity and three full original races with all requested groups. All 27 pedestrian checks across these files and the existing package/motion tests pass. TypeScript validation passes. A full 791-person New City probe found no missing motion roots, nonfinite positions or asset warnings; 100 updates at its stock camera took 21.6 ms total with four active pedestrians. The browser RNG stream remains different because native pointer/time reseeding has no portable equivalent, although the recovered sampling formulas and reaction tables are retained. Root Chromium integration additionally exercised original hits, cloud/chunk emission, settled blood slicks and sliding smears.

# C2 physics reconstruction

## Executive Summary

The initial browser vehicle handler is not a C2 crash simulation. It is being replaced from evidence in the local original executables, authored car/WAM/GENERAL data, and independently interpreted reconstruction references. Completion is unproven until the integrated motion, crash, damage, detachment, repair, rendering and regression gates pass in Chromium. Original binaries, decompiler databases and disassembly stay outside Git.

## Evidence and binary revisions

| Binary        | SHA-256                                                            | PE metadata                                                           |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| carma2_HW.exe | `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c` | PE32 i386, base 0x400000, entry RVA 0x177eb0, 1998-10-18 20:13:36 UTC |
| carma2_SW.exe | `15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d` | PE32 i386, base 0x400000, entry RVA 0x172ef0, 1998-10-18 21:16:25 UTC |
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
- Rendering defect remains under investigation. Baseline screenshots are local /tmp artifacts; gameplay/crash changes have priority.

## Current function map

| Subsystem        | Local HW VA | Local SW VA / rec2 symbol                | Evidence and behavior                                                                                                                         |
| ---------------- | ----------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick             | 0x4b63d0    | SW 0x4b2330; PHILDoPhysics rec2 0x4b6630 | Verified shared instruction flow; 40 ms tick, maximum five catch-up steps; pre, integrate, collide, post                                      |
| Collision        | 0x4ba450    | SW 0x4b63b0; DoCollisions rec2 0x4ba6b0  | Verified prologue/flow; rec2 stub; contact group solver and friction                                                                          |
| Contact matrix   | 0x4bf230    | rec2 collision core stub                 | Normal effective inverse mass includes both lever-arm/inertia terms                                                                           |
| Contact RHS      | 0x4bac60    | —                                        | Impact group if any closing >0.01; RHS 0.01+1.001\*max(closing,0). Rest group uses start/predicted transform drift times 25                   |
| Normal apply     | 0x4b7700    | —                                        | Delta v = impulse / mass; delta omega = inverse inertia times r cross impulse; local diagonal inertia, rotation-lock flag 0x800               |
| Friction         | 0x4c0870    | —                                        | Pair cap 0.35*normalImpulse*(1+objectFrictionA)\*(1+objectFrictionB); world cap includes face friction and 1+worldFriction                    |
| Impact callback  | 0x41c1d0    | SW 0x41c1f0; ProcessForcesCallback       | Crush/smash/damage callback before normal application; not the wheel-force integrator                                                         |
| Car frame        | 0x4168e0    | not reconstructed in rec2                | Ordinary motion calls controls 0x415320 and wheel forces 0x418870                                                                             |
| Wheel forces     | 0x418870    | rec2 unfinished                          | Spring/damper load; tyre limits proportional to sqrt(load), authored axle coefficients and road material; detailed interpretation in progress |
| Crush queue      | 0x42d350    | QueueCarCrush                            | Impulse magnitude times car softness; reject <=0.06, queue cap10, max4 contact points/events                                                  |
| Crush            | 0x436340    | CrushCar rec2 0x4363f0                   | rec2 stub; calls actor callback0x431d70 and vertex deformation0x432ad0                                                                        |
| Vertex region    | 0x42b410    | CrushLimitNumber                         | Original packs MIN in low2/MAX in high2 bits per axis; rec2 has swapped bits and invalid initialization discrepancy                           |
| Detached setup   | 0x433640    | SetUpDetachedBitObject                   | Inherits parent velocity plus omega cross COM offset, transformed consistently; original part mass and box inertia, no random launch kick     |
| Component damage | 0x43f820    | DoDamage rec20x43f930                    | Ignore increments<5; twelve units capped99; increment<10 crossing99 is rejected                                                               |

## Data and equations established

`ReadMechanics` establishes original root COM, mass, inertia dimensions, wheel geometry, suspension give/damping/slip, friction angles, traction multiplier, rolling resistance, collision shapes and transmission scalars. Diagonal inertia is mass times the sum of the other two squared authored dimensions /12. `src/mechanics.ts` preserves all these inputs; original geometry is not modified.

`GetDamageProgram` establishes six impact programs (top, bottom, left, right, front, rear). Strict comparisons address normalized body coordinates, and all matching clauses execute. Twelve units are engine, transmission, driver, steering, four brakes and four wheels. `src/damage-program.ts` parses their authored weakness factors.

GENERAL crush constants verified in original data/binary: radius squared0.01, minimum force0.06, maximum applied force0.5, force-to-movement1.5, distortion0.0135, detachment baseline0.1, maximum detach time5000ms. For current vertex p, weight is 1-sqrt(distanceSquared/contactRadiusSquared), clipped at zero. Movement is weight*partSoftness*min(queuedForce,0.5)/contactCount\*1.5 along the local direction, subject to dominant-axis region eligibility and WAM planes. Original-position falloff, squared weight and arbitrary cumulative displacement caps are incorrect. Root collision hull treatment differs from visual vertices and must be preserved.

## Status and open evidence

The full mechanics/damage parsers and independent crush/contact kernels are being implemented and tested. Runtime integration is still outstanding. Original damage scaling, detachment thresholds/joints, wheel-force/drivetrain branches and collision-hull deformation need to be tracked here as each is verified. No acceptance gate is considered met by standalone parser or math tests alone.

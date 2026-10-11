# C2 surface effects reconstruction

## Executive Summary

Original track material modifiers are parsed into wheel friction, sound,
sparkiness, smoke-type and skid-material fields. The browser currently uses
tyre friction, but has no skid-mark, continuous-smoke or spark consumer. The
installed HW binary confirms the skid-mark lifecycle and the wheel-force
producer; the exact branch meaning of several wheel-force trigger values is
still under analysis. Smoke production is reconstructed from rec2, while its
installed allocator is not mapped. Sparkiness has no located rec2 consumer and
remains open.

## Data and current implementation

`src/physics/surfaces.ts` parses the nine numeric values and skid-material
name from each material-modifier record. The values are wall friction, tyre
friction, downforce, bumpiness, tyre sound, crash sound, scrape sound,
sparkiness and smoke type. `surfaceIndex` maps the first material identifier
character relative to `'/'`. Wheel ray hits retain their actual `Surface`, and
`src/physics/motion.ts` applies the surface tyre-friction multiplier in the
wheel-force calculation. No browser module currently reads `sparkiness`,
`smokeType` or `skidMaterial` after parsing.

The following installed-binary observations use HW SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Addresses are absolute VAs for that installation.

## Skid marks

Installed HW `SkidMark` is at `0x4ea200`. The frame routine `0x4168e0`
clears `car+0x159c` (`new_skidding`) and calls `SkidMark(car,wheel)` for each
of the four wheels at `0x41702c–0x41703x`. WheelForces at `0x418870` also calls
the helper `0x41bd60` at nine call sites. The helper sets the corresponding
bit in `car+0x159c`; its caller supplies the per-wheel index and wheel-data
pointer. This separates the transient newly-skidding mask from `wheel_slip`
(`car+0x11f8`), which the force routine also updates.

`SkidMark` checks `oldd[wheel]` against the appropriate suspension height,
uses the wheel's material index (`car+0x1274+4*wheel`), and considers the
wheel's remaining oil (`car+0x16cc+4*wheel`). With no skid material, it clears
the active old-skid bit. Otherwise, it combines `new_skidding` and
`old_skidding` (`car+0x15a0`), then advances the mark using stored per-wheel
positions, normals and section data. A failed continuation clears its active
state; successful segments consume wheel oil by traveled distance. The
installed helper calls `0x4e9c90` for mark continuation/creation. Rec2's
`skidmark.c` gives the reconstructed details: material selection, oil override,
per-wheel state, minimum segment spacing, surface-normal continuity and a
bounded mark pool. Treat those geometric thresholds as rec2-reconstructed;
they have not all been independently confirmed against installed instructions.

### Wheel-force trigger status

Installed `0x41bd60` itself is **not** gated by a generic slip-percentage
threshold. Its initial filters reject a null wheel-data object, a nested object
with type byte `0x12`, and a wheel whose material-name string has the special
12-character form with `'|'` at offset 5. It then sets the wheel bit and
updates per-wheel mark start/position data. In `0x418870`, one call cluster at
`0x41a521–0x41a53a` is inside a four-wheel loop and calls the helper when that
wheel's oil field is positive. Other calls at `0x41ad35`, `0x41ad55`,
`0x41ae4e`, `0x41af15`, `0x41b1ca`, `0x41b1eb`, `0x41b2eb` and `0x41b3b6`
occur in tyre-force/slip branches. The latter clusters compare intermediates
against the installed `20`/`60` constants and, in some branches, `0.1`, before
marking a wheel.

The surrounding wheel-force code updates `wheel_slip` and applies
`friction_slipping_reduction` while resolving force demand against tyre
capacity. However, the full operand mapping for each `20`/`60` and `0.1`
comparison is not yet established. Do not substitute the browser's current
`allocateTyrePair` saturation flag as a proven one-to-one producer for
`new_skidding`; it is only a candidate integration signal pending that mapping.
The important runtime path is per wheel: preserve the selected road material,
the wheel's actual slip/force state, and its skid-history state, then invoke the
mark update once during the frame lifecycle. Do not infer marks from vehicle
speed or chassis yaw alone.

## Continuous smoke

Rec2 reconstructs a caller in `car.c:FinishCars`: for each wheel, smoke is
considered when `oldd[wheel] < susp_height[wheel/2]`, material `smoke_type >= 2`,
and movement is enabled. It calls `GenerateContinuousSmoke(car,wheel,pTime)`.
The reconstructed producer accumulates a randomized 200–400 ms per-wheel
timer, computes the wheel's local velocity including angular velocity, and
returns below squared speed 25. Above that gate it derives decay/strength and
selects a dust palette from `gDust_rotate + smoke_type - 2`, wrapping by the
number of dust tables, before calling `CreatePuffOfSmoke`.

This is rec2 evidence, not a verified installed gate: rec2's
`CreatePuffOfSmoke` at its annotated `0x4fb330` is a stub, and installed
HW addresses must not be inferred from that annotation. The minimum faithful
browser path is wheel-contact/suspension state plus surface smoke type and
wheel point velocity, feeding a timed particle emitter with the original
palette mapping. Particle allocation, decay and renderer parity remain open.

## Sparks and evidence gaps

Rec2 `world.c` reads `sparkiness`, with default 1, but repository search found
no gameplay consumer for it. Installed binary correlation with the spark
producer has not been established. Do not treat `sparkiness` as a multiplier
on every impact or tyre slip without locating its native caller and threshold.
Likewise, exact skid branch operands, installed smoke creation/allocation and
surface-specific spark lifecycle remain unresolved. These are separate gaps;
the presence of parsed fields does not establish a runtime effect.

## Runtime scope

The present browser has data for a staged implementation: contacts already
carry material identity and wheel motion has per-wheel support and force
results. A skid implementation can reuse the verified mark mask lifecycle and
the original material's skid texture once its force-trigger mapping is
completed. Smoke should remain an independent timed wheel effect because its
source gate is contact-height plus surface type and wheel velocity. Spark
effects should wait for the producer trigger evidence. No visual or gameplay
parity is claimed by this data-only audit.

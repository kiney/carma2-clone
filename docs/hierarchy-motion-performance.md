# PERF-14: native hierarchy movement

## Implemented behavior

`hierarchy-motion.ts` captures one isolated motion phase after each response or
topology barrier. Collision candidates, world sweeps, body-pair paths and final
commitment use that phase. Parents are sampled before children, independent of
roster order; commitment copies the same poses and motion values the guards saw.

| Path              | Installed HW evidence                                  | Browser implementation                                                                                            |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Free/root         | `0x4b9344`–`0x4b9392`, angular `0x4c1990`              | Existing COM translation and angular integrator                                                                   |
| Ball/universal    | `0x4b926a`/`0x4b927b`, alignment `0x4b9298`–`0x4b9317` | Independent angular integration, then parent candidate anchor placement; no independent child translation         |
| Hinge/quick hinge | `0x4b9156`, signed angle `0x4b9187`–`0x4b921f`         | Parent finite rotation plus signed Float32/16-bit relative-axis turn; world angular velocity retained             |
| World translation | `0x4b933d`, `0x4b8d80`                                 | COM-only angular integration, old-axis transverse correction and axial velocity; travel limits remain solver rows |

The native mathematics was checked against the installed executable whose hashes
and PE metadata appear in [the physics notes](c2-physics-re.md). rec2 identifies
symbols but stubs the principal hierarchy mover. No reference source or binary
dump is copied into this implementation.

Physical joint trees share a minimum world/pair temporal fraction even when their
collision masks reject mutual contact. Mask eligibility remains unchanged.
Parent-driven COM bounds and angular hints include ancestor motion and full turns.
World-query certificates now include ancestor motion/properties and mutable joint
anchors/axes, preventing reuse of a child's stale intermediate path.

The old independent post-commit joint projection and its second whole-scene guard
are removed for these supported paths. Anchor placement is already part of the
trajectory checked by the existing world/body guards. Global correction rounds,
ordinary impulse/damage equations and old-overlap guard policy remain for the
following PHY-13/PERF-15 tickets.

## Intentional changes and limits

- A free child translation followed by a late anchor snap is no longer the
  expected browser outcome. Older exact comparisons remain historical evidence;
  new tests derive hierarchy expectations from the native equations.
- Zero duration or zero accepted prefix retains the actual captured pose. This
  explicit stability choice prevents malformed, already separated anchors from
  teleporting through a finite world face merely by being evaluated at time zero.
- Source flag0x400 cached-relative-affine/inherited ancestor metadata and upward
  corrections from a descendant WORLD joint remain unmapped variants. They are
  not silently claimed as complete C2 hierarchy parity.
- Quaternion/double arithmetic approximates native matrix Float32/x87 rounding.
  Ordinary stock part anchors, axes, COM and inertia still come from original data.
- A corrected candidate is not itself a cure for the old-overlap lockup or the
  reported Timber frame collapse. Coupled clipping can still stop a complete
  hierarchy; PHY-13 owns that behavior investigation.

## Validation and measurement workflow

`tests/hierarchy-motion.test.mjs` checks native equations, pure phase sampling,
captured inputs, shuffled chains, shared caps, release/repair phases, zero-time
handling, full turns and COM enclosures. Existing finite-road, split, original-car,
joint and cache-on/off integration cases exercise the connected simulation.

For intentional movement changes, the existing short serial comparison tool can
retain equal initial fixtures without enforcing the old final poses:

```sh
node tools/profile-guard-kernel.mjs --samples 2 --root data \
  --allow-motion-changes --output artifacts/perf14-motion-comparison.json
```

Default tool behavior still requires exact outcomes for ordinary optimization
comparisons. The opt-in mode retains changed states/fractions and is timing
evidence, not native conformance. The older captured correction replay explicitly
retains legacy independent candidate paths; it does not replay current hierarchy
movement or a complete production tick.

## Results (2026-10-13)

The full test suite passed 2,755 tests, including 18 synthetic hierarchy cases
and two original-installation Eagle3/Cerby cases. A subsequent disabled-NONCAR
roster regression passed in the five-case NONCAR suite: destroyed world actors
must leave both the body and joint rosters, and re-enrolment must restore both.
The production build passes. Existing bundle-size warnings remain.

A clone-only 40 ms candidate of the saved Cerby fixture, after ordinary joint
velocity preparation, changes front-bumper anchor error from 18.247 cm to zero,
front-right-wing error from 0.525 cm to zero and rear-right-wing error from
5.940 cm to zero. Distances use the existing metric conversion of model units
times 6.9. This is a movement equation check, not a complete crash/tick replay.

Chrome DevTools MCP ran actual Timber content on AMD Radeon Graphics through
ANGLE/radeonsi, with a 2100 × 1466 drawing buffer. A short W-driven, positioned
car collision produced deformation revisions on both cars and component damage
on the rival. A separate controlled fixture made the original front/rear Eagle3
WAM reservations due, then ran the production detachment path and six complete
simulation ticks: both ball-jointed bumpers remained anchored (12 observations,
maximum measured error zero), while the car moved 0.274 model units. Full repair
and a cleanup tick removed both physical pieces and restored their attachment
phases. Console errors and the WebGL error code were clear; screenshots were
inspected. These setups isolate behavior, rather than claiming to recreate the
user's route or an unforced impact-to-detachment sequence.

The final production Chromium crash matrix also passes: ordinary Eagle3, Buggy,
Bigdump and Advanced 69mach1 driving impacts, Porker2 severe damage/split/joints/
repair and Eagle3 impact-queued semi-detachment/repair. It observes WASTED,
splitting and multiple physical joint links, with no console errors, failed
requests or WebGL errors. Eagle3 ends repaired with no owned debris or jointed
parts. These regressions preserve gameplay systems without asserting native
parity for the unresolved hierarchy flags above.

### Bounded hardware CPU comparison

Short, serial runs use the same prepared original Timber fixture (480 bodies,
seed `0x50455246`) against source baseline `f3ee9c3`. Each run has two manual
ticks and a 250 ms normal-frame window with drawing suppressed. Initial-state
hashes match; changed final poses/fractions are intentional and repeatable.
These are CPU tick costs, **not rendered FPS**. Small windows, warm-up, browser
scheduling and concurrent workstation use limit timing conclusions.

| Version / sample | Manual ticks (ms) | Frame ticks | Median tick (ms) | p95 / maximum (ms) |
| ---------------- | ----------------- | ----------- | ---------------- | ------------------ |
| Baseline A       | 126.1 / 63.9      | 4           | 37.9             | 51.1               |
| Baseline B       | 115.0 / 49.5      | 4           | 41.1             | 59.6               |
| Final A          | 141.7 / 61.5      | 8           | 31.3             | 123.2              |
| Final B          | 122.6 / 64.9      | 6           | 29.1             | 69.9               |

The traced first tick retains 8 global correction rounds, 10 contact collections,
109 candidate pair tests, 74 geometry transforms and 64 world collections.
World hull transforms change from 345 to 410 as child sweeps include ancestor
motion. The removed post-projection guard is absent from the production code;
this capture does not independently attribute elapsed savings to its removal.
The adverse 123.2 ms sample remains evidence against claiming stable performance.
Old-overlap stopping and global retries remain for PHY-13/PERF-15.

An intermediate implementation fed the conservative momentum/inertia angular
bound into world-sweep sampling. It performed 1,085 world hull transforms,
manual ticks of 188.5 / 80.6 ms and a 44.1 ms median frame tick. It was rejected.
World sampling now retains the existing actual-rate heuristic, extended for
ancestor/relative hinge motion. The conservative bound remains available to
body-pair guards. This heuristic does not certify arbitrary gyroscopic rate
growth; world sampling thresholds/caps and refinement policy are unchanged.

Ignored reports: `artifacts/perf14-validation.json`,
`artifacts/perf14-anchor-comparison.json` and the test/browser logs. No original
data is copied into tracked files.

Before the next risky ticket, user playtesting should focus on crashes with
hanging bodywork, wall contact, rollover and repeated repair. A damaged piece
should follow its attachment continuously without a late positional snap.
Report any new lockup or tunnelling separately from the already open old-overlap
guard defect; this ticket does not declare that defect or the Timber FPS drop
resolved.

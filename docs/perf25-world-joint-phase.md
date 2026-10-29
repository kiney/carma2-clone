# PERF-25: anchored scenery and native world-contact phases

## Verified mechanism

A procedural box reproduces the captured cones without original assets:
mass0.5, bounds[-.02,0,-.02]..[.02,.24,.02], COM/ball anchor[0,.12,0],
angular velocity[.5,0,0], floor clearance.00001 and a finite floor. Alternating
two-edge contacts consume thirty responses per tick. With bias beta=.01,
half-width a=.02 and impact excess epsilon=.001, the angular recurrence is

```text
omega[k+1] = -sign(omega[k]) * beta/a - epsilon*omega[k]
|omega| -> beta / (a*(1-epsilon)) = .5005005005005004
```

The numerical replay matches this recurrence. Mass/inertia tuning cannot cure
that equilibrium. Opposite supports cannot both separate at+.01 with a fixed
COM. Merely retaining more rows does not make those demands feasible.

Our extra world guard then freezes the OLD pose while retaining angular
velocity. Repeating the same OLD configuration preserves the cycle indefinitely.
The native quiet energy rejects this motion. Authored WORLD_FRICTION0 still
means factor(1+0)*faceFriction, not zero friction. The native low-linear-speed
friction branch can retain tipping spin, and the shared fifty-record pool can
starve later bodies; neither coefficient nor capacity is changed here.

## Original binary checks

Read-only installed HW/SW hashes match `c2-physics-re.md`. Static instructions,
not copied source, establish:

- HW4bac72..4bacac starts a fresh geometry collection at4bd780. Deferred
  friction persistence is not evidence for persistent normal manifolds.
- Version101 NONCAR loader48823c..4882c2 creates implicit WORLD type3 with
  attached-COM anchor when a snap angle is authored.
- World force builder4b8890..4b88f4 emits three signed translation restrictions.
- WORLD positioning4b8d80/4b8f5d aligns the finite candidate with its fixed anchor.
- Response4bbe7a..4bbef5 reintegrates the full literal40ms candidate. It calls
  post-movement callback+194, including TestNonCarSnapOff420380.
- Quiet4ba8f4..4ba910 rejects excessive linear/angular energy before its final
  joint/upright gate. Raising sleep thresholds is not a recovered correction.

The source's full candidate can change geometry/mode on subsequent ticks;
the additional browser cap is not a source requirement. A counterfactual that
disables every world guard is unsafe and is not the selected policy.

## Selected contract

Only authentic attached NONCAR ordinary WORLD ball movement with a fixed
anchor may admit a finite face qualified by the native OLD recovery detector.
Qualification is per authored hull, finite source face and captured phase.
Use the whole native face inventory so the nearest selected recovery face wins;
an independently recoverable farther face must remain protected. Detection
provenance matters even when candidate drift is zero and no normal row emits.

The native collector and normal response remain authoritative. New walls,
clear sibling hulls, released/free bodies, movable parents, unsupported joint
modes and next-phase re-entry retain the extra guard. Native endpoint slack
can qualify small positive clearance; this is not necessarily literal solid
penetration. This scoped phase admission is a **native-informed browser
adaptation**, analogous to PHY-13, not proof of every original runtime outcome.

## Frozen red contract

Reviewed before any engine changes on2026-10-29:

```text
cc1ffa7f966e6f25b740eafcbfac0f1b8911c9945048ed353926ed5e8d1acfbd  tests/world-joint-phase-admission.test.mjs
7165b4f23ba448a565ce52867ab395a1630b2fb514d2952337b47c42039724e2  tests/support/world-joint-phase-fixture.mjs
3946da3453cac66b055dac83c8ff099659a57a5af0ec803e59ccabf3795cb825  tests/run.mjs
```

`node --import tsx tests/world-joint-phase-admission.test.mjs`:14 tests,
six passing/eight expected failures. Controls cover native collection activity,
different mass/frame/prior flags, zero-drift detection, a genuinely new wall,
sibling geometry, nearest-face selection, unsupported modes and fresh-phase
rearming beyond the actual native slack.

The six-tick test compares production against an explicitly scoped
source-equation control, not an original-EXE oracle. Every admitted reference
phase independently verifies native OLD qualification; source impulses remain
live. The reference retains thirty responses initially, advances pose, crosses
the authored bend threshold and restores the ordinary guard after release.
It does not force sleep or prescribe a fabricated low retry limit.

Tests/fixture/runner are frozen for this correction. Existing PERF-24 regression
assertions and fixture remain unchanged; the runner only adds this new suite.
PERF-25 completion still requires a real-scene workload check: correcting phase
progress alone is not proof that sustained repeated work has disappeared.

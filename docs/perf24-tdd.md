# PERF-24 regression contract

The user requested failing tests first, followed by engine changes without
changing the tests. The root reviewed the procedural fixtures and controls
before freezing these files on 2026-10-29, against engine checkpoint `2b2c2bc`.

```text
1b0dc2ea6076541011c844e83c5451f900b66cd3b59bc49cc88460818a2c6e7e  tests/runaway-contact-regression.test.mjs
3ad3a011bb3a445f50d0a7c37fd4e8282d392b98c23666c88061ed9590958b3b  tests/support/runaway-contact-fixture.mjs
7609819907b78accd03629c8c491774df8a11305fd65a634956e4f2f2b52cf6b  tests/run.mjs
```

## Red baseline

`node --import tsx tests/runaway-contact-regression.test.mjs` runs 14 tests:
10 pass and 4 fail. Exact and near-dependent opposed packets, a rigidly rotated
and mass-scaled packet, and the complete production step fail their physical
impulse/energy envelopes. The production tick reaches energy about `1.98e13`.
All other controls pass on the unchanged engine.

The fixtures contain only generated geometry. They require neither proprietary
assets nor a captured playtest state. Raw-packet cases keep the public normal
solver accountable even if contact admission is corrected. Production cases
exercise both real collectors and the real merge/retry loop. Controls retain
floor/wall constraints, high-speed oblique response, valid opposed normals at
different levers, signed bilateral reactions, mass/rotation covariance,
redundant support and off-center car/car momentum exchange.

Energy allowances explicitly permit C2's verified positive velocity bias. The
tests require nonzero physical collision responses, finite nonnegative
unilateral multipliers and analytical ordinary impulses. Neither disabled
collisions nor arbitrary zero responses satisfy the contract. The bounds reject
the reproduced energy injection without prescribing a solver implementation.

These files are frozen for this correction. Do not edit tests or fixtures to
accommodate an engine change. See `runaway-contact-root-cause.md` for the
independent original-binary numerical oracle and evidence limitations.

## Green implementation

The unchanged 14-test contract passes after the engine correction. The complete
zero-friction production fixture starts at energy `0.3377283333`, ends at
`0.3306201036`, and its largest observed response energy is `0.3306201126`.
The old implementation reached approximately `1.98e13` in this same test.
Its first admitted packet now contains the upward sampled encounter; the
contradictory later downward chord is absent. The raw contradictory packet
independently returns a finite native-like partial solution with a numerical
failure report. It cannot rely on admission to hide solver failure.

No test, fixture or runner bytes changed after checkpoint `f76c807`.
This numerical reproduction is not a reconstruction of FAIR's unrecorded
historical first impulse, and is not a hardware FPS benchmark.

## Broader validation and limits

- Production TypeScript/Vite build passes. The full unchanged suite runs 3440
  tests: 3434 pass, five skip, one intermittent Vite HMR-shutdown test times out.
  That unchanged server test passes individually in both baseline and isolated
  checkouts with loopback access. No physics regression fails in that run.
- The unchanged headless crash matrix passes its three Stock cases (Eagle3,
  Buggy, Bigdump), including deformation, component damage and non-wasted repair.
  Its old Advanced Carrier mission fixture now selects a practice-only event
  with no rival, so the full harness stops there. This test was not altered.
- A separate real Chromium/DevTools check uses original Stock Desert1/Plow and
  Advanced Fridge Racer/69mach1 content. Plow/Zee impact deforms the rival and
  detaches two parts; 69mach1/Coupe impact deforms both bodies and causes
  authored component damage. Non-wasted Coupe repair clears all component
  levels and advances the deformation revision. Screenshots were inspected;
  console and WebGL errors are absent.
- Hardware is ANGLE AMD Radeon Graphics, radeonsi gfx1150/LLVM19.1.7, buffer
  2070x1435. Short serial captures, with diagnostic overhead, show Stock normal
  driving tick median9.3ms/p95 26.5ms (cold max135.8ms), Stock crash max104.7ms;
  Advanced crash median13.8ms/p95 32.7ms/max33.5ms. These are bounded correctness
  smoke captures, not an FPS comparison against the unrecorded historical crash.
- The user's original paused tab was preserved at elapsed325.68 throughout;
  builds and playtests used a separate checkout/server/tab.

PERF-24 remains open for durable first-event capture and extreme-motion
workload/lifecycle hardening. The correction removes the demonstrated energy
source without claiming to make every possible runaway motion cheap.

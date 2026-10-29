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

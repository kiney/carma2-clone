# PHY-17: grounded split-secondary commitment

## Evidence and cause

The historical original Porker2 grounded SPAM report contained a split secondary
with nonzero launch velocity but unchanged position. It did not retain the full
damaged pose, final velocity or admission/guard history. The new fixture is a
bounded original-data reproduction of the stationary mechanism, not a claim to
restore that unavailable scene exactly.

Eight deterministic original component impacts, two due original WAM attachments
(parts 6/RWING02 and 7/RBUMP02), and ten SPAM rays create the split without a
prolonged simulation search or directly assigning component damage. A finite
two-triangle support floor isolates world contact from unrelated scenery. The
historical launch vector is an explicit controlled input.

The secondary is PHIL-active and fails the quiet test on linear speed. Pair
commitment is unrestricted, but the browser-added world trajectory guard returns
fraction zero. A two-sided, old support-plane touch emits a moving-hull contact
even though both endpoint hulls remain on the same side of the plane. That row
incorrectly blocks separation. Native response still changes velocity normally;
this is a commitment defect, not evidence that sleep or split launch is broken.

## Correction and scope

For each existing angular sample, test whether all OLD and NEXT hull vertices
lie in one common closed halfspace of a nondegenerate world face plane, using
the existing geometric epsilon. Their world-space linear vertex paths and
interpolated edges cannot cross that plane. The independent browser guard may
therefore suppress those moving-hull feature emitters for that face. Edge-only
scenery is excluded from the certificate. No nearby face is removed.

This is **not** a certificate for a complete rotating trajectory. In particular,
the static-world-vertex emitter interpolates in inverse body frames. Its path
can enter between two clear endpoint poses. That emitter remains enabled, as do
native contacts, existing overlap recovery, shallow recovery and independent
new obstacles. A dedicated option avoids the existing `skipWorldEdges` option,
which also disables world-vertex emission.

Evidence classification: experimentally reproduced browser-engine defect and
independent geometric correction. No newly recovered original executable
formula is claimed. Native impulses, friction, split mass/COM/inertia, PHIL,
quiet thresholds, attachment joints and repair are unchanged. There is no
velocity nudge, global guard exemption or sleep override.

## Conformance cases

`tests/phy17-grounded-split.test.mjs` covers original Porker2 grounded and airborne
splits, one normal production tick, real attachments, partition mass and
unchanged secondary moments/COM, then repair and removal. An independent wall
still caps motion. Entering and old-overlap paths, edge-only faces and
degenerate triangles cannot use the separating certificate incorrectly.

A mandatory thin rotating hull regression has clear endpoints but enters a
finite world triangle vertex between them. It retains world-vertex contact
fraction `0.299967163` and the actual trajectory guard still limits advancement.
This caught and rejected an earlier whole-face filtering approach before
integration.

## Validation, 2026-10-24

- Full `npm test`: 3,119 passed, zero failures/skips. Production build passed.
- `node tests/browser-crash-matrix.mjs --core-only`: all four Stock/Advanced
  production crash cases passed with clean console/network and WebGL status.
  This deliberately excludes the old prolonged split search.
- `npm run test:grounded-split`: Chromium grounded, airborne and new-wall cases
  passed. Two ticks per case include full repair; real attachments, mass/moments,
  PHIL, quiet state, finite transforms and GL/console/network checks passed.
  This source-module SwiftShader test asserts correctness, not hardware speed.
- Chrome DevTools MCP in visible Chromium on AMD/radeonsi reproduced the grounded
  case: guard fraction 1, first-tick displacement
  `[0.053549861, 0.000400400, -0.021598477]`, both real attachments parented to
  the secondary. Repair restored mass 2, removed owned debris, released quiet
  state and unregistered the secondary. Screenshots were inspected; no GL or
  console warnings/errors. A separate production Timber/Porker2 W-key drive
  also advanced normally before this controlled source-module inspection.

Ignored evidence: `artifacts/phy17-full-tests.log`,
`artifacts/browser-crash-matrix-core.json`,
`artifacts/browser-phy17-split.json` and the six
`artifacts/browser-phy17-*-{split,repair}.png` screenshots. Original data is read
directly and remains unchanged. The still-open PERF-01 umbrella is separate from
this specific motion defect.

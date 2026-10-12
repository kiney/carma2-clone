# PHY-12: nearby blocked props freezing clear cars

## Finding

The independently implemented PHY-09 trajectory guard coupled every allowed
broadphase-near movable body before checking whether their paths actually
conflicted. One blocked prop could therefore stop a completely separated car,
including an airborne car. This behavior was already present before PERF-09.
It is an experimentally reproduced browser defect, not reconstructed C2
behavior. PHY-10's body-supported, unloaded-driven-wheel terrain traps and
PHY-11's degenerate crushed hulls remain separate issues.

With an original Eagle 0.05 world units above a small generated prop, both
independent car checks accept the complete trajectory. The prop overlaps an
immovable blocker and cannot move further inward. The old grouping reduced
the car's accepted movement from 0.1 to 0.0000009918212890625 world units.
The corrected guard accepts 0.1 while preserving the prop's exact limit
0.000009918212890625. No push, impulse, damage, suspension or tyre coefficient
changes are involved.

## Constraint handling

1. Preserve broadphase discovery, pair masks, attachment ancestry and the
   original per-pair guard. Evaluate every original full-path pair once.
2. Couple attachment groups and movable paths whose exact guard rejects part
   of their trajectory. Proximity alone no longer couples bodies.
3. Assign each group the minimum original certificate affecting its members.
   Same-prefix trajectories retain their original certificates; certified
   constant immovable paths remain safe with a shortened movable path.
4. Revalidate candidate pairs with unequal movement fractions. Independently
   slowing one body can otherwise introduce a collision absent from the
   original full trajectories. If it does, merge at the minimum existing
   common-prefix limit and revisit affected pairs. Applying the new pair
   fraction multiplicatively would certify the wrong relative-time paths.
5. Keep full angular-travel bounds on prefix wrappers. A bound is not a claim
   of constant angular speed. Geometry caches retain phase/path identity and
   cannot survive crush, repair or joint projection.

Revalidation is bounded to `max(64, 4 × candidate pair count)` exact checks.
On exhaustion, conservatively seal the affected complete allowed movable
broadphase component using its original certificates; disconnected components
are unaffected. Remaining unresolved components are checked/sealed without
resetting the global budget. Custom immovable pose providers lacking an
explicit constant-pose certificate retain legacy conservative coupling.
Production integration and joint-projection paths already supply these
certificates. The existing 128 angular samples, overlap escape allowance and
native contact/impulse solver are unchanged.

This guard remains a browser integration safety extension. It does not claim
that its orchestration reproduces the original executable timestep exactly.

## Verification

- Ten focused regressions cover separated blocked props, ordering/masks,
  induced third-body crossings, attached/released parts, downward contact,
  repeated geometry changes, actual original Eagle damage/repair and an 8π
  COM orbit with a remote secondary hull. Existing common-time, angular
  interlock, world clipping and projection tests remain enabled.
- A separate 30-neighbor stress regression exhausts exactly 260 revalidation
  calls (four times its 65 allowed pairs), checks conservative component-wide
  clipping and 17 independent geometry samples per allowed pair, and confirms
  that a disconnected clear body remains free beside its blocked prop.
- A historical multi-hull test expected an unrelated escaping body to inherit
  another hull's constraint. Its expectation now checks collision safety and
  free escape; the actual constrained pair retains its numerical limits.
- The full suite passes 2,645 tests with the local installation. The production
  build passes. All 15 deterministic original-car crash reports exactly match
  the accepted pre-fix baseline, including damage and deformation results.
- Production Chromium crash-matrix and spawn/pair suites pass: Stock/Advanced
  cars, original deformation/detachment/repair, DUNE terrain grids and real
  keyboard reverse release, with no fatal console/request/WebGL errors.
- Chrome DevTools on TIMBER confirms keyboard driving (2.624 world units of
  displacement in the short probe), a live Eagle/Coupe crash (geometry
  revisions 1/3, engine damage 50), repair restoring component damage to zero,
  and the exact separated-prop regression. Console warnings/errors are empty;
  WebGL error is zero. Screenshots were inspected.
- Installed HW/SW executable SHA-256 hashes still match the recorded originals;
  original assets and generated reports remain ignored and untracked.

The separated-prop fixture performs four exact pair checks instead of three:
the extra check certifies independently clipped paths. Short ABBA CPU samples
were 1.8/1.1/0.7/0.4 ms (old/new/new/old), affected by warmup and workstation
scheduling; these are not a frame-rate or performance improvement claim.
Diagnostics expose dependency merges, revalidation calls and conservative
fallbacks. Ignored numerical/browser reports are under `artifacts/`.

For the optional local before/after DevTools probe, prepare a source-only
baseline outside tracked source:

```sh
mkdir -p artifacts/phy12-reference
git archive fc243de | tar -x -C artifacts/phy12-reference
npm run dev
```

Load and pause a race, then evaluate
`(await import('/tools/guard-coupling-probe.mjs')).inspectGuardCoupling()`.
It clones the live original car geometry into an isolated guard check and
does not change game state. No proprietary fixture is included.

This fix does not establish that every reported upside-down roof or
repair-release symptom has the same cause. Roof contact queries do not exclude
rolled cars, and the stock Eagle's main roof fits its authored collision hull.
A separate rejected-hull/repair property-coherence hypothesis still needs
source-based verification; no speculative repair behavior was changed here.

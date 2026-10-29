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
d2c94993589d45bf05516ad12ff0d89ca3844f0cdd79fa006a84d53d6bcc3bcc  tests/support/world-joint-phase-fixture.mjs
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
The real-scene workload check below independently verifies that sustained
repeated work disappears; green phase tests alone would not establish that.

### Test-setup correction before the replacement red checkpoint

The first checkpoint `6151d4b` contained an invalid free-body control: passing
`jointType: none` failed to remove `createNonCarBody`'s default WORLD joint.
That control was physically indistinguishable from the attached case. The root
caught it during the first candidate run and did not add an engine exception to
satisfy it. The engine was restored byte-for-byte to the unchanged baseline,
then only the fixture setup was corrected to clear that joint and attachment.
No assertion or expected value changed. Baseline again gives six passes/eight
expected failures. The assertion file and runner hashes are unchanged; the
fixture hash above supersedes `7165b4f2...`. This correction is explicit rather
than claiming that the first fixture was valid or silently weakening a test.

## Implemented correction and cache ownership

`world-joint-phase.ts` captures native OLD detection provenance for ordinary
fixed WORLD NONCAR ball joints. The additional angular sweep omits only those
exact qualified finite faces for that hull and captured phase. Native contact
emission, impulses, friction, thirty-response limit, authored bend/release and
quiet thresholds remain unchanged. A released actor marker also disqualifies
stale attachment metadata. The next clear phase rearms normal protection.

The working-set guard key includes the native feature producer's certified
result identity, static-world revision, attachment state, actor marker and
authored joint kind. Pose/joint geometry remains in the existing snapshot key.
Thus native face-inventory or release changes invalidate admission even if the
pose happens to stay equal. Unknown revision providers retain the guarded path.
Independent review found no production-path cache blocker.

## Original-scene browser comparison

Short serial MCP runs used separate production tabs, preserving the user's
original tab and damaged scene. Each loaded original Advanced Fridge Racer with
69mach1, admitted the actual retained actors `&44C0112` and `&44C0126`, then
restored their captured state, properties, flags and authored anchor. Geometry,
world collection and all responses were the real browser engine. No replacement
floor, forced sleep, modified impulse or guard wrapper was used.

| Observation | Baseline `index-DZzIaBW9.js` | Fixed `index-C4e27w3i.js` |
| --- | --- | --- |
| Cone responses in first 40 ticks | 2,400 | 318 (including 9 ordinary responses after release) |
| Committed movement | Both remain at the captured poses | Both advance and cross authored release thresholds |
| Tick CPU median, first 40 ticks | 48.65 ms | 9.60 ms |
| Tick CPU median, ticks 11–40 | 44.60 ms | 9.25 ms |
| Fixed state after 80 ticks | Not run further | Both released; zero linear/angular velocities; no forced sleep |

The fixed first cone stops its repeated response sequence at tick 10; the second
after tick 1. Subsequent free-body floor contacts remain active. Counts identify
the removed workload more reliably than timings: fresh-scene opponent rosters,
JIT warm-up, diagnostic overhead and shared workstation activity make CPU/FPS
measurements noisy. This is a replay of the **two captured bodies in their real
level**, not restoration of the user's complete damaged race or a universal
fivefold frame-rate claim.

A subsequent 2.8-second normal graphical run recorded 39 real physics ticks:
median 12 ms, p95 36.8 ms, max 47 ms; neither cone generated a response. Frame
interval median 33.3 ms, p95 50.1 ms, max 116.7 ms. Hardware was ANGLE AMD Radeon
(radeonsi gfx1150 / LLVM 19.1.7), OpenGL 4.6, buffer 2073×1438, DPR about 1.48,
4×MSAA. WebGL error was zero; no warning/error console messages occurred. An
earlier candidate graphical capture had no ticks because the preceding manual
steps had advanced physics ahead of graphical game time; it is excluded from
performance conclusions. Browser focus/cadence remains separate.

Original 69mach1/Skyline controlled collisions produced seven accepted pair
impact records. A second collision raised 69mach1 engine damage to 56 and
advanced deformation revision; normal repair cleared all twelve components.
Both cars retained finite states. The focused unchanged PERF-24 regressions pass
14/14, new frozen regressions 14/14, and working-set/native-contact cache tests
pass. Production build passes. The full candidate suite recorded 3,454 tests:
3,448 pass, 5 skip and one intermittent unrelated HMR-shutdown timeout; the
focused server suite subsequently passes 8/8 with loopback socket access.

## Remaining fidelity questions

The source calls TestNonCarSnapOff from the per-response post-movement callback;
the browser currently checks bending after committed movement. Separately,
`createNonCarBody` initially derives attachment from mechanics even for an
authored `!` released marker, although mass selection does inspect the marker.
These need a focused lifecycle audit before claiming exact source callback and
load-mode parity. Neither is silently changed as part of this phase correction.
The historical FAIR first-event replay and extreme-motion lifecycle hardening
remain PERF-24, not acceptance claims of PERF-25.

# Collision query and shape ownership (PERF-13)

Implementation compared with engine `dee3f79`. This reduces redundant geometry
work in the measured Timber physics path. It does **not** establish that the
user's directional 6 FPS stall is fully resolved. PERF-13 remains active until
the hardware route can be measured again; PERF-01 remains the umbrella task.

## Why correction passes were not simply removed

The [live capture](live-timber-drop.md) measures up to five ticks/263 ms per
update, usually eight correction rounds and 4,347 world-guard calls per tick.
Repeated contact rows are not necessarily redundant responses: resting rows
have a minimum RHS, impulses change paths, and joint preprocessing, damage and
restart callbacks have observable effects.

The rec2 map leaves `DoCollisions` incomplete. Installed HW `0x4ba450` calls
the local response path `0x4bac60`, retains a local 30-retry guard and a
conditional global traversal restart. It does not establish our eight global
rounds as native C2 behavior. This change retains every round, callback and
solver ordering rather than pretending repeated rows are no-ops. Native 40 ms
steps, catch-up/restart limits, angular sampling and guard bisection remain intact.

## Work removed

- **Owned collision snapshots.** The built-in loaders explicitly opt into
  deeply frozen local hull graphs. Cars keep independently cloned, mutable
  DamageSystem shape vertices; accepted crush/repair publishes a new frozen
  collider generation. Split children and detached parts inherit this policy.
  NONCAR construction also owns its hull graph. Exact array identity can thus
  replace repeated walks of vertices, planes, indices and edges. Mutable/default
  constructors and unsealed replacements retain the old numerical checks.
- **Static guard geometry.** Only certified source hulls on explicitly stable,
  constant paths while immovable retain transformed geometry between guard
  phases. Source identity and all seven pose values must match with `Object.is`.
  Wake, motion, replacement, masks and ancestry still take their normal paths.
  Penetration allowances, dependencies and safe fractions never persist.
- **Query-specific answers.** The commitment guard requests a strict depth
  predicate and the first feature fraction. It no longer constructs a complete
  SAT minimum or solver normals/torque points/manifold that it discards.
  Positive old overlap retains exact depths for cumulative escape allowances.
- **Exact edge direction reuse.** Repeated raw edge vector bits are considered
  once before the SAT cross product. First authored order and signed zero are
  preserved. Nonfinite/overflow-risk vectors retain original traversal; lists
  above 64 edges independently bypass optional quadratic deduplication.
- **Allocation-free rejected edge queries.** `sweepMovingEdges` retains original
  subtraction/cross/dot arithmetic, quadratic roots, segment gates and Float32
  fractions using scalars. Two fixed root slots retain stable ordering, including
  equal roots and signed zero. Contact objects are built only after acceptance.
  Plane clipping likewise avoids per-plane vectors, and local transforms share
  an unchanged inverse quaternion within one point-array query.
- **Empty world guards.** Dormant/suppressed-world early returns use one private
  frozen empty result rather than thousands of fresh objects and arrays.

No car, pedestrian or scenery population, visual range, shape, force, impulse,
damage formula or collision tolerance was reduced. These are independent
browser implementation optimizations, not newly reconstructed native formulas.

## Numerical and structural evidence

Independent legacy oracles retain this project's pre-change MIT mathematics.
Tests compare strict depth results, complete emitted contacts, feature fractions,
signed zeros, exceptional/overflow geometry, compact/wire storage and seeded
translation/rotation/edge cases. A rejected edge pair drops from at least seven
vector clones to zero and no longer sorts an allocated root array. A representative
axis-aligned box pair drops from 144 edge crosses to nine, with identical contact.

Original EAGLE3 tests compare sealed/default constructors through localized crush,
accepted shape swap, repair, detachment and split; old published geometry stays
unchanged while mutable damage data deforms. Unsealed custom replacement restores
the value-walk fallback. Pose/wake/custom-path tests compare the retained static
guard with the legacy numerical guard.

The two saved 483-body user snapshots produce exactly identical guard fractions.
Warm static reuse removes 757 hull transforms per guard phase. These are cloned
full-40 ms next-trajectory checks; they omit world clipping, forces and correction
callbacks and are **not** full-frame replays. An early reconstruction accidentally
shared external NONCAR joint anchors and invented static attachment relations;
its timings are excluded. Corrected probes give each object its own native-style
anchor.

## Bounded browser measurements

`tools/profile-guard-kernel.mjs` uses separate loopback source checkouts, serial
ABBA samples, original Stock/Advanced Timber and the existing prepared crash
fixture. Each case has two deterministic manual ticks and a separate 250 ms
normal-frame capture with drawing suppressed. The first tick has counters;
the second disables them. Initial state, ordered impulses/damage/hull revisions,
kinematics, attachment state and traced world fractions match exactly in all modes.
Eight correction rounds, validity changes, geometry counts and emitted pair work
are unchanged. In the traced Stock case, 60,694 repeated dormant-bound vertex
checks become zero; all 4,186 valid bounds admissions remain.

Final backend: **SwiftShader**, drawing buffer 2098 x 1466, DPR 1.484375.
These are short CPU observations on a shared host, not hardware FPS claims.
Report: ignored `artifacts/perf13-final-serial.json`.

| Catalog  | Mode      | Manual ticks, ms (traced / minimal) | Frame-tick count | Frame-tick p50 / p95 / max, ms | Frame max, ms |
| -------- | --------- | ----------------------------------- | ---------------: | ------------------------------ | ------------: |
| Stock    | baseline  | 169.6 / 67.0                        |                8 | 46.1 / 85.4 / 85.4             |         178.8 |
| Stock    | optimized | 108.3 / 68.6                        |                8 | 34.4 / 44.9 / 44.9             |          77.5 |
| Stock    | optimized | 86.2 / 56.3                         |                9 | 28.9 / 53.1 / 53.1             |         111.3 |
| Stock    | baseline  | 104.0 / 69.4                        |                8 | 44.5 / 56.3 / 56.3             |         209.8 |
| Advanced | baseline  | 141.7 / 73.8                        |                7 | 40.3 / 54.8 / 54.8             |         109.5 |
| Advanced | optimized | 113.0 / 51.5                        |                7 | 29.3 / 57.2 / 57.2             |          88.5 |
| Advanced | optimized | 88.6 / 69.2                         |                7 | 33.9 / 54.8 / 54.8             |          87.5 |
| Advanced | baseline  | 86.8 / 88.9                         |                9 | 33.3 / 56.9 / 56.9             |         166.3 |

The Stock tick distributions and frame maxima improve. Advanced results retain
an adverse 57.2 ms tick tail and a median slightly above the last baseline;
the minimal Stock first sample also worsens. Earlier staged comparisons and
cold/JIT/adverse frozen samples remain in ignored artifacts. No uniform percentage
or steady-FPS guarantee follows from these small samples. One exploratory CPU
profile overlapped a regression suite; its timings are excluded. Diagnostic
navigation aborts of the preceding document's optional assets are recorded
separately; failures in a running scene remain fatal.

Hardware/MCP startup failed before application evaluation: target discovery/page
creation timed out. A bounded headless EGL probe reports `Permission denied`
opening `/dev/dri/renderD128` and no WebGL2 context; this session has `video` but
not `render` group access, and the render node has no user ACL. The accessible
primary node did not yield a hardware WebGL2 context either. This does not prove
that the headful controller timeout has the same cause. No permissions, groups,
driver configuration or system packages were changed. Isolated Chromium fallback
tests continue with SwiftShader. The old controlled browser was restarted during
diagnosis; its user trace and full collision snapshot had already been saved.

## Runtime regression checks

The final production build and all **2,723 tests** pass with no failures/skips.
Fifteen original-car crash conformance reports match the baseline byte-for-byte.
Production Chromium verifies Stock Eagle/Buggy/Bigdump and Advanced 69mach1
impacts, continued motion, severe deformation, physical detachment, split-child
state, joints and repair/reset. Four original-track NONCAR debris/joint-release
and repair cases also pass. Screenshots of actual impact/repair were inspected;
console, running-scene asset requests and WebGL checks are clean. The supported
spawn/interlock suite also passes on the final build. Original motion-powerup
regressions verify suspension, bounce, wall climbing, gravity and pinball responses
with the published immutable car collision generations.

These runs use the isolated software Chromium harness because MCP/hardware
startup is unavailable. This validates application behavior, not hardware FPS.

## Remaining acceptance work

Repeat a short minimally instrumented hardware capture on the reported route,
including the direction/heading and update-frame step count. The native-frame
catch-up feedback can amplify ticks near the 40 ms budget; a cheaper tick alone
does not prove the complete stall has gone. Eight global correction rounds and
high-angular-travel part guards remain expensive. Changing that behavior needs
separate native/dependency evidence, not a lower cap or cached solved impulse.
The own-debris road lockup remains the separate PHY-13 ticket.

Run comparisons serially:

```sh
# Two source-only checkouts serving the same CARMA2_ROOT; defaults are 5194/5195.
node tools/profile-guard-kernel.mjs --samples 4
node tools/profile-guard-kernel.mjs --hardware --samples 2
node --import tsx tools/frozen-guard-report.mjs \
  --baseline /tmp/carma-perf13-baseline
```

Tools are not imported by production. Original data and asset-derived snapshots,
reports and screenshots stay ignored and unmodified.

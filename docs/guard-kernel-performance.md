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
The [root-cause analysis](perf13-root-cause-analysis.md) identifies a plausible Cerby/own-hood cluster contributor to frame-window
feedback. Its dominant cost and live commit fractions need per-pass replay.
PERF-13 investigation now includes the PHY-13 evidence gap.

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

## Reviewed follow-up: correction attribution and allocation work

The reviewed analysis is committed separately as `b6b2a47`. Its bounded partial
body-pair/joint replay confirms real impulses in every round, concentrated on
the Cerby/hood/wing/bumper cluster. It does not restore the world, forces or
damage state; see `perf13-root-cause-analysis.md` for results and native retry
findings. No empty-impulse exit, joint-group skipping, velocity reset or tighter
angular sample grid is implemented.

Further exact reductions:

- Scalar SAT axis normalization, dot/cross products and world-edge differences
  preserve original operation order, authored order, signed zeros, exceptional
  arithmetic and the64-edge dedup fallback. Each query uses one scratch axis
  rather than cloned face/edge/cross vectors; selected contact normals still
  receive independent clones.
- One ordered body roster is reused within each synchronous correction
  collection phase. The next pass and final commitment rebuild it after
  preparation, damage, activation and restart callbacks. Uncached diagnostics
  retain the original calls and ordered decisions.
- `createRigidBodyPosePath` captures an immovable body with two pose clones,
  instead of cloning motion plus spreading the entire body/state and creating
  a per-body time map. Moving paths retain literal `step * worldFraction * t`
  and `momentumBound * step * worldFraction` grouping and original shared
  property semantics. Four fewer clones and two fewer newly constructed pose
  objects per fixed body mean2796 fewer Vector3/Quaternion objects for466
  dormant props during each commitment, plus466 fewer per-body time maps.
- A guard phase stores fixed constant-path samples in a direct body/path entry
  instead of two nested maps per fixed body. Seven exact pose comparisons avoid
  another temporary scalar array. Shape/pose/immutability certificates,
  wake-up, custom moving-path fallback and per-pair escape allowances remain.

These reductions apply to the pure synchronous guard/collection phase and plain
native state fields; side-effectful custom getters or providers mutating bodies
within a promised pure phase are outside that certificate.

The frozen-guard tool now uses each baseline checkout's own optional hull sealer.
This matters when comparing two revisions that both certify source ownership:
using the optimized module's sealer on baseline objects would leave the baseline
uncertified. Old references without that module retain their original mutable
path. New reports record baseline source and ownership availability.

Hardware MCP reconnected during this follow-up. Stage1 (SAT/roster only) ran
serially in actual AMD ANGLE/radeonsi Chromium, drawing buffer2100×1466. Original
Stock Timber recreated crash fixture: two manual ticks and250ms CPU-only frame
sampling with drawing suppressed. All initial-state, ordered final-state and
world-fraction SHA-256 values match across ABBA; GL error0.

| Stage1          | Manual traced/minimal tick (ms) | Frame tick p50/p95 (ms) |
| --------------- | ------------------------------- | ----------------------- |
| Baseline3b15b44 | 175.3 /71.7                     | 30.6 /57.7              |
| SAT/roster      | 134.3 /66.4                     | 27.0 /55.4              |
| SAT/roster      | 144.2 /84.5                     | 40.1 /49.4              |
| Baseline3b15b44 | 94.9 /43.8                      | 25.8 /50.0              |

The adverse optimized sample and faster final baseline are retained. This
establishes numerical preservation and removes known allocations; it does not
establish a uniform speedup or solve the user route's6FPS drop. The hardware
fixture is not the saved Cerby scene or an end-to-end rendered FPS benchmark.
Ignored report: `artifacts/perf13-reviewed-hardware-abba.json`. Frozen probes
made while a browser capture could overlap are excluded from timing claims.

Final follow-up ABBA includes fixed-body path/cache reductions, with the same
hardware/context/buffer and bounded recreated Stock fixture. All three state/
fraction hashes remain identical; GL error0.

| Final           | Manual traced/minimal tick (ms) | Frame tick p50/p95 (ms) |
| --------------- | ------------------------------- | ----------------------- |
| Baseline3b15b44 | 95.7 /65.9                      | 33.1 /44.5              |
| Final optimized | 117.5 /53.2                     | 23.0 /44.8              |
| Final optimized | 135.6 /54.8                     | 32.5 /40.4              |
| Baseline3b15b44 | 126.6 /53.3                     | 41.3 /59.4              |

Typical tick costs are lower in these final short samples; traced/cold times
and one tail remain adverse, and the last baseline minimal tick matches the
optimized ones. No universal percentage or60FPS claim follows. Final report:
`artifacts/perf13-reviewed-hardware-final.json`. Source remains at40ms/max5 ticks,
eight correction rounds,30 local restarts and unchanged angular/bisection caps.

Final full suite:2733 passed, zero failures/skips. Production build passes.
The15-scenario original-car crash report matches the existing baseline byte for
byte. Independent review confirms the arithmetic, pose alias/ownership,
phase-scoped roster and custom-path fallback boundaries. Production Chromium crash/repair validation passes: original Stock Eagle,
Buggy and Bigdump, Advanced69mach1, and the existing Porker2 split/repair
checks. Console errors and failed requests are empty; WebGL error0. Screenshots
are saved by the harness under ignored artifacts/. PERF-13 remains WIP: the original
Cerby lockup, full world/damage replay and actual rendered user-route drop are
not declared fixed by these allocations or recreated fixture measurements.

MCP also loaded ordinary Timber and ran a controlled head-on collision during
normal frame updates/driving input: player health100→91, opponent100→44,
player deformation revision0→1, actual position movement and GL error0.
An injected Window keyboard event exposed an unrelated event-target assumption
in `main.ts`; UI-04/TASK-107 adds an Element check before `closest()`. After a
fresh document load, Window/document KeyW events both reach throttle1, while
input/select/button/textarea targets remain excluded (throttle0). The production
build passes after this UI guard; final controlled console and failed resource
lists are empty, WebGL error0. This minor validation fix changes no physics.

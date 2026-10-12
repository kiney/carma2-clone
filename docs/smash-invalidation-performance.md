# Smash notification and collision invalidation

PERF-10 / TASK-100.5. Reference revision: `733435c`.

## Executive Summary

Unchanged texture-tile smash requests retain notifications, queue/cap behavior
and the existing solver restarts without rebuilding collision geometry. Actual
changes regenerate only affected static meshes, dynamic owners and native MODELs.
In original Stock/Advanced TIMBER, preparing one TEZFEN tile regenerates 155
static triangles instead of 17,707 static plus 9,210 dynamic triangles. Reusing
the tile regenerates none. This removes a separate 18–29 ms repeat-contact cost
in the short capture; it does not establish a fix for every canyon FPS drop.

## Behavior and ownership

Installed HW preparation `0x4f1660` reuses existing tiles at `0x4f2774` /
`0x4f2839`; the notification output at `0x4f2ad5–0x4f2adc` is written even when
enqueue returns null. Reinspection verifies this for decals too. The dispatcher
also consumes it for event piping; this output alone is not proof of an exact
native solver-restart rule. This optimization preserves the browser's existing
restart decisions, including its decal mapping, rather than changing physics.
See [queue evidence](c2-world-smash-queue-re.md).

`WorldDestructionResult.changed` notifications and the legacy
`requiresRebuild` field remain intact. The latter now explicitly documents its
existing solver-restart purpose. `geometryChanged` and `geometryRevision` track
actual collision-representation changes: first non-decal preparation, accepted
live-model tier rewrites, removal/disable and replacement. Reused unchanged
preparation no longer increments the revision. Dirtiness is queued by actor
before callbacks and drained by one collision adapter consumer; callbacks and
connotations retain their order. Rejected full queues still prepare new tiles
immediately; equal/lower/rejected existing requests retain notifications without
inventing dirtiness. A pending old texture commit cannot resurrect a replaced
model. Accepted tier commits still perform their existing mesh rewrite.

`VehicleSimulation.synchronizeWorldDestruction()` is shared by body contacts,
wheel flush barriers, final queue flushes and followup dispatch. Body restart,
type9 rows, impulse caps, queue limits/order/clocks and effects remain unchanged.
Wheel preparation and a flush commit can share one collision update instead of
redundant global rebuilds. Legacy standalone world adapters lacking targeted
invalidation retain a conservative global fallback.

`WorldCollision` retains static per-mesh surfaces, indexed cell keys/counts,
ancestry membership and canonical owner order. Targeted invalidation removes old
cell entries and inserts new surfaces at their original owner/face order. New or
relinked subtrees refresh canonical order; ordinary tile/material changes avoid
a whole-scene order scan. Removed generated children disappear, while original
source-snapshot references remain retained according to the previous broad-rebuild
contract. Old returned rows stay immutable and unrelated row identities survive.
Dynamic owners containing, formerly containing or descending from a changed
subtree refresh individually. Replacement includes disabled sibling subtrees.

Native mesh-to-actor associations identify the affected MODELs. Explicit
invalidation checks in-place RAW metadata deeply for those models only; normal
query preflight keeps PERF-09's cheaper checks. Newly admitted associations are
retained. Mutation creates actor-private MODEL resources and preserves shared
original DAT resources, replacement source-face ownership and material bindings.

For actual changes, the finite 300-face ring still invalidates globally at the
established barriers. Spatially filtering that ring would change collector
callbacks, aliasing and wrap chronology and requires separate native evidence.
Unchanged preparation does not invalidate it. Unchanged collision owners retain
their triangle data; this ticket does not introduce a different ring policy.

## Short serial comparison

The paused original scene uses its actual TEZFEN threshold 1 and contact impulse
0.55: one new tile followed by two unchanged contacts, no queued effects or
simulation ticks. Independent caches compare the archived implementation's
global rebuild/refresh with targeted invalidation, in serial ABBA order. Native
MODEL bindings are isolated outside the timed regions; all native rows,
callbacks, capacity-one prefixes and static candidate ordering agree exactly.
Setup is excluded and each scene's capture has a two-second bound.

Chromium uses explicitly selected SwiftShader/ANGLE Vulkan, buffer 1280×800,
DPR1. These are CPU operation timings, not hardware GPU or FPS measurements.
Both tracks have 466 dynamic owners and 1,214 native mesh records. All reported
samples, including the slower cold Stock sample, are retained under ignored
`artifacts/perf10-smash-invalidation.json`.

| Scene / operation           | Old ABBA samples (ms) | New ABBA samples (ms) |
| --------------------------- | --------------------- | --------------------- |
| Stock, first preparation    | 32.7, 30.5            | 19.4, 1.0             |
| Stock, reuse 1              | 22.9, 24.8            | <0.1, <0.1            |
| Stock, reuse 2              | 27.3, 18.8            | <0.1, <0.1            |
| Advanced, first preparation | 24.4, 22.7            | 1.3, 0.2              |
| Advanced, reuse 1           | 24.4, 21.5            | <0.1, <0.1            |
| Advanced, reuse 2           | 28.9, 17.9            | <0.1, <0.1            |

First preparation rebuilds one static owner/155 triangles, checks two associated
native MODELs and refreshes zero dynamic owners. The old path rebuilds 17,707
static triangles, checks 1,214 native records and forces all 466 dynamic owners
to rebuild 9,210 triangles. Reuse performs zero such work; `<0.1` reflects the
browser timer resolution rather than a claim of literally zero CPU time. First
notification can still admit newly created subtree state and refresh canonical
order. Empty untracked descendants may conservatively request that order scan
on genuine parent changes; they do not trigger unrelated triangle regeneration.

Reproduce with a source-only ignored reference and local server:

```sh
mkdir -p artifacts/perf10-reference
git archive 733435c | tar -x -C artifacts/perf10-reference
npm run dev
node tools/profile-smash-invalidation.mjs http://localhost:5173
```

The helper modifies a paused diagnostic tile and reloads the race before rendering
again. It runs Stock/Advanced serially, suppresses rendering during CPU capture,
checks console/network/WebGL and writes ignored reports/screenshots.

## Validation and limits

The full suite passes 2,657 tests. New tests cover first/reused/below-threshold
requests, equal/lower/higher/rejected queues, replacement, decal behavior, real
body restart and wheel caller paths, static cell removal/order/prefixes, dynamic
owner isolation, eligibility/facing changes and immutable snapshots. Native
collector tests now check immediate actor-local MODEL synchronization and
unversioned RAW face-flag changes before later callbacks. Fifteen deterministic
original Eagle/Buggy/Bigdump crash reports exactly match the accepted baseline.
The production build passes with the existing bundle-size warning.

Production Chromium smash-gameplay, noncar-debris, crash-matrix and render-matrix
suites pass serially. They validate original queue/effect/gameplay paths, four
Stock/Advanced physical scenery-debris cases, keyboard driving, permanent damage,
detachment/splitting/repair and original rendering, with no fatal console,
request or WebGL errors. These harnesses explicitly use SwiftShader rather than
claiming a hardware performance measurement.

Chrome DevTools MCP was attempted twice, but its existing browser timed out at
`Target.createBrowserContext` and `Target.createTarget`. Those are tool failures,
not application errors. Direct Chromium/CDP validation through the reproducible
project harness continues; the frozen Stock/Advanced capture has no console
errors, failed requests or WebGL errors, and rendered screenshots were inspected.

The independent earlier 4-FPS canyon capture had no world rebuilds. Do not
attribute it to this defect or claim stable frame rates from these microcaptures.
PERF-11's face locality and PERF-12's cross-correction reuse remain separate.
Physics formulas, step/correction/guard limits, activation distances, visual
visibility and rendering resolution are unchanged. No original assets are modified
or bundled. Existing coincident decal reuse and the Carrier actor-name assertion
in the smash-followup harness are not addressed here.

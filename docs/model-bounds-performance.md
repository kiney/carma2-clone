# Retained native MODEL bounds

PERF-08 / TASK-100.3, 2026-10-12. Engine baseline: `c89adfa`.

## Executive Summary

Unchanged engine-owned MODELs retain their exact raw Float32 bounds and radius.
Warm queries perform no vertex scans. Stock/Advanced collection retains ordered
faces, emission prefixes and callbacks; original crash results remain identical.
Short hardware Chromium comparisons show lower collector CPU cost, with cold
preparation and variable samples retained. Actor synchronization remains PERF-09;
this change does not claim stable FPS throughout Timber.

## Ownership and invalidation

`nativeTrackRawBounds` retains one result per explicitly managed resource in a
WeakMap. Validity checks resource revision, current MODEL object/identity, flags,
vertex-table identity and count in constant time. Initial resources, generated
migration MODELs, changing-powerup clones and actor-private geometry replacements
are admitted separately; a private owner never inherits another owner's result.

The existing engine mutation contract remains essential: call
`invalidateNativeTrackResource` **before in-place RAW coordinate, slot or table-order
edits**. It clears bounds and prepared geometry together. Bounds-defining changes
must not bypass this protocol. Direct flag/table/current replacements also fail
constant-time validity checks. Generic externally mutable structural resources
remain uncached; ACT traversal and live resource lookup are not memoized.

Migration can invoke arbitrary host callbacks. Bounds caching is suspended through
nested migrations and cleared on exit, including failure after partial changes.
A callback may read, change vertices and read again without retaining an earlier
observation. Cached result objects and their nested bounds arrays are frozen so
callers cannot corrupt another actor's bounds. Failures are never cached.

World smash, crush, split and repair already update render geometry identity or
position-buffer version. `WorldCollision.syncNativeGeometry` constructs the fresh
native owner before collection; this owner now participates in bounds retention.
Spinning-powerup flags use the existing resource invalidation. UV/pivot/face/
material/ACT-transform changes alone do not define raw bounds, although the shared
resource revision may conservatively invalidate after broader mutations.

The existing `nativeRawModelBounds` arithmetic is unchanged: all RAW vertices,
including unused ones, contribute; vertex zero seeds extrema; no pivot subtraction
occurs. Radius retains `Y² + Z² + X²`, the Float32 maximum stores and final rounded
square root. Custom flag `0x400` and empty tables retain explicit unresolved-owner
results; lazy cold iteration avoids mapping custom-owner vertices unnecessarily.

## Measurements

Original Stock Timber/Eagle, six rivals, 466 noncars and 584 pedestrians.
Chrome DevTools MCP used hardware AMD Radeon Graphics with ANGLE/radeonsi
OpenGL 4.6, viewport 1414×987, DPR 1.484375, buffer 2098×1465 and four-sample MSAA.
Frozen scene comparisons run serially, without simulation stepping, and compare
ordered rows and onFace/StopGroovidelic/pull callbacks exactly. Capacity-one
prefixes are also compared. The diagnostic bound is 1.5 seconds; no sustained
stress loop or forced GPU synchronization is used.

| Authored path node | Rows | Bounds requests | Uncached vertex reads | Warm vertex reads | Uncached samples (ms) | Cached samples (ms) |
| ------------------ | ---: | --------------: | --------------------: | ----------------: | --------------------- | ------------------- |
| 0                  |    2 |             126 |                 6,499 |                 0 | 4.2, 4.5              | 3.0, 2.8            |
| 4                  |    3 |             224 |                10,258 |                 0 | 5.1, 4.1              | 2.5, 2.6            |
| 178                |    2 |              94 |                 3,949 |                 0 | 1.5, 0.9              | 1.5, 0.8            |
| 192                |   12 |              53 |                 2,663 |                 0 | 2.7, 1.0              | 0.8, 0.8            |

All four warm queries compute **zero** bounds; every request hits the cache.
The overlapping-cold queries compute 32/20/9/5 newly visited owners and read
3,804/3,105/1,531/1,099 vertices. Their inclusive times are 16.2/4.0/1.5/0.9 ms;
these include cold scene synchronization. The shared scene holds 333 resources.
Every ABBA sample is retained, including the node178 sample with no improvement.
These are inclusive collector times and shared-workstation measurements, not
bounds-only timing or an FPS multiplier.

A short rendered keyboard drive advances 27 native ticks with no skipped physics
time. Its 3,163 bounds requests yield 3,147 hits and only 16 computations / 2,408
vertex reads. It displays 28.38 FPS, frame p50 29.2 ms / p95 61.8 ms / max 72.8 ms;
mean tick CPU is 17.33 ms. This is a smoke capture, not a paired FPS benchmark.
A controlled higher-speed car/car impact produces authored rival component damage
and deformation with no application or WebGL errors.

## Validation and remaining scope

- **2,611 headless tests pass**, including cache/Float32/signed-zero, explicit
  invalidation, MODEL/table/identity/flag changes, unmanaged live mutation,
  immutable results and repeated callback mutation/failure cases.
- Stock and Advanced original Newcity collectors compare uncached/cold/warm
  rows and callbacks, including the 300-row prefix and continued callbacks after
  capacity. Existing native collector/ring tests preserve ordering and wrap rules.
- Existing original geometry mutation/replacement tests verify private native
  ownership and immutable DAT preservation. All production admission/invalidation
  paths were independently reviewed.
- The production build passes. Fifteen deterministic original Eagle/Buggy/Bigdump
  crash outputs match the preceding accepted baseline exactly.
- Hardware MCP loading, driving, impacts, console inspection and screenshots pass.
  The additional production Chromium world-smash harness (SwiftShader) stops at
  a Carrier actor-name assertion: actual `&coR0|03.ACT`, expected `&coR0122.ACT`.
  The unchanged `c89adfa` baseline fails identically at the same assertion. This
  independent baseline defect is recorded under WLD-05; the whole harness is
  **not** reported as passing, and its final Carrier completion stage remains
  unverified by this run.

Whole-actor synchronization and broader geometry invalidation still perform work;
PERF-09–12 retain their existing scopes. Generic resources deliberately do not gain
cache speed until a host can guarantee the revision mutation protocol.

Opt-in `world.nativeModelBoundsOptions` accepts cumulative diagnostics
(`requests`, `cacheHits`, `computations`, `verticesVisited`, `unmanagedRequests`)
and a cache bypass for same-input comparisons. It is unset during normal gameplay.
The local source-only helper `/tools/model-bounds-performance-probe.mjs` is not
imported by the app or bundled into production. Ignored evidence:
`artifacts/perf-08-*.json`. Original data remains read-only and unbundled.

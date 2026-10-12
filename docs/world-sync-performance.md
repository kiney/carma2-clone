# World collision synchronization

PERF-09 / TASK-100.4, 2026-10-12. Reference engine: `6a1b225`.

## Executive Summary

Unchanged dynamic owners retain their collision triangles without recursive
matrix updates or matrix-string creation. Native queries synchronize only their
selected authored columns and the additional-actor container, before callbacks.
Exact physical transforms, ordered faces and callback snapshots are preserved.
This removes synchronization work without changing simulation clocks, contact
limits, activation distances or correction passes. It does not promise stable
FPS throughout Timber; broader face discovery remains PERF-11.
PERF-10's [owner-specific smash invalidation](smash-invalidation-performance.md)
now separates native notifications from real collision changes.

## Validity and ownership

`WorldTransformState` retains exact Three composition separately from presentation
`matrixWorld`. Each synchronization phase checks a shared ancestor once. Local
TRS values, manual affine matrices, automatic-update switches, parent identity
and parent revision determine validity. `matrixWorldAutoUpdate=false` retains
all sixteen authoritative world elements. Ordinary unchanged nodes perform no
composition or multiplication. Restoring physics TRS after render interpolation
does not leave collision geometry at the interpolated position.

Dynamic owners retain a snapshot of their hierarchy. Exact local poses, child
identity/order, parent links, external-parent revisions, disabled ancestors and
collision eligibility are checked before reconstruction. Descendant articulation
or crush can invalidate an owner even when its root has not moved. Only changed
owners rebuild triangles; previous returned surfaces remain independent snapshots.
Pose-only changes reuse unchanged mesh metadata and signature storage.

Mesh validity includes geometry and position/index/UV identities, versions,
arrays/counts, collision revisions, source-table identities, material bindings,
flags, sampling type and material groups. Attribute edits follow Three's
`needsUpdate` contract, including interleaved-buffer versions. Unversioned in-place
RAW metadata edits require the existing explicit invalidation outlets or
`geometry.userData.c2CollisionRevision`; they are not detected by scanning every
triangle on every query. `rebuildStatic()` also checks retained face metadata.
Current smash/replacement paths replace geometry/metadata and notify the world;
their broad rebuild policy was left for PERF-10, which now updates only notified
collision owners as described in the separate invalidation note.

Custom Three matrix-update methods use a conservative native hierarchy update.
They are classified without invoking them and remain uncached. Dynamic generation
and signature capture share one native update, avoiding repeated stateful calls.
Native synchronization carries the same captured world/parent matrices through
write and bookkeeping, rather than invoking custom methods again to remember them.

## Query and callback lifetime

The optional host `prepareActors` outlet receives exactly the selected native
column roots in the original X-then-Z order, followed by additional actors.
Preflight synchronizes each selected subtree once and retains native cycle checks.
The emitting collector still owns inheritance, pruning, face capacity and all
interleaved pull/StopGroovidelic callbacks, including capacity-zero queries.

Synchronizing individual actors during emission was rejected: an earlier callback
can move a parent while the renderer has reparented its retained child. Recomputing
the child's local matrix at that point would erase the borrowed parent movement.
Preflight preserves the query-start locals. Stop callbacks can still update the
borrowed twelve-element native matrix immediately; already emitted surfaces keep
their pre-callback coordinates. Native remove/add leaves the pulled local intact
until an actual host pose change or required Stop rewrite. Subsequent unchanged
Stop notifications reuse an already written matrix only while both transform
validity and the borrowed matrix contents still match. The first affine/Float32
rewrite remains required.

## Short hardware measurements

Stock Timber/Eagle: 1,445 native actors, 1,214 mesh records, 466 dynamic owners,
473 bodies and 584 pedestrians. Hardware Chromium via Chrome DevTools MCP used
AMD Radeon Graphics/ANGLE/radeonsi OpenGL 4.6, viewport 1412×985, DPR 1.484375,
buffer 2095×1462. Measurements use frozen original input, independent caches from
an archived source-only reference, serial ABBA order and a two-second capture
bound. No simulation runs during comparison. Each warm timing averages five
queries; setup and first cold queries are separate. All samples, including slower
ones, remain in ignored reports.

| Path node | Rows | Actor checks: old → new | Mesh checks: old → new | Old samples (ms/query) | New samples (ms/query) |
| --------- | ---: | ----------------------: | ---------------------: | ---------------------- | ---------------------- |
| 0         |    2 |              1445 → 134 |             1214 → 126 | 6.46, 2.28             | 4.48, 2.00             |
| 4         |    3 |              1445 → 232 |             1214 → 224 | 2.44, 2.34             | 1.60, 1.06             |
| 178       |    2 |              1445 → 100 |              1214 → 94 | 1.08, 1.32             | 0.48, 0.48             |
| 192       |   12 |               1445 → 59 |              1214 → 53 | 0.72, 0.66             | 0.48, 0.40             |

Warm selected actors perform zero native writes, geometry writes, compositions
or multiplications. Ordered rows, event sequences and capacity-one prefixes
match the reference exactly at all four nodes.

Unchanged refreshes of all 466 dynamic owners cost **0.46, 0.20, 0.22, 0.44 ms**,
against **0.50, 1.78, 0.42, 0.76 ms**. They still validate 932 cached hierarchy
records, but perform zero native hierarchy updates, triangle builds or matrix
strings. Only the two shared external-parent transforms require local checks.

With sixteen owners moving per refresh, 450 retain their surfaces and only sixteen
locals compose / thirty-two matrices multiply. Each refresh rebuilds 248 triangles.
New samples are **2.88, 0.60, 0.46, 0.68 ms**, against **1.38, 3.92, 0.94, 0.52 ms**.
This workload has mixed timings, including a slower first sample; stronger validity
checks and allocation/JIT/shared-workstation variability prevent a uniform timing
claim. The removed work counts are deterministic, unlike individual CPU samples.

Advanced Timber additionally compared 1,449 actors/1,218 meshes and 470 dynamic
owners. The same four ordered-row and prefix comparisons pass. An exploratory
capture before the final pose-signature storage reuse retained 60–233 actor checks,
zero warm matrix writes and unchanged-owner costs of 0.26–0.44 ms against
0.82–1.34 ms. Its moving-owner samples were mixed and are retained separately.

Early implementations were measured and rejected: resolving every dynamic node
and allocating warm material signatures reduced matrix work but increased elapsed
time. Cheap exact local comparisons precede matrix resolution in the final path.
This evidence is preserved rather than counted as an optimization result.

## Runtime evidence and remaining scope

Hardware MCP keyboard driving on Timber advances 35 game frames and approximately
1.19 world units with throttle 1, without increasing skipped physics time. That
short run displays 29 FPS; it is a smoke check, not a paired FPS benchmark.
It checks 3,795 selected actors rather than global scene loops. Existing moving
props still legitimately regenerate geometry as their physical poses change.
A controlled twelve-tick original car/car impact emits six body contacts,
component damage and a deformation revision. Full repair restores components to
zero and advances the deformation revision. Application console and WebGL checks
are clean after these actions; screenshots were inspected.

Final validation passes **2,634 headless tests**, including fourteen synchronization
and nine exact-transform tests. They cover opaque method restoration/topology,
native relinking, direct borrowed-matrix edits, callback snapshots, manual affine
transforms, geometry/index/material changes, activation and teardown. Original
Stock/Advanced collector and groove tests pass. Fifteen deterministic original
Eagle/Buggy/Bigdump crash reports match the accepted preceding report exactly.

The production build passes. Existing Chromium render-matrix checks pass on
Stock/Advanced content. The crash-matrix harness passes original driving,
deformation, joint/detached-part, splitting and repair scenarios. After final
review fixes, rendering and four original physical scenery-debris cases pass
again, with no console errors, failed asset requests or WebGL errors. These
automated harnesses use SwiftShader for reproducibility, separate from hardware
MCP measurements. The existing large-bundle warning remains.

The first GUI probe used a background page and an incorrect synthetic keyboard
event target. It produced no valid driving evidence and is excluded from the
runtime claim. The foreground test dispatches through the normal DOM keyboard
listener. MCP file-output workspace restrictions were bypassed by saving returned
JSON through local tooling; they were a tool limitation, not an application error.

Opt-in `world.syncDiagnostics` counts changed/unchanged owners, cached hierarchy
checks, rebuilt triangles, selected native checks/writes and transform work. It
is absent in normal gameplay. The source-only helper
`tools/world-sync-performance-probe.mjs` is not bundled. Reports under
`artifacts/perf-09-*.json` contain generated original-data evidence and stay ignored.

No simulation/visibility policies, physics formulas or native face-ring/restart
semantics were tuned. Other queued performance work and the pre-existing Carrier
actor-name assertion in the smash-followup harness remain open.

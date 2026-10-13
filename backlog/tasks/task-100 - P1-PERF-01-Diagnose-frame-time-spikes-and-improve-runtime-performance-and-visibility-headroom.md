---
id: TASK-100
title: '[P1] PERF-01: Diagnose frame-time spikes and coordinate performance findings'
status: wip
assignee: []
created_date: '2026-10-11 19:16'
updated_date: '2026-10-13 01:06'
labels:
  - priority-1
  - PERF-01
  - performance
  - profiling
dependencies: []
references:
  - docs/performance-investigation.md
  - docs/timber-performance-findings.md
  - tools/profile-performance.mjs
  - tools/performance-probe.mjs
  - docs/live-timber-drop.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reports roughly 30 FPS in Chromium on modern hardware and severe frame-time spikes, notably when leaving the tunnel in Snow Way Out. Investigate first. Separate CPU simulation/collision/AI work, rendering and GPU cost, resource upload/shader compilation, garbage collection, frame pacing and development-versus-production overhead. Initial hardware evidence identifies expensive scene traversal and post-solver collision guarding as independent CPU bottlenecks.

This active ticket owns cross-subsystem profiling, the unresolved tunnel-exit spike, ranked findings and coordination of implementation scopes. Scene-hierarchy implementation belongs to completed PERF-02 / TASK-101 (P1, done); the initial code/algorithm physics optimization belongs to completed PERF-05 / TASK-104 (P1, done); resolution policy to PERF-03 / TASK-102 (P4, backlog); higher visual visibility to PERF-04 / TASK-103 (P2, next, after TASK-101). Do not duplicate these implementation scopes. The user's physics policy is code/algorithm optimization first, with Web Workers reserved as a last resort if residual measurements justify the larger redesign.

Use short, serial profiling captures and static algorithm review because the workstation is simultaneously used by the user; no sustained simulation or parallel stress workloads. Preserve C2 behavior, destruction, assets and existing gameplay. Existing QUA-05 hardware measurement, QUA-06 memory and QUA-10 FPS diagnostics retain their narrower scopes and user-edited priorities.

Latest report: Timber! canyon/ravine drops to roughly 4 FPS after PERF-05. The user requests a fresh structural investigation and findings before implementation. Analyze global collision working sets, repeated correction/geometry work and event invalidation rather than selecting more coefficient/micro optimizations. No new engine change is authorized in this investigation phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document a reproducible short Chromium baseline including actual drawing-buffer resolution, renderer/GPU backend, frame-time distribution and scene population/draw-call counts.
- [x] #2 Rank measured bottlenecks and spike triggers with CPU profiles or timing evidence; separate verified findings, static complexity evidence, hypotheses and software-renderer/shared-host limitations.
- [ ] #3 Investigate Snow Way Out tunnel-to-open-area transitions and compare resolution and isolated subsystem costs without silently changing normal gameplay behavior.
- [ ] #4 Consolidate measured findings, remaining spike hypotheses and ownership in the separate implementation tickets; retain a reproducible baseline and the code/algorithm-first, Web-Workers-last-resort physics policy without duplicating implementation acceptance criteria.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Initial analysis completed; implementation choices intentionally remain open. Hardware Chrome DevTools MCP captures identified two independent CPU bottlenecks: repeated full scene matrix traversal (about 16 ms per paused Snow frame; hidden pedestrian hierarchies own about 89% of scene nodes) and post-solver pair-guard SAT construction (about 50% of sampled physics CPU; full pair guard about 64%). Async GPU timer measured roughly 1 ms across both passes at 2098x1465. A 74.5% pixel reduction improved the matched paused sample only from 40.2 to 43.9 FPS; matrix-freezing is diagnostic only. The reported specific tunnel-exit spike remains unisolated: the bounded candidate route included rematerialization/activity changes and a crash and is excluded from clean transition claims. Added opt-in serial capture/CPU-profile tooling; its one-second standalone smoke passed but used SwiftShader and is excluded from hardware FPS conclusions. Final MCP probe lifecycle smoke verified ratio/pause restoration, disposal and zero WebGL errors. Production engine behavior unchanged. Evidence, candidate risks, visibility coupling and remaining measurements: docs/performance-investigation.md. AC3-5 remain open.

User prioritization split on 2026-10-11: TASK-101 owns scene-hierarchy optimization (P1 next), TASK-102 owns resolution policy (P4 backlog), TASK-103 owns visual visibility (P2 next, dependent on TASK-101). Historical AC4/AC5 scope was split accordingly; AC1/AC2 remain verified, AC3 and the narrowed simulation AC4 remain open. In the start-drive capture, updateFrame took 2696.1 ms of 3519.5 ms wall duration (76.6%), including frame-final physics/damage callbacks. Mean tick CPU was 39.3 ms against a 40 ms native step. Worker execution is feasible in the browser, but current scene/geometry/callback ownership prevents a drop-in move; no threading decision or engine behavior changed.

2026-10-12 user direction: physics implementation was extracted to PERF-05 / TASK-104 (P1 next). Optimize code and algorithms first; Web Workers remain a last resort for a separately justified larger redesign. TASK-100 now retains profiling/spike investigation and finding coordination. Historical worker feasibility is not an implementation decision. No production behavior changed.

2026-10-12 Timber investigation (baseline 59e6d8f): no production engine changes. Short CPU-only ordinary route captures average 19-24 ms/tick. A controlled already-damaged/prepared-fence session with normal AI and seven detached Eagle parts reproduces 3.75 FPS with renderer.render suppressed: updateFrame consumes 1517.4 ms / 1601.8 ms wall (~95%), mean tick 57.52 ms, max 139.5 ms; up to eight correction passes. A subsequent state after removing CPU profiling and detailed wrappers still gives 3.97 FPS, mean 48.73 ms/tick, max 150.3 ms, and +640 ms skipped physics time. These are serial CPU diagnostics on SwiftShader, not hardware rendering/FPS benchmarks or a clean reproduction of the exact reported canyon route. MCP/X11 automation stalled; EGL/Vulkan checks supplied no WebGL context. Isolated browser/server closed.

Verified structural opportunities: all-pairs body discovery scans 114,960 combinations at 480 bodies; first heavy ticks have 466 immovable props, making 94.2% of opportunities immovable/immovable. GuardBodyTrajectories repeats discovery and pair-local geometry transforms, using conservative radius bounds even for constant prop paths. Sampled heavy tick costs: body guard 545 ms inclusive, nested pair guard 374 ms, collectBodyContacts 306 ms, mask predicate 144 ms self, SAT 98 ms, contact-group solver 28 ms; inclusive rows overlap. Main direction is retained spatial discovery and immutable per-body geometry snapshots, preserving pair/contact order, attachments, wake-up, crush and native timing. Normal refreshDynamic also visits all 466 props several times per tick/frame. Small world queries admit 203 versus 4 tighter-XZ candidates at node 4 and 104 versus 4 at quarry node 178; conservative face indexing is another candidate, not an implemented filter.

Independent original-material reproduction: second/third below-threshold TEZFEN contacts leave geometry identity/version and damage tier unchanged, yet trigger global geometry revisions and rebuild/invalidate-all work costing 15.8/24.0 ms. Preserve the binary-verified native restart output while separating actual geometry dirtiness and owner-specific invalidation. Zero world rebuilds in the slow capture rule out this defect as its cause. Long-session private MODEL retention and hardware GPU/4K canyon cost remain candidates. Full evidence, limitations and proposed sequencing: docs/timber-performance-findings.md. PERF-01 stays wip for exact canyon/tunnel attribution and coordination; no implementation ticket was started and no worker migration selected.

2026-10-12 user selected the structural implementation decomposition: PERF-06 / TASK-100.1, PERF-07 / TASK-100.2, PERF-08 / TASK-100.3, PERF-09 / TASK-100.4, PERF-10 / TASK-100.5, PERF-11 / TASK-100.6, PERF-12 / TASK-100.7. All seven are parented to TASK-100, P1/high with priority-1 labels, in next, ordered by ordinals 1110 through 1170. The queue is body-pair discovery, shared body geometry, retained native MODEL bounds, selective world synchronization, actual geometry invalidation distinct from native restart, local world-face discovery, then cross-correction-pass reuse. Technical dependencies are recorded separately; early independent work is not artificially blocked. Implementation has not started and WIP stays at one profiling ticket. Exact canyon/tunnel attribution remains here; the child tasks own implementation and conformance, without reopening completed PERF-02/05 or changing other priorities. See backlog/README.md for the selected queue.

PERF-06 and PERF-07 are implemented and verified, now done. See docs/body-pair-performance.md for indexed pair discovery, phase-local geometry sharing, exact crash comparisons and bounded hardware Chromium evidence. Remaining frame spikes are documented, including adverse samples; PERF-08 through PERF-12 remain next in their existing order. No universal FPS improvement or completion of the parent performance investigation is claimed.

PERF-08 completed: native MODEL bounds/radius retention and mutation ownership validated; see docs/model-bounds-performance.md. Warm hardware original-track queries perform zero raw-vertex scans with unchanged faces/callbacks. Actor synchronization and further structural costs remain PERF-09 onward. An independent whole-smash Carrier actor-name assertion reproduces on unchanged c89adfa and is recorded in WLD-05; no broad FPS or full-world compatibility completion is claimed.

2026-10-12 PERF-10 / TASK-100.5 completed: actual owner invalidation is separate from native notification/restart. Original Stock/Advanced TEZFEN reuse rebuilds zero triangles, and first preparation regenerates one155-triangle mesh/two native MODELs instead of full static/dynamic world. 2657 tests, build, identical15 original crash reports and serial Chromium smash/debris/crash/render checks pass. Short frozen CPU comparisons retain all samples and do not claim hardware FPS or repair the earlier zero-rebuild canyon capture. See docs/smash-invalidation-performance.md. PERF-11 and PERF-12 remain next; PERF-01 stays wip.

PERF-11 / TASK-100.6 completed: ordered conservative static face locality and retained exact feature planes. Timber bridge candidate counts fall 203 to 4 and guard face work 272 to 16; quarry guard work falls 348 to 24. Stock/Advanced Timber and Snow comparisons preserve camera, normal and shallow flagged/unflagged/deep recovery results and native collector callbacks exactly. All 2,677 tests, build, 15 exact original crash reports and serial production/hardware MCP regressions pass. Cold BVH construction costs and unfavorable quarry guard samples (4.15/3.60 ms local versus 0.65/1.10 ms baseline) remain unresolved timing concerns; there is no universal FPS or exact canyon/tunnel route completion claim. See docs/world-face-performance.md. PERF-12 stays next; PERF-01 stays wip for attribution and profiling coordination.

2026-10-13 PERF-12 / TASK-100.7 completed: exact cross-pass body/world certificates, raw contact reuse, independent retained geometry and lazy dormant narrow-phase preparation. Stock/Advanced reconstructed Timber heavy states preserve eight correction passes, restart work, ordered damage/impacts and guard fractions; body transformations 298->95 / 370->93 and actual static guard collections 135->78 / 171->82. All 2,698 tests, build, 15 original crash outputs, serial spawn/debris/camera/render Chromium regressions and clean AMD hardware production MCP driving/crush/repair validation pass. Short traced and minimally instrumented ABBA timings have lower heavy-tick/frame maxima but retain adverse medians/tails and do not prove steady FPS. Original canyon route is still not exactly reproduced; residual stalls/route attribution remain in PERF-01. Evidence: docs/correction-performance.md. PERF-01 remains the only WIP ticket; visibility keeps its existing P2 next priority.

2026-10-13 user still reproduces <=4 FPS severe stalls after PERF-12, with the latest Timber screenshot showing a clustered collision state and overturned cars. Visibility work is deferred until the cause is isolated. Prepared an isolated hardware Chromium production Timber/EAGLEGREEN session for user-driven reproduction, with ordinary collision/damage behavior, frozen race timer only, and bounded 512-row scalar timing rings for rendered frame intervals, updateFrame CPU and step CPU. No detailed profiling, simulation loop or source behavior change is running. Await user pause to inspect the actual failing live application state before repair/reset/reload; no clean route or root-cause claim yet.

User-driven controlled Timber session did not reproduce the <=4FPS performance problem. It instead yielded a reproducible smooth-road vehicle lockup, now tracked separately as P1 PHY-13 / TASK-106 (backlog). Captured live state149.44s, actual512-row timing history and screenshot are ignored in artifacts/perf01-user-stuck*. Last512 frames p50~16.7ms,p95~33.4ms,max50.1ms; individual ticks p50~10.1ms,p95~28.3ms,max34.8ms. The clone diagnosis isolates deep overlap with a fully detached own wing: world movement allowed1, direct car/wing pair fraction~4.15e-6, no solver contact rows, removing only that wing from the cloned guard restores1. Actual gameplay remains paused and unchanged. PERF-01 remains open for a genuine user-provoked performance stall; these timings must not be described as its reproduction or as proof that performance is solved. PERF-04 is deferred.

2026-10-13 actual user-paused Timber drop captured at113.56s, separate from PHY-13: 7 active cars,10 parts,466 dormant props; hardware AMD buffer2098x1466; last game period170ms, cumulative skipped800ms. Previous recorder was stopped/bound to old race, so no preceding full-frame timing exists. Corrected read-only cloned next-trajectory probes isolate a residual rotating-part body-guard cost29.6ms warm (35.7ms with per-pair timing), versus world2.2ms/pair8.6ms/solver0.3ms.55pair guards,22revalidations,3308hull transforms. Zero-spin CLONES reduce guard15ms/1419transforms but alter contacts/fractions; not a behavior fix. Exact stall attribution remains open. Durable512-row opt-in recorder now preserves pause history, auto-rebinds in-page race/Simulation replacements and leaves world-query cache identities intact. User game remains paused and unchanged; no engine fix or visibility work. Evidence and invalid exploratory-probe exclusions: docs/live-timber-drop.md.
<!-- SECTION:NOTES:END -->

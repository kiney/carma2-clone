---
id: TASK-100.14
title: '[P1] PERF-19: Diagnose and eliminate ordinary world-contact latency spikes'
status: next
assignee: []
created_date: '2026-10-15 18:19'
labels:
  - priority-1
  - PERF-19
  - performance
  - physics
  - world-contact
dependencies: []
references:
  - docs/world-contact-spikes.md
parent_task_id: TASK-100
priority: high
ordinal: 1260
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Separate residual world-contact spike workstream from PERF-01 coordination. Actual post-PHY-16 Stock desert2 recording contains a 420 ms single physics tick, including 292 ms in 108 ordinary worldContacts invocations; its enclosing update lasts 431.4 ms and a corresponding RAF interval450 ms. Subsequent 4-5-tick catch-up updates amplify delays. CPU rendering is about3 ms on average. No CPU profile yet distinguishes native face-cache refresh/actor work, feature emission/recovery, allocation/GC or scheduling. This is not the unrecorded earlier9-FPS episode and is not a Timber-specific capture.

Source audit identifies that PERF-11 localized the extra world trajectory guard but ordinary worldContacts still tests each authored hull against every eligible native-collected face. Native collection has observable water, ACT-pull and GROOVE side effects. Other candidate amplifiers include 300-face ring refresh/wrap, repeated per-hull preparation, feature/recovery loops, local-response retries and global disabling of static guard reuse whenever movingWorld is nonempty. Do not select a fix from aggregate timing alone. Thorough findings and conditional implementation directions are in docs/world-contact-spikes.md.

Scope: attribute and substantially reduce the measured ordinary world-contact/outlier workload; handle separately measured guard amplification where causally relevant. PERF-13 retains its broader historical full-scene residual scope; PERF-01 coordinates findings. Preserve collision/crush/repair and original asset behavior. Work precedes increased visual visibility.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Attribute a bounded real outlier to body/part, face/hull workload and contact subphase using short serial CPU profiling and low-overhead outlier counters; distinguish GC/scheduling, catch-up and GPU uncertainty.
- [ ] #2 Implement the evidence-selected structural improvement and demonstrate lower work counts plus before/after tick and frame-tail measurements on comparable original-data workloads; retain adverse samples.
- [ ] #3 Preserve native collection side effects and ordering, ground/wall/moving-surface contacts, damage, parts and repair; cover multiple original cars, new collisions and PHY-16 release regressions.
- [ ] #4 Validate build, relevant numerical tests and hardware Chromium playtests; document deviations, measurement limits, reviewed checkpoint and focused user playtest.
<!-- AC:END -->

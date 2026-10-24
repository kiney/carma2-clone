---
id: TASK-120
title: '[P3] QUA-11: Retry failed asset reads and roll back incomplete scene loads'
status: done
assignee: []
created_date: '2026-10-24 18:54'
updated_date: '2026-10-24 19:11'
labels:
  - priority-3
  - QUA-11
  - quality
  - assets
dependencies: []
references:
  - src/content.ts
  - src/native-global-resources.ts
priority: medium
ordinal: 3092
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reproduced during the unattended resource audit: a rejected Assets.bytes fetch remains in the promise cache, so two reads issue only one request and reload cannot recover. An injected Eagle ACT read failure leaves 53 material allocations/registrations and 25 model registrations after releaseRaceResources because scene disposal is registered only after construction succeeds. Implement failure eviction without losing successful/in-flight coalescing, and ownership-specific rollback for incomplete scene episodes. Preserve existing shared storage resources and native registration ordering; never substitute global basename assets or modify the installation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 HTTP/network/body read failures can be retried; concurrent callers still share one request and successful bytes stay cached.
- [x] #2 Failure at MAT, DAT, geometry or ACT construction releases only newly owned registrations, allocations, textures and geometry; pre-existing shared-storage episodes remain valid.
- [x] #3 A valid retry succeeds without stale native names, growing allocations or extra cleanup; successful normal scene disposal remains idempotent.
- [x] #4 Deterministic synthetic failure tests and representative original read-only scene checks pass; no real display is required.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Read-only reproduction with original Eagle3 plus an in-memory ACT read error confirmed 53 live MAT allocations and 25 MODEL registrations survive releaseRaceResources. A separate synthetic failed fetch attempted twice made only one network call and retained one rejected cache entry. Selected next after an active WIP slot closes.

Implementation started after QUA-09 checkpoint, maintaining three active tickets. Root owns Assets/native registry transaction changes; a separate worker owns deterministic network/partial-scene failure tests.

Implemented failure-only byte cache eviction with request-identity protection and scoped scene rollback. New local textures (including shadowed maps), render MAT clones, model bindings/geometry, arena allocations and storage references are cleaned without removing earlier shared-storage episodes or accepted duplicates. Geometry validation releases a BufferGeometry created before rejection. Twelve deterministic tests pass, including native arena capacity failure halfway through a MAT batch, all requested construction stages, texture ownership, shared exact duplicates and actual read-only Eagle ACT failure/same-path retry. A focused resource/geometry/metadata suite passed 40 checks before the extra edge cases were added; the current 12-case file passed independently. TypeScript and production build pass; the latest 5-load original-scene headless resource audit also passed with this loader implementation. No proprietary fixtures or original files were changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Failed reads can be retried and incomplete scene loads leave no native registration or allocation residue. Successful scene lifetimes and native name/admission order are preserved. Covered by synthetic failure/ownership tests and the original Eagle retry case; evidence in docs/asset-failure-recovery.md.
<!-- SECTION:FINAL_SUMMARY:END -->

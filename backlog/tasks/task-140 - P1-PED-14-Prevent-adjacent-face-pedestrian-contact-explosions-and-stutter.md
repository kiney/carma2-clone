---
id: TASK-140
title: '[P1] PED-14: Prevent adjacent-face pedestrian contact explosions and stutter'
status: done
assignee: []
created_date: '2026-10-30 21:22'
updated_date: '2026-10-30 22:06'
labels:
  - priority-1
  - PED-14
  - topic-pedestrians
  - topic-performance
  - bug
dependencies: []
priority: high
ordinal: 1003
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stock TIMBER hard stutter: two unpaused updates took7.485s without new exceptions. CPU trace attributes>94% of each long callback to simulation. Pedestrian owner50926/recorder body10 developed runaway velocity; one observed world-contact collection alone cost1.54s. Saved216MB local c2bug history before intervention. Exact contact replay identifies first injection at tick8339 from ordinary input speed0.553: adjacent slightly angled world faces emit near-opposed edge/vertex constraints; normal solver reports solved but injects1647x kinetic energy, followed by a same-tick amplification. Existing chronological world-contact admission only recognizes virtually coplanar source surfaces, so it misses connected gently angled seams. Investigate and correct physical encounter admission with procedural frozen regressions; preserve independent walls/gaps/levers and vehicle crash behavior. Captured geometry remains ignored, never commit it. Separate performance consequence from first-event physics source and preserve live scene.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A redistributable procedural adjacent-triangle regression fails before engine correction and passes unchanged afterward; actual captured contact replay remains local evidence.
- [x] #2 Contact admission recognizes the justified continuous surface neighborhood before opposed grouping while preserving independent corners, gaps, distinct features and existing vehicle crash conformance.
- [x] #3 Original-asset browser and the preserved stalled scene run without runaway query amplification; profile before/after briefly and report limits honestly.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
First event isolated from local three-minute capture. Recorded5row packet exactly replays217.764678 normal impulse and1647.436x energy. Original TIMBER collector before/after comparison reproduces that samepacket; fixed source emits3rows with.903695x energy and maxJ.002541 while earlier bounded response stays unchanged. Root fix: shared static actor, complete common edge, <=5degree source-normal angle, opposite triangle interiors, existing opposed response and OLDpoint criteria. Both sampled admission and chord merge use common predicate; solver/RHS untouched.16frozen proceduraltests:9pass/7fail before,16pass after with unchangedhashes;2review slot/winding controls also pass; existing14runawaycases pass. Full originals suite3795pass/6optional skip/0fail. Asset-free CI3294pass/439skip with known unrelated HMRshutdown timeoutQUA15. Build and originalped/car Chromiumchecks pass. Preserved user scene patched through all3owningmethods; only corrupted corpse kinematics restored from pre-burst capture, HP0/masks unchanged. No new errors or subsequent runaway peds. Existing damaged-scene steady performance remains poor and is explicitly PERF26/P1/next; do not advertise a general FPS fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the reproduced seconds-long TIMBER stall at its contact-admission cause, not with an impulse/velocity cap. Original-world before/after proves the destructive first packet disappears; preserved scene is recovered without race reload. Conservative topology controls preserve true corners, narrow slots, different actors and separated levers. Remaining ordinary crowded-scene throughput is PERF-26, not hidden as completed.
<!-- SECTION:FINAL_SUMMARY:END -->

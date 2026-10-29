---
id: TASK-132
title: >-
  [P2] QUA-13: Record three-minute bounded playtest bug captures with local
  download
status: done
assignee: []
created_date: '2026-10-29 17:36'
updated_date: '2026-10-29 18:03'
labels:
  - priority-2
  - QUA-13
  - diagnostics
  - recording
dependencies: []
priority: high
ordinal: 2105
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Always record a rolling three-minute diagnostic history during playtests, bounded to512MiB. Provide an accessible English Save bug capture button producing a normal local browser download without MCP. Retain useful body states, input/timing, accepted contact and damage transitions, context and bounded structural snapshots while preserving gameplay and avoiding hot-path geometry hashing/wrappers. Export is diagnostic evidence and must describe remaining full-replay limitations honestly. Original-derived captures remain local and ignored.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bound retention by180seconds and512MiB with tested eviction, export stability and no engine-object retention.
- [x] #2 Integrate always-on recording, normal Save bug capture download and MCP access; include metadata, body states, inputs, timing and useful impact/damage/structure evidence.
- [x] #3 Validate actual browser download and decoded content, build/tests and a short serial recorder-on/off overhead check without losing live user scenes.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented always-on Float64 body/frame/contact/joint records, bounded five-second collision/context keyframes, stable weak IDs and scalar directory, input/pause/load/error events. Three-minute active-time retention survives pause followed by no RAF/workstation lock.512MiB recorder accounting reserves16MiB construction plus one immutable export, leaving248MiB rolling storage, allocated on demand. O(1) eviction with age/byte/count guards and drop counters. Normal local .c2bug download works without MCP; portable inspector safely decodes it. Full suite3470 tests:3465 pass,5 skip,0 fail; focused feature tests and build pass. Browser downloaded file is decoded and checked against actual same-generation body state. Short headed AMD hardware off/on windows preserve16.7ms median frame interval; recorder work12.3ms over45ticks/1.8sec (~0.27ms per tick including frame callbacks), no console/WebGL errors. Exact whole-game replay, crash-safe persistence and entire-browser heap limits are explicitly not claimed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Automatic rolling playtest diagnostics and Save bug capture download are integrated, tested and documented in docs/bug-captures.md. Captures remain local/ignored; paused history survives workstation locks. Existing physics formulas/provider identities are preserved.
<!-- SECTION:FINAL_SUMMARY:END -->

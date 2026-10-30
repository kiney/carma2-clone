---
id: TASK-56
title: '[P3] AI-04: Implement native opponent stuck detection and recovery'
status: next
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 17:29'
labels:
  - priority-3
  - AI-04
  - opponents
  - legacy-partial
  - topic-ai
dependencies:
  - TASK-33
  - TASK-32
references:
  - src/ai.ts
  - src/main.ts
priority: medium
ordinal: 3043
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-04**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Verified implementation

The native physical follower already implements stuck/struggle detection in `src/ai/path-follow.ts` and `src/ai/path-struggle.ts`. It uses the installed speed, elapsed-time, pursuit/movement, section, count and mass conditions; returns the native give-up result with its source force behavior; and is wired through opponent runtime/objective handling. This is not the former heuristic wait followed by a road-graph reset.

Evidence: installed `ProcessFollowPath` at `0x4afc6e–0x4afd99`, documented in [native path evidence](../../docs/c2-ai-paths-re.md#physical-follower-state-and-ordering) and [struggle timing and failure](../../docs/c2-ai-paths-re.md#struggle-timing-and-failure). Runtime integration is in [opponent repair and levitation evidence](../../docs/c2-ai-repair-levitate-re.md#live-chain-and-checks).

## Remaining scope

Verify integrated stuck/recovery behavior and exact ownership across follower give-up, objective restart/selection, cheating transitions, and rematerialization/fallen-world recovery. In particular, validate the native count-zero struggle case: its derived unsigned timing does not reach the ordinary stop/brake thresholds during normal short sessions, so it can persist until an outer objective or cheating transition. Treat that as source behavior requiring integration verification, not a defect or a prompt to add an invented timeout.

Navigation/path reconstruction remains tracked by AI-02 / TASK-33. Keep this ticket focused on the already implemented struggle path's integrated recovery and objective/cheating edge behavior; do not duplicate AI-02 route work.

## Source references

[src/ai/path-follow.ts](../../src/ai/path-follow.ts), [src/ai/path-struggle.ts](../../src/ai/path-struggle.ts), [src/ai/runtime.ts](../../src/ai/runtime.ts), [src/ai/rematerialization.ts](../../src/ai/rematerialization.ts), [src/ai/fallen-world.ts](../../src/ai/fallen-world.ts), [native path evidence](../../docs/c2-ai-paths-re.md), [repair and levitation evidence](../../docs/c2-ai-repair-levitate-re.md), [cheating/rematerialization evidence](../../docs/c2-ai-cheating-re.md), [pursuit evidence](../../docs/c2-ai-pursuit-re.md).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected third after navigation/placement (AI-02/TASK-33) and objective/crash-reaction integration (AI-01/TASK-32). Validate existing native struggle/give-up through objective restart, physical/remote transitions and rematerialization, including count-zero behavior. Dependencies describe completion of those integrated validation prerequisites.
<!-- SECTION:NOTES:END -->

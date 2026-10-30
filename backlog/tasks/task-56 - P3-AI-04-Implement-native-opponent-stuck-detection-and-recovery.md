---
id: TASK-56
title: '[P3] AI-04: Implement native opponent stuck detection and recovery'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 19:20'
labels:
  - priority-3
  - AI-04
  - opponents
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
Original status: **Partial**, now completed
Category: **Opponents and Pedestrians**

## Completed scope

Verified the actual fleet path from native stuck/struggle detection through give-up/local restart, strict objective deadline selection, physical/remote transitions, rematerialization and fallen-world recovery. Native count-zero unsigned timing is preserved; no invented short escape timeout was added.

Corrected four adapter boundaries: actual car-owned forces now feed Follow before objective RUN; RunAway top-up eligibility follows current cheating mode; each placement reset enables native traction control; exhausted placement restores actor pose without a 25th cache reset that overwrote relocation direction. Damage remains permanent through recovery.

Deterministic tests cover reachable count-zero interruption, failed return retry, physical resumption, fallen-world callback ownership, borrowed-force preservation, type2 route eligibility and real simulation reset/cache behavior. Production Stock/Advanced and hardware DevTools validation are recorded in [AI-04 implementation evidence](../../docs/ai04-production-integration.md).

## Evidence and limits

Installed ProcessFollowPath at 0x4afc6e–0x4afd99 and its unsigned timing at 0x4afa33–0x4afb14 remain authoritative. Original TopUpRandomRoute flag check is 0x4a921f–0x4a922c; traction reset is 0x4a8b0b; exhausted fallback/cache direction ownership is 0x4a8e75–0x4a8ef2 and 0x4a8fd3–0x4a8fd9. Source addresses, confidence and test boundaries are documented in the linked note.

A placement return1 may mean exhausted fallback with physics still off. The explicit 4096-visit safe-relocation bound remains; closed components report exhaustion. Nearby blocked cars retain native objective/struggle behavior, not a guarantee of immediate escape. Original grid ranking and full launch RNG chronology remain separate AI-06; navigation preparation was completed by AI-02.

Source references: src/ai/path-struggle.ts, src/ai/path-follow.ts, src/ai/runtime.ts, src/ai/run-away-state.ts, src/ai/fallen-world.ts, src/physics/opponent-placement.ts and src/physics/simulation.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reachable count-zero struggles retain native unsigned timing and are interrupted correctly by strict objective deadlines or cheating transitions.
- [x] #2 Give-up/restart reads actual car forces; flee-route eligibility follows current cheating mode.
- [x] #3 Rematerialization preserves source attempt count, cached direction, traction reset and exhausted-fallback ownership without repairing permanent damage.
- [x] #4 Deterministic recovery regressions, production build and original Stock/Advanced Chromium checks pass; full-suite and asset-free CI results are reviewed and any failures are triaged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected third after navigation/placement (AI-02/TASK-33) and objective/crash-reaction integration (AI-01/TASK-32). Validate existing native struggle/give-up through objective restart, physical/remote transitions and rematerialization, including count-zero behavior. Dependencies describe completion of those integrated validation prerequisites.

Integrated source audit exposed force-cache, RunAway mode-filter and exhausted-placement cache-reset defects. New regressions were observed failing before the corresponding engine changes; existing native timing and deadline semantics are retained. See docs/ai04-production-integration.md.

Validation: all14 new recovery cases pass; build and Stock/Advanced production browser2/2 pass; hardware DevTools recovery and fresh keyboard driving pass without console/WebGL errors. Existing native-AI and real-contact reaction browsers pass. Complete original suite3755 pass/6 optional skip/1 known intermittent Vite HMR shutdown timeout; unchanged server suite immediately passes8/8 standalone. Asset-free CI3254 pass/439 skip/0 fail. No vehicle collision coefficients or native count-zero timing changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed native recovery integration. Actual car force ownership, current-mode flee-route filtering, traction activation and exhausted rematerialization cache preservation are corrected with failing-before/fixed-after regressions. Count-zero timing, strict deadline interrupts, physics/remote transitions, failed placement return retry and fallen-world ownership are covered. See docs/ai04-production-integration.md for evidence, validation and deliberate limits.
<!-- SECTION:FINAL_SUMMARY:END -->

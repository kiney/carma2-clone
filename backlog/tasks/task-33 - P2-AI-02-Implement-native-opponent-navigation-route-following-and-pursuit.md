---
id: TASK-33
title: '[P2] AI-02: Implement native opponent navigation, route following, and pursuit'
status: next
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 17:29'
labels:
  - priority-2
  - AI-02
  - opponents
  - legacy-partial
  - topic-ai
dependencies: []
references:
  - src/ai/runtime.ts
  - src/physics/opponent-placement.ts
  - docs/c2-ai-pursuit-re.md
priority: high
ordinal: 2040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-02**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Scope and evidence

The live native dispatcher replaces RoadNavigator targets with original section widths, speeds, types, one-way data, projected routes, corners, physical forces, GetNear acquisition and direct/trail pursuit. Physical/cheaty switching, source ACT orientation, sensible-place rematerialization attempts, volume reset and shared-route safe relocation are integrated. Native fallen detection uses cached caret materials and bounded source vertical probes. Stock/Advanced/Snow Chromium verifies normal motion, freeze/thaw and physical-to-cheaty-to-rematerialized transitions. Remaining work: source shared collision-candidate preparation, additional placement/fallback stress cases and review of robustness extensions (undefined empty-route status, bounded native-unbounded endpoint walk).

## Source references

[runtime.ts](../../src/ai/runtime.ts), [placement](../../src/physics/opponent-placement.ts), [pursuit evidence](../../docs/c2-ai-pursuit-re.md)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected AI workstream order (2026-10-30): first AI-02/TASK-33, then AI-01/TASK-32, then AI-04/TASK-56. Finish shared collision-candidate preparation and verify placement/fallback transitions before reviewing behavioral reactions and integrated stuck recovery. Preserve implemented navigation and ordinary driving; audit the remaining scope against current code before changing it.
<!-- SECTION:NOTES:END -->

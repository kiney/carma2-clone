---
id: TASK-72
title: >-
  [P3] QUA-01: Consolidate loading and compatibility warnings into a visible
  diagnostic
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 18:31'
labels:
  - priority-3
  - QUA-01
  - quality
  - legacy-partial
dependencies: []
references:
  - src/content.ts
  - src/main.ts
priority: medium
ordinal: 3075
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-01**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Provide a visible, consolidated loading/compatibility diagnostic. Missing models, animation warnings, powerup warnings, and background loading errors end up in separate lists or only in the console.

## Source references

[content.ts](../../src/content.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline implementation: consolidated visible English session/current-race diagnostic for asset, animation, damage, powerup and asynchronous population/load warnings. Preserve individual source lists and console behavior; avoid polling or traversing scene graphs in active gameplay. Add practical local report export and headless tests for actual menu visibility, deduplication and source attribution.

Added visible English pause-menu diagnostics grouped by source and session/current-race scope, insertion-ordered linear aggregation with repetition counts, manual/open refresh and localJSON export. Sources include shared asset/damage warnings, player/opponent/world animation, powerups, pedestrians, smoke, world destruction/grooves, special volumes and populationstates. Startup/race/population background errors retain capturedrace/time in bounded100event history; lone unsupportedworld-followup consolewarn now also recorded. Existing arrays/logging remain; no scene traversal or active-gameplay polling. Aggregation/serialization tests, build/tsc, and actual headless Chromium grouping/safe-text/scope/download regression pass. Physical-displaystyling unverified. Docs/diagnostics.md and test:diagnostics describe use.
<!-- SECTION:NOTES:END -->

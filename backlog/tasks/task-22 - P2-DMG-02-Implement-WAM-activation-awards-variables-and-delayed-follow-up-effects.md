---
id: TASK-22
title: >-
  [P2] DMG-02: Implement WAM activation, awards, variables, and delayed
  follow-up effects
status: backlog
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-28 22:34'
labels:
  - priority-2
  - DMG-02
  - damage
  - legacy-partial
dependencies: []
references:
  - docs/c2-wam-effects-re.md
  - src/damage.ts
  - src/main.ts
priority: high
ordinal: 2017
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DMG-02**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Damage, destruction and effects**

## Scope and evidence

WAM activation boxes, follow-up side effects, room/script fields, awards and variable changes are retained by the shared bounded parser. Live WAM callbacks reuse delayed noncar activation, explosion and mission-variable outlets. The observed 52 stock WAMs contain sounds/shards only; synthetic parser tests do not prove execution of the other classes. World texture/decal preparation and queued tier effects are separated, including capacity-before-dedup and acceptance-only impulse caps. Installed `roomCode` is a powerup index, not a room script. Native award formulas/latches, human-owner proximity and the separate fifty-entry final-flush powerup queue now have numerical checks and live bindings. Follow-up cuboids now use live source physics, triangle selection, retained spec/context and the shared twenty-slot delayed scheduler; numbered due effects pull/release before the distinct bit-two Bash gate. Original Stock/Advanced Carrier and numerical integration checks cover these paths. Still open: exact prepared track-column/face ordering at saturation, parallel direction, fancy headups, source immediate edge flags and remaining connotation outlets.

## Source references

[WAM evidence](../../docs/c2-wam-effects-re.md), [damage.ts](../../src/damage.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-28 22:34
---
WLD-05/DMG-03 (2026-10-28) now supply this task's previously duplicated finite native prefix, generated ACT/source identities, immediate source-edge flags, direct pickup followups and original-font fancy outlet. Retain the installed parallel-direction uncertainty explicitly: that branch divides uninitialized scratch, and all111 catalogued Stock/Advanced entries are away. Do not invent normalized force semantics or duplicate completed providers. See docs/c2-world-smash-source-edges-re.md and docs/c2-effect-producer-audit.md.
---
<!-- COMMENTS:END -->

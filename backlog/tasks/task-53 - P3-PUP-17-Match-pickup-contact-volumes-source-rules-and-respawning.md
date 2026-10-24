---
id: TASK-53
title: '[P3] PUP-17: Match pickup contact volumes, source rules, and respawning'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 20:14'
labels:
  - priority-3
  - PUP-17
  - powerups
  - legacy-needs-validation
dependencies: []
references:
  - src/powerups.ts
priority: medium
ordinal: 3037
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-17**
Numeric priority: **3** (1 is highest)
Original status: **Needs validation**
Category: **Powerups**

## Scope and evidence

Validate pickup volume and source rules: currently a fixed 0.7 world units around the vehicle position is used instead of the original vehicle/pickup-dependent contact logic; respawning is not implemented.

## Source references

[powerups.ts](../../src/powerups.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24 native trace: original world-face dispatcher 0x4f0ec0 receives wheel contacts at 0x419add and body contacts at 0x41c84c. Pickup branch reads the live owning ACT identifier and render style, decodes index, queues a grant, then runs pickup/mine smash behavior. Helper 0x4f0db0 accepts ordinary pickups for driver 8; mine 14 has a separate qualifying driver>5 path. The browser reparents pickup ACTs away before collision construction and uses a cached-index radius-0.7 sweep, so substituting another radius would not establish compatibility. PUP-21 separately implements the authored respawn masks/100-slot queue/120-second original deadline and dedicated effects; this parent remains open for native contact/source ownership, mine rules and collision restoration. See docs/c2-powerup-respawn-re.md.
<!-- SECTION:NOTES:END -->

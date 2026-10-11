---
id: TASK-8
title: >-
  [P1] PHY-09: Prevent cars from remaining interlocked after collision and
  recovery
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - PHY-09
  - physics
  - legacy-done
dependencies: []
references:
  - src/physics/pair-guard.ts
  - src/physics/simulation.ts
  - docs/c2-physics-re.md
priority: high
ordinal: 1013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-09**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Physics and world**

## Scope and evidence

Native recovery centers from local hull bounds are transformed correctly; recursive attachment groups are accounted for. An additional integration guard checks actual pair trajectories after world clamps and joint projection, prevents new/deeper solid overlaps and allows separation/reverse motion. Frontal, oblique, side, deformed and wall-adjacent pairs, plus the original 0.0565 penetration regression, are checked. DUNE crashes still deform and damage cars; the real reverse key frees both tested crash pairs. This guard is a documented browser extension, not a claimed replacement for the native solver.

## Source references

[pair-guard.ts](../../src/physics/pair-guard.ts), [simulation.ts](../../src/physics/simulation.ts), [RE notes](../../docs/c2-physics-re.md)
<!-- SECTION:DESCRIPTION:END -->

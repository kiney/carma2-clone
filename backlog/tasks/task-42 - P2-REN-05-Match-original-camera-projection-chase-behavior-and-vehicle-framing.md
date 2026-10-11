---
id: TASK-42
title: >-
  [P2] REN-05: Match original camera projection, chase behavior, and vehicle
  framing
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 15:15'
labels:
  - priority-2
  - REN-05
  - rendering
  - legacy-done
dependencies: []
references:
  - docs/c2-camera-re.md
  - src/main.ts
  - docs/c2-scale-audit.md
priority: high
ordinal: 2074
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **REN-05**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Native GENERAL FOV (quantized 55.546875°), doubled hithers, track Yon, COM/zoom/height/reversal, accepted frame contacts and true 3D obstacle/own-head-shape clearance are integrated. No model scaling was changed. Eagle retains zoom0.2; an explicit bounded startup-framing extension makes large vehicles usable (Bigdump1.7001 in the checked viewport). Production Chromium verifies original Eagle/Bigdump, zoom, actual driving/reverse, modes, sky and paused recovery. Latest production Chromium also verifies both orbit keys, reset latch, native cadence and paused resets with no console/network/WebGL errors. Prepared nearby-face candidate ordering stays separate under REN-04.

## Source references

[Camera evidence](../../docs/c2-camera-re.md), [main.ts](../../src/main.ts), [Scale audit](../../docs/c2-scale-audit.md)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 9). Preserve this completed scope when considering remaining subsystem work.

Geometric scale checked again: all 52 Stock-car ACT hierarchies with unit scale, several visible car/pedestrian dimensions, and DUNE BUGGERED were checked in the browser; no global car/world scale factor is missing. The evidenced projection/chase-camera discrepancy is now fixed under REN-05; the large-car startup zoom is an explicitly documented browser extension. [Measurements and limitations](../../docs/c2-scale-audit.md).
<!-- SECTION:DESCRIPTION:END -->

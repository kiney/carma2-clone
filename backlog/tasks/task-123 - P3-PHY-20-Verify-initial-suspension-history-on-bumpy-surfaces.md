---
id: TASK-123
title: '[P3] PHY-20: Verify initial suspension history on bumpy surfaces'
status: backlog
assignee: []
created_date: '2026-10-26 20:39'
labels:
  - priority-3
  - PHY-20
  - physics
dependencies: []
references:
  - src/physics/spawn.ts
  - src/physics/motion.ts
priority: medium
ordinal: 3101
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code-verified startup discrepancy found during AI-05: spawn.ts initializes previous wheelLengths from raw wheel-ray distances; WheelForces adds the native wheelBumpinessOffset before calculating damping. A bounded original Newhawk/procedural-flat-road check using DUNE bumpiness 5 at X=.125/Z=.375 produced first vertical velocity -0.03973163 model/s versus -0.01779225 with effective-distance history. Both retained four supports; this modest unloading does not reproduce historical Newhawk wastage. Verify original initial suspension/history ownership before changing it; do not tune force coefficients or claim this caused the early crash. PHY-15 concerns detached debris and is unrelated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Establish original initialization and first-force distance/history semantics using rec2 or installed binary evidence.
- [ ] #2 Compare original Newhawk and Eagle first forces on zero and nonzero authored bumpiness with deterministic numerical assertions.
- [ ] #3 Implement only an evidence-backed history/placement correction if needed; preserve native road bumps and suspension response.
<!-- AC:END -->

---
id: TASK-119
title: '[P3] DAT-06: Trace Advanced texture names outside current load scope'
status: backlog
assignee: []
created_date: '2026-10-24 17:09'
labels:
  - priority-3
  - DAT-06
  - assets
  - materials
dependencies: []
references:
  - docs/advanced-assets-audit.md
priority: medium
ordinal: 3091
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DAT-04 inventories MAT texture labels that either exist elsewhere in the installation or have no basename/parsed-map-name match in the audited containers. Trace owning scene/ACT/MAT and original resource-loading scope, including unparsed format containers, before claiming data is missing. Correct proven runtime lookup gaps without global basename substitution or cross-installation namespace leakage. Retain explicit distinctions between unresolved labels, unsupported containers and genuinely missing resources.
<!-- SECTION:DESCRIPTION:END -->

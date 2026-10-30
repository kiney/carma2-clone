# Project backlog

Backlog.md is the task source of truth. The former `TODO.md` entries have been migrated with their complete descriptions, evidence, source references, original issue IDs and numeric priorities. Use the installed `backlog` CLI from the repository root; it stores tasks in `backlog/tasks/` without committing automatically or checking remote branches.

## Current implementation queue (updated 2026-10-30)

The selected opponent-AI workstream is in `next`, with numeric priorities retained:

1. AI-02 / TASK-33 (P2), `done`: shared navigation collision preparation and placement/fallback validation.
2. AI-01 / TASK-32 (P2), `done` after TASK-33: real-contact reactions and native roster/initialization/personality RNG ownership.
3. AI-04 / TASK-56 (P3), after TASK-33 and TASK-32: integrated stuck/struggle recovery and objective/rematerialization transitions.

Board ordinals encode this order; plain task lists can instead sort equal-priority
items by ID. AI-02 and AI-01 are complete; AI-04 remains in `next`.
AI-06 / TASK-136 separately records original grid ranking and whole-launch
selection chronology in `backlog` at P3.
See [AI-01 evidence and validation](../docs/ai01-production-integration.md).
See [AI-02 implementation and validation](../docs/ai02-production-integration.md).

P2 PED-06 / TASK-96 is `done`:authored ordinary Stock/Advanced identities now own
bounded FORM/PHIL bodies, native BON transport and source steering/scanning.
Original mass/COM/inertia, canonical process/face caches and shared CRT feed real
contacts; the old visual sweep/second launch is bypassed. Stock/Advanced actual
hits, release/reacquisition, reload, retained-visible admission, powerups and
hardware Chromium are validated. Full integrated suite:3551 passed. See
[implementation and explicit remaining boundaries](../docs/ped06-production-integration.md).

P2 PED-07 / TASK-97, PED-08 / TASK-98 and PED-09 / TASK-99 are `done`:
ordinary falls/get-up, independent severed parts and native effect/award outlets
now use actual population/FORM/PHIL owners. Stock and Advanced contacts,
release/reset, original gore selection, blood/shared marks, score chronology
and actual falling height are validated. Full suite:3670 passed,6 optional
cases skipped. PED-11 / TASK-134 now completes reachable nonhumanoid and
explosive contacts and corrects the original active-ragdoll assumption against
installed HW/SW evidence. See [exceptional physics](../docs/ped11-production-integration.md), [recovery](../docs/ped07-production-integration.md),
[severed parts](../docs/ped08-production-integration.md) and
[awards/effects](../docs/ped09-production-integration.md).

P2 PED-11 / TASK-134 is `done`: reachable nonhumanoid and explosive contacts
now use original sever selection, launch, damage and independent FORM parts.
Actual high-bone process-cache aliases, local-PE blood lookup, shared-face
settling and retained joint2 friction/quiet ownership are covered. Installed
ordinary callers use levels0/5; full level2/6 topology is dormant/incomplete,
not an active ragdoll to reproduce. Missing DOCTOR4/Nuke assets and optional
custom shapes remain explicit limitations. Full suite:3703 passed,6 skipped;
asset-free CI:3209 passed,431 skipped. Serial Stock/Advanced Chromium covers
exceptional hits, living recovery, ordinary severing and combat powerups.
[Implementation and validation](../docs/ped11-production-integration.md).

P2 QUA-13 / TASK-132 is `done`: every playtest now keeps an automatic rolling
three-minute bug history with a512MiB recorder budget, including download
headroom. **Save bug capture** exports a local `.c2bug` file without MCP.
Pause/lock history, actual download decoding, physics parity and short hardware
overhead are checked. See [capture contents and limits](../docs/bug-captures.md).

P3 PERF-24 / TASK-129 is deferred in `backlog` at medium priority until the
extreme-motion stall occurs again or the user explicitly selects it. The
[reproduced contact/solver energy source](../docs/runaway-contact-root-cause.md)
is already corrected in `bb61b30` against frozen red/green tests. Remaining
first-event capture and extreme-motion workload/lifecycle work is inactive;
retain the [historical FAIR/bumper evidence](../docs/screwie-runaway-car-stall.md)
without claiming that its unrecorded first impulse was replayed.

P1 PERF-25 / TASK-130 is `done`: the additional browser guard froze movement
against native-qualified OLD faces, keeping two anchored cones in a permanent
contact cycle. Frozen regressions and original Fridge Racer replay verify
normal phase progress, release and settling. See
[correction and measurement limits](../docs/perf25-world-joint-phase.md).
P3 PHY-24 / TASK-131 records separate released-actor initialization and source
snap callback chronology questions in `backlog`.

P1 PHY-22 / TASK-127 fixes the newly reproduced ignore-world lift cache omission
that globally blocked scenery reclaim. Its original Stock/Advanced and hardware
Chromium checks preserve near-owner protection and zero lift world contacts.
P3 PHY-23 / TASK-128 is deferred in `backlog` at medium priority until the
reported fatal sign impact recurs or a concrete mismatch can be reproduced.
The actual historical damaging rows remain unknown, and a clean Plow approach
does not reproduce the failure. The bounded impact/component recorder remains
available for another capture; see [evidence and boundaries](../docs/c2-ignore-world-reclaim-re.md).

The user selected the following implementation order. ANI-01/PED-04 complete the
first animation/resource stage. PED-06 through PED-09 are complete; PED-11 /
TASK-134 completes reachable exceptional contacts and records dormant topology.
Existing numeric priorities remain unchanged: selection order is explicit and
must not be inferred from priority alone. No pedestrian ticket currently occupies a WIP slot.

| Stage | Ticket                                | Status | Priority | Purpose                                                                                                      |
| ----- | ------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| 0b    | PERF-25 / TASK-130                    | done   | P1       | Resolve recurring anchored-scenery contact retries in Fridge Racer without hiding them through forced sleep. |
| 1     | ANI-01 / TASK-62 and PED-04 / TASK-57 | done   | P3       | Original FORM/MODEL selection, living/death BON/SKL, source morph/head/model effects and prepared vertices.  |
| 2     | PED-06 / TASK-96                      | done   | P2       | Bind ordinary population identities to native physical lifecycle and movement owners.                        |
| 3     | PED-07 / TASK-97                      | done   | P2       | Grounding, living falls and recovery ownership.                                                              |
| 4     | PED-08 / TASK-98                      | done   | P2       | Visible severing and articulated body contacts.                                                              |
| 5     | PED-09 / TASK-99                      | done   | P2       | Native contact causes, awards and blood/giblet/effect outlets.                                               |

P1 PED-10 / TASK-125 was inserted and completed during this stage: already
visible retained pedestrians inside the native process box now resume movement
and ordinary contact checks, while far actors remain presentation-only.
[Evidence and regression checks](../docs/pedestrian-nearby-admission.md) retain
the actual reported Newcity1 actor and source camera-jump hook.

P1 PHY-21 / TASK-126 is complete: physical capacity exhaustion now defers valid
scenery instead of permanently disabling it. Stock/Advanced original stop-sign
regressions reproduce the old failure and verify normal contact-driven motion
and tipping after capacity release. The query that caused the earlier 549 failed
actors is still unknown; see [evidence and adaptation](../docs/noncar-capacity-recovery.md).
QUA-12 / TASK-124 retains its separate contact/effect-fixture scope.

ANI-01 is complete for its animation/render scope, including native death and
morph playback, head/blood model changes, body/head powerup geometry, shared-CRT
mutant angles and exact prepared fire vertices. Stock/Advanced populations and
hardware Chromium are validated. Ordinary native physical population is integrated by PED-06; detailed recovery,
severing and complete contact-cause owners remain in the selected next tickets; see
[implemented behavior and ownership](../docs/c2-ped-presentation-re.md).

The animation stage preserves current gameplay transport until the corresponding
native physical owner is integrated. It must not duplicate population identities,
colliders, root displacement, death counts or rewards. Preserve the user's live
production scene by developing in an isolated checkout/build.

## Selected world/effect work (updated 2026-10-28)

WLD-05 / TASK-20 and DMG-03 / TASK-23 complete the selected independent
single-player world/car effect scope. The newly selected pedestrian queue is
listed above.

- World followups retain the actual native 400-face prefix, generated ACT
  identities and source face/material ownership. Immediate edge masks publish
  coherently before deferred tiers. Native pickup ACTs share final-flush grants,
  once-only hide/audio and original-ACT respawns. Rejected mine pickup hits use
  the separate native impulse core, without action30 damage/crush.
- Original replacement MODEL changes start ownerless mode-zero fire from current
  prepared vertices. Car/noncar/replacement preparation borrows actual MAT
  identities and owned host-resource addresses, preserving NULL and aliases.
  Fancy awards use original fonts, HUD slots and shared WASTED priority.
- Carrier's full18 ACT objectives plus the actual ADMIRAL death, four
  Stock/Advanced replacement-fire cases and existing crash/debris regressions
  have focused browser coverage. Original assets stay external and read only.

The earlier PHY-11 / TASK-10, AI-05 / TASK-17 and DMG-01 / TASK-21 remain done.
P3 PHY-20 / TASK-123 separately owns the modest bumpy-road suspension-history
startup discrepancy.

The completion boundary remains explicit:ordinary native pedestrian population
is complete under PED-06 / TASK-96. Detailed recovery, articulated bodies and
full blood/giblet/cause adapters remain PED-07/08/09 with their existing
transitive prerequisites.
Positional event audio remains AUD-03 / TASK-71. DMG-02 / TASK-22 retains the
unresolved, uncatalogued native `parallel` branch; this work also supplies its
previously duplicated finite-prefix, source-edge and fancy outlets. The original
78 catalogued track files contain only `away` followups, so no substitute formula
is invented for the installed parallel branch's uninitialized scratch reads.

Whole-engine CRT chronology and a historical Windows heap episode are not
claimed. Connected effect producers share the CRT stream and native phase order;
positive-material comparison uses real host addresses rather than guessed ranks.
See [producer coverage and boundaries](../docs/c2-effect-producer-audit.md),
[world edges/collector](../docs/c2-world-smash-source-edges-re.md),
[replacement fire](../docs/c2-replacement-fire-re.md) and
[WAM evidence](../docs/c2-wam-effects-re.md).

Current performance status (2026-10-24): PERF-02 and PERF-04 through PERF-23,
including all 18 direct PERF-01 subtasks, are done. PERF-03 resolution-policy
implementation and the PERF-01 umbrella are explicitly deferred at P5 at the
bottom of `backlog`, in that order. No performance ticket remains in `wip` or
`next`. PERF-01 retains its unresolved exact Snow tunnel-transition attribution
and consolidation criteria; moving it is not a claim that every performance issue
is fixed. Earlier dated entries below describe historical work and board states.

```sh
backlog board
backlog browser
backlog task list --status done --plain
backlog task list --labels priority-2 --plain
backlog task view TASK-1 --plain
```

## Board columns

| Column    | Meaning                                                                                                            | Imported status                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `backlog` | Open work awaiting selection, including inactive partially implemented work, unresolved data issues and validation | Missing, inactive Partial, Needs validation, Data issue |
| `next`    | Explicitly selected upcoming work                                                                                  | Initially empty                                         |
| `wip`     | The most recently active workstreams, limited to 3 tickets                                                         | Selected Partial tasks with concrete recent activity    |
| `done`    | The described scope was implemented and verified according to the existing record                                  | Done                                                    |

Migration preserved all 92 numbered issues plus three distinct completed checklist items (95 tasks total). Seven other completed checklist items are retained as evidence on existing tasks to avoid duplicates. The initial migration mapped all 35 Partial issues to `wip`; that mapping confused implementation completeness with active work. On 2026-10-11, 32 inactive partial issues were returned to `backlog`. After that cleanup, the board had 59 in `backlog`, 0 in `next`, 3 in `wip`, and 33 in `done`. The `legacy-partial` label and full implementation evidence remain unchanged, regardless of board status. Importing `done` preserves the previous verification record; it does not assert that the whole subsystem is complete or that migration reran engine tests. Original status labels such as `legacy-needs-validation` distinguish validation requests from reported defects. No new engine completion claims are introduced by the migration.

## WIP limit: 3

At most **three tickets** may occupy `wip`. Only genuinely active work belongs there; partially implemented but inactive tasks belong in `backlog`. Several subagents working together on a single ticket count as one slot. Record dependencies separately rather than starting every related ticket. Check the WIP count before beginning work; if all slots are occupied, finish a ticket or return inactive work to `backlog` first. Moving a task does not discard its existing implementation or evidence.

The three retained tickets were originally selected from actual source/test changes and normalized issue-description changes in the last engine commit, `83d0ba3`, rather than migration timestamps:

| Backlog ID | Original ID | Completed implementation                                                                            |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------- |
| TASK-19    | WLD-03      | Production prepared MODEL/ACT collection, live geometry ownership and separate drivable wheel phase |
| TASK-35    | PED-03      | Real population/group/mission counting from the native once-only OneLessPed outlet                  |
| TASK-67    | REN-02      | Native Gouraud/specular coefficients, material fog/sampling and shared race-resource lifetimes      |

This selection records the latest work context; changing board status does not resume a paused Goal. Backlog.md 1.47.1 has no built-in configurable WIP cap. The limit is therefore enforced by the project workflow and agent policy; the CLI/browser does not automatically reject a fourth ticket.

## PED-03 scope split

PED-03 / TASK-35 now owns only the small remaining integration of native `OneLessPed` with real population/group/mission counters. Its acceptance criteria require actual native contact bound to an existing population owner and real application-counter changes, plus once-only and legacy-path regressions. Recorded fixture events alone cannot close it. The full pre-split evidence remains in its historical description; the split itself did not claim engine completion. The bounded counting task is now implemented: Stock/Advanced Chromium verified real population/group/mission changes exactly once before scoring, including the original already-counted flag regression. Its deferred movement and articulated-body owners remain separate.

Four larger priority-2 follow-ups are separately tracked in `backlog`:

| Legacy ID | Backlog ID | Deferred scope                                                                                |
| --------- | ---------- | --------------------------------------------------------------------------------------------- |
| PED-06    | TASK-96    | Normal population identities, native physical/resource admission and movement/spawn ownership |
| PED-07    | TASK-97    | Native grounding, fall/get-up/recovery, selected volumes and process/face ownership           |
| PED-08    | TASK-98    | Visible severing, articulated body/part contacts and exceptional form continuations           |
| PED-09    | TASK-99    | Native physical cause/retained award inputs and contact/effect consumer adapters              |

Existing PED-04, ANI-01, RAC-04, RAC-09 and PUP-11 retain asset, animation, reward-formula, replay and combat ownership; their descriptions clarify the extracted boundaries. Their existing priorities are unchanged. Follow-ups depend on the narrowed counting integration where appropriate; closing PED-03 does not require completing them and does not assert full native pedestrian parity. No paused Goal or broader acceptance gate is completed by changing task scope.

The split produced 99 tasks. After completing the three selected WIP tickets, the board contains 63 in `backlog`, 0 in `next`, 0 in `wip`, and 36 in `done`. The WIP limit remains 3. This completion does not resume or complete a paused broader Goal.

PERF-01 / TASK-100 was subsequently added at priority 1 and taken directly into
`wip` at the user's request. The initial
[analysis](../docs/performance-investigation.md) is recorded; implementation
choices remain open. The user then separated upcoming work as follows:

| Backlog ID | Issue   | Priority | Status    | Scope / order                                                                            |
| ---------- | ------- | -------- | --------- | ---------------------------------------------------------------------------------------- |
| TASK-100   | PERF-01 | 5        | `backlog` | Profiling umbrella deferred after concrete implementation queue completion               |
| TASK-101   | PERF-02 | 1        | `done`    | Shared render preparation and dormant pedestrian subtree pruning, measured and validated |
| TASK-104   | PERF-05 | 1        | `done`    | Lazy SAT and per-invocation guard caches, numerical and Chromium validation              |
| TASK-103   | PERF-04 | 2        | `done`    | Fourfold visual ranges, native activation preserved; headed hardware before/after checks |
| TASK-102   | PERF-03 | 5        | `backlog` | Resolution-policy implementation deferred; GPU savings measured, no consistent FPS gain  |

At the creation of this queue, the board had 111 tasks: 64 `backlog`, 8 `next`,
1 `wip` and 38 `done`.
PERF-04 subsequently extended visual ranges after the structural queue and
PERF-13 integration; see [policy and hardware measurements](../docs/visual-visibility.md).
Only the profiling investigation remains active; queued tickets do not consume
WIP slots. Existing QUA-05/QUA-06/QUA-10 keep their narrower hardware-coverage,
memory and FPS-diagnostic scopes and user-edited priorities.

PERF-05 / TASK-104 owns physics implementation separately from PERF-01's analysis.
Prioritize code and algorithm improvements while preserving collision decisions,
native timing and anti-tunneling/interlock safeguards. Consider a separately scoped
worker redesign only as a last resort if measurements after optimization justify it.

## Timber structural performance queue

The [Timber investigation](../docs/timber-performance-findings.md) produced seven
implementation subtasks of TASK-100, selected by the user at priority 1 and placed
in `next`. They precede P2 visibility work. Stored ordinals define the proposed
implementation order; dependencies record technical prerequisites separately.
Creating this queue does not start implementation or occupy additional WIP slots.
PERF-06 through PERF-11 were completed on 2026-10-12. PERF-12 was completed on
2026-10-13; the table retains the implementation order.

| Order | Backlog ID | Issue   | Priority / status | Scope                                                              |
| ----- | ---------- | ------- | ----------------- | ------------------------------------------------------------------ |
| 1     | TASK-100.1 | PERF-06 | P1 / `done`       | Spatial body-pair discovery and tighter constant-prop bounds       |
| 2     | TASK-100.2 | PERF-07 | P1 / `done`       | Shared immutable body geometry snapshots across pairs              |
| 3     | TASK-100.3 | PERF-08 | P1 / `done`       | Retained native MODEL bounds with mutation validity                |
| 4     | TASK-100.4 | PERF-09 | P1 / `done`       | Synchronization of changed world actors/geometry only              |
| 5     | TASK-100.5 | PERF-10 | P1 / `done`       | Native smash restart versus actual owner-specific invalidation     |
| 6     | TASK-100.6 | PERF-11 | P1 / `done`       | Conservative local world-face discovery for physics/camera queries |
| 7     | TASK-100.7 | PERF-12 | P1 / `done`       | Reuse of unchanged collision work between correction passes        |

[World synchronization](../docs/world-sync-performance.md) now retains unchanged
geometry and synchronizes query-selected native subtrees before callbacks.
PERF-01 remains the active profiling/coordinating ticket; visibility and resolution
retain separate scopes. [Smash invalidation](../docs/smash-invalidation-performance.md) separates
unchanged notifications from actual owner changes. Completing these scopes does
not assert that all frame-time spikes are fixed.

[World face locality](../docs/world-face-performance.md) now narrows static
guard/camera candidates while preserving native wheel/capacity paths, moving
owner snapshots and contact decisions. Cold index costs and adverse quarry
timings remain recorded under PERF-01.

[Correction-pass reuse](../docs/correction-performance.md) checks exact body and
world validity, reuses unsolved rows for unchanged pairs, and defers full dormant
geometry until spatial admission. Stock/Advanced Timber retain eight correction
passes, restart work and exact damage/guard outcomes. Work reductions are stable;
elapsed frame results remain mixed and the exact reported route still needs
profiling. After this completion the board has 112 tasks: 64 `backlog`, 1 `next`,
1 `wip` and 46 `done`. PERF-01 alone remains active; P2 visibility remains next.

Native MODEL bounds are separated from broader synchronization so their narrower
cache validity can be reviewed independently. Correction-pass reuse follows the
ownership/index work because its validity depends on impulses, activation,
geometry and attachment changes. Every task requires meaningful conformance and
short Chromium validation; skipping safeguards or changing iteration/native
timing limits does not qualify as optimization. PERF-01 retains exact canyon/
tunnel attribution and profiling coordination; PERF-03/04 and existing QA scopes
keep their user-assigned priorities.

## Priorities and sorting

The original five numeric levels remain visible in each task title (`[P1] PHY-10: …`), label (`priority-1`) and description. Lower numbers mean higher importance. Backlog.md's native three-level priority is an additional coarse grouping:

| Numeric priority | Meaning                                                                    | Native priority |
| ---------------- | -------------------------------------------------------------------------- | --------------- |
| 1                | High impact on driving, crashes and destruction                            | high            |
| 2                | Important gameplay mechanics or substantially simplified original behavior | high            |
| 3                | Further compatibility, content and major game systems                      | medium          |
| 4                | Quality assurance, robustness, maintainability and convenience             | low             |
| 5                | Presentation and UI with less impact on gameplay feel                      | low             |

All columns use explicit ordinals to put numeric priority 1 first and priority 5 last, retaining original table order within each priority. Ordinals are initially `priority × 1000 + original row index`, leaving room for manual ordering. Native priority alone cannot distinguish 1 from 2 or 4 from 5; keep the numeric title, label and ordinal consistent when reprioritizing. A task's original issue ID (for example `PHY-09`) stays in its title, label and description; Backlog.md also assigns its own `TASK-…` ID for CLI operations. Existing issue references remain valid.

The three completed checklist items had no original issue ID or numeric priority. They retain that distinction, use `unprioritized` and `imported-checklist` labels, and sort after the numbered issues in `done` rather than inventing a user-assigned priority.

The interactive terminal/browser board respects ordinals. Plain task-list output does not reliably reflect those ordinals, and its native priority sort cannot distinguish numeric P1 from P2. Backlog.md 1.47.1's Markdown board export (also used by `backlog board` without an interactive terminal) instead sorts by update date, so it does not preserve this priority order. The stored ordinals and the interactive board remain the intended queue order.

## Preserved context

The previous list recorded gaps, simplified implementations and outstanding checks, without claiming full C2 parity. Its 2026-10-08 summary recorded numerical and Chromium checks of interlocked-car recovery and terrain placement on DUNE BUGGERED (green Eagle, Buggy and Bigdump), with NEW CITY as a control. The scale audit found no global vehicle scaling error but identified the camera discrepancy recorded under REN-05. Per-task status remains authoritative: AI-05 still requests further validation of terrain placement.

Powerup action numbers come from the local `POWERUP.TXT`. Missing effects are collected and reported as `NOT IMPLEMENTED`; random pickups may select them according to the original table. Working credit, repair, time, engine/grip, protection and APO effects are not listed as missing.

Data issues do not request changes to original files. `carma2_orig/` remains read-only. Distinguish format variants, installation contents and engine expectations before adding targeted support or reporting clear unavailability.

## Maintaining tasks

PHY-12 / TASK-105 was inserted at priority 1 for the reproduced airborne freeze
beside blocked, non-contacting props. Its verified fix replaces proximity-based
guard coupling with actual trajectory constraints and revalidation; see
[implementation and validation](../docs/guard-coupling-fix.md). PHY-10 terrain
support traps and PHY-11 degenerate crush hulls retain their independent scope
and user-edited priorities. This bugfix does not complete PERF-01 or the broader
engine-fidelity work.

Use the CLI or browser to edit tasks rather than manually rewriting task Markdown. Move selected work to `next`, active work to `wip`, and verified finished scope to `done`. Leave finished tasks on the board; archiving removes them from `done`.

PHY-13 / TASK-106 was added at priority 1 in `backlog` after a user-driven Timber
session captured a road lockup caused by deeply overlapping detached own debris.
Clone-only probes separate it from the PHY-12 non-contact coupling fix and retain
the original paused game. See [diagnostic evidence](../docs/own-debris-lockup.md).
It has no implemented fix and does not reproduce the PERF-01 frame-time failure;
visibility remains deferred. The new task makes 113 tasks: 65 `backlog`, 1 `next`,
1 `wip`, 46 `done`, with existing priorities unchanged.

The subsequent real user-driven 6 FPS capture confirms dominant physics CPU
and global correction/catch-up amplification. PERF-13 / TASK-100.8 is P1 in
`wip`, ordinal 1180, ahead of P2 visibility. Its authorized implementation removes
repeated shape walks, discarded query work and transient collision allocations;
see [implementation and remaining acceptance](../docs/guard-kernel-performance.md).
Iteration/catch-up limits and solver callbacks are preserved. The actual
hardware route and the 180-degree correlation remain unverified; software
measurements retain adverse samples and do not close that acceptance.
[Live evidence](../docs/live-timber-drop.md) includes observer overhead.
PERF-01 and PERF-13 occupy two WIP slots. The board now has 114 tasks:
65 `backlog`, 1 `next`, 2 `wip`, 46 `done`; existing priorities are unchanged.

A subsequent [root-cause analysis](../docs/perf13-root-cause-analysis.md)
identifies frame-window feedback and a plausible jammed opponent/own-debris
contributor matching the PHY-13 mechanism; dominant attribution remains open. PERF-13 / TASK-100.8 now
depends on PHY-13 / TASK-106, which gained an acceptance criterion for the
captured opponent case. Statuses, priorities and ordinals are unchanged.

Reviewed follow-up implements further SAT/fixed-body allocation reductions and
phase roster reuse. Hardware MCP reconnects; bounded recreated Timber CPU
comparisons preserve exact numerical states/fractions with mixed timing samples.
The actual rendered user-route stall and PHY-13 remain open. A keyboard target
assumption found during QA is fixed as UI-04 / TASK-107 (`done`). Current board:
115 tasks,65 `backlog`,1 `next`,2 `wip`,47 `done`; WIP remains below3.

## Selected structural redesign queue

On 2026-10-13 the user selected the fundamental findings for implementation,
explicitly allowing substantial reversible physics/guard changes and playtests
between ticket checkpoints. All six entries are P1/high in `next`, ordered by
stored ordinal. PHY-13 is reused rather than duplicating the own-debris/guard fix.

| Order | Issue   | Backlog ID  | Ordinal | Scope                                                             |
| ----- | ------- | ----------- | ------- | ----------------------------------------------------------------- |
| 1     | PERF-14 | TASK-100.9  | 1190    | Native hierarchy-aware joint candidate movement                   |
| 2     | PHY-13  | TASK-106    | 1200    | Native old-overlap recovery and restrictive guard redesign        |
| 3     | PERF-15 | TASK-100.10 | 1210    | Change-local collision response and retry orchestration           |
| 4     | PERF-16 | TASK-100.11 | 1220    | Retained static ACTs, local physical admission and reclaim bridge |
| 5     | PERF-17 | TASK-100.12 | 1230    | Generic car/part/jointed-prop hierarchy sleep and wake            |
| 6     | PERF-18 | TASK-100.13 | 1240    | Dormant render-pose work and scenery batch locality               |

Native/gameplay expectations govern redesign; preserving the old browser's
monotone-depth guards or eight global rounds is not a completion requirement.
Each ticket owns focused validation and a separate Git checkpoint for user
playtesting. Original data remains read-only and measurements stay short/serial.
Admission/reclaim initially uses already authoritative quiet states; PERF-17
supplies the remaining hierarchy providers. Detached/split car pieces do not
become reclaimable driver-4 scenery merely because they sleep.

PERF-13 returns to `backlog` for residual rendered-route integration and profiling
after these changes; its implemented optimizations and historical checks remain
intact. PERF-01 remains `wip` for coordination. PERF-04 stays P2 in `next` after
PERF-13 validation, with its original visibility scope and ordinal unchanged.
The board contains 120 tasks:65 `backlog`,7 `next`,1 `wip`,47 `done`.
No implementation ticket has been started or engine behavior changed by this
queue update. The WIP limit remains3; the broader paused Goal is unchanged.

PERF-14 / TASK-100.9 is now `done`: installed-native parent-first candidate
movement is shared by collision probes and commitment; ordinary part anchors
are aligned during that trajectory rather than by a second post-commit guard.
[Hierarchy movement evidence](../docs/hierarchy-motion-performance.md) records
numerical/original-data tests, production Chromium crash/repair validation and
bounded AMD hardware comparisons, including adverse timing samples. It does
not resolve the old-overlap guard or the full Timber FPS collapse. PHY-13 remains
the next P1 ticket for a separate checkpoint after user playtesting. Current
board: 120 tasks, 65 `backlog`, 6 `next`, 1 `wip`, 48 `done`. PERF-01 alone
remains active; the broader paused Goal is unchanged.

PHY-13 / TASK-106 is now `done`: native-qualified old hull-pair recovery admits
solver-selected phase movement instead of forcing monotonically decreasing
penetration. Fresh clear phases rearm collision checks; independent other hulls,
third bodies, finite world contacts and physical joint-tree timing remain guarded.
[Recovery evidence](../docs/old-overlap-recovery.md) records the captured player/
Cerby release, preserved impulses, numerical regressions and production/MCP
driving, new own-piece contact and repair validation. This does not close the
whole rendered Timber performance investigation. PERF-15 is the next P1
checkpoint after user playtesting. The separately discovered nested-parent
eligibility discrepancy is PHY-14 / TASK-108, P2 in `backlog`, without an engine
change in that scope. Current board: 121 tasks, 66 `backlog`, 5 `next`, 1 `wip`,
49 `done`. PERF-01 alone remains active; WIP limit3 and the broader paused Goal
are unchanged.

PERF-15 / TASK-100.10 is now `done`: local OLD-X/response-ring scheduling,
incident discovery and mutation barriers replace eight global correction rounds;
shared50-row friction follows normal commitment and precedes quiet processing.
[Evidence and costs](../docs/local-response-performance.md) retain the saved
Cerby response, original-car regressions and mixed hardware comparisons,
including slower Advanced cases. This does not close the actual-route
performance investigation. PERF-16 is the next P1 checkpoint after user
playtesting; its inactive/static participation bridge remains essential.
Current board:121 tasks,66 `backlog`,4 `next`,1 `wip`,50 `done`. PERF-01 alone
remains active; WIP limit3 and the broader paused Goal remain unchanged.

```sh
backlog task edit TASK-1 --status next
backlog task edit TASK-1 --status wip
backlog task edit TASK-1 --status done
backlog task edit TASK-1 --ordinal 1000
backlog task create "[P2] New issue title" --status backlog --priority high --labels priority-2 --ordinal 2100 --description "Problem, evidence and remaining scope."
```

Descriptions retain distinctions between reported symptoms, reproduced defects, approximations, outstanding validation and verified fixes. Preserve technical evidence and source links when updating scope. Board movement is separate from exact priority; user changes take precedence over the initial ordering.

PERF-17 / TASK-100.12 is now `done`: production car/part/jointed-prop quiet
ownership joins native energy/gravity/child folds with complete contact rings.
Resting pieces retain physical and graphical ownership while skipping independent
forces/response; actual impacts, wheel support, release, repair and replacement
wake them. Grounded cars still run source WheelForces.
[Evidence and validation](../docs/hierarchy-quiet-performance.md) record natural
original-part sleep, actual bumper/root hits, resumed force work, source creation
packets and the explicit one-phase split startup correction. Native pool-memory
aliasing and unknown/tumble eligibility remain documented; no FPS guarantee is
claimed from the short mixed SwiftShader comparison. Hardware page creation and
a final async DevTools probe failed separately from the passing application checks.
PERF-18 is the next P1 checkpoint after user playtesting; PERF-01 alone stays
`wip`, with the WIP limit3 and broader paused Goal unchanged.
Current board:121 tasks,66 `backlog`,2 `next`,1 `wip`,52 `done`.

## Topic labels and scope reconciliation (2026-10-30)

Open tickets use `topic-*` labels for filtering by subsystem: `topic-pedestrians`,
`topic-powerups`, `topic-ai`, `topic-physics`, `topic-destruction`,
`topic-campaign`, `topic-rendering`, `topic-audio`, `topic-quality`,
`topic-performance` and `topic-ui`. A ticket can carry more than one when its
remaining work crosses subsystem boundaries. Existing issue, priority and legacy
labels remain intact. Filter with, for example,
`backlog task list --labels topic-physics --plain`.

The open queue was tagged and reconciled against implementation notes. PUP-11 /
TASK-30 is now `done`: its gameplay/timed effects are implemented. The
historical articulated-topology assumption is resolved by the PED-11 / TASK-134
audit; prepared vertices are completed under ANI-01 / TASK-62, while positional
audio remains AUD-03 / TASK-71. DMG-02 / TASK-22 remains open for prepared face/column ordering at
saturation and any remaining source connotation outlets; completed WLD-05 /
DMG-03 providers were removed from its active scope, while the unused undefined
parallel-direction branch remains documented as uncertainty. Original evidence
and ticket history are retained.

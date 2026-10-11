# Project backlog

Backlog.md is the task source of truth. The former `TODO.md` entries have been migrated with their complete descriptions, evidence, source references, original issue IDs and numeric priorities. Use the installed `backlog` CLI from the repository root; it stores tasks in `backlog/tasks/` without committing automatically or checking remote branches.

```sh
backlog board
backlog browser
backlog task list --status done --plain
backlog task list --labels priority-2 --plain
backlog task view TASK-1 --plain
```

## Board columns

| Column | Meaning | Imported status |
| --- | --- | --- |
| `backlog` | Open work awaiting selection, including inactive partially implemented work, unresolved data issues and validation | Missing, inactive Partial, Needs validation, Data issue |
| `next` | Explicitly selected upcoming work | Initially empty |
| `wip` | The most recently active workstreams, limited to 3 tickets | Selected Partial tasks with concrete recent activity |
| `done` | The described scope was implemented and verified according to the existing record | Done |

Migration preserved all 92 numbered issues plus three distinct completed checklist items (95 tasks total). Seven other completed checklist items are retained as evidence on existing tasks to avoid duplicates. The initial migration mapped all 35 Partial issues to `wip`; that mapping confused implementation completeness with active work. On 2026-10-11, 32 inactive partial issues were returned to `backlog`. After that cleanup, the board had 59 in `backlog`, 0 in `next`, 3 in `wip`, and 33 in `done`. The `legacy-partial` label and full implementation evidence remain unchanged, regardless of board status. Importing `done` preserves the previous verification record; it does not assert that the whole subsystem is complete or that migration reran engine tests. Original status labels such as `legacy-needs-validation` distinguish validation requests from reported defects. No new engine completion claims are introduced by the migration.

## WIP limit: 3

At most **three tickets** may occupy `wip`. Only genuinely active work belongs there; partially implemented but inactive tasks belong in `backlog`. Several subagents working together on a single ticket count as one slot. Record dependencies separately rather than starting every related ticket. Check the WIP count before beginning work; if all slots are occupied, finish a ticket or return inactive work to `backlog` first. Moving a task does not discard its existing implementation or evidence.

The three retained tickets were originally selected from actual source/test changes and normalized issue-description changes in the last engine commit, `83d0ba3`, rather than migration timestamps:

| Backlog ID | Original ID | Completed implementation |
| --- | --- | --- |
| TASK-19 | WLD-03 | Production prepared MODEL/ACT collection, live geometry ownership and separate drivable wheel phase |
| TASK-35 | PED-03 | Real population/group/mission counting from the native once-only OneLessPed outlet |
| TASK-67 | REN-02 | Native Gouraud/specular coefficients, material fog/sampling and shared race-resource lifetimes |

This selection records the latest work context; changing board status does not resume a paused Goal. Backlog.md 1.47.1 has no built-in configurable WIP cap. The limit is therefore enforced by the project workflow and agent policy; the CLI/browser does not automatically reject a fourth ticket.

## PED-03 scope split

PED-03 / TASK-35 now owns only the small remaining integration of native `OneLessPed` with real population/group/mission counters. Its acceptance criteria require actual native contact bound to an existing population owner and real application-counter changes, plus once-only and legacy-path regressions. Recorded fixture events alone cannot close it. The full pre-split evidence remains in its historical description; the split itself did not claim engine completion. The bounded counting task is now implemented: Stock/Advanced Chromium verified real population/group/mission changes exactly once before scoring, including the original already-counted flag regression. Its deferred movement and articulated-body owners remain separate.

Four larger priority-2 follow-ups are separately tracked in `backlog`:

| Legacy ID | Backlog ID | Deferred scope |
| --- | --- | --- |
| PED-06 | TASK-96 | Normal population identities, native physical/resource admission and movement/spawn ownership |
| PED-07 | TASK-97 | Native grounding, fall/get-up/recovery, selected volumes and process/face ownership |
| PED-08 | TASK-98 | Visible severing, articulated body/part contacts and exceptional form continuations |
| PED-09 | TASK-99 | Native physical cause/retained award inputs and contact/effect consumer adapters |

Existing PED-04, ANI-01, RAC-04, RAC-09 and PUP-11 retain asset, animation, reward-formula, replay and combat ownership; their descriptions clarify the extracted boundaries. Their existing priorities are unchanged. Follow-ups depend on the narrowed counting integration where appropriate; closing PED-03 does not require completing them and does not assert full native pedestrian parity. No paused Goal or broader acceptance gate is completed by changing task scope.

The split produced 99 tasks. After completing the three selected WIP tickets, the board contains 63 in `backlog`, 0 in `next`, 0 in `wip`, and 36 in `done`. The WIP limit remains 3. This completion does not resume or complete a paused broader Goal.

PERF-01 / TASK-100 was subsequently added at priority 1 and taken directly into
`wip` at the user's request. The initial
[analysis](../docs/performance-investigation.md) is recorded; implementation
choices remain open. The user then separated upcoming work as follows:

| Backlog ID | Issue | Priority | Status | Scope / order |
| --- | --- | --- | --- | --- |
| TASK-100 | PERF-01 | 1 | `wip` | Cross-subsystem profiling, unresolved frame-time spikes and finding coordination |
| TASK-101 | PERF-02 | 1 | `next` | Scene-hierarchy CPU overhead; explicitly no solution prescribed |
| TASK-104 | PERF-05 | 1 | `next` | Physics code/algorithm optimization; Web Workers reserved as a last resort |
| TASK-103 | PERF-04 | 2 | `next` | Higher visual visibility, dependent on TASK-101 |
| TASK-102 | PERF-03 | 4 | `backlog` | High-resolution rendering policy; deferred, measured gain was small |

The board now has 104 tasks: 64 `backlog`, 3 `next`, 1 `wip` and 36 `done`.
Only the profiling investigation remains active; queued tickets do not consume
WIP slots. Existing QUA-05/QUA-06/QUA-10 keep their narrower hardware-coverage,
memory and FPS-diagnostic scopes and user-edited priorities.

PERF-05 / TASK-104 owns physics implementation separately from PERF-01's analysis.
Prioritize code and algorithm improvements while preserving collision decisions,
native timing and anti-tunneling/interlock safeguards. Consider a separately scoped
worker redesign only as a last resort if measurements after optimization justify it.

## Priorities and sorting

The original five numeric levels remain visible in each task title (`[P1] PHY-10: …`), label (`priority-1`) and description. Lower numbers mean higher importance. Backlog.md's native three-level priority is an additional coarse grouping:

| Numeric priority | Meaning | Native priority |
| --- | --- | --- |
| 1 | High impact on driving, crashes and destruction | high |
| 2 | Important gameplay mechanics or substantially simplified original behavior | high |
| 3 | Further compatibility, content and major game systems | medium |
| 4 | Quality assurance, robustness, maintainability and convenience | low |
| 5 | Presentation and UI with less impact on gameplay feel | low |

All columns use explicit ordinals to put numeric priority 1 first and priority 5 last, retaining original table order within each priority. Ordinals are initially `priority × 1000 + original row index`, leaving room for manual ordering. Native priority alone cannot distinguish 1 from 2 or 4 from 5; keep the numeric title, label and ordinal consistent when reprioritizing. A task's original issue ID (for example `PHY-09`) stays in its title, label and description; Backlog.md also assigns its own `TASK-…` ID for CLI operations. Existing issue references remain valid.

The three completed checklist items had no original issue ID or numeric priority. They retain that distinction, use `unprioritized` and `imported-checklist` labels, and sort after the numbered issues in `done` rather than inventing a user-assigned priority.

The interactive terminal/browser board respects ordinals. Plain task-list output does not reliably reflect those ordinals, and its native priority sort cannot distinguish numeric P1 from P2. Backlog.md 1.47.1's Markdown board export (also used by `backlog board` without an interactive terminal) instead sorts by update date, so it does not preserve this priority order. The stored ordinals and the interactive board remain the intended queue order.

## Preserved context

The previous list recorded gaps, simplified implementations and outstanding checks, without claiming full C2 parity. Its 2026-10-08 summary recorded numerical and Chromium checks of interlocked-car recovery and terrain placement on DUNE BUGGERED (green Eagle, Buggy and Bigdump), with NEW CITY as a control. The scale audit found no global vehicle scaling error but identified the camera discrepancy recorded under REN-05. Per-task status remains authoritative: AI-05 still requests further validation of terrain placement.

Powerup action numbers come from the local `POWERUP.TXT`. Missing effects are collected and reported as `NOT IMPLEMENTED`; random pickups may select them according to the original table. Working credit, repair, time, engine/grip, protection and APO effects are not listed as missing.

Data issues do not request changes to original files. `carma2_orig/` remains read-only. Distinguish format variants, installation contents and engine expectations before adding targeted support or reporting clear unavailability.

## Maintaining tasks

Use the CLI or browser to edit tasks rather than manually rewriting task Markdown. Move selected work to `next`, active work to `wip`, and verified finished scope to `done`. Leave finished tasks on the board; archiving removes them from `done`.

```sh
backlog task edit TASK-1 --status next
backlog task edit TASK-1 --status wip
backlog task edit TASK-1 --status done
backlog task edit TASK-1 --ordinal 1000
backlog task create "[P2] New issue title" --status backlog --priority high --labels priority-2 --ordinal 2100 --description "Problem, evidence and remaining scope."
```

Descriptions retain distinctions between reported symptoms, reproduced defects, approximations, outstanding validation and verified fixes. Preserve technical evidence and source links when updating scope. Board movement is separate from exact priority; user changes take precedence over the initial ordering.

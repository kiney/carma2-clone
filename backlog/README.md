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
| `backlog` | Open work awaiting selection, including unresolved data issues and validation | Missing, Needs validation, Data issue |
| `next` | Explicitly selected upcoming work | Initially empty |
| `wip` | Work partly implemented, with remaining scope recorded in the description | Partial |
| `done` | The described scope was implemented and verified according to the existing record | Done |

Migration imports all 92 numbered issues plus three distinct completed checklist items: 27 in `backlog`, 35 in `wip`, 33 in `done` (95 tasks total). Seven other completed checklist items are retained as evidence on existing tasks to avoid duplicates. Imported `wip` means partially implemented, not that all 35 tasks are being worked on simultaneously. Importing `done` preserves the previous verification record; it does not assert that the whole subsystem is complete or that migration reran engine tests. Original status labels such as `legacy-needs-validation` distinguish validation requests from reported defects. No new engine completion claims are introduced by the migration.

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

The interactive terminal/browser board and default task list respect ordinals. Backlog.md 1.47.1's Markdown board export (also used by `backlog board` without an interactive terminal) instead sorts by update date, so it does not preserve this priority order.

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

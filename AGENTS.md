# Project workflow and agent policy

## Language and communication

- All authored application UI must be English, regardless of the language of the user's prompt. This includes menus, HUD text, debug tools, tooltips, accessibility labels, loading/status messages and errors. Keep `index.html` marked `lang="en"`. Preserve original proper names and asset identifiers.
- Conversation with the user may remain German. Do not infer a UI localization request from a German conversation.
- Keep all project documentation in English, including README, Backlog tasks, workflow policies and reverse-engineering notes. Translate newly reported German issues into English when documenting them. Use English for new code comments. Preserve user-maintained legacy issue identifiers, priorities, status meanings and technical evidence; do not retain German prose solely because an entry was authored by the user. A later explicit localization request may override this policy.
- For longer responses, start with an Executive Summary stating the outcome, decisions and important limitations. Omit it for short responses. Give concise progress updates during extended work; report actual results and validation.

## Scope and autonomy

- Continue improving the existing engine. Preserve working tracks, cars, races, controls, audio, opponents, pedestrians and debug tools. Audit the relevant implementation before replacing it; do not restart the project or provide another architecture proposal instead of implementing a requested change.
- Make routine engineering decisions and complete authorized implementation, integration and debugging without asking the user to choose a language, library, architecture, directory layout, priorities or agent setup. Follow runtime permission rules.
- If a missing system tool is materially necessary, first try installed tools and project-local dependencies. Prefer Debian packages. Ask only for the exact required installation, explaining why existing tools are insufficient and giving an exact `sudo apt install ...` command. Project-local dependencies need no separate approval; retain reproducible lockfiles.
- If an explicit active Goal exists, use its actual acceptance criteria. A milestone, passing tests or an approximation of a core requirement does not by itself complete the Goal. Do not create a Goal unless explicitly requested.
- Keep Backlog tasks in `backlog/tasks/` current with discovered defects and compatibility gaps, using the `backlog` CLI. Reconcile duplicates, retain stable legacy identifiers (such as `PHY-09`) in titles and labels, and respect priorities the user edits. Distinguish reported symptoms, reproduced defects, approximations and verified fixes. Use board statuses `backlog`, `next`, `wip`, `done`; preserve exact numeric priorities 1–5 in `[P<number>]` titles and `priority-<number>` labels. Keep board ordinals ordered by numeric priority; see `backlog/README.md` for native priority mapping and migration semantics. `TODO.md` is only a redirect, not a second task list.
- Enforce a WIP limit of **3 tickets** in the `wip` column. Before starting a ticket, check the current count with `backlog task list --status wip --plain`; when three slots are occupied, finish an active ticket or return inactive work to `backlog` before starting another. Partially implemented work alone does not qualify as WIP. Several subagents collaborating on the same ticket consume one slot. Track dependencies separately; they do not justify exceeding the limit. Backlog.md 1.47.1 has no native column cap, so this is a mandatory workflow rule rather than an automatic CLI/browser restriction.
- Prioritize C2 gameplay, collision, crush, damage, destruction and repair fidelity over cosmetic UI work when working on engine fidelity. Follow the user's current task and priority changes.

## Original assets and licensing

- `carma2_orig/` is strictly READ ONLY. Never modify, rename, move, delete, re-encode or overwrite its contents, including executables. Do not commit original assets or executable contents.
- Keep original data and proprietary generated/copied caches ignored. The source repository and production bundle must contain only redistributable source/tooling and safe fixtures. Generated screenshots and asset-derived reports belong in ignored `artifacts/` or `/tmp`.
- Serve the configured local installation directly through the existing asset server. `CARMA2_ROOT` overrides the default `./carma2_orig`. Do not expose arbitrary filesystem paths.
- Inspect third-party licenses before reusing code. Do not blindly vendor reference projects or copy unclear-license code. Prefer independent implementation from documented formats, observed data and verified behavior; document attribution and licensing obligations for any actual reuse.

## Subagents and model routing

The established practice is proactive delegation when tasks can be separated usefully. The root agent owns architecture, physics interpretation, acceptance criteria, integration and final review. Do not spawn agents just to satisfy a quota; keep small sequential tasks in the root when delegation would add more overhead than value.

| Work                                                                                                                                                                                                                                                             | Preferred model and reasoning                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Inventory, source/symbol searches, structured extraction, PE/strings comparisons, parsers with an established specification, repetitive implementation, fixtures/tests, documentation, mechanical reviews, bounded browser/screenshot QA and obvious build fixes | `gpt-6-luna`, low or medium                           |
| Architecture, ambiguous binary formats, difficult reverse engineering, collision mathematics, crush/physics interpretation, game-state design, renderer bugs, integration failures and high-impact review                                                        | `gpt-6.1-sol`, medium or high                         |
| A major unresolved architectural or reverse-engineering issue after Sol has produced concrete evidence and cannot resolve it                                                                                                                                     | `gpt-6-astra`, if available, for a focused escalation |

- Use explicit model selection when supported. If an override or context-fork combination is rejected, retry with a supported configuration; do not ask the user to configure orchestration. If model selection is unavailable, use the available subagent mechanism.
- Use a small context fork, preferably `fork_turns="none"`, with a self-contained task specifying paths, evidence to inspect, ownership, expected output and acceptance criteria. Avoid forwarding the full project history to mechanical workers.
- Research and audit workers are normally read-only. Ask narrow questions, such as mapping the contact-to-impulse call path or checking a screenshot for a specific transform defect.
- Assume a shared filesystem. Assign writers non-overlapping modules/directories; never let agents edit the same file concurrently. Serialize overlapping work or use isolated worktrees when appropriate. Respect the runtime concurrency limit.
- Review worker output against code, original data and runtime evidence. Retry failures with a narrower task; escalate repeated ambiguous failures to Sol. The root integrates and verifies the result.

## Evidence and implementation

- C2 is the specification. Use original car configuration, WAM data, geometry and gameplay tables rather than hard-coded Eagle/track behavior or generic physics coefficients.
- Consult `madebr/rec2` first as a map into C2 functions and addresses. Dethrace provides ancestral clues, not proof that C2 behavior is identical. Use community tooling/documentation where relevant and inspect licenses.
- Hash executables and record PE metadata before serious binary analysis. Exploit shared HW/SW game logic to distinguish gameplay from renderer code. Use static analysis and suitable installed tools before manually decoding assembly.
- Maintain concise implementation evidence in `docs/c2-physics-re.md` and the related subsystem notes. Record symbols/addresses where known, structures, equations/constants, car fields, confidence, implemented behavior and deviations. Avoid large proprietary binary dumps.
- Label evidence as verified from the original binary, reconstructed by rec2, compared with Dethrace, implied by original data, experimentally inferred or a temporary approximation. Resolve conflicting interpretations with code/data inspection or a focused test.
- Structural performance direction (2026-10-13): the user authorizes substantial, reversible changes to physics orchestration and browser-added collision guards. Their current algorithms, sampling caps and bitwise outcomes are not immutable specifications. Prefer native-informed behavior, meaningful crash regressions and playable performance; do not require exhaustive safety proofs before trying a justified redesign. Keep a reviewed Git checkpoint per ticket and provide a concise playtest focus so the user can test between changes and regressions can be rolled back. Preserve historical exact-comparison evidence without using it to freeze known browser-specific defects.
- Keep behavior data-driven, binary parsers bounds-checked, simulation timesteps stable and visual/gameplay state coherent. Preserve cumulative localized crush, component damage, physical detached parts and repair behavior.
- Debug grants should reuse normal powerup/simulation paths. Keep debug mode visibly selectable, opt-in and off on page load. Timer freezing must not pause driving, physics, AI or normal timed-powerup expiry. Label unsupported effects honestly.

## Validation and checkpoints

- Run checks appropriate to the change. Avoid tests that only mirror trivial implementation or meaningless coverage targets. Use numerical conformance tests for physics and deterministic scenarios where source formulas support expected values.
- Original-installation tests may read `carma2_orig` when available and must skip cleanly when it is absent. Never commit proprietary fixtures. Validate multiple original cars when changing data-driven mechanics.
- For substantial runtime/physics changes, run the actual application in Chromium and use Chrome DevTools MCP: drive, crash, inspect deformation/destruction, console errors, failed asset requests, WebGL state and screenshots. Compilation alone is insufficient. Record a tool failure separately from an application failure; use the reproducible Chromium harness to continue validation if MCP is unavailable.
- After relevant checks pass, investigate remaining concrete failures or fidelity gaps instead of repeatedly rerunning unchanged tests. Preserve working systems and update concise documentation truthfully.
- Performance profiling runs on a workstation the user also uses. Prefer static algorithm review and short, serial captures; do not run sustained simulation loops or parallel stress benchmarks. Record the actual GPU backend, drawing-buffer size and frame-time distribution, and distinguish hardware measurements from SwiftShader results. Treat resolution and visual visibility separately from C2 simulation activation. See `docs/performance-investigation.md` and `tools/profile-performance.mjs`.
- Make sensible Git checkpoints after reviewed changes. Stage explicit source/documentation/test paths, inspect the diff and verify that no original/generated assets are tracked. Do not overwrite the user's unrelated edits.

Common commands from the repository root:

```sh
backlog board          # Priority-ordered task board
backlog browser        # Editable local board
npm ci
npm run dev             # Local assets; http://localhost:5173
npm run build           # TypeScript check and production bundle
npm start               # Serve production bundle and local assets
npm test                # Format/assets and headless conformance tests
npm run test:browser    # Build plus stock/Advanced, priority and debug Chromium checks
npm run test:debug      # Build plus focused debug UI/runtime checks
npm run test:crashes    # Ignored numerical crash report
npm run test:car-damage # Ignored multi-car impact/repair audit
```

Read `README.md`, `backlog/README.md`, relevant Backlog tasks and `docs/` notes for current status. Inspect actual code and runtime behavior before relying on an earlier status report.

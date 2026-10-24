---
id: TASK-87
title: '[P4] QUA-09: Report server startup failures, including occupied ports, clearly'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 18:58'
labels:
  - priority-4
  - QUA-09
  - quality
  - legacy-partial
dependencies: []
references:
  - server/dev.mjs
priority: low
ordinal: 4083
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-09**
Numeric priority: **4** (1 is highest)
Original status: **Partial**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Handle server startup errors, especially an occupied port, with a clear message instead of an unhandled `EADDRINUSE` stack trace.

## Source references

[server/dev.mjs](../../server/dev.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected for the 2026-10-24 unattended session: complete bounded server startup/shutdown diagnostics with process-level tests; no display required.

Implemented explicit PORT validation and contextual startup diagnostics with exit code1, including EADDRINUSE, missing/inaccessible asset roots and Vite initialization errors. Cleanup closes Vite/HMR before HTTP: a real open HMR WebSocket test found that reverse order hangs shutdown. No automatic port fallback or interference with existing listeners. Seven isolated process/unit tests cover production and dev occupied ports, port ranges, asset-index failure, manifest serving, SIGTERM, open HMR sockets and successful port rebind. Tests use generated empty roots and no original assets. Registered in npm test; README includes alternate-port command.

Integration regression: asset-free full suite reproduced an intermittent open-HMR-WebSocket development-server shutdown timeout (15 seconds). Reopened for lifecycle diagnosis; original-install suite passed. Keep application/server failure distinct from sandbox EPERM bind denial.

Integration review did not reproduce a runtime shutdown defect: focused development HMR shutdown passed repeatedly and the full startup file passed 8/8, including an independent root run (HMR about 0.4 seconds). Hardened the process harness to retain exit observation from launch and added a deterministic late-wait regression; this addresses a real helper limitation but does not establish the cause of the one full-suite timeout (adjacent synchronous kill/wait calls cannot normally interleave a close callback). Corrected two optional-browser absent-tool skip branches and restored documented focused npm test commands. Final asset-free integration suite will be rerun after the remaining active source changes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
QUA-09 complete. Reviewed seven subprocess/unit checks pass, including real Vite HMR shutdown. Node syntax/format/diff checks pass. Server HTTP/asset behavior is preserved; original assets unchanged. No display-dependent validation is required for these process-level behaviors.
<!-- SECTION:FINAL_SUMMARY:END -->

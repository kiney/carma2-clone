# Terminal race feedback

The HUD retains a race-ending message independently of temporary notices. A
wasted car reports that the wreck countdown is still running, then prompts for
Enter to restart when the race enters its failed state. A completed race keeps
the Enter-to-skip instruction during its payout and changes to Enter-to-restart
when payout ends. Pausing, resuming and short notifications do not erase the
underlying terminal message. Since the pause menu hides the HUD, the prompt is
also shown in a dedicated menu status line. Starting a new load clears the
previous feedback.

This affects HUD text only. The original wasted canvas/audio feedback, the
ten-second post-wasted simulation, payout timing, and the existing Enter input
path remain in their current runtime paths.

Five deterministic tests verify notification expiry, all terminal categories,
pause fallback and restart clearing. `npm run test:terminal-feedback` exercises
the actual headless Chromium DOM: explicit WASTED/completed state fixtures,
continued rendering, visible pause-menu feedback, payout skip and Enter restart.
These fixtures verify feedback rather than reconstructing physical crashes; the
original WASTED drawing/audio and ten-second simulation paths are unchanged.

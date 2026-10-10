# C2 frame and gameplay timebase

## Evidence

**Verified in the installed `carma2_HW.exe`** (SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
i386): `UpdateFramePeriod` is at `0x4923d0`, and its tail clamps the gameplay
period at `0x49252a`/`0x492547` to 10–1000 ms. The camera period is clamped
separately at `0x49254d`/`0x492566`. This differs from the rec2 source tail,
which appears to omit assigning the gameplay period to 10 ms in its low-period
branch. The installed binary was inspected directly because the rec2 function
annotation (`0x492680`) does not match its address.

The installed routine also confirms 32-bit unsigned wrap in its moving
average: `0x4924cf` computes `9 * gAverage_frame_period` with a 32-bit `LEA`,
then `0x4924d2`–`0x4924e2` divides that wrapped value by 10 and adds the current
period. The frame period is updated at `0x74b584`, average at `0x68aeb4`,
predicted tick at `0x79c470`, actual tick at `0x68aeb0`, and race start at
`0x760980`. `0x68aea4` is the prior camera timestamp, not lost time. The
installed main-loop setup at `0x4926d0` resets the actual/predicted tick and
100ms period without writing the average field; rec2 likewise leaves the
process-global average intact across races.

**Reconstructed from rec2, with installed arithmetic/tail checks above:** the
ordinary branch predicts the next tick using the previous frame period,
computes signed tick error, averages with `9*average/10 + period`, and after
race age exceeds 2000 ms uses `average/10` as the period. A raw period over 500
ms after that point first substitutes `average/10` and snaps the predicted
tick; the later signed error correction can add much of the stall back. Periods
over 1000 ms cap at 1000 ms. `MainGameLoop` initializes actual/predicted tick
to OS time and frame period to 100 ms, but does not reset the process-global
average. `DoRace` captures an earlier race-start value, but MainGameLoop
overwrites it with OS time after the initial clock update: installed
`0x4928b3` calls the OS timer and `0x4928b8` stores `0x760980`. The earlier
DoRace epoch is not authoritative for the running loop. Single-player `GetTotalTime` is predicted tick plus current
period minus accumulated lost time in rec2's `common/utility.c`; menu pause adds
the menu's OS duration to lost time. Installed `GetTotalTime` at `0x514610`, specifically `0x514636–49`,
confirms the single-player sum and lost-time field `0x6aa094`. Installed
`AddLostTime` at `0x514660` adds the argument to that field. These are now
binary-confirmed, rather than source-only semantics.

## Native fixed-step frame windows

PHILDoPhysics is installed at `0x4b63d0`. It retains fixed 40 ms steps and
limits each call to five iterations (`0x4b650d`, `0x4b6882`). At
`0x4b641b–2f`, when frame start exceeds the last physics tick (`0x74878c`),
resynchronize to `40*floor(frameStart/40)`. Step while frame end is strictly
greater than that tick. This can advance physics ahead of the requested end.
The earlier note describing native physics as variable-period stepping was
incorrect; the discrepancy was the absolute frame window, not step size.

Interpolation at `0x4b689b–e4` computes backward fraction
`(lastPhysicsTick-frameEnd)*.025`. If outside `[0,1]`, replace it with zero,
meaning latest pose; do not saturate it to one. The browser forward alpha is
`1-backward`, retaining the same fallback when a long frame exhausts the
five-step budget.

## Browser integration

`src/game-clock.ts` samples `NativeFramePeriodClock` with integer wall ticks
and supplies native frame periods to gameplay. It renders independently and
processes gameplay no faster than 100 Hz. This cadence gate is an explicit
browser scheduling extension: applying the native 10 ms floor at every
144/240 Hz RAF would multiply gameplay time. Filtering uses wall age since
the actual race epoch, including pauses, rather than physics elapsed.

`simulation.updateFrame(startMs,periodMs)` now accepts the absolute predicted
frame window and reproduces native newer-start resynchronization, 40 ms steps,
five-step budget and interpolation. Timed physics state advances with the
resynchronized tick; skipped time does not invent additional force integration.
Legacy `update(dt)` remains for tests/tools, with an explicit transition that
clears a pose-only remainder before using it as step debt.

Pause accumulates lost wall duration and rebases sampling while retaining the
native moving average. The rebase is an explicit browser extension to prevent
a menu duration becoming a gameplay stall. Active stalls retain native
filtering and the 1000 ms limit rather than discarding everything above 50 ms.
The camera uses the separately clamped native period for gameplay frames;
paused camera settling remains a presentation extension.

Numerical checks cover native first-frame seeding, 60/100/144/240 Hz schedules,
10 ms cadence gating, comparable elapsed time, active stalls, pause continuity,
new-race retained averaging, fixed-step windows, equality/no-step boundaries,
five-step exhaustion, subsequent resynchronization and interpolation fallback.
Browser validation of the integrated path is recorded below; numerical
checks alone were not used to close PHY-07.

## Timed consumers

Installed GotPowerupX `0x4d8f30`, specifically `0x4d928c` and
`0x4d92bb–c6`, stores `got_time=GetTotalTime()` and
`lose_time=now+duration` for an ordinary timed single-player effect. Loader
`0x4d983d–984e` converts integer configuration seconds to milliseconds.
DoPowerupPeriodics `0x4daf90` samples GetTotalTime once; `0x4db092/095` skips
loss only while unsigned now<deadline, so equality expires the effect. Renewal
creates a fresh deadline rather than extending the previous one. Whole-race
and instant types remain distinct; keyboard inventory budgets use a separate
path and are not ordinary effect deadlines.

The browser now stores absolute expiry milliseconds, avoiding the floating
remaining-seconds error at a 999ms+1ms boundary. It supplies the pause-adjusted
GetTotalTime-style race timestamp for these deadlines and Bounce age, and its
process-clock timestamp for repair double-tap control. Race timer subtraction
continues to use native frame period (CheckTimer in rec2); payout presentation
uses elapsed game-clock timestamps rather than assuming all frame periods sum
to GetTotalTime. Native unsigned deadline wrap is plain addition/comparison;
the browser's race-relative epoch does not attempt multi-day wrap parity.

MainGameLoop's installed physics call `0x492c0c` precedes
DoPowerupPeriodics at `0x492de7`. The runtime therefore samples grant time and
collects pickups in `beginFrame`, retains modifiers through the physics window,
and expires due effects in `finishFrame` before Bounce callbacks and timer
checks. Direct `update` remains the combined compatibility API. Tests cover
gravity/Pinball at equality, no expired Bounce impulse and a renewed pickup's
fresh deadline.

Finish countdown and payout presentation are intentionally separate clocks:
state0 subtracts frame period, while states1–6 use absolute game timestamps.
Tests preserve the native predicted-time regression `2000→1032→1048` after
a stall; clamping a negative delta to zero would count the corrected interval
twice. BrowserGameClock exposes the signed delta, and payout uses the absolute
timestamp directly rather than accumulating it. Positive keyboard inventory
budgets still have their separate native activated-frame-period path
(`0x4db3d6–ee`); remaining unsupported inventory behaviors stay under PUP-15.

## Integrated validation

All 716 automated tests and the production build pass. Production bundle
`index-CagOa8j5.js` passes `browser-timebase`, `browser-priority`,
`browser-debug`, `browser-race-awards` and `browser-motion-powerups`. Real
W input moves the original Eagle approximately .596 model units, with
RPM3328, speed1.503 and gear1 over about two seconds of game time.
A real 650ms blocked event loop yields a captured capped1000ms frame, exactly
five physics steps and760ms skipped; the next frame window is127ms. These
are recorded call results, not synthetic clock replacements.

A 600ms Escape pause leaves gameframes/time, physics, powerup beginFrame calls
and race timer unchanged while seven render frames continue. Resume excludes
the paused interval. Debug timer freeze independently leaves timer120 while
physics advances1.28→2.48 seconds. Existing water, underwater exit, mine/oil,
lift/smash, recovery, pedestrians/WASTED, suspension/Bounce/wall/gravity/Pinball
and payout checks pass. The Eye payout still settles exactly160180 credits.
Reports contain no console, failed-network or WebGL errors; screenshots were
inspected. Chrome DevTools MCP was unavailable, so validation uses the
established real Chromium/Playwright fallback. Ignored artifacts retain the
numerical browser trace and screenshots; proprietary assets remain read-only.

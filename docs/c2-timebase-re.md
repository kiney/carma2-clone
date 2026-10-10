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
average. `DoRace` captures race start from `GetTotalTime` before that loop
initialization. Single-player `GetTotalTime` is predicted tick plus current
period minus accumulated lost time in rec2's `common/utility.c`; menu pause adds
the menu's OS duration to lost time. The installed `GetTotalTime` mapping and
lost-time field address remain unverified, so those semantics are not treated
as binary-confirmed.

## Browser path and open integration work

The current browser loop computes RAF elapsed time, caps active gameplay `dt`
at 50 ms, and uses a 40 ms fixed physics step with a five-step accumulator
(`src/main.ts`, `src/physics/simulation.ts`). Since a normal RAF call supplies
at most 50 ms, the 200 ms accumulator cap is not reached through this path.
The browser still differs from C2's one-frame-period/one-physics-update model:
AI, pedestrian, race, animation, and powerup clocks update at RAF cadence while
physics advances in 40 ms steps. At render rates above 100 Hz, applying the
native 10 ms frame-period floor once per RAF would over-advance gameplay time;
a browser integration must apply the period as a game-time clock, not as a
per-RAF multiplier.

`src/frame-period.ts` is a standalone implementation and is not wired into the
runtime. It preserves integer tick state, the 32-bit average operation, lost
time, and a main-loop reset that retains process-global average/lost-time
state. Before integration, resolve the epoch mismatch between `DoRace`'s
pre-loop `GetTotalTime` race-start value and the first `MainGameLoop` reset.
Also define pause handling: browser RAF continues while paused, whereas C2's
interface loop returns lost duration through `AddLostTime`. Finally, choose how
to reconcile native variable-period physics with the browser's fixed 40 ms
solver and keep AI/control updates aligned with whichever cadence is selected.

Useful conformance cases are 16 ms cadence through the 2 s smoothing threshold,
the 10 ms and 1000 ms clamps, a >500 ms stall, unsigned average overflow,
pause/lost-time continuity, and equal elapsed time partitioned across 60 Hz,
100 Hz, and >100 Hz RAF schedules. No runtime behavior is claimed until those
integration decisions are implemented and tested.

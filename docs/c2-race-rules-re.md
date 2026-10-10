# C2 race rules: exclusions and time awards

## Evidence and implemented paths (RAC-03)

The installed HW executable has SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Addresses below are virtual addresses in its PE32 image (base `0x400000`).
The shared SW executable has SHA-256
`15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d`.
Original files are inspected read-only; no binary dumps are distributed.

The public symbol map is [rec2](https://github.com/madebr/rec2), inspected at
commit `249f6be9925b7632295b74a47e3d4b07857b1649`. Critical powerup handlers
remain stubs there; the behavior below was checked in installed HW disassembly.
This is an independent implementation, not copied reference code.

| Path                | Evidence                                                                                                                                                      | Browser behavior                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exclusion parsing   | `LoadRaces`, negative termination at `0x48c221–0x48c23e`; loader uses whitespace, comma and slash delimiters and a 50-entry temporary list                    | Zero-based definition indices; stop at first negative token; reject invalid integers and oversized lists. rec2's loader currently omits the negative termination check.                                                |
| Pickup substitution | `GotPowerupEarwig` at `0x4d8b10`, exclusion test `0x4d8bdf–0x4d8bff`, fallback call `0x4d8ec7`; `GotPowerupX` at `0x4d8f30`, substitution `0x4d8ffc–0x4d9006` | Keep authored actors visible and collectable. Replace an excluded effect with definition 0 exactly once, including debug grants and charged abilities. Use definition 0's original parameters, not a fabricated award. |
| Random pickup       | `PickAtRandom`, `0x4de5a0–0x4de5c9`                                                                                                                           | Draw once from the full authored integer list, preserving duplicate weights. Substitute an excluded result; do not remove entries or reroll.                                                                           |
| Time awards         | `AddTimeAward` at `0x44baf0`, current race `no_time` check at `0x44bb21–0x44bb2e`; `GotTimeOrPower` at `0x4dc270` calls it at `0x4dc2ad`                      | Route ordinary pedestrian, opponent and powerup time additions through `awardRaceTime`. Checkpoints grant credits only. Suppress them when `disableTimeAwards` is set. Credits and objective progress are unaffected.  |
| Catalog selection   | Implied by separate original `data/RACES.TXT` and `adv_data/Races.txt`                                                                                        | Select definitions from the track's own root, including menu names, exclusions, mission type and time flag.                                                                                                            |

Time-award callsites also occur in wasting (`0x440ee9`), rolling
(`0x4410b1`), pedestrian (`0x4cd3e1`) and stunt (`0x4ed45e`) paths. Future
implementations must use the same helper. The opt-in debug **+60 seconds**
control is an explicit administrative override and bypasses ordinary awards.

## Separate compatibility gaps

RAC-04 remains separate: the installed `IncrementCheckpoint` at
`0x502f70–0x503079` awards credits without calling `AddTimeAward`, consistent
with rec2's `structur.c`. The earlier checkpoint time-bonus approximation was gated by RAC-03 and
is now removed by the subsequent RAC-04 work. Normal pedestrian and opponent
award quantities are verified separately below; special kill classification and
complete attacker selection remain open. The time flag alone establishes no
award quantity.

Tests cover parsing, substitution, weighted random choices, collection,
charge exclusion, time suppression and original Stock/Advanced race catalogs.
Browser regression uses the installed missions and ordinary runtime grant
path; generated screenshots and reports remain in ignored `artifacts/`.

## Smash missions (RAC-01)

Installed HW evidence resolves several differences from a simple object-count
mission implementation:

| Native path                                                               | Verified behavior                                                                                                             | Browser implementation                                                                                                                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetRuntimeVariable` `0x4e71b0`                                           | Read memory `0x6b87e0` using signed-byte extension; 1000 slots                                                                | `MissionVariables.get`, signed `Int8Array`. rec2's unsigned getter differs from the installed instruction. Invalid reads deliberately return 0 rather than native unspecified EAX. |
| Add `0x4e71d0`, toggle `0x4e71f0`, clear `0x4e7220`                       | Byte wrap, toggle zero to 1 and any nonzero to 0, clear all slots                                                             | Independent methods; clear for each new race.                                                                                                                                      |
| `ReadVariableChanges`                                                     | Text pairs are address, delta; storage reverses their order into unsigned-16 address and signed-16 delta. Delta 9999 toggles. | Preserve parser pairs; apply native-width conversions at dispatch.                                                                                                                 |
| Smash connotations `0x4ed200`, mutation `0x4ed552`, completion `0x4ed597` | Apply entire variable-change list, then compare signed mission variable **>=** authored target; complete with reason 3        | Dispatch through real world smash callbacks, then check the mission immediately. An intermediate crossing inside a list is insufficient.                                           |
| `OneLessPed` `0x4ccf10` (rec2 annotation differs)                         | Selected type-5 pedestrian increments the same variable by 1; accounted flag `0x100` prevents duplicate deaths                | Existing alive-to-dead transition emits the spawn group once; selected group increments the same byte and checks immediately.                                                      |
| Ped target selection `0x4d3019`                                           | Compare `(spawnGroupPtr - gPed_groups) / 8` with authored mission group; selected flag `0x200`                                | Use original `ped.spec.group`, not actor name or personality.                                                                                                                      |

`smashAndPed` is additive: targets and selected pedestrian kills contribute to
one counter. It does not require a separate "all pedestrians" victory condition.
Completion freezes once won, so a later event wrapping/subtracting the counter
cannot undo victory. The event-time check matters; checking only after a frame
could miss a valid crossing followed by another event.

Stock catalog missions preserve these values: **EYE OF THE BEAVER** variable 1,
target 11; **HARD CORE** variable 1, target 19, pedestrian group 56;
**OIL BE BLOWED** variable 1, target 7; **CARPOCALYPSE NOW** variable 1, target 15.
Advanced **CARPOCALYPSE AGAIN** also uses variable 1, target 15.
Satellite, carrier weapons/core, pump and silo records author `[1, 1]` changes;
actual actor instances, not distinct record counts, determine available targets.

This restores objective parsing and accounting. World side-effect scripts and
room links remain separate WLD-05 gaps, particularly relevant to original silo
mission traversal. Existing pedestrian contact fidelity is still PED-03; its
current death event is integrated here without claiming native collision parity.
Completion award amounts remain RAC-04.

## Validation

RAC-03: original Stock and Advanced catalogs, synthetic parser/error and
weighted/charged/collection tests pass. Actual Chromium checks load Boulder
Dash, The Bruise Brothers, Nice Beaver and an Advanced mission. They confirm
excluded Hot Rod becomes credits without engine changes; the unexcluded time
flask is suppressed in The Bruise Brothers and adds time normally in Nice
Beaver. ArrowUp drives the stock car. No console errors, failed requests or
WebGL errors were observed. Chrome DevTools MCP is unavailable in this session;
validation uses the project's Playwright/Chromium harness, not a compile-only
claim. Screenshots were inspected and remain ignored.

RAC-01: Chromium inventory finds exactly eleven authored satellite actors in
Eye of the Beaver (one comsat1, ten comsat2). Real destruction-handler contacts
replace all eleven models, advance variable 1 from 0 to 11 and complete the
mission; repeating the first actor does not count again. Completion voice 8011
is dispatched once. A real pedestrian sweep in Hard Core kills one group-56
pedestrian and increments the shared variable by one. These are deterministic
integration checks, not proof of every mission's natural driving traversal.
Carrier/Desert/Silo traversal and script dependencies still need broader checks.
The existing Chromium regression also retains 16 ordered gate crossings, race
completion, stock Quarry and Advanced Acid Reign loading without fatal errors.

## Award reconstruction and remaining limits (RAC-04)

Installed `IncrementCheckpoint` at 0x502f70 pays the GENERAL skill-indexed
checkpoint-credit tuple via 0x503061, without AddTime or reading the track gate
timer tuple. It skips payment when this gate finishes the race. The tuple in
track files is truly labelled timer increments for **ped mode**, not credits.
The normal browser gate path now follows these rules.

Installed completion row selection at 0x493adb differs from rec2's current
MungeRaceFinished reconstruction: classic type 0 selects reason rows 0 laps,
1 pedestrians, 2 opponents; every mission selects row 0. The final amount is
that row's skill value plus floor(remaining timer milliseconds / 1000) times
GENERAL's skill-indexed credits-per-second. The browser calculates this amount
once using original tables, then presents the native finish delay and transfer
states described below. Runtime variable 99 and Enter skip retain full final
settlement. Special pedestrian classification and complete native attacker
selection remain open; this is not a claim of full RAC-04 acceptance.

The GENERAL parser consumes original three-skill records; runtime skill remains
0/Easy until separate RAC-05. Installed checkpoint table is at 0x75f660 and
time-bonus table at 0x75f410. Wrong-order native announcements are separately
throttled (different gate >2 seconds, same gate >20 seconds); wrong gates grant
no credits or time.

Integrated normal-award paths and separate limits:

- Pedestrian rewards come from PEDS/settings.txt (installed ScoreForKilledPedestrian
  0x4cd010), not GENERAL's pedestrian-time tuple. Stock and Advanced have different
  time tables. Credit combo increments on kills within 1000ms, capped at 10;
  classified-kill inputs remain absent from the browser callback. Time is
  unaffected by the combo. OneLessPed accounts objectives separately.
- Wasting reward branch 0x440e85 rounds to hundreds using
  `100 * trunc((GENERAL.wastingCredits[skill] * (0.7 / victim.softness)^2 + 50) / 100)`.
  Time uses GENERAL's wastingTime. Normal player ownership, environmental
  continuation and duplicate guards are integrated; complete car-car attacker
  selection remains open. Every knackered car must not automatically earn credit.
- AddTime0x44baf0 rejects finished/countdown/network/no-time and zero awards.
  The shared browser helper now also rejects finished races and zero seconds;
  countdown and network play are not yet implemented.

## Verified award and payout follow-up (RAC-04)

All instruction addresses below were checked in the installed HW
binary; rec2 supplies symbol and structure mappings, not the critical stub logic.
The implemented subset does not establish full RAC-04 acceptance.

### Normal pedestrian awards and remaining classification inputs

Installed `ScoreForKilledPedestrian` is at `0x4cd010`, whereas rec2 annotates its
stub at `0x4cd260`. Award eligibility requires a pedestrian cache, its cached
killer pointer at `+0xc0`, and killer `driver == 8` (`0x4cd052–0x4cd072`).
`OneLessPed` separately accounts objective progress.

| Original PEDS/settings field | Stock Easy/Medium/Hard | Advanced Easy/Medium/Hard |
| ---------------------------- | ---------------------- | ------------------------- |
| Points score per ped         | 300, 200, 150          | 300, 200, 150             |
| Time score per ped           | 15, 10, 5 seconds      | 10, 8, 5 seconds          |

At `0x4cd078–0x4cd0b6`, a credited kill within an unsigned elapsed time of
**at most 1000ms** increments the combo, capped at 10; otherwise combo becomes

1. Credits are `points[skill] * combo * classificationMultiplier`. At
   `0x4cd3c2` credits are submitted to `EarnCredits`; at `0x4cd3da` the fixed
   `times[skill]` value goes to `AddTimeAward`. Combo and classification never
   multiply the time award. `src/race-awards.ts` and the normal pedestrian callback
   now implement the original normal multiplier of 1 and combo/time tables.

Special classes are ordered alternatives, not cumulative multipliers. Cache
cause flags `0x10`, `0x08`, `0x40`, `0x01`, and `0x20` select multipliers
20, 5, 2, 4, and 2 respectively (`0x4cd104–0x4cd1ae`). Original writers identify
mutant-tail, mine, drone/indirect, and napalm attribution for the latter flags.
Remaining geometric branches inspect caller height, killer angular velocity,
actor up component and origin height, cached field `+0x98`, pedestrian physics
current velocity and the vector at physics `+0x1b4`, transformed relative hit
position, and killer car-space velocity. Their multipliers include 4 for the
rolling/low-position branch, 2 for height greater than 1, 4 for pedestrian
velocity squared at least 2, and 2 for sideways/spinning or reverse-position
conditions (`0x4cd1ae–0x4cd399`). A final flag-`0x02` doubling applies only when
the combo is 1 and no previous class matched (`0x4cd39b–0x4cd3c2`).

The current browser death callback does not carry these native collision/cache
inputs. Speed alone cannot classify them. The normal award path is implemented;
special classification and native kill eligibility remain tied to PED-03.

### Wasting value, eligibility and attribution limits

The installed waste branch at `0x440e85` calculates:

`credits = 100 * trunc((GENERAL.wastingCredits[skill] * (0.7 / victim.softness)^2 + 50) / 100)`

The helper at `0x512ef0` squares its argument; it is not an exponential.
Victim softness is the authored car field at `+0x18d0`, read by the installed
car loader at `0x48934d`. Waste time is `GENERAL.wastingTime[skill]`, passed to
`AddTimeAward` at `0x440ee9`. The browser uses these original tables and formula.

Installed `DoCrashEarnings` starts at `0x440550` (rec2's stub annotation is
`0x440660`). The award guard at `0x440dc0` requires selected attacker and victim
pointers; offline, the attacker must have `driver == 8`. After the victim
knacker check, `knackered(+0x1d4)` must be nonzero and
`pre_car_col_knackered(+0x1d8)` zero. The latter is set before awarding at
`0x440e12`, preventing repeats.

When the other-car argument is null, `0x440a6f` accepts the current victim's
`last_hit_by(+0x13ec)` only when `now - time_last_hit(+0x13e4) < 5000ms`.
The selected attacker and current time are written back at
`0x440efc–0x440f02`, including accepted environmental continuations before the
car is wasted. Thus the window can refresh; it is not merely five seconds after
the last direct player impulse. The separate 20-second damage scaling context
is not the earnings window.

The browser now retains a nullable earnings attacker and timestamp separately
from damage scaling, refreshes accepted static-world continuations, and prevents
a known AI attacker from inheriting earlier player credit. A zero initial
timestamp alone never establishes ownership. Direct car-car selection still
assumes the contacting other car is the attacker; native selection also uses
pre-impact sectors, speed and control branches now mapped in [crash earnings evidence](c2-crash-earnings-re.md), awaiting integration. Its pointer-based strict750ms fallback is likewise mapped but not yet implemented. Native mapping of ordinary
non-car callbacks to a null car argument also remains open. These limitations
are explicit; any knackered car must not automatically earn player credit.

### Native post-race transfer and final settlement

`src/race-payout.ts`, integrated by `main.ts` with deferred completion awards,
implements the offline successful-race sequence. `RaceCompleted(0x502d80)`
ignores repeats while finished and initializes a **10000ms** finish delay
offline, or 8000ms for network play (`0x502ef4`). Network play remains outside
the browser implementation.

Inlined `MungeRaceFinished` at `0x493a7d` is inactive during action replay.
Offline reasons 0–3 snapshot credits once and calculate the complete final award
at `0x493aca–0x493b24`. Classic type 0 selects the completion row by reason;
mission types select row 0. Runtime variable 99 is checked after calculation
at `0x493b2a`: it suppresses the 3000ms autosave headup, not the award.

At finish-delay expiry (`0x493b6f`), zero timer, network mode, reason 6 or
nonzero runtime variable 99 exits without animation. Otherwise blank headup
slots 9/10 are created, accumulated time bonus becomes zero, and native state
1 starts. The animation dispatch computes elapsed time from its start timestamp
at `0x49348c`; only one state executes per frame.

| Native state          | Verified transition/effect                                                                                                                                                                                                                                   | Installed address |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 1: initial pause      | At elapsed >=500ms, display/add completion bonus, play clap 8015, enter state 2.                                                                                                                                                                             | `0x4934af`        |
| 2: completion display | After >=2000ms, enter state 3 and reset rattle timestamp.                                                                                                                                                                                                    | `0x493531`        |
| 3: timer conversion   | For delta >15ms, consume 1000ms of timer per floor(delta/15), clamp zero, and add trunc(actual timer reduction/1000) times rate to displayed bonus. Advance rattle timestamp by 15\*floor(delta/15). A subsequent frame observing zero timer enters state 4. | `0x49354b`        |
| 4: pause              | After >=1000ms, enter state 5 and reset rattle timestamp.                                                                                                                                                                                                    | `0x493621`        |
| 5: credit transfer    | For delta >15ms, subtract floor(delta*rate/15) from displayed bonus, clamp zero, and add the actual reduction to credits. Advance rattle timestamp by 15*floor(delta/15). A subsequent frame observing zero bonus enters state 6.                            | `0x493655`        |
| 6: end pause          | After >=2000ms, set finish countdown to 1; finish processing then exits.                                                                                                                                                                                     | `0x493721`        |

Each transition resets the start timestamp; states 1–5 keep the finish countdown
at 10000ms. The initial animation countdown is `15 * (timerMs + 300)`
(`0x493ba0–0x493bb3`), subsequently maintained by the state dispatch.
Return/keypad Return checks at `0x493c03` skip throughout finish processing.
At every final exit with a valid snapshot, `0x493c4d` assigns
`credits = snapshotCredits + totalBonus`, so skipping or variable 99 preserves
the entire payout even before its display. The browser's first Enter skips;
a subsequent Enter restarts the finished race.

Two rec2 reconstruction errors must not be reused: its completion-row condition
is reversed relative to `0x493adb`, and `MungeHeadups` subtracts the state enum
instead of the state-start timestamp. Both are corrected in the independent
browser implementation.

Finally, `EarnCredits(0x44baa0)` forwards to `EarnCredits2(0x44b960)`, which
rejects finished races and zero amounts before mutation. It has no countdown,
network or no-time guard. A nonzero global credit multiplier at `0x703d80` is
applied at `0x44b989`; that modifier is separate from these base formulas.
The shared browser credit helper now rejects finished-race awards, including
ordinary credit pickups; their resulting event amount is zero. Closing normal
credit awards when completion sets the finish flag is consistent with the later
payout snapshot. The global multiplier remains a separate TODO gap. Debug grants
are administrative overrides.

The integrated numerical conformance suite passes 653 tests. Actual Chromium validation (`tests/browser-race-awards.mjs`) passes original Eye of the Beaver completion, natural ten-second delay, completion sound8015 once, deferred credits and Enter full settlement. Stock pedestrian callbacks award300/+15 then600/+15; Advanced awards300/+10. An unattributed wreck pays nothing, while an attributed softness1.5 victim pays700/+120. The last Nice Beaver opponent completes with reason2 before its individual reward. Real keyboard driving, console/network and WebGL checks pass. Screenshots and reports remain ignored; MCP remains unavailable. These deterministic handler checks do not prove every collision classification.

### Final normal kill ordering

The installed direct pedestrian-kill caller invokes `OneLessPed` at `0x4ccd86`
before `ScoreForKilledPedestrian` at `0x4ccd8f`. The falling/vanish path similarly
accounts the pedestrian at `0x4d53ad` before scoring at `0x4d53ce`. If that death
completes a classic all-pedestrian objective, selected-pedestrian objective or
type-5 mission, the finish flag is already set when ordinary credits and time
are submitted, so both awards are suppressed. The browser normal death callback
now checks objective completion before submitting those awards.

For opponents, `DoCrashEarnings` calls the knacker check at `0x440df1`.
`KnackerThisCar` sets the knackered state at `0x43f728` and, when a nonempty
opponent population has no remaining eligible goals, calls `RaceCompleted(2)`
at `0x43f792`. This precedes the waste-credit/time calls at
`0x440ed7`/`0x440ee9`, suppressing ordinary rewards for the final goal opponent.
The browser now checks objectives synchronously on the waste transition, using
actual damage-wasted state rather than waiting for the rival HUD flag.

This ordering is cause-specific: napalm cleanup scores at `0x4d545d` before
accounting at `0x4d54c0`. It must not be generalized to every future special-kill
callback. Chromium verifies final-goal opponent suppression and a real final group-56 Hard Core sweep.

## Population and selection (RAC-02)

Installed LoadRaces `0x48c502–0x48c53c` resolves a negative opponent count
using `trunc(first + index/(catalogCount-1)*(last-first))`. The defaults are
RACES headers, Stock 5→11 and Advanced 10→13 across 40 catalog entries, not
GENERAL. Nice Beaver has five AI opponents; Boulder Dash explicitly has zero;
Trucking Hell has one authored ID38; The Bruise Brothers has twelve separate
ID51 instances. The browser now loads the original resolved count instead of imposing a cap of four.

SelectOpponents `0x5036b0` preserves explicit IDs and duplicate instances, even
when their model matches the player's car. Random fillers use ChooseOpponent
`0x5037d0`: strength1–5, requested tier unless zero, not previously picked and
not the player's catalog ID. Empty tiers advance through5 then zero. Explicit
IDs are marked picked by actual catalog ID (`0x503726`); rec2 incorrectly marks
the slot index. Nice Beaver requests tiers `[1,1,1,2,3]`.

Goal initialization `0x48cdc4–0x48ce21` marks instantiated opponent membership
in the authored target-ID list; negative target count selects all. Duplicate
instances count separately. NumberOfOpponentsLeft `0x502d20` counts surviving
goal instances; the authored target-list length is not a quota which can be
clamped to loaded cars. Missing assets must not shrink an objective silently.

Ped selection `0x4d3064–0x4d30df` is the union of all listed group IDs, with
one aggregate selected population. Negative group count selects all.
OneLessPed `0x4ccf95` compares selected kills against that aggregate; it does
not require every listed group to have a member. A zero selected population
cannot auto-win at initialization because the comparison occurs on a selected
death event. Preserve loading/failure guards while removing substitute totals.
These rules are integrated in opponent-selection, main and rules. Numerical tests cover original catalogs, duplicate instances, player/random exclusions, selected-union goals and missing-population guards. Chromium checks five Nice Beaver opponents, one Trucking Hell ID38, and twelve separate Bruise Brothers ID51 instances with Eagle and Bugga player selections; no console/network/WebGL failures. Separate AI driving fidelity remains under AI entries.

The Hard Core final selected-pedestrian regression now uses a real group-56 sweep with the mission counter at18/19: it completes reason3 without a pedestrian credit/time award and snapshots the new race credits. This also reproduced and fixed a race-load reentrancy defect: ensureRacePayout must not recreate the previous completed race payout while loadRace awaits original assets.

Ordinary offline AI car contacts do not overwrite saved human attribution: installed driver guard0x440dce skips those stores. This is now corrected and tested separately from immediate AI-caused wasting (no player reward). AI mine/free-part ownership can overwrite through their separate explicit paths; do not generalize the car-car guard to those paths.

# Native opponent repair and stolen-car levitation

Evidence: verified against the installed `carma2_HW.exe`; rec2 provides symbol and structure mapping but both objective addresses differ in this installation. Original files remain read-only.

## Repair

`ProcessOpponent` at `0x4aa310` changes cheating mode, calls repair (`0x4aa5d3` → `0x4ad6b0`), then selects the objective (`0x4aa5f9` → `0x4acc10`). `PossiblyRepairOpponent` checks police category `car_ID & 0xff00 != 0x300`, strict `now > opponent.next_repair_check (+0x50)`, cheating flag `0x20`, objective other than levitate/freewheel (5/6), and clear permanent knackered field `car+0x1d4`.

An eligible check stores `nextCheck = now + 3000 + IRandomBetween(0,2000)`, then requires strict unsigned `now > car.lastContact (+0x1548) + opponent.repairInterval (+0x54)`. At `0x4ad74d–0x4ad771` the supposed necessity loop tests the non-null address of damage unit0, rather than its damage value. Thus a valid ordinary car passes even when undamaged; adding a damage threshold would change installed behavior.

Repair calls `TotallyRepairACar` at `0x439460`, then rerolls the interval as a wrapping u32 `60000 * IRandomBetween(min,max)` and stores `lastRepair (+0x58) = now` (`0x4ad7e3–0x4ad819`). Installed minimum/maximum globals are `0x748824/0x748828`. GENERAL's two repeated labels say seconds, and values120/240 remain unchanged; the installed multiplier makes these120..240-minute intervals. `readNativeOpponentRepairLimits` retains this label/behavior mismatch. Contacts and deadlines use the AI game-frame clock, separate from raw PD collision-history time. The independent scheduler is `src/ai/repair.ts`; its callback owns actual model/shape/component restoration.

`TotallyRepairACar` clears all12 current/previous/smoke component levels, stops smoke, restores detached and bent models, collision shapes, shape swaps and crush lists. It preserves permanent knackered state. The browser's existing complete repair path must be checked for these side effects when binding the callback.

## Levitation

Installed dispatcher `0x4aa9ee` calls `ProcessLevitate` at `0x4ac2e0` (rec2's address annotation is stale for this installation). START sets settling bit `opponent+0x18c`, start timestamp `+0x188`, acceleration0 and brake `F32(15*mass)`.

RUN settles while either collision speed is at least `F32(0.0014492754125967622)` (`0x589548`) or angular speed is at least1, unless unsigned elapsed time is strictly greater than4000ms. Each angular component is divided by live `pow(2, dtMs*0.001)` and then stored Float32 (`0x4ac42e–0x4ac4c9`).

When settled, clear settling, reset the timestamp, and capture Float32 actor Y at `opponent+0x184`. In that same RUN, zero acceleration, brake, curvature (`car+0x1254`), gear (`+0x135c`), revs (`+0x1340`), linear/angular collision velocities, and turn physical activity off (`0x4ac4d9–0x4ac54d`). The UI headup only applies when the original stolen flag is set.

For unsigned elapsed seconds `t`, rise height is `0.25*t*t` for `t < 20`, otherwise `10*(t-20)+100`. Actor Y is `F32(baseY+height)`. Mark finished-for-race bit2 only when live height is strictly greater than200 (`0x4ac553–0x4ac5c0`). DIE is a no-op. `src/ai/levitate.ts` expresses this state machine and returns explicit physical-off/stop and finished notifications. The fleet binds it to the stolen knackered objective, preserves rendering during physical inactivity, and applies finished-for-race state. Without a stolen mechanic the source flag remains false.

## Live chain and checks

`src/ai/runtime.ts` owns regular-instance selector/objective/follow state, shared projected backing, visibility and trails, and catalog-index grudge storage. Initialization consumes repair-interval RNG before the per-instance visibility deadline RNG. Each actual game frame records the player trail, recounts objective populations, updates proximity/visibility, changes cheating mode, checks repair, selects/runs the objective, then clears crash occurrence facts. Attribution uses live accumulator and AI time before physics cleanup. Actual physical forces remain stored on the car and are passed to the existing opponent WheelForces bridge; numeric input fields only describe animation controls.

Verified installed grudge reduction `0x4aa138–0x4aa186` reads each active instance's selected catalog index. The low-byte formula is `(grudge - min(grudge, 3-skill)) & 255`, after strict `now > nextDeadline`, rescheduled to `now+5000`. Duplicate instances reduce their shared catalog entry repeatedly. rec2's instance-index interpretation differs and is not used.

`tests/ai-native-follow-dispatch.test.mjs` checks all objective-specific0/1/2 return contracts and the24-section trail bound. `tests/ai-native-runtime.test.mjs` exercises actual shared lifecycle physical/cheaty/rematerialized and freeze/thaw transitions, live attribution, duplicate grudge decay, repair scheduling and stolen-car levitation. Focused repair/levitate tests cover strict boundaries, callback/RNG order, authored-label preservation, Float32 damping and timestamp wrap.

## Live engine binding and deliberate extensions

`main.ts` uses this fleet once the complete original opponent population has loaded. It runs once per native game frame before physics; animations read its controls without a second steering/speed controller. Physics inactivity excludes the car and attached pieces from collisions while preserving independently detached debris. Attribution reaches the live fleet before the physics accumulator is cleared. Atomic private staging prevents asynchronous partial grids from entering the scene or physics before final initialization.

`NativeOpponentPlacement` binds the verified projection, metric/model ground conversion, yaw/pitch/roll attempts and sensible-place polarity to current deformed hulls and world faces. Success performs only `ResetCarSpecialVolume`; exhausted attempts call shared-route native safe relocation. `WorldCollision.nativeYBelow` uses original material facing flags and pling filtering, with the minimum relevant height-100 instead of an unlimited ray. `fallen-world.ts` retains the66-query maximum, caret-material behavior and iterative Float32 origins.

Two explicit robustness extensions remain: the installed undefined empty-race return slot is interpreted as continue, and the otherwise unbounded endpoint relocation walk is limited to4096 visits with an observable diagnostic. Neither extension invents a successful physical placement. Replay/flying-cheat flags remain false while those features are absent.

Installed trail recording is player-only: the sole `StartRecordingTrail4aa230` caller is `MungeOpponents4a9f35`, passing the current player pointer. Initializers clear regular/cop recording counts. Pursuit START/DIE does not create trail ownership. Rival trails consequently remain empty; native pursuit of such a target uses its GetNear fallback.


## AI-01 startup and contact completion (2026-10-30)

Production reserves the original local repair/visibility-before-personality
chronology before asynchronous staging and binds publication-relative deadlines
without duplicate draws. `selectionRanking` retains native per-slot ranking draws.
Real solver contacts now have tests through attribution into the following
frame's pursuit/escape decision and strict stun resumption. Whole-launch/grid
chronology remains AI-06. See [implementation and evidence](ai01-production-integration.md).

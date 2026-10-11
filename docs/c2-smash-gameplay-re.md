# C2 smash gameplay connotations

Evidence below is verified from the read-only installed HW executable (SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`). rec2 supplied the function map; its HW addresses differ from this installed executable. The implementation is independent and copies no reference source.

## Native order and suppression

Installed `DoConnotations` is `0x4ed200`. Its order is sound, noncar activation (`0x4ed27b` calling `0x4ed5d0`), followup smash (`0x4ed299` calling `0x4ed950`), optional powerup, shrapnel, awards, explosions, slick, variable changes, immediate mission-completion check. The world texturechange caller's suppression flag skips activations, followups, powerups and awards; decal permits them. Sound, debris, explosions and variable changes remain eligible. Main preserves this order for implemented outlets: sound, activation, powerup enqueue, WAM glass, awards, explosion and variables/completion. Follow-up world smashes, world debris and slick dispatch remain absent.

## Powerup queue

The parser retains the compatible name `roomCode`. Despite rec2's `room_turn_on_code` name, installed `0x4ed29e–0x4ed314` forwards connotation `+0x274` as a **powerup table index** to `0x4f0db0`. The connotation path requires a nonzero index, physics type1 with a car owner whose driver is8, and squared distance strictly less than2 between the live physics actor translation and the supplied effect point. The respawn actor is always null. No award-frequency gate applies to the powerup.

The queue has50 records of12 bytes at `0x6a2ac0`, count `0x6a3c4c`, containing car/index/actor. `FlushSmashQueue(0)` (`0x4ecd20`, branch `0x4ecfd4`) drains after smash effects and model updates: `GotPowerup` (`0x4d8b00`) at `0x4ecfed`, then `MayQueuePowerupRespawn` (`0x4e0590`) at `0x4ecff7`. The count is reread after each pair, so appended records execute during that drain. Consumed records retain capacity until the count clears at `0x4ed009`. The20-smash count clears afterward at `0x4ed011`. Argument1 skips this entire powerup drain and retains its count. `VehicleSimulation.flushSmashEffects()` drains powerups before the20-smash queue clears; intermediate barriers retain them. Initialization belongs to runtime/race creation, not every physics barrier.

`NativeSmashPowerupQueue` implements the bounded storage/drain. `enqueueConnotationPowerup` implements the verified connotation eligibility path. The native generic helper additionally handles special index14 for drivers greater than5 and a network fallback; those separate pickup/network paths are outside this connotation adapter. Powerup respawn with non-null actors is also an integration outlet, rather than invented by the pure queue.

## Awards

At `0x4ed396–0x4ed4c1`, connotation fields are frequency `+0x278`, credits scalar `+0x27c`, seconds scalar `+0x280`, misc-text index `+0x284`, fancy-headup index `+0x288`, persistent awarded latch `+0x28c`. There is no award timestamp. Frequency0 does nothing;1 requires a previously clear latch and type1 car physics with driver8;2 requires that same human owner but ignores the latch;3 ignores owner and latch eligibility. All require the caller's suppression flag to be zero. Eligible execution sets the latch before invoking outlets, even for zero amounts or a finished race.

For each positive scalar, truncate toward zero. For a nonpositive credits scalar, compute `truncate(min(20000, -magnitude * scalar))` then round to the nearest100 with `n + 50 - ((n + 50) % 100)`. For nonpositive time, use cap60 and `n + 2 - ((n + 2) % 5)`. Installed conversion helper `0x575190` sets x87 truncation explicitly. Credits call `0x44baa0`, or its rounding wrapper `0x44bab0`; time calls `0x44baf0`, or its rounding wrapper `0x44bbf0`.

Magnitude is caller dependent: direct world dispatcher `0x4f0ec0` passes the solved normal impulse (load `0x4f1438` while12 temporary argument bytes remain on the stack). Queued WAM/decal effects use the norm of the first queued starting-velocity vector after componentwise native multiplication by6.9 (`0x4ece87` onward). The live adapter supplies this explicit magnitude and retains the first queued starting-velocity snapshot, including when a later impact upgrades the target level.

`EarnCredits2` (`0x44b960`) rejects a finished race and zero amount, and applies the global credit multiplier only when it is nonzero (`0x44b989–0x44b993`). `AddTimeAward` (`0x44baf0`) additionally rejects the race's no-time flag. Misc text uses `GetMiscString` (`0x514750`) and a3000ms headup (`0x44a630`, call `0x4ed4b2`); fancy output calls `DoFancyHeadup` (`0x44ac60`, call `0x4ed4c1`). HUD indexes can still be emitted when financial outlets reject an award. `consumeSmashAward` returns these outputs without introducing UI or timestamp policy.

The live adapter owns latch scope through a race-scoped WeakMap keyed by direct authored spec, runtime decal patch or car damage instance, then by connotation identity. Direct world specs use their authored connotation identity. Native texture/decal preparation copies runtime level arrays, so decal tiles have separate runtime connotation latches; one WeakSet of shared parser payloads would combine those tiles incorrectly. WAM runtime parts/levels likewise need the corresponding car-owned state. Repeated final-tier payload executions share that same latch. Race/runtime recreation resets it; outer frames do not.

## Installed data and remaining outlets

Each Stock and Advanced track table set contains662 connotation payloads:81 single-shot awards,20 repeated awards,1 regardless award,95 nonzero powerup indexes (all14),78 payloads with followup smashes,55 with noncar activations, no slick payloads, and no extension flags. All installed award scalars are nonnegative and fancy indexes zero; authored numerical fixtures exercise the verified negative-scalar/fancy paths. All52 stock WAM files have no authored awards or powerup indexes.

`data/RACES/Carrier_mission/CARRIER_mission.txt` and its `adv_data` counterpart author core removal with3000 credits,20 seconds, misc-text132, powerup14 and a two-second `*.DAT` followup. Desert mission numbered nochange actors `&92` onward author single-shot3000/20, powerup14 and delayed area smashes, making persistent latch behavior observable. Silo mission `&20` authors the sole regardless award (zero credits/time, text133), powerup14 and an immediate area followup. Ski track icebear removal authors repeated3000/30 and text129 without a powerup. Powerup table index14 is action30 (mine reaction), with float parameters8,15,4,4; it is not a random item grant.

Followup parsing already retains delay, target, coordinate mode, bounds, direction and strength, but main has no execution outlet. Installed `0x4ed950` snapshots selected world candidates/context into the shared20 delayed-side-effect slots (200-byte stride); due execution re-enters normal world smash handling, with numbered actors first pulled and marked released. This module does not approximate candidate selection, delayed release or that scheduling policy. Connecting awards/powerups therefore does not complete followup-smash fidelity.

## Live browser checks

`tests/browser-smash-gameplay.mjs` drives normal destruction contacts on the
original Carrier Hard Core core and Stock/Advanced Desert targets. Hard Core
and Stock Desert retain their original no-time gate: the authored3000/20
award pays3000 credits and zero seconds. A separately labelled gate-override
fixture proves the same authored20-second outlet without editing credits or
award state. Ownerless/NPC contacts, persistent single-shot latches, intermediate
powerup retention and final index14 delivery are checked. The objective fixture now starts at zero, contacts seventeen real non-core
actors, sweeps the actual group-56 ADMIRAL through the current population's
ordinary vehicle-hit lifecycle once, and contacts the Core to complete at19.
The repeated pedestrian sweep contributes no additional unit; no counter is
seeded. The separately controlled vehicle sweep is the existing legacy contact
adapter, not proof of native articulated pedestrian physics or a natural
keyboard-driven mission route. A companion follow-up regression checks the
opposite final order: all eighteen ACT targets, then the ADMIRAL death.

Installed `InitRace481788` clears all1000 runtime-variable bytes; target
registration `497640` does not preload progress. `InitPedsForRace4d3002..3055`
marks group56 with `0x200`, and once-only `OneLessPed4ccfdb` adds its death to
variable1. The authored nineteenth target therefore needs no initial credit,
extra ACT or second removal of WIGGLYBIT. See the
[native track loader evidence](c2-native-track-actor-load-re.md).

The proximity check rounds both live actor and effect point coordinates to
Float32. For the checked Desert X position `-108.43269348144531`, adding
`sqrt(2)` yields raw JavaScript squared distance just below2 but native-rounded
squared distance `2.000004314817488`; no powerup is therefore correct. The
numerical fixture uses exactly representable coordinates to check equality.

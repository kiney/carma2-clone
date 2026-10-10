# Recovery vouchers, instant handbrake and command jump

## Evidence and installed records

The following is **verified from the installed HW binary and original stock/Advanced POWERUP.TXT**. rec2 `powerups.c` supplies the handler names; its handlers are stubs and some annotated addresses and structure sizes differ from this installation. Native loader instructions at `0x4d98a3`, `0x4d98ad`, `0x4d98b7` select the got/lose/periodic tables at `0x65d480`, `0x65d560`, `0x65d640`. Installed powerup records have stride140, not rec2's172.

| Original index | Action                    | Record inputs                                                | Got / lose / periodic installed addresses |
| -------------- | ------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| 38             | 26, `GotVouchers`         | whole race, initial value0, integer parameter5, inclusion256 | `0x4de5d0` / NULL / `0x4de610`            |
| 32             | 28, `SetInstantHandbrake` | duration30 seconds, initial value0, no parameters            | `0x4de620` / `0x4de660` / NULL            |
| 54             | 36, `KangerooJump`        | instantaneous, initial value−3, float parameter12            | `0x4ddec0` / NULL / NULL                  |

## Vouchers

`GotVouchers` accepts a non-null car with local-human driver8 and calls `AddVouchers` (`0x4445d0`) with integer parameter0. That function adds to the integer count at `0x67ac98`; repeated grants accumulate. `GetRecoveryVoucherCount` (`0x4445c0`) returns the count. `MungeVouchers` copies it to powerup current-value field+`0x28`, providing the icon count and ordinary zero-value removal. There is no lose handler that erases unused vouchers.

The successful recovery branch (rec2 controls reconstruction around1937; installed free branch `0x443928`) decrements one nonzero voucher and announces free recovery, bypassing the credit charge. It consumes at recovery execution, not initial key intent or a cancelled request. The enclosing path excludes a knackered car. Network free-recovery entitlement is an independent alternative. `ResetRecoveryVouchers` (`0x4445e0`) clears the count; installed calls include race initialization `0x48185f` and car lifecycle `0x41402b`. Browser race reload must clear it.

Native recovery pricing comes from GENERAL's skill/network recovery tables. The browser's existing fixed250-credit recovery is an approximation independent of the voucher counter; vouchers must bypass that charge when a browser recovery actually succeeds. Do not consume a voucher for a rejected recovery.

## Instant handbrake

Got/reset affect only the local-human car, setting global `gInstant_handbrake` at `0x79c110` to1/0. Ordinary timed-powerup expiry calls the reset handler; repeat grants use normal native duration renewal rather than a permanent flag.

This is a **control-time velocity operation**, not a tyre-grip coefficient or stronger brake force. Installed `PollCarControls` branch `0x443e5a` corresponds to rec2 `BrakeInstantly`: when the handbrake control is held, the flag is set and the race is unfinished, revs become0 and collision linear velocity X/Y/Z become0. Angular velocity is untouched. It also stops an airborne car; grounding is only used for screech feedback. With the effect absent or the race finished, that control sets normal `keys.brake`.

Speed squared above`0.0001` with at least one grounded wheel triggers Pratcam41 and five tyre-screech sounds9000–9004. Speed squared above`0.1` triggers the `Instant_Handbrake` force-feedback effect. The installed inlined branch ends with stores to collision offsets`0x68`, `0x6c`, `0x70` at `0x443f18`. Browser integration should perform the operation before the ordinary physics step and preserve angular state; physical forces may subsequently generate velocity during that step.

## Command jump and inventory

Collection and command activation are distinct. Installed `GotPowerupEarwig` (`0x4d8b10`) routes a nonzero initial value into inventory without invoking the got handler. Inventory is keyed by original powerup index. New entries first zero remaining value at `0x4d8cff`; both new and repeated pickups add initial value at `0x4d8e69`–`0x4d8e75`. Thus original index54 grants three charges and repeated pickups add three more, preserving remaining charges. Inventory-full handling does not execute the jump.

The command key uses an input edge. Installed use call `0x4db365` invokes `GotPowerupX` (`0x4d8f30`); its successful nonnegative result consumes one negative-valued charge by incrementing remaining value at `0x4db373`. At zero the item is removed and another available inventory item selected. Countdown, finished-race and knackered guards prevent use. Holding the key does not repeatedly consume charges; there is no recovered grounding check or cooldown for this action.

`KangerooJump` adds `floatParams[0] / 6.9` to **world vertical linear velocity**, rather than replacing velocity, adding along local up, teleporting or resetting horizontal motion. Constant`0x589cb0` is the verified double`1/6.9`; original parameter12 adds approximately`1.7391304348` native world units per second. Installed `0x4ddee4`–`0x4ddeef` updates collision field+`0x6c`. It clears the collision sleeping byte+`0xec` at `0x4ddf13`, including airborne activation. Angular velocity is unchanged.

Activation requests force-feedback `Kangeroo`, Pratcam42, and sound9010 (`0x2332`) for the local-human driver. Collection should not synthesize that activation sound. Unsupported force-feedback output is a platform limitation, not grounds to omit the simulation operation.

## Implementation status

This note records source behavior for PUP-06; it does not claim these three actions are implemented or runtime-validated. Integration must share ordinary grant/use/expiry paths with debug grants, preserve failed-use guards and recovery sample resets, and validate cumulative vouchers/charges, expiry, airborne stopping/jumping and additive jump velocity in the application.

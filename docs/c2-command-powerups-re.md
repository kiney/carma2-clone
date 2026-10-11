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

Speed squared above`0.0001` with at least one grounded wheel triggers Pratcam41 and all five tyre-screech sounds9000–9004 (verified loop, not a random choice). Speed squared above`0.1` triggers the `Instant_Handbrake` force-feedback effect. The installed inlined branch ends with stores to collision offsets`0x68`, `0x6c`, `0x70` at `0x443f18`. Browser integration should perform the operation before the ordinary physics step and preserve angular state; physical forces may subsequently generate velocity during that step. The ordinary handbrake input bit must be cleared after this branch: source execution bypasses normal rear-wheel braking and its gear/wheelspin behavior.

## Command jump and inventory

Collection and command activation are distinct. Installed `GotPowerupEarwig` (`0x4d8b10`) routes a nonzero initial value into inventory without invoking the got handler. Inventory is keyed by original powerup index. New entries first zero remaining value at `0x4d8cff`; both new and repeated pickups add initial value at `0x4d8e69`–`0x4d8e75`. Thus original index54 grants three charges and repeated pickups add three more, preserving remaining charges. Inventory-full handling does not execute the jump.

The command key uses an input edge. Installed use call `0x4db365` invokes `GotPowerupX` (`0x4d8f30`); its successful nonnegative result consumes one negative-valued charge by incrementing remaining value at `0x4db373`. At zero the item is removed and another available inventory item selected. Countdown, finished-race and knackered guards prevent use. Holding the key does not repeatedly consume charges; there is no recovered grounding check or cooldown for this action.

`KangerooJump` adds `floatParams[0] / 6.9` to **world vertical linear velocity**, rather than replacing velocity, adding along local up, teleporting or resetting horizontal motion. Constant`0x589cb0` is the verified double`1/6.9`; original parameter12 adds approximately`1.7391304348` native world units per second. Installed `0x4ddee4`–`0x4ddeef` updates collision field+`0x6c`. It clears the collision sleeping byte+`0xec` at `0x4ddf13`, including airborne activation. Angular velocity is unchanged.

Activation requests force-feedback `Kangeroo`, Pratcam42, and sound9010 (`0x2332`) for the local-human driver. Collection should not synthesize that activation sound. Unsupported force-feedback output is a platform limitation, not grounds to omit the simulation operation.

## Implementation status

The three PUP-06 actions are now integrated through ordinary grant/use/expiry and recovery paths. Numerical tests and actual Chromium checks pass for all three actions. The browser keeps existing approximate recovery pricing and omits original Pratcam/force-feedback output. Cars are always integrated, so command jump needs no separate sleeping flag. Vouchers are consumed after recovery executes successfully; administrative debug free recovery does not spend one.

The existing Actions 34/35 inventory now accumulates repeated grants using
this verified shared path: five initial oil charges, one use, another pickup
leaves nine. The focused debug browser test checks a bulk grant followed by
another mine grant and one activation against twice the authored charge count
minus one. The installed eligibility and fizzle audit below resolves the
remaining PUP-15 command inventory question; this path has no elapsed cooldown.

## Command eligibility and handler failure

**Verified from the installed HW binary**, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `0x400000`, entry RVA `0x177eb0`, timestamp
1998-10-18 20:13:36: `GotPowerupX` is `0x4d8f30`. rec2 was consulted
as a symbol map; its GPL-3.0 license was inspected, and no code was copied.
The native eligibility implementation is a stub there and its address differs
from this installed revision.

Invalid indices and dummy records return failure at `0x4d8f41`–`0x4d8f74`.
The surrounding keyboard caller blocks countdown, finished races and knackered
cars before dispatch. The browser also observes `awardsClosed`: a finished
award path may retain a racing status while the wasted body still simulates.
Only a nonnegative got-handler return consumes a negative initial-value charge
(`0x4d9153`–`0x4d915b`, caller `0x4db36a`–`0x4db373`). The browser event
handler can return a negative numeric native result to reject use, preserving
both the charge and selected inventory item. Existing void handlers are
successful, matching the supported source commands.

An allocator refusing placement is **not** such a negative got-handler return.
The installed action34 handler is `0x4dd500`; every exit, including its pool
failure and network-client paths, returns the definition index via
`0x4dd87d`–`0x4dd8a2`. Action35 at `0x4dde40` calls the oil allocator
and then independently returns its definition index at `0x4ddea3`–`0x4ddebc`.
Action36 likewise returns its index. Thus full mine pools and unsuitable oil
surfaces still consume one charge. No grounding or elapsed cooldown guard is
present in these handlers or the keyboard dispatcher. Separate input edges
may consume consecutive charges without advancing the simulation clock.

The preconditions at `0x4d8f85`–`0x4d8fda` and race exclusion list at
`0x4d8fdc`–`0x4d8ff8` substitute definition0 at `0x4d8ffc`; they do not
return a failed activation. Gates include available AI for flag64, multiplayer
inappropriateness flag2, single-player index97, and option getters for
indices91, 52/96 and 4/57. The option getter for command indices52/96
(`0x4d6dc0`) reads `0x65c340`, whose installed default is1. All Stock and
Advanced commands52/53/54/96 have flags0, inclusion mask0 and fizzle type−1,
so normal browser configuration needs no additional command gate.

The active inclusion-mask loop (`0x4d9042`–`0x4d9103`) calls the lose
handler and clears other active overlapping groups; it does not reject the
new command. These original command definitions have no overlapping mask.
`fizzle_type` selects icon transition graphics (`DrawSinglePowerupIcon` and
`PrintPowerupIconIn3D`); it is not an activation probability or cooldown.
Icon transition artwork, original network play and configurable native
content options remain separate platform/compatibility limitations.

## Runtime validation

The visible debug UI grants original definitions 38/32/54. Two voucher grants
give ten; ordinary R recovery at zero credits succeeds and spends one, while
knackered and failed-race attempts preserve the count. Space on an airborne car
zeros linear velocity and RPM before physics, preserves angular velocity, and
bypasses ordinary handbrake input. The timed effect expires normally. Two jump
grants give six charges; F adds exactly 12/6.9 to airborne world Y while leaving
X/Z and angular velocity unchanged. A repeated keydown spends no extra charge;
a second input edge spends one and sound 9010 is dispatched on each use.
Ordinary ArrowUp driving remains functional; no fatal console, asset-request or
WebGL errors occur. The screenshot was inspected; its sky-only background is
intentional because this deterministic airborne check places the car above the
city, not a claim of a rendering regression. Original Stock and Advanced table
parameters are checked without copying fixtures. New City unsupported-definition
warnings decrease from 27 to 24 as these three actions become supported.

Chrome DevTools MCP is unavailable in this session. Tests use the existing
actual Chromium/Playwright harness; generated artifacts are ignored.

The eligibility update was validated again in the production Chromium command
and debug harnesses, with no captured console errors, failed requests or WebGL
errors. The command harness now intercepts the actual `updateFrame` boundary
when checking instant handbrake before integration; its obsolete `update` hook
previously timed out after the timebase migration. Debug grants, repeated input
edges, voucher recovery, jump velocity and ordinary driving remain checked.

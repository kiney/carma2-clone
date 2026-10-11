# Pedestrian award classification and earned credits

## Evidence

Checked in the read-only installed HW executable, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841e9ca14ca5ff027bd6c`, PE32 image
base `0x400000`, entry `0x577eb0`, timestamp October 18, 1998. `.text` VA
`0x401000` / file offset `0x400`; `.rdata` `0x588000` / `0x186c00`;
`.data` `0x58e000` / `0x18c800`. rec2 was consulted for names and navigation;
the relevant score/kill/powerup bodies are stubs or have shifted annotations.
No reconstructed source or proprietary fixtures were copied.

`src/ped-awards.ts` independently implements the verified ordered consumer,
combo state and signed earned-credit mutation. Missing native motion providers
are reported in `missingInputs`; they skip unsupported geometric alternatives
rather than supplying invented velocities or cause flags. The runtime supplies
retained napalm cause flags, current/starting pedestrian velocity, local killer
ownership, body-axis angular/linear velocity, live world COM displacement and
actor up/origin-Y. Those browser states do not certify the separate PED-03
contact and articulated-body mechanics, which remain approximations.

## Death and score ownership

Installed `ScoreForKilledPedestrian` is `0x4cd010`. It first clears the
pedestrian hit-points byte at `+4`, substitutes action 6 if necessary and writes
the death clock at `+0x30`. Financial eligibility is independent: pedestrian
cache `+0x0c` must exist, cached killer at cache `+0xc0` must exist, and that
car's driver at `+0x0c` must equal 8 (`0x4cd052` through `0x4cd072`).
Unattributed/opponent deaths must not update the local award combo.

`KillPedestrian` `0x4ccc20` calls `OneLessPed` `0x4ccf10` first at `0x4ccd86`,
then scores at `0x4ccd8f`. Its earlier low-gravity branch goes to `0x4ccd84`:
it skips physical/gore setup, **not death, objective progress or scoring**.
The same distinction applies to the physical-effects global `0x65c344`.
An earlier interpretation treating this as a rejected death was incorrect.

Only three direct score caller sites were found:

| Caller                                                                     | Installed call | Supplied height                                     |
| -------------------------------------------------------------------------- | -------------- | --------------------------------------------------- |
| Ordinary KillPedestrian, including annihilator/electric/active burn expiry | `0x4ccd8f`     | 0                                                   |
| PedFallingForever                                                          | `0x4d53ce`     | Float32 `ped.pos.y - FindYVerticallyBelow(ped.pos)` |
| Inactive burning target during pedestrian processing                       | `0x4d545d`     | 0                                                   |

The inactive-burning caller requires signed cache `+0x98 > 0` and positive hit
points; it scores immediately without waiting for the deadline or testing the
ordinary immortal/volume gates, stops smoking, clears `+0x98` and vanishes.
It does not call OneLessPed at that site. This differs from normal death's
objective/scoring ordering and must not be merged into an invented common
completion policy. Negative cache `+0x98` instead identifies a reserved bolt.

## Tables and combo

There are no separate special-cause PEDS points/time tables. Loader sites
`0x4cac83` / `0x4cac8f` populate the same three-skill tables at `0x69a388`
and `0x6928f8`. Skill is global `0x7590c0`.

| Table                       | Stock Easy/Medium/Hard | Advanced Easy/Medium/Hard |
| --------------------------- | ---------------------- | ------------------------- |
| Points per pedestrian       | 300 / 200 / 150        | 300 / 200 / 150           |
| Time seconds per pedestrian | 15 / 10 / 5            | 10 / 8 / 5                |

At `0x4cd078`, unsigned `(now - previousKill) <= 1000` increases combo,
capped at ten; otherwise combo becomes one. Previous eligible kill time is
`0x69eaa8`, combo is `0x69a374`. Base credits are signed32
`points[skill] * combo`. One classification below multiplies that base,
with native integer overflow wrapping at each operation. Time is always
`times[skill]`, unaffected by combo or classification. Final calls are
`EarnCredits` at `0x4cd3c4` and `AddTimeAward` at `0x4cd3e1`.

## Ordered classifications

Cause flags are the WORD at **cache `+0x2e`**, separate from cache `+0xc4`
processing/smear flags. These ordered alternatives return immediately:

| First set cause bit | Credit multiplier | Fancy index | Supported writer                   |
| ------------------- | ----------------- | ----------- | ---------------------------------- |
| `0x10`              | 20                | 32          | Tail collision in mutant-tail mode |
| `0x08`              | 5                 | 31          | Tail collision                     |
| `0x40`              | 2                 | 2           | Mine collision                     |
| `0x01`              | 4                 | 17          | Drone/indirect culprit collision   |
| `0x20`              | 2                 | 30          | Napalm contact                     |

Installed writers `0x4cdd63` / `0x4cdd86` OR tail bits `0x08` / `0x10`;
the second requires global tail mode `0x7036e0 == 1`. Tail physics type is
`0x20`, initialized at `0x4d9edf`. The collision attribution path accepts that
tail type when mode is 2 or elapsed since `0x703d10` is less than 7500 ms.
Mine physics type `0x40` is initialized at `0x4da37d`; the collision writer
`0x4cdd96` replaces the WORD with `0x40` and takes its owner from mine `+0x30`.
Drone physics type `0x10` uses owner `+0x5d4`, replacing the WORD with `0x01`
at `0x4cdda8`. An indirect fallback copies another owner's culprit `+0xc8`
and ORs `0x01` at `0x4cddd1`.

Napalm sets `0x20` at `0x4ce9a0`, after writing its deadline at `+0x98` and
firing car at `+0xc0`. Annihilator/electric callback `0x4cde00` replaces the
cached killer and invokes ordinary killing; it **does not write a cause bit**.
Thus a ray killing a burning pedestrian can retain a prior napalm flag.
`InitProcessData` clears the cause WORD when a processing cache is initialized;
the flags are not reset merely because a different kill callback executes.

Without a preceding cause, these geometric alternatives follow:

1. At `0x4cd1ae` through `0x4cd23a`, multiplier 4 / fancy 3 when
   `height == 0` and any of `abs(killer omega.x) > 5`, `abs(omega.z) > 5`,
   killer physics actor up-Y `< F32(.1)`, or actor origin-Y minus ped-Y
   `> F32(.05)`. Independently, signed cache `+0x98 > 0` also selects this
   branch. This tests positivity, not whether the deadline is still future.
2. Height strictly greater than one selects multiplier 2 / fancy 6.
3. Actual simple-ped physics world velocity `+0x68` squared length at least
   two, or starting velocity `+0x1b4` squared length at least two, selects
   multiplier 4 / fancy 5. A null native simple-physics pointer skips this test.
4. With height zero, multiplier 2 / fancy 2 applies when
   `abs(localPed.x)/abs(localPed.z) >= .5` and either
   `abs(localCarVelocity.z) < abs(localCarVelocity.x)` or
   `abs(killerOmega.y/localCarVelocity.z) > 600`; alternatively both
   localPed-Z and localCarVelocity-Z strictly positive qualify.
   Native IEEE division behavior is retained, including infinity/NaN.

The relative position is pedestrian world position minus killer **world COM**
`car.pos +0x4c`, transformed as a vector by the killer physics pose's inverse
rotation (`0x4cd0b9` through `0x4cd0f9`). Local velocity is physics `+0x1a8`,
not raw world V. Caller height must not be inferred from these relative vectors.

If none matches, combo greater than one selects fancy `combo + 6`, with no
extra multiplier. Only for combo one does cause bit `0x02` double credits
and select fancy 0. Writer `0x4cd506` sets this bit when a dismemberment helper
count exceeds four; browser blood particle count is not evidence for that bit.

The associated `0x4e0c50(30)` calls are a **Pratcam event stub whose installed
body is an empty RET**, not a screen-shake effect. The sideways/reverse branch
even bypasses that stub. Returned metadata does not introduce a shake.

## Drink Driving and the earned-credit outlet

Both Stock and Advanced authored `POWERUP.TXT` records name **pickup index
90**, action **48**, duration 30 seconds, integer parameter `[3]` and float
parameters `[.075, 1500, 2500, 1]` as Drink Driving. Action 18 is wall climb;
pickup index 18 is Turbo Cops/action 15. Keep these identifier domains distinct.

Installed `SetPissed` `0x4df040` writes integer parameter zero to global
`gCredit_multiplier = 0x703d80` at `0x4df0a1`, only for a non-null car with
driver 8. It also starts intoxication motion/control state. `ResetPissed`
`0x4df120` clears the global to zero at `0x4df128`. No credit-multiplier update
is needed each frame; the timed powerup's normal loss callback owns reset.

`EarnCredits` `0x44baa0` tail-calls `EarnCredits2` `0x44b960` with an empty
prefix. Its guards are finished-race global `0x74b7cc` and zero original amount,
before multiplication. No countdown/network/no-time guard exists there.
Nonzero multiplier applies signed wrapping `IMUL` at `0x44b993`; zero means
identity. The multiplied delta is retained separately from HUD aggregation
and signed-wrapping added into credits `0x7590a0` at `0x44ba63` / `0x44ba73`.
There is **no clamp, nonnegative-credit rule or zero-after-multiply rejection**.
The HUD merges displayed awards within strictly less than 2000 ms; this never
re-adds the prior displayed amount to account credits. It uses slot 4,
2000-ms lifetime and ordinary credit/lost-credit strings, not a fancy bonus.

Supported earned call sites include pedestrian `0x4cd3c4`, damage `0x441075`,
wasting `0x440ed7`, checkpoint `0x503072`, smash connotations `0x4ed40a`,
ordinary credit pickup `0x4dbfff`, and cunning stunt `0x41ef62` / `0x41f091`.
Further native pedestrian callback sites also call EarnCredits directly.
These all receive the same live global multiplier. Explicit `SpendCredits`
`0x44bad0` subtracts directly. Administrative debug grants and post-race
completion/remaining-time settlement use their separate direct mutation path.
Do not apply Drink Driving to the final payout snapshot or apply it twice
when smash's pure consumer has already multiplied a result.

## Cunning stunt consumer

This is separate from pedestrian cause classification. Installed graphical
car update `0x41ee11` through `0x41f107` requires no action replay, local driver
8 and native car mass `< 5`. With body-axis inertia `I` and angular velocity
`omega`, it computes:

```text
A.x = (F32(47.61)*I.x + 3.30) * .5 * abs(omega.x)
A.y = (F32(47.61)*I.y + 3.57) * .5 * abs(omega.y)
A.z = (F32(47.61)*I.z +  .44) * .5 * abs(omega.z)
wild = A.x > F32(26.4) || A.y > F32(49.98) || A.z > F32(3.52)
mild = A.x > F32(1.65) || A.z > F32(.22)
```

The sampled stunt clock is **PDGetTotalTime** `0x51ca50` at `0x41e959`,
not the ordinary score consumer's GetTotalTime `0x514610`. Globals are last
award `0x677c44`, wild start `0x677c48`, mild start
`0x677c4c`, mild end `0x677c50`, all-wheels start `0x677c54`, and upside-down
clock `0x677c58`. Wild behavior requires unsigned elapsed since the prior
award strictly greater than 10,000 ms. Its first qualifying frame sets the
wild start; subsequent duration at least 500 ms awards only when the car's
special-volume gravity equals one or there is no volume. A different raw
volume gravity continually resets the wild start.

Otherwise wild start clears and the mild landing path runs. Fewer than four
wheels down clears all-wheels start. Zero wheels and mild spin records mild
start, and up-Y below `F32(-.8)` records upside-down time; other airborne
states update mild end. With at least four wheels down, mild end initializes
if zero. It requires a nonzero mild start, cooldown strictly over 10,000 ms,
mild duration at least 2000 ms, and upside-down timestamp inclusively within
that interval. Landing must begin strictly less than 300 ms after mild end,
then persist strictly more than 500 ms, with absent/exact-one volume gravity.

Awards call fancy index 18 and EarnCredits with GENERAL's skill table at
`0x760a20`. Stock and Advanced both author `[2000, 1000, 500]`. There is no
time bonus. Award resets the mild interval, landing and upside-down state;
`CancelPendingCunningStunt` `0x41e5a0` clears those plus wild start. This source
state machine is independently implemented in `src/cunning-stunts.ts`, with
eleven source conformance tests. The graphical frame supplies raw
`performance.now()` as the PD process-clock adapter; it does not substitute the
pause-adjusted gameplay clock. Landing samples that clock again after the
shared earned-credit outlet. Race loading and recovery cancel pending stunts
without resetting the last-award cooldown. The X/Y formulas use JavaScript
double temporaries and Z is explicitly Float32, matching the source store;
pathological x87 80-bit boundary identity is not claimed.

## Integration and checks

Keep one `NativePedAwardCounter` for local eligible deaths. Supply retained
cause flags and actual killer/body state at the score phase; preserve original
objective-before-score ordering where the caller does so. Send raw returned
credits through one shared EarnCredits consumer. Fixed time remains on the
ordinary guarded time path. The module intentionally reports missing geometric
providers; authored napalm flags can still be exact while PED-03 collision
causes, indirect culprits and motion snapshots remain incomplete.

`tests/ped-awards-binary.test.mjs` verifies ordered flags, geometry thresholds,
raw current/starting velocity, local reverse/spin/sideways conditions, signed
deadline semantics, ownership gates, combo timing/cap/clock wrap, dismemberment
priority, signed credit products and earned multiplication/addition. Optional
read-only Stock/Advanced cases check original table values and action48's
authored multiplier without copied fixtures.

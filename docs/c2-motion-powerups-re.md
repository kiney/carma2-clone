# C2 motion powerups

Evidence comes from the read-only installed HW binary (SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`).
Rec2 names the following handlers but leaves their bodies stubbed. The addresses
and assignments below were recovered from the installed handler tables and
instructions, independently implemented where indicated.

| Action        | Installed setter / resetter | State and implementation                                                                                                |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 16 Gravity    | `0x4dcbb0 / 0x4de520`       | Global `0x74b348=arg0`; restore default `0x74b55c`. Integrated across car and generic-body gravity.                                                 |
| 17 Pinball    | `0x4dcbe0 / 0x4de530`       | Global `0x75f644=arg0`; reset zero. Integrated in ordered world-contact impulse groups.                                                                 |
| 18 Wall-climb | `0x4dcc10 / 0x4de540`       | Car `+0x1c4=1/0`. Integrated with wheel-normal gravity and tyre inclination.                                            |
| 19 Bounce     | `0x4dcc40 / 0x4de550`       | Car period `+0x4c0=1000/arg0`, amount `+0x4c4=arg1`, last-bounce `+0x1598=0`; removal clears period/amount. Integrated. |
| 20 Suspension | `0x4dcc90 / 0x4de560`       | Calls AdjustSuspension `0x41fc80` with front/rear give, front/rear extra length and damping. Integrated.                |

## Bounce and suspension

DoBouncey `0x4de7c0` affects the current player globally. Unsigned timestamp age
must reach the period and the previous physics result must have more than two
wheels on the ground. It saves the timestamp, adds `amount/6.9` to world Y
velocity and plays sound 9010. The callback at `0x4e0c50` is a bare return;
this effect does not consume ability charges. Nonzero bounce period prevents
the already reconstructed stationary settling branch. Browser periodic dispatch
runs after physics, and its age uses the pause-adjusted game timestamp supplied by the native frame
clock integration (PHY-07). Direct tool/test updates retain elapsed-delta mode.
Cars have no independent sleep-disable flag in the current integrator; the
native wake instruction therefore has no additional browser state to clear.

Suspension action 20 takes exactly five floats in the order
`frontGive, rearGive, frontExtraLength, rearExtraLength, damping`.
It sets the existing mass/COM/authored-wheel suspension equations. Removal
restores `[1,1,0,0,1]`; it does not reinstate a previous pickup's suspension.
Renewal replaces the same action's timeout. Other actions can overwrite shared
suspension, as can wheel damage and repair; setters are not reapplied every frame.
Engine action 9 retains its different seven-parameter layout and scalar factors.

Tests exercise exact argument order, different original Eagle/Buggy mechanics,
renewal, removal, independent engine factors, unsigned bounce age, two versus
three supported wheels and horizontal-momentum preservation. Browser validation
uses original pickups through the normal grant path and actual vehicle physics.

## Verified gravity and contact consumers

Gravity multiplies ordinary car gravity at `0x41bcd7` and generic-body gravity
at `0x4b6cc2/0x4b6d07/0x4b6d13`; fragments also consume it. The custom
NonCarCalcForce path `0x418270–0x418863` contains no global gravity read: its
`10/6.9` gravity and motor thrust must not be multiplied indiscriminately.
GENERAL supplies the default gravity; both installed Stock/Advanced values are 1.

Settling at `0x41bb03–97` has a separate branch. A null volume pointer compares
raw force magnitude with mass, skipping both gravity divisors. A non-null
volume compares `forceLength/effectiveVolumeGravity/globalGravity < mass`.
Its effective volume value is raw authored gravity, without depth mixing;
with a car driver>5 and underwater ability, use `1-(1-rawGravity)*.6`.
The acceleration path uses depth mixing instead. Reusing the acceleration
factor for settling would lose this distinction.

Pinball at `0x41dbca` requires a nonzero factor, null other physics object
(world contact), and grouped positive impulse weight strictly above `0.0002`.
Group up to four ordered rows with the same object pair and seed-normal dot
strictly above `0.7071070075035095`. For summed browser/model normal impulse J,
`dv=J*6.9*factor/mass*.20000000298023224`, `q=dot(dv,dv)`; when `q>500`,
scale by `500/q`, then add dv to velocity. This is a squared-magnitude cap,
not a conventional speed clamp. The **post-cap** squared magnitude greater than 1 plays 9011 (human 2D, others 3D).
Car-car collisions do not enter this branch.

Wall-climb at `0x41958a` requires driver>5, the flag and a nonzero sum of accepted
wheel normals. World normals come from `MultiRayCheckSingleFace`, are flipped
against the ray, then transformed by actor rotation transpose at `0x418f61`.
They are added **unweighted** at `0x4190d2/0x4190f6/0x419102`; the existing browser
local `normalSum` matches these inputs. Normalize if length>`2^-22`, otherwise
use local Y, and add `-mass*10*direction` in place of ordinary gravity. Global
gravity does not multiply this wall force. No support or exactly cancelling
normals uses ordinary gravity. At `0x419bf8`, override the tyre downforce
inclination cosine to 1, retaining material downforce and other tyre equations.
Wall-climb now uses those existing local wheel normals, the original driver guard and tiny-vector fallback. Numerical conformance checks cover rotation, slope, zero/cancelling/no support and material downforce. The normal pickup/expiry path changes the flag without altering independent engine/grip state. Gravity and Pinball now use the verified consumers below.

## Wall-climb browser validation

The production Chromium regression grants original action 18, verifies its
normal expiry, and places the original Eagle3 wheel anchors against a real
Newcity `tower2` collision face. All four contacts come from the real
`WorldCollision.wheelRaycast`; no wheel normals or collision geometry are
stubbed. Identical on/off fixture poses through `VehicleSimulation.update(.04)`
produce the native support-force difference. The original wall/car screenshot
is ignored under `artifacts/browser-motion-wall-original.png`. This proves
original-geometry contact and the force branch, not unrestricted wall traversal.
Normal driving and the suspension/Bounce regressions remain green, with no
console, asset-request or WebGL errors.

## Gravity and Pinball integration

Action 16 assigns a native Float32 scalar; it does not multiply the current
value. Removal restores the parsed GENERAL default, including a non-unit
custom default. Action 17 likewise assigns its first Float32 parameter and
removal restores zero. Renewal replaces the corresponding timeout. Both are
global effects; normal pickup, debug grant, expiry and neutralization share
the same state path.

Ordinary car forces and generic free-body gravity (including mines and detached
parts) consume the global multiplier. Wall-climb support gravity bypasses it.
Custom NonCarCalcForce instead consumes raw authored volume gravity, without
depth mixing or the global multiplier; its motor thrust remains unchanged.
The separate settling calculation honors the native driver>5 underwater guard
and distinguishes a null volume from a present volume with multiplier one.

Pinball consumes raw grouped world-contact normal impulses after geometry
mutation and damage processing, before normal solver impulses and friction.
Disabled type9 rows and contacts with another physics object do not qualify.
Resting contacts are eligible: the native branch has no closing-speed gate.
Numerical tests cover seed-normal grouping, four-row limits, zero-weight
slots, the strict impulse threshold, mass scaling, the squared-magnitude cap,
post-cap audio eligibility and car-car exclusion.

Original-data tests cover Eagle and Buggy forces, actual simulation propagation,
GENERIC mine gravity and the custom noncar volume path. Regression fixtures
separate depth-mixed acceleration from raw-volume settling and verify lower
driver types do not gain the underwater settling adjustment. The normal sound
9011 callback is integrated; spatial playback for other bodies remains the
existing AUD-03 gap rather than a claim of native positional audio parity.

## Integrated browser validation

The final production bundle `index-DLXT3med.js` passed both
`tests/browser-motion-powerups.mjs` and `tests/browser-priority.mjs`. Original
Lunar/Jupiter pickups set gravity to Float32(.35)/5 for Eagle and a real
F-key-launched mine, then expire to GENERAL's one. Airborne .04-second samples
have no car contacts and preserve the separate car/generic gravity constants.
Original Pinball index20 produces four real tower-wall contact rows, one
9011 callback and an extra velocity approximately `[3.4796,0,-.000052]`; real
two-car contacts produce no callback and expiry restores zero.

The same run checks soft/hard suspension for Eagle/Buggy, a grounded Bounce
impulse and sound, the original wall-climb contact fixture, ordinary keyboard
driving, water/underwater exit, mines/repair, oil, lift, door smash, recovery,
pedestrians and WASTED. Both harnesses report zero console errors, failed
requests and WebGL errors; screenshots were inspected. Chrome DevTools MCP
was unavailable in the runtime, so these checks use the established real
Chromium/Playwright fallback, not a simulated renderer. The full automated
suite passed 694 tests before the final additional Pinball boundary checks.

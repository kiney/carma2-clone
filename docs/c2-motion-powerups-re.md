# C2 motion powerups

Evidence comes from the read-only installed HW binary (SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`).
Rec2 names the following handlers but leaves their bodies stubbed. The addresses
and assignments below were recovered from the installed handler tables and
instructions, independently implemented where indicated.

| Action        | Installed setter / resetter | State and implementation                                                                                                |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 16 Gravity    | `0x4dcbb0 / 0x4de520`       | Global `0x74b348=arg0`; restore default `0x74b55c`. Not integrated yet.                                                 |
| 17 Pinball    | `0x4dcbe0 / 0x4de530`       | Global `0x75f644=arg0`; reset zero. Not integrated yet.                                                                 |
| 18 Wall-climb | `0x4dcc10 / 0x4de540`       | Car `+0x1c4=1/0`. Not integrated yet.                                                                                   |
| 19 Bounce     | `0x4dcc40 / 0x4de550`       | Car period `+0x4c0=1000/arg0`, amount `+0x4c4=arg1`, last-bounce `+0x1598=0`; removal clears period/amount. Integrated. |
| 20 Suspension | `0x4dcc90 / 0x4de560`       | Calls AdjustSuspension `0x41fc80` with front/rear give, front/rear extra length and damping. Integrated.                |

## Bounce and suspension

DoBouncey `0x4de7c0` affects the current player globally. Unsigned timestamp age
must reach the period and the previous physics result must have more than two
wheels on the ground. It saves the timestamp, adds `amount/6.9` to world Y
velocity and plays sound 9010. The callback at `0x4e0c50` is a bare return;
this effect does not consume ability charges. Nonzero bounce period prevents
the already reconstructed stationary settling branch. Browser periodic dispatch
runs after physics, and its age uses consumed gameplay milliseconds. Broader
native frame-clock differences remain PHY-07, not a claim of elapsed-time parity.
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

## Remaining verified consumers

Gravity multiplies ordinary car gravity at `0x41bcd7` and generic-body gravity
at `0x4b6cc2/0x4b6d07/0x4b6d13`; fragments also consume it. Native settling
at `0x41bb69` divides its force comparison by this factor. Changing only car
acceleration would leave this action incomplete.

Pinball at `0x41dbca` requires a nonzero factor, null other physics object
(world contact), and grouped positive impulse weight strictly above `0.0002`.
For native world impulse J, `dv=J*factor/mass*.2`, `q=dot(dv,dv)`; when `q>500`,
scale by `500/q`, then add dv to velocity. This is a squared-magnitude cap,
not a conventional speed clamp. Original `q>1` plays 9011 (human 2D, others 3D).
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
These paths remain explicitly pending under PUP-05.

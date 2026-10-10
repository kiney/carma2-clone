# Opponent and police speed powerups

## Records and handler map

Installed Stock and Advanced `POWERUP.TXT` define indices15–18 as follows:

| Index | Action |   Duration | Float parameter 0 | Meaning          |
| ----: | -----: | ---------: | ----------------: | ---------------- |
|    15 |     14 | 30 seconds |                 0 | Freeze opponents |
|    16 |     15 | 30 seconds |                 0 | Freeze police    |
|    17 |     14 | 30 seconds |                 2 | Turbo opponents  |
|    18 |     15 | 30 seconds |                 2 | Turbo police     |

The installed read-only HW binary (SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`)
confirms these handlers through tables at `0x65d480` / `0x65d560`:

| Action       | Grant      | Reset      | Global     |
| ------------ | ---------- | ---------- | ---------- |
| 14 opponents | `0x4dcab0` | `0x4de4b0` | `0x75f610` |
| 15 cops      | `0x4dcb80` | `0x4de510` | `0x74b7d4` |

Grants write authored float parameter zero; resets write one. These addresses
differ from rec2's annotations. Normal renewal, expiry and cancellation share
the existing powerup lifecycle. The browser retains independent Float32 factors.

## Native AI consumers

`opponent.c` selects the cop factor only when the vehicle type in the high byte
of `car_ID` is `eVehicle_rozzer` (type3); other AI cars use the opponent
factor. `MungeOpponents` processes regular opponents and cops in separate
arrays. `ChooseNewObjective` changes zero-factor AI to `eOOT_frozen`, and
restores its former pursuit or `get near player` objective after the factor
becomes nonzero. `ProcessFrozen` requests rematerialisation at speed0, clears acceleration,
and applies brake force `15 * mass` while frozen. The installed helper returns
without changing the pose for already physical cars, as verified below.

The route speed controller multiplies desired speed by the selected factor.
Its acceleration cap starts at `max(factor, 1) * 12`, then applies engine and
transmission damage reductions. Therefore values below1 reduce target speed
while retaining at least the base acceleration cap; zero invokes the separate
frozen objective path.

## Browser implementation scope

`PowerupSystem` now exposes independent `opponentSpeedFactor` and
`copSpeedFactor` modifiers, both initialized and reset to1. It reads float
parameter0 without a fallback, applies the parsed float32 value, renews the
timer by action, expires through the normal timed-effect path, and resets both
factors through cancellation. The runtime consumes opponent factors through the
verified direct-force controller below. Production Chromium validation has passed for NICE BEAVER (five rivals) and
Advanced Carrier (ten rivals), including grants, expiry and normal keyboard
driving during freeze. Native path/objective targets remain AI-01/AI-02. No separate police
population is created, matching the installed loader described below.

## Verified force controller and browser integration

Installed `ProcessFollowPath 0x4af700`, controller `0x4b03bd–0x4b0525`:

```text
speed = 6.9 * length(modelVelocity)          # metres/second
capacity = max(factor, 1)
engine 51..97: subtract (damage-50)/80; >=98: subtract .6
transmission 51..97: subtract (damage-50)/160; >=98: subtract .3
either component >=99: capacity = 0
error = desiredSpeed * factor - speed
acceleration = clamp(previousAcceleration + error
                     + (error-previousError)*100/dtMs,
                     -12*capacity, 12*capacity)
```

The installed storage boundaries are also implemented. Velocity components,
factor, desired speed and mass are native Float32 fields. The initial full 3D
length is multiplied by double 6.9 and then stored Float32 (`0x4af9a2–0x4af9db`).
The later horizontal speed is a separate steering/SOC local: the PID still
loads the earlier full 3D speed. Damage losses use Float32 multipliers .0125
and .00625 and plateaus .6/.3. Maximum acceleration is stored Float32.
The derivative consumes live error, multiplies by 1000, divides by frame
milliseconds and multiplies by Float32 .1; contracting this into double 100
changes results. The derivative adds the stored error and previous stored
acceleration in that order. Both histories are stored Float32 before mass
multiplication; force uses the live clamped acceleration and is then stored
Float32. Numerical fixtures include cumulative history and vertical velocity.

History is stored before mass multiplication. Positive acceleration writes
`accForce=acceleration*mass, brakeForce=0`; otherwise acceleration force is zero
and braking is `-acceleration*mass`. Zero factor uses the separate frozen path:
zero acceleration and `15*mass` braking. Thaw restarts navigation/controller
history. Already physical cars are not teleported: rematerialisation helper
`0x4a7f10` returns at `0x4a7f35` when `physics_me` is set.

The driver branch at `0x416bfc–0x416fde` bypasses player controls/drivetrain for
driver<7. WheelForces consumes the commands directly through the existing tyre
and axle solver (`0x41a19e`, `0x41a2a8`, `0x41a306`). AI force commands persist
across physics steps: the feedback store is human-only (`0x41bc52–0x41bc7c`).
Curvature clamp/auto-centering is also human-only (`0x4196d3–0x41988d`), while
steering-damage curvature addition/subtraction is common. AI curvature approaches
its requested value by at most `float32(dtMs*0.0005)` per controller frame,
with Float32 storage of the result (`0x4b053b–0x4b05a2`). This corrects rec2's
ten-times-faster reconstructed constant.

Main now uses this controller for all physical rivals. The requested route
speed and curvature target still come from RoadNavigator, whose undirected graph
and steering heuristic remain AI-01/AI-02 approximations; these are not claimed
to reconstruct native pursuit/objective selection.

## Catalog-29 special interaction

Action14 additionally applies authored Hot rod powerup catalog entry5 to the
**first** race opponent whose catalog ID is29, regardless of factor (including
freeze zero). Installed grant `0x4dcab0` scans the 16-byte race list and applies
engine/grip and suspension; reset `0x4de4b0` restores defaults. Stock parameters
are `[8, 2.2, 1, 1.5, 0, .15, 1.5]`, loaded from the table, not hard-coded.
The browser helper preserves first-match behavior and tracks grants/removal
revisions so renewal reapplies the original parameters.

## Police population: installed no-op

The earlier rec2 stub assumption was resolved with original disassembly.
`LoadAIWorldForRace 0x401070` calls `0x4a93a0`; that function only clears police
count at `0x75acc4` and returns. All 51 Stock and 73 Advanced track records
inspected also have zero police starts. The browser therefore does not invent
category-3 police populations; action15 faithfully changes/resets its global
factor without spawning cars. Catalog vehicle “The Cop” remains an ordinary
opponent when selected. Custom police spawning would be an explicit extension,
not parity with this installed loader.


## Validation

`tests/browser-opponent-powerups.mjs` waits for the full authored rival count
while paused. It checks normal debug grants, modifiers/forces, first-match
Hot rod settings and cancellation, both category factors and independent
player keyboard driving while the race countdown and opponent controllers
are frozen. Stock additionally checks natural 30-second expiry against game
time. The catalog-29 case temporarily labels two real loaded bodies with ID29;
it is a synthetic identity fixture, not a claim that this mission selects29.
Production Chromium reports no page/console, failed-request or WebGL errors.
Stock world-rival contacts were observed; the final Advanced run had none and
is not claimed as Advanced collision coverage.

The wider smoke checks real W/A input, four-lap progression and Stock/Advanced
track switches. It now waits for opponents/pedestrians before unpausing: starting
while rivals were still loading let traffic damage the waiting player and
invalidated the directional steering assertion. That assertion is unchanged.
Chrome DevTools MCP is unavailable in this runtime; these checks use actual
Chromium through the existing Playwright harness with software WebGL.

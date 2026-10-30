# Explosive Pedestrians powerup

## Installed handler

The installed HW action table maps action 3 to `SetPedExplode` at `0x4dc5d0`;
its reset table maps action 3 to `ResetPedExplode` at `0x4dc820`. The HW global
is `gExplodingPedestrians` at `0x742950`. The setter writes DWORD 1 and returns
the definition index computed from the powerup pointer and the global
`POWERUP.TXT` array (`0x69f0e4`). The resetter writes DWORD 0 and returns.
Neither reads parameters or a car/driver field, samples random state, changes a
pedestrian directly, or performs activation, velocity, or body conversion.

The matching SW functions are `0x4d82d0` and `0x4d8520`, using global
`0x7395b0` and powerup array `0x6992ec`; their instruction bodies implement the
same assignments. The installed executable identifies are recorded in the
project's [binary inventory](c2-physics-re.md). Pedestrian initialization at
`0x4d5a74` also clears the global. rec2 provides the function names but its
annotated addresses differ from this installation.

## Authored definition and lifecycle

Stock and Advanced record index 4 is **Explosive pedestrians!**: action 3,
30-second duration, no float or integer parameters, group inclusion 2048,
Pratcam 38 and flags 67. Its effect belongs to the normal powerup owner: grant
sets the shared boolean; renewal preserves it and replaces the existing
deadline; normal expiry, group conflict, explicit cancellation, and teardown
run the existing reset path. The source reset is an unconditional assignment,
not a reference count, and has no recipient condition. The browser powerup
getter therefore exposes the global value regardless of which car received the
effect. The timer uses game time and continues to expire while the race timer is
frozen.

The action does not create an explosion at grant time. It changes a global read
by later pedestrian gameplay. In the installed code, exploding pedestrians
receive different passive/active contact damage; exploding or brittle
nonhumanoids receive the source minimum normalized damage; the sever attempt
bypasses the ordinary percentage roll while retaining the applicable damage,
other-body, gore and immortality gates; and successful severing uses the
existing exploding launch and random sequence. World-only contacts do not
become sever contacts. These consumers are documented in
[pedestrian contact evidence](c2-ped-sever-contact-re.md) and
[PED-11 sever evidence](ped11-sever-re.md).

## Browser ownership boundary

`PowerupSystem` represents the handler with a timed global boolean and exposes
it as `explosivePedestrians`. The pedestrian gameplay bridge must read this
value for its ordinary frame globals. Do not set per-character explosion
flags, add an activation-time impulse, or create a separate duration clock;
those would bypass the installed global handler and its existing lifecycle.

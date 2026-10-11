# Combat powerup numerical kernels

## Evidence

Verified against the read-only installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `0x400000`. `.text` starts at RVA `0x1000` / file offset
`0x400`; `.rdata` starts at VA `0x588000` / file offset `0x186c00`.
The handler map is in [c2-combat-powerups-map.md](c2-combat-powerups-map.md).
rec2 was consulted for names and structures only; no source was reused.
Installed addresses take precedence over its shifted stub annotations.

`src/combat-powerups.ts` implements independent numerical kernels. Calls use
original actor coordinates and velocity units. The integration owner applies
the returned velocity and body-axis angular increments, wakes rigid bodies,
and preserves ordinary attribution, pedestrian death, scoring and visual paths.

## Opponent repulsificator (action 38)

Installed wrapper `0x4ddfe0` enters `0x4ddff0`. It visits car categories
0 through 4, excludes the source by identity, and does not test wasted/active
flags or line of sight. Stock parameters `[12, 0.2, 3, 7]` mean linear strength,
minimum vertical direction, angular strength and Euclidean range.

Installed `0x4de059–0x4de070` reads source/target car fields `+0x4c..+0x54`.
These are world COM positions, populated by `FinishCars` from the local
collision center of mass through the master actor transform, not actor translations.

For target displacement `d`, distance `r = length(d)`, range `R = p3`:

```text
eligible = r < R
F = (R - r) / R / target.massMultiplier
n = d / r if r > 2^-22, otherwise (1, 0, 0)
if abs(n.y) < 0.1: n.y = p1
deltaVelocity = n * p0 * F
deltaAngularVelocity[i] = uniformSigned(p2 * F), independently for X, Y, Z
```

`+0x4c8` is a temporary mass multiplier, **not rigid mass**. It initializes to
1 (`0x414311`); `SetMassMultiplier` writes it (`0x4de9c0`), reset writes 1
(`0x4dea00`), and the simulation temporarily scales rigid mass/inertia with
it (`0x415bb8`). The repulsion handler divides that field at `0x4de0e4`.
Thus cars of different ordinary rigid mass receive the same delta velocity
when their multiplier is equal. Y replacement does not renormalize the vector.
The handler clears rigid `disable_move_rotate +0xec`, sets network-state cutoff
field `+0x49c` to last PHIL physics tick +40 ms, and sets last culprit car/time fields.
No qualifying car returns -1, preserving the charge. Multiplayer forwarding
is outside the local kernel; network mode 3 skips local rigid mutation.

## Shared pedestrian command selection

Installed `0x4cdef0` returns no targets when the immortal-pedestrian global
`0x742940` is set. It walks `gPedestrians_in_sight` (`0x742954`, next pointer
at pedestrian `+0x50`), requires positive hit points, tests **squared** distance
strictly below the passed range, and requires the world segment's first face
fraction to be at least 1. A range of zero disables the range gate. It does not
choose every pedestrian spawn in the level. A qualifying target makes the
helper succeed regardless of the callback's return. Both action 37 and 45
therefore preserve a charge when this target list is empty.

Action 37 (`0x4cdde0`) passes stock `p0=36` directly: six actor units of
Euclidean range. Callback `0x4cde00` records the car as culprit, calls ordinary
pedestrian killing (`0x4ccc20`), sets move 113/action 6, and allocates one of
20 proximity-ray records with a start timestamp and source/target pointers.
The renderer expires each link after 500 ms; this is independent of the
electric pickup's 30-second duration. The ordinary kill function includes
a low-gravity special-volume branch that skips physical/gore setup but still
executes death counting and scoring (`0x4ccc8b` to `0x4ccd84`), plus global gates. Selection is implemented;
full bone animation, ray rendering and death bookkeeping belong to integration.

## Pedestrian repulsificator (action 45)

Wrapper `0x4de340` rearranges the stock float arguments for `0x4ce030`.
Callback `0x4ce0e0` uses original `[15, 0.25, 5, 10]` as linear strength,
angular strength, minimum vertical direction and **squared** range. Its gate
is about 3.162 actor units, rather than 15 or 10 actor units.

```text
q = dot(d, d)
F = (p3 - q) / p3 * 0.068 / pedestrian.simpleRigidMass
n = d / length(d) if length(d) > 2^-22, otherwise (1, 0, 0)
if abs(n.y) < 0.1: n.y = p2
deltaVelocity = n * p0 * F
deltaAngularVelocity[i] = uniformSigned(p1 * F)
```

The `0.068` double is at `0x589a70`; the vertical cutoff `0.1` double is
`0x589a98`. Pedestrian mass is rigid object `+4` in tonnes, read before any
boned/simple physics activation. The handler sets move 91 (random factor
75..200), activates character physics, wakes the rigid body, advances the
network-state cutoff by 40 ms, records culprit and event time, and emits a repulsion link.
The pure kernel supplies the impulse; it does not pretend this is an instant
kill or unconditional radial blast.

### Network-state cutoff, not local contact suppression

The handler's `+0x49c = gPHIL_last_physics_tick + 40` stores use installed
clock `0x74878c`, loaded at `0x4de20b` and `0x4ce2b2`. PHILDoPhysics
`0x4b63d0` reads and resynchronizes that same 40-ms physics tick at
`0x4b6416–2f`; it is not `GetTotalTime` or the animation frame timestamp.
The kernel's time argument therefore represents the last physics tick.

A full installed disassembly cross-reference found no world-contact, rigid-pair
or CCD predicate reading `+0x49c`. The read at `0x415c74` is explicitly gated
by net mode 2 (`0x415c68–6f`): if the cutoff is strictly greater than imported
state timestamp at rigid `+0x274`, it clears the pending network-state marker
`+0x261`, resets car `+0xc4` to -1 and returns without importing state.
Other consumers serialize or filter network state (`0x497919`, `0x4979af`,
`0x497fa4`, `0x498536`, `0x4988da`). Their comparisons have individual equal-
timestamp behavior and are not a generic collision pause. Single-player
integration should apply the impulse and wake the body while leaving ordinary
collision processing enabled. `CombatImpulse.networkStateCutoffMs` preserves
the verified timestamp for future multiplayer implementation.

## Electric ray (action 31)

`0x4dea80` stores `p0*p0` at car `+0x170c`; `0x4deab0` resets it to zero.
Installed pedestrian object scanning starts at `0x4ced30`. The electric path
requires a car-owned physics object (`+0x238 == 1`, driver `>5`), a nonzero
range, and no immortal-pedestrian flag. Its broad phase is a strict cube:
each position difference must have absolute value below 5.

Normal scanning compares squared distance to the relative-velocity **line in
XZ**, rather than present radial distance. For `d = carPosition-pedPosition`
and `u = carVelocity-pedVelocity`, distance is
`(u.x*d.z-u.z*d.x)^2/(u.x^2+u.z^2)`; zero planar relative velocity uses
`d.x^2+d.z^2`. A separate native nearness mode uses full 3D squared distance.
The comparison is strict against `car.proxy_ray_distance`. This scan invokes
the same death/ray callback directly (`0x4cf218` / `0x4cf0eb`); unlike the
keyboard pedestrian commands, this electric scan does not cast a LOS segment.
The kernel implements this geometry. It assumes the caller already enforces
the active pedestrian scan, car ownership/driver and immortality gates.

## Flamethrower (action 49)

Installed `0x4ce310` rejects a source whose last special volume has gravity
multiplier below 1, allocates the first free of five bolt slots (stride `0x6c`,
pool `0x69a080`), and obtains alive/in-sight/LOS targets with no range limit.
Callback `0x4ce520` accepts only a pedestrian with a process cache and cache
`+0x98 == 0` (neither reserved nor burning). The candidates sort by ascending
squared distance (`0x4ce560` comparison), then the first target with no low-
gravity special volume is chosen. All targets occupied/blocked/wet or all
five slots busy return failure, preserving the charge. The cache receives
`-(slot+1)` and the bolt stores source car, target, birth time, zero direction,
and starts at the car position.

Installed `MungeNapalm` is `0x4ce580` for this build. When time minus bolt
`+0x24` exceeds 50 ms, it normalizes target-minus-bolt displacement (coincident
fallback `(1,0,0)`), scales **each component independently** by a random value
in `[0.8,1.25)`, and adds `(500-age)*0.002` to Y while age <500 ms.
It advances by direction times `framePeriodMs*0.002`. The installed routine
does not update `+0x24` after this direction refresh, although older rec2
describes it as a time; the kernel preserves the observed behavior.

Impact uses the target's simple rigid bounds and seven flame actors, starts
the explosion/burning animation, marks cache `+0x98 = now+15000`, records
culprit, scares the pedestrian and starts 25-second smoke. Pedestrian updates
kill after the 15-second deadline unless immortal; a low-gravity special volume
cancels reserved/burning state. Selection and central bolt motion are verified
and implemented. Seven-actor trail sampling, animated bone bounds, explosion/
smoke rendering, and complete native corpse physics remain integration work;
they are not implemented by a generic blast replacement.

## Validation

`tests/combat-powerups.test.mjs` contains numerical cases for unequal mass
semantics, range boundaries, squared pedestrian falloff, non-normalized upward
replacement, coincident fallback, directional electric geometry, five-slot
allocation and napalm ascent/movement. Its optional installed-asset case skips
cleanly without the executable or with another hash, and compares native float
constants without copying original fixtures into the repository. Installed
`FRandomPosNeg 0x512fc0` uses the 15-bit CRT sample scaled by 1/32768 (the
negative reciprocal constant is at `0x58a288`), so its upper endpoint is open.

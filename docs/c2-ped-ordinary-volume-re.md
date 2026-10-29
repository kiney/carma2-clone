# Ordinary pedestrian low-gravity volume phases

## Evidence and ownership

Verified directly against the installed read-only HW executable, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 base `400000`. Metadata is retained in the existing physics notes.
`madebr/rec2` `common/pedestrn.c` maps the Munge phases and helper names, but
its callback addresses differ from this installation. Its `SetRandomOmega`
macro expression is useful context; the actual installed instruction sequence
determines the numerical implementation. No reference code or binary assets
are included.

`src/ped-ordinary-volume.ts` exposes three independent host phases:

- `processOrdinaryPedVolume` runs before ordinary support/steering.
- `activateImmersedOrdinaryPed` runs after support/steering, before BON.
- `moveOrdinaryPedInVolume` runs after physical moved synchronization,
  angular settling and any moved-animation-period draw.

Callers supply the actual selected physical `BodyVolumeState`, current body
orientation and raw world velocity, actual bounded process bytes, signed HP,
move ID, outer time, replay/active state and global gravity. An allocated empty
volume cache or an automatic candidate without a selected volume is dry.
The helpers do not query world geometry, choose volumes, integrate gravity or
repeat animation. Existing PHIL free forces and quieting remain their owners.
Move, full Kill, burning resources and activation use explicit host outlets;
unavailable outlets produce diagnostics before effects/RNG where possible.

## Outer selected-volume process state

Installed `4d3a9d..4d3bfc` runs outside replay. A selected `Object+258`
volume whose Float32 gravity at `+88` is strictly below1 enters this branch.
There is no immersion-depth, active-physics or global-gravity gate here.

The existing burning resource in signed process DWORD `+98` is stopped first.
Positive values use the actual simple-body smoke owner; negative values use
the napalm resource owner. Clearing this DWORD without disposing its actual
effect is incomplete. The new module delegates that resource operation to
`clearBurning`; no existing combat expiry loop is replaced.

The installed negative branch `4d3b23..4d3b5a` clears process `+98` before
reloading it for napalm-pool addressing. Thus rec2's apparent lookup using the
old negative value is not sufficient proof of this image's target identity.
The numerical module deliberately leaves resource selection to the supplied
actual burning owner and clears the process field after successful release;
this adapter ordering is a bounded ownership deviation from the native
negative store/lookup sequence. It must not be described as verified napalm
pool parity.

Process `+94` stores the low-gravity entry timestamp. A zero value is replaced
with the actual outer time (`4d3b81..4d3b89`); entering at time0 consequently
retains the native zero-sentinel behavior. With signed HP>0, select move110
when needed using speed−1, restart0, completion0 and action5, then test unsigned
DWORD elapsed time strictly greater than30000 (`4d3bc0..4d3bd5`, unsigned
`JBE` at equality). The expired branch invokes the full `KillPedestrian`
owner; no extra immortal check appears in this branch. With HP<=0, select94
with the same arguments when needed and do not repeat Kill. No selected low
gravity volume resets `+94` to0 (`4d3bf6`). This branch consumes no CRT draws.

## Passive fully immersed activation

Installed `4d492b..4d4b1f` is a separate later phase. It requires nonreplay,
character active bit4 clear, selected volume gravity<1, global gravity exactly
double1 and Object depth exactly double1. There is no living-HP gate.
It clears process smooth-turn timestamp `+6c`, requests actual physics level5,
then draws three `SFRand(1)` samples in X/Y/Z order into BODY omega.

The installed component scaling at `4d4a5b..4d4b1f` reevaluates length after
earlier component updates. It is not one vector normalization followed by a
single scale. Let initial stored Float32 components be `a,b,c`, let `F` mean
a Float32 store, and retain live products as double approximations to x87:

```text
c2 = F(c*c)
xLive = 2*a / sqrt(a*a + b*b + c2)
x = F(xLive)
yLive = 2*b / sqrt(xLive*x + b*b + c2)
y = F(yLive)
z = F(2*c / sqrt(x*x + yLive*y + c2))
```

The source spills `c*c` at `4d4a8b`, new X at `4d4ab2/4d4acb` and new Y at
`4d4aeb/4d4b07`; the live new component times its stored copy explains the
mixed products above. Consequently the final length need not be2. The
independent kernel `ordinaryPedInitialVolumeOmega` retains these stores.

Three exact center samples produce initial `[0,0,0]`, whose source division
is0/0. The browser explicitly retains finite zero omega and reports
`native-immersed-ped-omega-singularity-suppressed`; it does not consume
replacement random samples or claim NaN parity. Activation already occurred,
matching the phase's owner order. This is a documented stability deviation.

## Moved living continuation

Installed `4d28ca..4d29a7` requires selected volume gravity<1 and signed HP>0.
The source BODY-omega components are Object `+74/+78/+7c`; world V is `+68`,
with VY at `+6c`. The browser's world angular velocity is converted using the
actual physical orientation before and after local updates.

If BODY angular magnitude is strictly below double1, draw three `SFRand(5)`
values, X/Y/Z, and add/store each component as Float32 (`4d2932..4d295f`).
Then, independently, depth strictly below double1 and stored world VY strictly
above double−.02 add one `FRand(0,Float32(−.3))` and store VY as Float32
(`4d2962..4d29a7`). Exactly1 angular magnitude and depth1 fail their strict
gates. Float32(−.02) is slightly above double−.02 and therefore passes VY's
test. No timestep or depth multiplier applies to either addition.

Installed shared CRT helpers are `SFRand513030` and `FRand512f90`, with
`rand575f80` range0..32767 and divisor32768. `SFRand(s)` is
`−s + 2*s*sample/32768`; the lower/upper float helper is
`lo + (hi−lo)*sample/32768`. Moved93/94/97 animation-period randomness precedes
this phase and remains in `NativePedGameplay`; it must not be repeated here.
Corpses may receive their existing low-gravity animation-period adjustment but
never these living angular/vertical draws.

## Validation and limits

`node --import tsx tests/ped-ordinary-volume.test.mjs` exercises16 deterministic
cases: original branch order, entry/reset/zero timestamp, unsigned wrapping and
strict30000ms timeout, replay and selected-volume distinctions, corpse move94,
provider preflight, activation gates/order, sequential normalization reference
values and singularity, local-space rotated additions, exact ordered CRT
consumption, and the Float32/double−.02 boundary. Fixtures are synthetic and
redistributable. No original installation data is embedded.

The module is a numerical/ownership integration seam, not standalone proof of
production call chronology, drowning death attribution, burning resource
parity or rendered original gameplay. Those require the actual production
host bindings and subsequent application validation.

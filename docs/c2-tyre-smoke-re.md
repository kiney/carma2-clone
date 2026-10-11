# C2 tyre smoke and squeal producer

## Evidence and scope

Verified against the installed, read-only `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
This is the PE32 executable with image base `0x400000`, entry `0x577eb0`
and October 18, 1998 timestamp. `madebr/rec2` supplies field and sound-wrapper
names; its annotated addresses differ from this installation. No reference
implementation code or original asset contents are copied into this port.

`src/physics/tyre-smoke.ts` independently implements the installed producer
`0x41bef0–0x41c1c1` and its axle selection gates. It returns the native puff
input for the existing `SmokeSystem.spawnPuff` allocator. This producer is
separate from FinishCars continuous surface dust (`smokeType >= 2`).

## Caller phase and selection

WheelForces processes the rear axle, then the front axle. The rear producer
calls are at `0x41ad8c`, `0x41adbb`, `0x41ae63`, `0x41af2a`; front calls are
at `0x41b225`, `0x41b257`, `0x41b303`, `0x41b3ce`. These execute during
tyre-force allocation, before the resulting velocity and angular changes.
They must not be reconstructed from final slip flags or delayed until the
FinishCars dust/render phase.

For stored demand `d`, capacities `c0/c1`, and slipping reduction `r`:

- If `d > c0` and `d > c1`, store
  `q = (2*d-c0-c1)/Float32(c0+c1)`. After the independent skid-mark gates,
  draw integer `0..1`. Nonzero selects the first wheel; zero selects the
  second. The selected stored capacity must exceed **double** `0.1`.
- If only `d > c0`, store `residual = d-Float32(r*c0)+d`. Select the second
  wheel only when `residual > c1` and `c1 > double(.1)`;
  store `q = (residual-c1)/c1`. No wheel-selection RNG draw occurs.
- The other mixed case mirrors the preceding case, selecting the first wheel.
- If neither demand exceeds capacity, no producer call occurs.

Wheel indices are rear `0/1`, front `2/3`. The both-saturated random draw
occurs even below the skid-mark quotient thresholds `20/60`. Skid-mark
eligibility is not tyre smoke/squeal eligibility. `Float32(.1)` exceeds
double `.1`, while its immediately smaller stored value fails the cap gate.

## Producer RNG, voices and eligibility

The exact order is:

1. Draw sound channel integer `0..1`, unconditionally.
2. Reject `q < Float32(5)` or selected material `tyre_noise_index == -1`.
3. Draw integer `0..4`; reject nonzero.
4. Store selected channel volume as signed truncation of `q*Float32(10)`.
5. Compute the source wheel point and test selected sound tag for playback.
6. Start sound if the tag is not playing, or the caller driver is exactly8
   and that channel belongs to another car. A restart draws pitch
   `49152..81920`, then sample index `0..4`, in that order.
7. Start positional sound `9000+sample`, repeats1, supplied volume and pitch,
   speed `65536`; retain the returned tag and caller owner.
8. Only selected material `smoke_type == 1` proceeds to the puff.

Addresses: channel draw `0x41befb–0x41bf02`; rejection and chance
`0x41bf07–0x41bf43`; voice eligibility `0x41bfdb–0x41bff5`; pitch/sample/start
`0x41bff7–0x41c048`; smoke type `0x41c04f–0x41c056`.
The authored noise index is an eligibility sentinel here; it does not replace
the hardcoded9000–9004 sound IDs. Opponents can use an idle channel but cannot
preempt a playing one through the local-driver ownership exception.
Replacing another owner's playing tag does not stop that old sound: the
start callback creates a new sound and the table overwrites its tracked tag.
Consequently, the two-channel table does not impose a two-live-voice limit.

Global tags are `0x677c60[2]`, owners `0x677c68[2]`, stored volumes
`0x677ca8[2]`. There is one two-channel table across cars and wheels.
Updating its volume while a sound remains active does not call a native
volume-update API in this function. Native StopSkid stops matching-owner tags
without clearing those tags or owners. Installed calls occur when the previous
slip state is zero in PrepareCars (`0x41644a–0x416473`), before this frame's
wheel updates. The WheelForces stop branch is independently selected by
**zero accepted wheel supports**, at `0x41988d–0x419891`, after preparation
and before final force integration. Its counter is initialized at `0x4188f4`
and incremented only after wheel acceptance at `0x4190e0–0x4190ef`.
The branch clears front/rear maximum forces and stops matching-owner tags at
`0x41b908–0x41b935`. The ordinary-gravity block at `0x41bca1` rejoins this
path at `0x41bd3e → 0x4196cb`; it is not an early return.
The root motion/frame adapter
must supply these actual stop conditions; the kernel does not infer them
from elapsed time or visual wheel motion.

All draws default to the shared MSVC CRT stream. Audio-off still consumes the
pitch/sample draws on a start branch and receives a zero tag from the source
wrapper. The adapter should return0 when audio cannot start, preserving that
subsequent playback query behavior.

## Point and velocity equations

Source fields are wheel `wpos` at car `+0x1224`, selected `oldd` at
`+0x1264`, support normal at `+0x1348`, physics omega at `+0x74`, and
physics local linear velocity at `+0x1a8`. `oldd` means that field's value
**at the producer call**, after wheel preparation; it is not an additional
previous-frame snapshot introduced by the port.
Specifically, `0x41926d–0x419272` uses the prior field value for the spring
delta, then `0x419274` overwrites `oldd` with this call's current wheel length.
The adapter must pass `state.wheelLengths[wheel]`, not the prior spring sample.

Let `p = wpos - (0,oldd,0)`. The source model-origin lever is `p`, without
subtracting COM. For the mechanics-phase ACT transform `M`:

```text
P = Float32(M.applyPoint(p) * Float32(1/6.9))
v = Float32(omegaBody × p + Float32(6.9) * velocityCarSpace)
s = Float32(-supportNormalBody · v)
v = Float32(v + supportNormalBody*s)
V = Float32(M.applyVector(v))
strength = Float32(q * Float32(.04))
decay = 1
type = 4
```

The Y linear-velocity multiplication has an additional Float32 spill before
addition. The cross product and vector stores are retained explicitly.
The normalized aggregate support normal is supplied; the producer does not
replace it with global up or normalize it again.

The physical ACT's translation is in physics coordinates. In this browser,
`motion.wheelPositions` and `state.wheelLengths` already use those coordinates;
the actor-origin `state.position` must be multiplied by6.9 when constructing
the mechanics-phase ACT translation. Its rotational basis remains unit scale.
A final render ACT or interpolated pose is not the source transform.

Sound receives `P` and the retained world-velocity vector at car `+0x13cc`.
That vector is refreshed by the sound frame owner at `0x4567db–0x4567f3`;
substituting a post-force velocity changes the source snapshot.
Puff input receives `P/V` above. Existing CreatePuffOfSmoke then applies its
own velocity division by6.9 and position/Y-rise changes; the producer must
not apply those allocator operations a second time.
`velocityCarSpace` is the raw body-local linear velocity; the producer applies
its own `Float32(6.9)` factor at `0x41c0bf–0x41c0fd`. Motion's physical-speed
vector, which already contains that factor, must first be converted back.

Constant addresses: threshold5 `0x5887c4`, volume10 `0x5886b8`,
scale6.900000095367432 `0x5886b4`, inverse0.14492753148078918 `0x5886d4`,
strength0.03999999910593033 `0x588808`. The puff call is `0x41c1b5 → 0x4fb0c0`.

## Integration and validation

Keep one `NativeTyreEffects` instance. Supply synchronous actual audio
`isPlaying/startSound/stopSound` callbacks. Call `selectAxle` in the rear/front
phases and pass only a returned selection to `produce`. Immediately route its
optional puff to `SmokeSystem.spawnPuff`, preserving the current mechanics
synchronization duration. Scalar and physics-vector inputs are the live
pre-force values, while the audio velocity is the independently retained
sound-frame value.

Eight focused tests verify rejected RNG consumption, the inclusive5 boundary,
sound ID/pitch order, shared ownership and stopping, surface gates, both/mixed
caller selection, default shared CRT, and original Eagle/Buggy physics-unit
wheel packets. Original installation tests skip cleanly when assets are absent.
The runtime connects these packets directly to the rear/front motion phases,
with current wheel lengths and raw pre-force local velocity. PrepareCars and
the no-accepted-wheel branch stop the owner's tags. The sound-frame velocity
is retained after physics for the following frame. Two additional original-car
phase tests verify those barriers for Eagle/Buggy and airborne stopping.

Web Audio's tagged one-shot adapter tracks pending decode, playback, cancellation
and natural completion; focused tests prohibit delayed playback after stopping.
The current audio bridge uses the original sample and pitch but mixes through
the ordinary master gain: native positional mixing and Doppler are still
AUD-02. Chromium verifies type-4 puffs through real stock-city driving input.
Float32 spill points are modeled; JavaScript arithmetic does not emulate every
x87 extended-precision rounding.

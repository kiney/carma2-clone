# Replacement-model fire and remaining native producer scopes

Verified by read-only static inspection of installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base `0x400000`, entry `0x577eb0`, timestamp October 18, 1998.
rec2 supplies names and structure maps; installed instructions determine the
addresses and behavior below. Implementation is independent, with no copied
reference source or proprietary fixtures.

## Replacement fire producer

`SmashObject` at `0x4f4bc0` compares the actor's current MODEL pointer against
the replacement at spec `+0x2c0` (`0x4f4ca7–0x4f4cb2`). Equal pointers skip
replacement and all its fire RNG. After recording the MODEL change, it assigns
the new pointer at `0x4f4cce`, then evaluates fire before disabling child ACTs
and before ordinary connotations (`0x4f4e98`). The incoming impact car does
not own these columns.

The parsed `SmashReplacementFire.parameters` tuple has recovered semantics:
`[columnCount, minimumColour, maximumColour]`. Source fields are chance
`+0x2c4`, count `+0x2c8`, minimum `+0x2cc`, maximum `+0x2d0`.

`Chance` at `0x512f30` returns false without a draw when chance is zero.
Every other chance, including 100, consumes one 15-bit CRT value and compares
`floor(100 * rand15 / 32768) < chance`. Failure skips all further work. A
successful chance with nonpositive count also consumes no column draws.

For each column (`0x4f4cec–0x4f4d2e`), read the new MODEL's first prepared
group count, draw vertex inclusively from `0..nvertices`, then colour inclusively
from `minimumColour..maximumColour`. Call `CreateSmokeColumn2` at `0x4f4d20`
with mode 0, that ACT, NULL car, NULL rigid object, selected colour/index, and
**10,000,000 ms**. This branch adds no seed/reseed operation, wet-volume gate,
or repair dependency. The ordinary creator's smoke-quality gate can reject
publication after the producer draws have already occurred.

`createNativeReplacementColumns` implements those gates/draws and emits the
normal `SmokeColumnSource`. Host integration must invoke it only for an actual
MODEL identity change, before connotations, and supply a live prepared-resource
provider. Its safe provider must retain actual MODEL-load MAT bindings and
owned arena addresses; DAT ordinals, MAT names and rendered group order do not
define pointer order. Host addresses implement the recovered comparator under
the declared allocator policy, without claiming original Windows heap parity.

## Mode 0 consumer and lifetime

Creator `0x4fb58e–0x4fb5a6` retains mode, car, rigid object and ACT. With both
owner arguments NULL there is no fallback rigid object. It resets lifetime,
accumulator, source index, upright state and flame frame counters through
`0x4fb602`; persistent count/whiteness fields retain the normal pool behavior.

`DoSmokeColumn` sends **every mode other than 1**, including 0, through
`0x4fbf46–0x4fbfa8`. It forces upright and reads the actor's **current** MODEL
prepared group 0 vertex base plus `32 * index`. It performs the full ACT affine
point transform at `0x4fc039–0x4fc04b`, then subtracts Float32 `.03` from world Y
at `0x4fc050–0x4fc060`. A subsequent MODEL replacement therefore changes the
column's sample source while retaining its index and lifetime. The host's
`readPreparedSource` callback follows this current resource rather than retaining
a superseded geometry. Rigid/car split, inverted-height and smudge branches
apply only to mode 1 and do not run for replacement fire.

The normal lifetime check at `0x4fb867–0x4fb86c` expires only when remaining
time is strictly below the period; equality performs a final update. Expiry
clears the slot and detaches a colour 0 flame ACT. Mode 0 skips only the extra
replay-record emission at `0x4fb86e–0x4fb88e`. It uses the ordinary circular
pool, fire animation, glow and puff emission. With NULL rigid object, emission
input velocity is `(0, Float32(2.8985507), 0)` at `0x4fbb0e`, before the normal
puff initializer's scale/rise. See [column consumer evidence](c2-smoke-columns-re.md).

The inclusive vertex endpoint can enter the following contiguous material
group. If no following prepared vertex exists, bounds-safe source retirement
and a diagnostic are explicit browser deviations from unsafe native memory.
There is no endpoint clamp. Ordinary car repair does not expire mode 0 columns.

## Two additional call sites belong to multiplayer

The mode 2 call at `0x4f6201` belongs to function `0x4f60b0`, reached by the
single direct call at `0x4a3067` in the received-message dispatcher. The jump
table at `0x4a4328` routes packet type `0x22` to its case at `0x4a2fdb`.
It reconstructs a noncar clone from transmitted fields: template identifier
bytes `+0xa/+0xb`, actor U16 index `+8`, velocity `+0xc`, omega `+0x18`, matrix
`+0x24`, RNG seed `+4`, fire chance/count/colour range `+0x54/+0x58/+0x5c/+0x60`.
It rejects an occupied actor slot, clones/attaches and pulls a free body, restores
motion, seeds CRT with the packet seed at `0x4f61ac–0x4f61b0`, then reproduces
the same chance/vertex/colour sequence with mode 2 and 10,000,000 ms. It is not
an additional single-player scripted fire producer. Network packet support is
not introduced here.

Type 7 puff calls `0x4425a3` and `0x4425ed` are in the actual enclosing
`CheckRecoveryOfCars` at `0x4423f0`, within its **multiplayer remote-player**
recovery loop. rec2's `ExplodeCar` is inlined there. The loop requires nonzero
network mode, a nonlocal player, nonzero recovery deadline and end-frame time
at/after that deadline. It sets recovering status 8, physics byte `+0x261=0xff`
and message time `+0x268`, then clears physics `+0x49c`. It constructs two local
points with X/Y from COM and Z at boundsMinZ plus respectively `.3/.7` of the
bounds Z extent, applies the car master ACT, and sends type 7 with strength 1,
decay 1 and input velocity Float32(rawPhysicsVelocity\*double6.9). Installed
doubles `0x588c60/68/70` are `6.9/-0.3/-0.7`; subtracting those last products
implements the positive fractions. It then optionally welds, disables that
remote car, and clears its recovery deadline. These are not ordinary wasted
smoke or local recovery effects and must not be attached to either event.

## Validation

Independent numerical fixtures cover chance boundaries, exact RNG call order,
the changed-MODEL gate, ownerless mode 0 packets, current MODEL swaps, full
affine poses, live arena material ordering, the next contiguous group, invalid
final endpoints, unrelated car repair, lifetime equality and ownerless emission.
Optional original-installation cases exercise Carrier gun and City pump
replacement models in both Stock and Advanced. No original assets are written.

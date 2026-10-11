# C2 world-contact sparks

## Evidence and scope

Verified from the read-only installed HW executable, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base `0x400000`, entry RVA `0x177eb0`, linker 5.10, timestamp
1998-10-18 20:13:36. `.text` VA/file offset `0x401000/0x400`, `.rdata`
`0x588000/0x186c00`, `.data` `0x58e000/0x18c800`. rec2 provides names
and a reconstructed renderer; installed instructions take precedence.
Implementation is independent; no reference code or original assets are copied.

| Routine                    | Installed VA        | Evidence                              |
| -------------------------- | ------------------- | ------------------------------------- |
| World-contact spark caller | `0x41d773–0x41d7d4` | Installed                             |
| World spark allocator      | `0x4f7af0`          | Installed; rec2 creation stub         |
| Car/car spark allocator    | `0x4f8020`          | Installed; independent reconstruction |
| RenderSparks               | `0x4f71e0`          | Installed + rec2 reconstruction       |
| DrawLine3D                 | `0x4f6910`          | Installed + rec2 reconstruction       |
| SetLineModelCols           | `0x4f7a40`          | Installed + rec2 reconstruction       |
| ResetSparks                | `0x4f8530`          | Installed                             |
| Shrapnel outlet            | `0x4f8590`          | Installed; independent reconstruction |

The 32-record pool starts at `0x6a8210`, stride 64. Cursor `0x6a8c08`
and mask `0x6a8c0c` use circular insertion, overwriting live records.
Record fields: lifetime `+0`, position `+4`, velocity `+0x10`, tail
`+0x1c`, normal `+0x28`, synchronization duration `+0x34`, car `+0x38`,
colour byte `+0x3c`. Reset only clears the mask; cursor and data survive.

## Caller and required providers

The collision dispatcher requires primary rigid object type 1 and its car
pointer, and stored grouped severity strictly above Float32 `0.02`
(`0x41d39c–0x41d3ab`). The world branch additionally requires no secondary
rigid object, a world contact face, primary world velocity squared strictly
above double `0.0009` (`0x41d65f–0x41d66c`), and car driver greater than 5
or car flags at `+0x100` containing `0x200000` (`0x41d79f–0x41d7bb`).
The face material identifier's first character minus `'/'` selects modifier
0..9, with out-of-range values falling back to 0. Sparkiness is the
Float32 at `0x7607e4 + 40 * index`.

Actual allocator signature is `(worldPosition ECX, mutablePointVelocity EDX,
forceVector stack1, sparkiness stack2, car stack3)`, returning with `ret 12`.
At `0x41d672–0x41d6fb`, the caller computes body `omega × relativeContact`
plus body velocity at rigid `+0x1a8`, and applies the rigid transform's
linear part at `+0x8c`. This **point velocity is not rescaled**. It transforms
the group force separately, then multiplies that force by double `6.9`
(`0x41d739–0x41d76f`). Position is the transformed group contact position.
Before transformation, a world collision with vertical rigid velocity below
Float32 `-2.8985507488250732` doubles the local group force.

Exact contact grouping, force aggregation and correspondence with the browser
crash packet remain essential integration providers. Sparkiness is not a
multiplier on every impact, wheel slip or contact. The module deliberately
accepts a qualified source rather than inventing those providers.

## World allocator equations

Let `F = f32(length(force))`, `N = force/F`, `d = dot(force, velocity)`.
Compute `k = 1/(10F)`, subtracting `d/F²` when `d < 0`, then mutate the
caller velocity to `f32(velocity + k*force)`. The source force must be nonzero;
the browser rejects zero instead of propagating division-by-zero values.

The first count is `min(10, trunc(FRandomBetween(0, f32(0.7 +
0.5*length(mutatedVelocity))) * sparkiness))`; nonpositive count emits no
records. The **positive** speed term is verified by Float32 `-0.5` at
`0x58a038` followed by reversed subtraction from double `0.7` at
`0x58a040`. Each record gets world position, world normal `N`, and velocity
components multiplied independently by uniform Float32-bound `[0.5,0.9)`
draws in X, Y, Z order. Lifetime is 1000, car pointer null, colour zero and
synchronization duration copied from `0x748784`.

If `f32(F*sparkiness) >= 10`, a second batch has count
`min(10, 3 - trunc(f32(F*sparkiness)*f32(-0.1)))`. Position and normal
are transformed with the transpose of the rigid car-master actor basis,
subtracting translation for position; local position adds `f32(0.01)*N`.
The random vector draws in **Z, Y, X** order, using Z/X `[-1,1)` and
Y `[-0.2,1)`. `0x533bd0` only stores three floats: this vector is **not
normalized**. Local velocity is the tangent projection `R-N*dot(R,N)`.
The records store car attachment, lifetime 1000, colour zero and sync.

After this second batch the allocator calls shrapnel `0x4f8590`, passing
world position, mutated velocity, world normal, force magnitude, the same
car twice and two zeros. Its allocation and RNG side effects are reconstructed
in [shrapnel evidence](c2-shrapnel-re.md).
`SparkOptions.shrapnelOutlet` receives those inputs and the same quantized
CRT sampler. Missing outlets create a bounded diagnostic; `capabilities`
describes this class alone; production injects the reconstructed shrapnel
outlet and a separate car/car producer into the same ring.

## Render-frame update and hardware lines

RenderSparks receives `gFrame_period` from graphics, independently of the
40 ms physics producer. For each active slot, lifetime `<=0` clears its bit
but **continues one final update and draw**. Then:

1. Project velocity tangent to its stored normal.
2. Move by `velocity * (sync ? sync : framePeriod) * f32(0.001)`.
   Lifetime adds `sync-framePeriod` when sync is nonzero, otherwise subtracts
   framePeriod; clear sync. Positive sync overshoot can produce lifetime above
   1000 and a forward tail; there is no lower clamp on tail age.
3. Tail is `-velocity * min(150,1000-lifetime) * f32(0.001)`; nonzero
   colour halves it. World allocator only produces colour zero.
4. Gravity is `f32(framePeriod * 10 * double(0.00014492753623188405))`,
   i.e. `framePeriod/690`. Installed `0x4f7696–0x4f76cb` contradicts rec2's
   `framePeriod/69`; installed behavior is implemented. Attached position and
   tail use the live rigid actor transform, with gravity subtracted along the
   world-Y components of the actor basis. Unattached velocity Y loses gravity.
5. Add independently drawn `[-0.1,0.1)` noise in Z, Y, X order, then apply
   `max(f32(0.1), 1-length(velocity)*f32(1/1.4)*framePeriod*f32(0.001))`.
   Noise may reintroduce a normal component until the next projection.

Hardware rendering uses two vertex-coloured line vertices: red at the tail,
yellow at the head for colour zero, white for nonzero colour. The reconstructed
line initialization has prelit/smooth/two-sided flags and edge style. There
are no spark PIX sprites, lifetime alpha fades or pixelmap-size scaling.
Three renders ordinary depth-tested one-pixel lines; software depth/shade
tables, replay, rearview-specific double updates and original driver line
rasterization are not ported. Parent supplies the ordinary render-frame update
order; calling this stateful renderer twice also consumes and advances twice.

## Runtime and confidence

`src/sparks.ts` exposes `spawnWorld`, `update(timeMs,framePeriodMs)`, `group`,
`stats`, `snapshot`, `clear` and `dispose`. Production randomness uses the
shared native CRT stream; test injection uses the same 15-bit quantization.
Float32 storage, finite arithmetic checks, pool capacity, axis draw order,
caller mutation, rigid attachment and expired final iteration are covered by
numerical tests. No original assets are needed. Scalar/vector storage is
Float32 while live arithmetic uses JavaScript doubles; exact x87 extended
precision and every intermediate spill boundary are not claimed.

Confidence is high for the installed world allocator, renderer equations,
record layout and caller gates. Production binds the ordered native collision
group packet before solver velocity changes, a shared car/car producer, and
original FRAG4/FRAG5 shrapnel. Each outer graphical game frame updates the
shared spark ring once. Numerical tests cover world packet gates/scaling,
car/car insertion into the same ring, overwrite and final-frame lifecycle.
Passing unit tests alone does not establish complete DMG-03 behavior; other
producer paths and full source consumer chronology remain open.

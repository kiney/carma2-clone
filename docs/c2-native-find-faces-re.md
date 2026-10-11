# Installed FindFacesInBox orchestration

## Evidence and scope

This is an independent implementation of installed C2 orchestration in
`src/native-find-faces.ts`, using the released actor traversal and prepared MODEL
picker. It does not replace production world queries by itself. Original files
were read only; no reference implementation was copied.

The inspected PE32/i386 HW executable has image base `0x400000`, entry
`0x577eb0`, and SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
`/tmp/carma-rec2/src/carma2/common/finteray.c` and `brucetrk.c` provided the
symbol map. Installed instructions establish the arithmetic and traversal below.

| Installed address | Role                                              |
| ----------------- | ------------------------------------------------- |
| `4b5570..4b5701`  | FindFacesInBox                                    |
| `45fb90..45fdb7`  | FillInBounds                                      |
| `40cb90..40cc45`  | XZToColumnXZ                                      |
| `45fdc0`          | ActorBoxPick, delegated to `native-actor-pick.ts` |
| `460490`          | ModelPickBox, delegated to `native-model-pick.ts` |
| `532ae0`          | Native point transform                            |
| `5798e0`          | Native CRT floating-point initialization          |

A private `/tmp` PE mapping called the installed bounds/converter functions with
invented inputs after CRT initialization. All 104 packets matched the port's
bounds equations. Tests retain only safe invented numeric inputs/outputs. Two
source rounding edges are independently distinguished from tempting alternatives.

## Query bounds

Native `tBounds` contains a matrix pointer at `+0`, original min/max at
`+4/+10`, center at `+1c`, radius at `+28`, and real min/max at `+2c/+38`.
All input scalar fields are Float32. Live arithmetic uses the native 53-bit CRT
precision; explicit stores round to Float32.

For each original axis, midpoint is `f32((min+max)*.5)`, then the installed point
transform computes the center. Let `r=max-min` retain the live subtraction and
`b=f32(r)`. Radius is
`f32(sqrt((r.x*b.x+r.y*b.y)+r.z*b.z)*.5)`. It is the **local** half-diagonal,
without scaling by the query matrix. Replacing live extents by the stored vector
before both factors changes a captured result from `40.716739654541016` to
`40.71673583984375`.

The transformed original minimum is stored first. Each extent/basis product is
separately stored as `c[row][axis]=f32(b[row]*matrix[row][axis])`. Real minimum
adds the three negative contributions in the live order `(c2+c0)+c1`, then the
stored transformed minimum, with one final store. Real maximum uses
`(c1+c0)+c2` for the positive contributions. Installed predicates are multiplied
by the stored products; this also retains their signed-zero behavior.

This is different from `GetNewBoundingBox 45fab0`, which sequentially stores the
three additions. For an invented sheared basis with X contributions `1,1,1`
and translation `16777216`, FillInBounds yields maximum X `16777220` while
GetNewBoundingBox yields `16777216`. The orchestration therefore does not reuse
the latter helper for its initial query.

## Column addressing and traversal

The host supplies actual retained `tTrack_spec` origin, column sizes and byte
counts. `XZToColumnXZ` computes live quotients `(coordinate-origin)/size`.
The X quotient is stored Float32 before upper clamping/truncation. Its lower
clamp compares the retained live quotient. Z stays live through both clamps and
truncation. Both results clamp to `[0,count-1]` before signed `__ftol` and byte
storage. With width `f32(1/3)` and coordinate `1`, installed X is `3` but Z is
`2`; the port preserves this asymmetry.

FindFacesInBox converts real minimum and maximum, decrements each nonzero lower
index, and increments each upper index only when the next column is below the
byte count. Both resulting ranges are inclusive. Out-of-track queries clamp to
edge columns, then receive the same one-column expansion.

Traversal is X outer / Z inner over actual `columns[z][x].actor_0x0`, skipping
NULL slots. Each call supplies:

- inherited MODEL NULL;
- inherited MAT `gBlack_material` (`6b5a20`), not the default-track MAT;
- `pMat` NULL, not a non-NULL identity matrix;
- remaining capacity and the existing output prefix;
- the caller's actual world callbacks and model-emission global.

The output pointer advances by the native 80-byte record stride. Capacity zero
does **not** terminate traversal: ActorBoxPick still performs applicable bounds
tests and pull callbacks, and its MODEL picker receives zero capacity. MODEL
emission precedes child traversal. Numeric `&` actors retain the released
two-bounds-test/pull behavior; transformed emission retains actual stop-GROOVE
notifications. No independent callback is synthesized by this orchestration.

After all columns, the native function reads `gAdditional_actors` (`6b5760`) and
picks that single actual container if non-NULL. Its linked child pointer order
is authoritative; there is no alphabetic or insertion-index sorting. The module
borrows the container and current child topology. Global `gPling_face` is not
cleared here: the delegated ModelPick adapter requires its actual write outlet
when literal material names start `!`, and an empty query retains prior state.

## Integration contract

`nativeFindFacesQuery(bounds,matrix)` and `nativeFindFacesColumnRange(query,layout)`
are separately available for numerical callers. `findNativeFacesInBox(input)`
returns the query, expanded range, ordered rows and remaining capacity. A missing
provider produces `resolved:false` with the already emitted prefix; that prefix
must not be used as a complete query.

`createNativeFindFacesProviders(resolveModel,modelPickOptions)` connects actual
MODEL identities to `NativeTrackModelResource`, unwraps `nativeTrackRawBounds`,
and delegates emission to `createNativeModelPickEmitter`. Resources must already
have their current prepared revision. Multi-material native pointer order is
still an explicit provider; there is no heap-rank/name fallback or lazy prepare.

The production host must supply actual column actors (for released extracted
columns, each non-NULL entry's `wrapper`), the additional root, actual retained
layout fields, actual black MAT identity, and known-NULL/known-present callbacks.
Do not use renderer fallback materials or render geometry bounds. The grid
counts/sizes are validated for the supported nonzero byte-count track layout;
malformed or overflowed inputs fail explicitly rather than indexing arbitrary
storage. The generic provider interface allows explicit capture tests as well as
the concrete prepared-resource adapter.

This module does not reconstruct ExtractColumns grid allocation, callback-driven
changes to global root pointers, original MAT heap addresses, or body cache
scheduling. In particular, supplying a retained layout avoids substituting the
rec2 source's extra-room formula without independently resolving the installed
loader arithmetic. Production integration remains the root agent's ownership.

## Validation

Focused tests cover literal installed bounds/converter captures, grouped-addition
and radius rounding, expansion, X/Z order, MODEL/child order, absolute output
indices across calls, capacity-zero/later pull callbacks, stop callbacks,
additional-root order, inherited black MAT, retained pling state, stale prepared
revision and invalid providers. Optional Stock and Advanced Newcity tests each
read eight original prepared one-MAT MODEL resources and verify real source face
prefixes under explicitly invented column placement and capture fallback MAT.
They do not claim to recover the original Windows material heap or full track
column placement.

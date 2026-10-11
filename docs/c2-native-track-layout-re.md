# Installed initial track layout and actor bounds

## Evidence and implemented scope

`src/native-track-layout.ts` independently implements the initial portion of
ExtractColumns and the installed BrActorToBounds traversal. Capture occurs
before ProcessModels, face migration, FindNonCars or raw-slot compaction. The
module returns detached bounds/layout metadata; it does not allocate/register
columns, mutate noncars, infer renderer bounds or claim to provide the complete
production collision collector.

The original HW executable was read only. PE32/i386 image base is `0x400000`,
entry is `0x577eb0`, SHA-256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
rec2 `common/brucetrk.c` and `brender/core/v1db/actsupt.c` supplied the symbol
map; installed instructions take precedence. No reference implementation was
copied.

| Installed address            | Meaning                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `40cc50..40cdc4`             | ExtractColumns header, initial bounds and layout fields |
| `40cdc7..40ce58`             | Column/raw noncar slot allocation                       |
| `40ce71`                     | ProcessModels child enumeration after initial capture   |
| `51e160..51e1ff`             | BrActorToBounds                                         |
| `51e200..51e336`             | Recursive ActorToBounds                                 |
| `51e28a..51e2bb`             | MODEL bounds transformation with sequential stores      |
| `5311a0`, `532d40`, `531c60` | PreTransform, Pre and matrix multiplication             |
| `531e00`                     | Set matrix identity                                     |
| `79c958`                     | Actual `v1db.default_model` pointer                     |
| `79c500`                     | Temporary `v1db.model_to_view` matrix                   |

The bounds functions were executed in a private read-only PE mapping with native
CRT initialization (`5798e0`, 53-bit precision). All 102 invented three-actor
packets matched the port. Six additional whole-tree captures used original
Stock/Advanced ACT topology and independently supplied raw MODEL bounds. The
private aggregate bounds outputs match the original-installation tests exactly.
Generated actor/model packets remain under `/tmp`; no proprietary fixtures were
added to the repository.

## Header and raw counts

ExtractColumns reads the actual `track.the_actor->identifier`; it does not search
descendants for a PP actor or choose a renderer node. For the six audited tracks,
the ACT file contains one top-level PP root with an identity matrix.

If the name begins uppercase `PP`, installed code checks **byte 3 only** for
`'1'` and starts parsing at byte 5. Byte 2 is not checked. Other PP versions take
the fatal wrong-track-format path (`40cc7e..40ccdd`). The scanner format at
`58e51c` is `%u%u%f%d`. Four conversions retain X/Z unsigned32 counts, Float32
extra room and signed32 raw noncar count. The native stored column counts are
their low bytes, not the raw unsigned integers.

Exactly three conversions take the ancient-preprocessor BrFailure branch
(`40cd32..40cd3c`). Fewer conversions take the one-column fallback: counts 1/1,
room 0, raw noncar count 0; no ProcessModels callbacks run. A non-PP numeric name
can still take the four-conversion path. Native `%u` sign handling and byte casts
are retained, including `257 -> 1` and `-1 -> uint32(0xffffffff) -> byte255`.
Zero stored dimensions are an explicit unsafe-input error in the independent
port rather than a division by zero/allocation error.

Before compaction, native globals retain raw count and capacity `rawCount+250`
(`40ce2d..40ce58`). The returned header keeps these values independently of the
later AssertNonCars survivor count. Negative signed counts and overflowing
four-byte slot allocations are explicit bounds-safe errors. The header parser
supports original decimal tokens and complete decimal exponent forms. Integer
overflow, nonfinite Float32 values and malformed exponents are explicit errors;
no claim is made to emulate every malformed-string/locale edge of the native
CRT. A direct private sscanf probe required additional Windows CRT setup and
did not provide conformance evidence; the grammar evidence here is the installed
format/caller branch, ordinary decimal conversion semantics and original files.

## BrActorToBounds semantics

The installed entry saves the prior global model-to-view matrix and chooses the
root's **local** MODEL if non-NULL, otherwise `v1db.default_model`. It then writes
identity to model-to-view. The root's local transform, parent transform, render
style, MAT and BOUNDS resource are not applied.

- A type1/MODEL root copies the chosen MODEL's raw bounds directly.
- Any other root initializes min to `+FLT_MAX` and max to `-FLT_MAX`.
- Children are visited in actual linked pointer order.

Each descendant overrides the inherited MODEL only when its own local MODEL is
non-NULL. Every descendant's local transform is premultiplied onto the current
matrix, regardless of its identifier, type or render style. Only type1 emits a
MODEL box into the union. Every type traverses its children. In particular,
**type5 authored BOUNDS do not prune or emit a box** in this traversal, and
render_style1 does not hide a subtree from the initial layout bounds. MATs have
no role. These rules differ from ActorBoxPick and renderer traversal.

Transforming a MODEL box initializes both extrema to the stored accumulated
translation. For each output axis, source row0, row1, row2 are processed in order.
Let `a=basis*min` and `b=basis*max`; these products stay live, without a Float32
spill. The smaller is added to the current minimum and the larger to maximum,
each followed by a Float32 store. The `a<b` test is strict, including equality's
else branch. This operation differs from both FillInBounds grouped additions
and GetNewBoundingBox extent products. For example, invented inputs
`min=max=1.5`, basis `f32(.1)` and translation `-f32(.15)` yield
`-3.725290298461914e-9`; spilling the product first incorrectly yields zero.

The independent traversal consumes already-converted native12 matrices from
NativeOrderedActor and the verified multiplication helper. No general inverse,
Three Box3, prepared vertex subset or MAT-derived render geometry is used.
Empty non-MODEL subtrees retain the native FLT_MAX sentinels in the bounds helper;
the layout constructor explicitly rejects them as a finite usable grid.
Custom/empty MODEL bounds remain explicit provider requirements.

The default MODEL is an actual BRender-owned resource pointer, not a unit cube or
renderer fallback. It can remain unresolved until a type1 branch actually uses
it. Stock and Advanced Newcity1, Carrier1 and Airport1 have respectively
1346/343/999 type1 actors and **zero** type1 branches requiring this fallback.
Their non-MODEL PP roots load the pointer but all contributing descendants
override it. The source adapter may therefore pass an unresolved default for
these tracks safely; a future track requiring it returns a provider diagnostic.

## Layout chronology and equations

Bounds are captured at `40cd5d`, **before** any ProcessModels/FindNonCars mutation.
`40cd62..40cdc4` then computes, with live 53-bit arithmetic and final Float32
stores:

```text
columnSizeX = f32((maxX - minX - 2*extraRoom) / storedCountX)
columnSizeZ = f32((maxZ - minZ - 2*extraRoom) / storedCountZ)
originX = f32(minX - extraRoom)
originZ = f32(minZ - extraRoom)
```

The width equation uses **minus** doubled room in the installed image; rec2's
reconstructed plus sign is contradicted by `fsub st,st(1)` at `40cd81/40cda6`.
The doubled term remains live through both width calculations. Widths must be
finite and positive for the supported host layout. The immutable snapshot must
not be replaced by bounds recomputed after accessory normalization, X+2000
undersize shifts, face migration, destruction, rendering or animation.

Native allocation then creates the Z row-pointer array, each X row of 12-byte
track squares, and raw noncar pointer storage. Four-conversion tracks enumerate
ProcessModels children; fallback assigns the actual root as column[0][0]. These
allocation/mutation operations remain in the existing actor-order/actor-load
host integration; returning layout metadata does not claim they happened.

## Integration API and validation

`parseNativeTrackLayoutHeader(name)` exposes the pre-compaction header.
`nativeTrackActorBounds(root,{defaultModel,modelBounds})` computes a detached
snapshot. `extractNativeTrackLayout(root,providers)` returns initial bounds,
MODEL actor count, header and `NativeFindFacesLayout`.

The host should construct actual NativeOrderedActor topology/resource bindings
from original source ACT nodes and original MODEL identities, then capture
layout before actor-load mutations. `modelBounds` can directly unwrap
`nativeRawModelBounds(originalModel.flags,originalPositions)`; this requires no
fabricated MODEL resource, MAT resolution or preparation. The optional
`createNativeTrackLayoutBoundsProvider` delegates actual
NativeTrackModelResource identities to `nativeTrackRawBounds`. Source MODEL
flags400 or empty allocations require their retained bounds instead of guessed
geometry. The copied result remains stable as later actor matrices/models mutate.

Tests cover header/version/conversion branches, byte casts, unsafe allocation,
root-ignore/render-ignore/type5 behavior, MODEL inheritance/default ownership,
matrix/product/store chronology, source minus-room widths, snapshot retention,
custom/empty metadata and cycles. Six original Stock/Advanced tests read actual
Newcity1/Carrier1/Airport1 ACT/DAT resources and compare whole-tree installed
captures; absence skips cleanly. Remaining production gaps concern source actor
loading/preparation, world callbacks and face-cache consumers, not this initial
bounds/layout arithmetic.

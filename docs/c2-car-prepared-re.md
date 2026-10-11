# Car prepared vertices and smoke attachment

## Evidence and scope

Installed, read-only `carma2_HW.exe` SHA-256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32, image base `0x400000`, entry `0x577eb0`, October 18, 1998.
`madebr/rec2` maps symbols, structures and loader fields. Its BRender addresses
differ from this executable; the addresses below are verified installed addresses.
The implementation is independent; no reference implementation code or original
asset contents are incorporated.

`src/car-smoke.ts` captures native DONT_WELD vertex ordering before deformation
and samples live browser positions. It also implements the principal ACT
translation and optional local-player cockpit attachment adjustment.

## Preparation and first group

The installed car loader at `0x48a349–0x48a382` sets model flags `0x83`
(DONT_WELD, KEEP_ORIGINAL, UPDATEABLE), then calls BrModelUpdate `0x51ef90`.
Owner index `0x62` and austerity mode take the separate flags-clearing branch;
this port targets ordinary editable car models, not that alternate welding mode.
Rec2 `loading.c` SetModelFlags and `prepmesh.c` identify the flags and algorithm.

Installed preparation chooses DONT_WELD comparator `0x520030` at
`0x51f481–0x51f499`. That comparator compares **unsigned resolved material
pointers**, then the original unsigned 16-bit vertex index, then the three
**unnormalized** temporary smoothing sums. Faces independently sort by material
pointer at `0x51fe80`. Neither comparator sorts alphabetically or by DAT material
ordinal, Three material ID, or first face occurrence.

Temporary corner records contain three Float32 normal components and unsigned
16-bit source vertex/face IDs. Prepared vertices have a **32-byte float layout**:
XYZ at offsets 0/4/8, UV at 12/16, normalized XYZ normal at 20/24/28. These
normals are not packed integer normals. CopyVertex `0x5202a0` normalizes only
**after** comparison and distinct-vertex counting. Normalized browser normals
therefore cannot recover native split cardinality or order.

Smoothing first sorts all corners by exact source XYZ at `0x51fea0`, including
coincident vertices with different source IDs. Installed `0x5200d0` accumulates
face normals when masks overlap or the corner is itself; every component addition
spills to Float32. Mask zero becomes `0xffff` when loading the modern face chunk.
The optional crease routine `0x520190` additionally requires a strict face-normal
dot product greater than the source crease cosine, except for the corner itself.
The port accepts an explicit cosine rather than inferring an angle absent from
browser geometry metadata.

BrPlaneEquation `0x5365f0` forms and normalizes the triangle cross product. Its
zero-length branch `0x5366bb–0x5366ef` supplies `(0,0,1)`. The subsequent fraction
clamp stores components below -1 as `-0.9999998807907104` and components at/above
1 as 1. Components exactly -1 remain -1. JavaScript models Float32 stores but
not every intermediate x87 extended-precision operation.

The installed BrQsort wrapper `0x527a50` calls CRT qsort `0x575aa0`.
The independently reconstructed ordering uses its middle-element pivot,
less/equal and greater/equal scans, and first-strict-maximum selection for
partitions of at most eight records. A JavaScript stable sort would change
Float32 smoothing accumulation order among coincident corners.

DAT material zero resolves to the native null face material. An inherited ACT
material does not replace that pointer in model preparation. Thus its group is
first regardless of native allocation addresses. When positive materials are
resolved, their relative address order remains unavailable to the browser.
A provided native pointer map supports the full ordering and same-pointer aliases.
Otherwise, positive groups retain browser first-occurrence order and the result
explicitly reports `browser-positive-material-approximation`. A model without
null faces also reports `browser-first-approximation` for its first group.

## Contiguous allocation, including indices past group zero

PrepareGroups allocates one contiguous prepared vertex array, then assigns
`groups[0].vertices` to its base. Later groups point farther into that same array;
rec2 `prepmesh.c` documents the layout, matching installed preparation.
DoSmokeColumn `0x4fbef7–0x4fbf35` indexes this base as `vertexIndex*32`.
It does **not** compare the selected index with `groups[0].nvertices`.

This matters for ordinary wrecks: CheckDamage `0x43f7de–0x43f80f` supplies raw
random indices 0..11. CreateSmokeColumn `0x4fb620` retains that index and the
column allocator stores it at `0x4fb5d0`. These are not fire_vertex table lookups.
The separate random fire_vertex lookup at `0x4fb66e` only supplies the no-op
SmudgeCar call and still consumes its own random draw.

The sampler therefore captures **all contiguous prepared groups**, with
`firstGroupCount` available separately. Original read-only data exercises:

| Car    | Principal DAT | Null faces | First-group prepared vertices |
| ------ | ------------- | ---------: | ----------------------------: |
| Eagle  | EAGLENEW.DAT  |          4 |                             6 |
| Buggy  | BEACH.DAT     |          1 |                             3 |
| Copcar | MEDIA.DAT     |         10 |                            26 |

All three browser first-face groups originally use a positive material. Null-first
selection corrects that prefix. Raw wreck indices beyond the exact prefix still
need native positive-material pointer order for full native correspondence;
no allocation order is guessed from material names or loading chronology.

## Mode-1 attachment and cockpit adjustment

DoSmokeColumn `0x4fbee0–0x4fbf41` reads the car's principal car_actor model, its
prepared group-zero base, and the chosen vertex. It adds only car_actor ACT
translation at actor offsets `0x50/0x54/0x58`, storing Float32 XYZ.
It does not ordinarily apply the principal actor basis, mesh-child transform,
or parent-chain scale to this intermediate point.

The column's independent actor/master transform is applied later at
`0x4fc039–0x4fc04b`, followed by its world Y subtraction. The sampler returns
the intermediate local point; SmokeSystem retains responsibility for that final
transform, upright/inverted source-height selection, split-half eligibility,
and the final Y subtraction.

Global `0x7590ec` is `program_state.cockpit_on`, as its initialization writer
`0x503985–0x50398d` and rec2 `structur.c` show. It is not an Eagle-specific tail
flag. With cockpit enabled and driver exactly 8, installed `0x4fbfcd–0x4fc014`
compares the translated point Z with `driver_z_offset - double(-.2)`:

- Strictly smaller Z: replace the intermediate point by the raw prepared vertex
  transformed with the complete principal car_actor ACT.
- Equal/larger Z: subtract double `.07` from intermediate Y and store Float32.

Other drivers and cockpit-off retain translation-only attachment. The port's
optional live cockpit provider supplies enabled, driver, and driverZOffset.
The application binds it to the selected cockpit camera, local/opponent driver
and the parsed original car TXT head offset.

LoadCar reads driver XYZ from the **first nonempty data line after**
`START OF DRIVABLE STUFF` in the resolution-independent car TXT. Its variable
2D cockpit/hands fields come from a separate file. Rec2 `loading.c` asserts
`driver_x_offset` at `0x47c`; adjacent Y/Z are `0x480/0x484`.
`parseNativeDriverZOffset` strictly validates that triplet and returns its stored
Float32 Z, or undefined. It does not substitute a bounds/COM-derived coordinate.

## Integration and limitations

Capture the sampler before crush and pass its live sample callback to mode-1
columns. Supply the principal model ACT if the mesh's parent is not the matching
native car_actor proxy. The existing two-argument call remains compatible.
Prepared source IDs/order remain stable across position-only model updates;
each sample reads the current render buffer.

Geometry with sourceFaces/sourcePositions/sourceVertexIndices uses preparation
reconstruction. Geometry lacking those data retains an explicitly diagnosed
render-only approximation. Missing native positive-material addresses remain
an ordering limitation. The current DAT reader does not retain source model
pivot/crease metadata; explicit sampler pivot/cosine providers are supported.
APC/austerity welding is outside this DONT_WELD path. Exact x87 intermediate
rounding and initial resource allocator addresses have not been reproduced.

Focused tests cover null-first and contiguous groups, identical normalized
normals with distinct smoothing sums, pointer aliases, live deformation,
translation-only principal transforms, cockpit gates, strict TXT validation,
and original Eagle/Buggy/Copcar. Original-installation tests skip cleanly when
assets are absent.

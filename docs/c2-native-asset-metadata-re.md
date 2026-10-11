# Native asset metadata retention

The DAT reader retains a model's optional native pivot from chunk `0x15`
(`DF_CHUNKID_PIVOT`). The chunk payload is three big-endian BRender scalars in
X/Y/Z order. In the installed x86 format each scalar is Float32, so this reader
requires exactly 12 payload bytes and finite values. Duplicate pivots and pivots
outside a model are rejected. If no pivot chunk is present, the render geometry
stores `[0, 0, 0]` as `userData.c2Pivot`. Geometry positions and renderer behavior
are unchanged.

Every ACT actor object's `userData` retains the raw native actor type,
render-style byte, identifier, and its zero-based sibling ordinal as
`c2ActorType`, `c2ActorRenderStyle`, `c2ActorName`, and `c2ActorChildIndex`.
These values preserve DEFAULT style (`0`) separately from explicit FACES (`4`)
while existing effective-style inheritance and mesh creation remain unchanged.
Existing `Object3D.name`, local matrix, inherited material and child ordering
continue to represent the scene hierarchy.

The scene now also exposes `sourceActors`: authored parsed ACT roots before
renderer defaults or native column/model mutations. Collector consumers build
separate mutable native linked lists; they must not mutate these source records.
Per-actor metadata retains `c2ActorLocalModelName` and
`c2ActorLocalMaterialName` independently of effective render inheritance, with
explicit NULL when no local binding exists. `c2ActorBounds` clones the six local
BOUNDS components without inferring a mesh union. [Bounds evidence](c2-actor-bounds-re.md)
records the original chunk attachment and validation. Stock/Advanced Newcity
source-tree tests verify this metadata throughout all authored actors, including
the 211 bounds records in each scene.

`sourceMaterials` exposes the authored MAT resource table separately from Three
materials. Its normalized lookup and last-loaded replacement match the existing
scene material lookup. Raw flags, identifiers and source object identities remain
available even when renderer defaults are applied. This does not assign or prove
Windows heap pointer ordering. Stock/Advanced car and Newcity tests compare every
returned source MAT with the parsed source libraries and verify distinct render
object identities.

## Evidence and limits

The public `madebr/rec2` BRender map identifies `DF_CHUNKID_PIVOT = 21` in
`src/brender/core/fw/datafile.h` and three `DF_TYPE_BR_SCALAR` pivot fields in
`src/brender/core/v1db/v1dbfile.c`. Its license is GPL-3.0; it was consulted as
a format reference, and no code was copied.

A read-only inventory of the 111 unpacked `.dat` files beneath
`carma2_orig/{data,adv_data}` found no pivot chunks. It does not include DAT
members held inside TWT archives, so this result makes no claim about every
asset in the installation and yields no installed nonzero-pivot example.
Representative scanned files included Advanced AcidReign (176 models) and
Advanced 69MACH1 (53 models); both use tags `0`, `22`, `23`, `24`, `26`, `53`,
and `54` without tag `21`.

The parser's exact-length and finite-value checks are defensive host validation.
The reference BRender pivot reader consumes the three scalar fields into the
current model but does not itself validate the chunk length or scalar finiteness.

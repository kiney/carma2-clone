# Pre-batch world source metadata

`captureWorldSource` records ACT and render-triangle identity before static
world batching. It retains the source `Object3D` and mesh references, ordered
ACT child paths, model names, material-group ordinals, original DAT face
indices/metadata where recoverable, and tile coordinates inherited from ACT
identifiers such as `"3 2"`. These references survive later reparenting or
disposal of the source hierarchy; the frozen metadata is a snapshot, while the
original objects themselves are intentionally not cloned or mutated.

For a track root named `PP01 nx nz extraRoom ...`, the snapshot computes column
origin and dimensions from the source world bounds using the rec2 `ExtractColumns`
formula: `sizeX = (maxX - minX + 2 * extraRoom) / nx`, likewise for Z, and
`origin = min - extraRoom`. Stock and Advanced Newcity1 both expose
`PP01 16 16 1.000 1126` and numbered tile ACT identifiers. The trailing PP01
count is preserved in the identifier but is not interpreted as a column field.
The original `ExtractColumns` fallback also accepts a non-PP root without four
column fields as a 1x1 grid with zero extra room; a non-PP root with all four
fields retains those explicit values. A PP-prefixed root whose fourth identifier
character is not `1` is rejected by the original fatal branch, and the obsolete
three-field form is rejected by the original failure branch.

## Limits

The snapshot does **not** claim BRender prepared model group/face ordering.
`createModelGeometry` stores original `sourceFaces`, but render indices are
reordered into groups by material insertion order. C2 `ModelPickBox` consumes
prepared groups and faces. Reproducing that order needs the native preparation
mapping (including its group ordering and `face_user` source indices), which is
not represented by current render metadata. `preparedGroupIndex` is therefore
explicitly null and `preparedGroupOrderResolved` false.

The main race loader captures this metadata before batching, and `WorldCollision`
uses its unique original mesh references to build and rebuild static surfaces.
Retained actors therefore keep live transforms and smash/dynamic eligibility;
surface records retain their original ACT and DAT metadata. Mirrored actors
preserve the same winding and edge-bit exchange as the previous render-batch
collision path. Tests exercise retained movement, smash removal and dynamic
exclusion across rebuilding. This fixes metadata loss without claiming native
prepared ordering.

Later-created live meshes join static collection separately; explicitly tagged
GPU batches do not duplicate the original faces. All material-triggered mutable
UV-tile/decal actors now remain unbatched, including texturechange cases. An
Airport regression demonstrated why this matters: collision on an unrendered
original MODEL could no longer modify the visible material batch. Retaining the
actual actor keeps collision, queue changes and rendering on the same geometry.
The production Airport check now targets the source mesh at the prescribed
impact point rather than a GPU batch name or the first material match. It
verifies the original `airhut_smash` tile, passthrough/solid faces, type9
contacts and finite supported motion; the broader mine/oil/lift/Snow/pedestrian
regression suite passes without reported console/network/WebGL errors.
After clipping/replacement creates a new geometry, old DAT face indices are
not attached to its new face records. Original actor ownership stays live.

ACT traversal paths currently describe the browser loader's append order.
Installed `BrActorAdd51d620` uses `BrSimpleAddHead529090`; native child-file
loading therefore prepends siblings, and later column relinking changes that
order further. Neither this snapshot nor render material order is proof of
the final native linked traversal. The installed unstable prepared-face sort
is separately reconstructed in [prepared order](c2-prepared-face-order-re.md).

The cache collectors still need to
consume an ordered column/ACT candidate traversal before applying clipping and
capacity. Additional actors, passthrough faces that consume capacity, and
drivable-object ordering remain separate compatibility work.

Evidence: original Newcity ACT metadata was read from the local Stock and
Advanced installations. Column sizing and tree traversal are mapped from
rec2's `brucetrk.c` / `finteray.c`; they are reconstruction evidence, not a
claim that this snapshot implements the native collector.

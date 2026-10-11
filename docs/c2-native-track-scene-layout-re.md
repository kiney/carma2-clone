# Initial native track layout in the live scene

`captureNativeTrackSceneLayout` binds authored ACT references to the actual DAT
objects returned by `Assets.scene`. It builds the installed child-list order and
calls the independently reconstructed initial `BrActorToBounds`/`ExtractColumns`
helpers. Ordinary raw MODEL bounds do not require MAT allocation order or prepared
face groups. The DAT positions include unused vertices and are not shifted by the
pivot. Effective track flags preserve custom-bounds ownership as unresolved.

`main.ts` captures this snapshot immediately after loading the track, before
model migration, GROOVE preparation, noncar construction or static batching.
`captureWorldSource` receives the retained initial bounds, origin and column
widths. Its `columns.boundsSource` distinguishes `native-initial-act` from the
explicit `renderer-fallback` used by standalone render-only consumers. A missing
MODEL/default/custom-bounds owner produces a compatibility warning in the live
loader instead of silently claiming native bounds. Invalid headers retain the
native fatal branch and safe parser errors.

The installed width expression subtracts twice the extra-room value; it must not
be replaced by the earlier renderer-based expression adding it. Source ACT
identity uses the same loaded resource-key normalization as `Assets`; identifiers
such as `&02lamp.act` can reference a DAT MODEL under the normalized key. This
binding does not fabricate a heap address, MAT rank or prepared MODEL identity.

Tests cover ignored root translation/render style, unused vertices, pivot
retention, copied initial bounds after geometry changes, unresolved resources,
and Stock/Advanced Newcity1, Carrier1 and Airport1. The renderer face crosswalk is
captured separately and continues to reference its actual meshes.

This change corrects live retained column metadata. Production collision and
pedestrian collectors still need the complete mutated native column tree,
additional ACT root, black MAT and prepared material-group owner before they can
use `findNativeFacesInBox` without an approximation. It does not claim that the
existing renderer-based world collector now has native capped-face ordering.

See [initial layout evidence](c2-native-track-layout-re.md),
[face orchestration](c2-native-find-faces-re.md) and
[asset identity metadata](c2-native-asset-metadata-re.md).

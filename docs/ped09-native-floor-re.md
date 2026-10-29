# Native pedestrian falling-floor query

`findNativePedFloorBelow` implements the single `FindYVerticallyBelow` used by
the ordinary falling-death score. It does not use `WorldCollision.height` or
the retrying `FindYVerticallyBelow2` wrapper.

Evidence was checked against the installed read-only HW executable, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
`madebr/rec2`'s `common/raycast.c` provided the function map. Its callback and
facing predicates differ from the installed binary, so the installed branches
take precedence here.

## Verified behavior

- `InitRayCasting` (`0x4e3420`) creates an unparented downward-facing camera.
  `FindYVerticallyBelow` (`0x4e4130..0x4e432c`) copies the supplied position
  without a height offset, resets the highest result to `-FLT_MAX`, then visits
  the clipped 3×3 track-column neighborhood in X-major order. It does not append
  additional actors, detached actors, or a global-root fallback. The camera's
  unparented `DRActorToRoot` path does not accumulate the candidate root's
  ancestors.
- `ActorPick2D` (`0x4e3600`) inherits MODEL and MAT identities, skips complete
  subtrees with render style 1, uses arbitrary affine inversion, and visits
  actual linked children. BOUNDS types 5 and 6 gate their children. MODEL bounds
  use `PickBoundsTestRay` (`0x4e37f0`), initial interval `[0, FLT_MAX]`, and
  parallel threshold `2^-22`; the camera's nominal yon value does not truncate
  this interval. The positive reciprocal has a Float32 spill, whereas the
  negative reciprocal stays live.
- The actor callback (`0x4e4330`) excludes exactly the current player's ACT's
  MODEL callback. Its children remain traversable. The host may supply either
  the actual native ACT identity or its actual mapped render object.
- `DRModelPick2D` (`0x4e3b50`) uses prepared MODEL group/face order, the group's
  first material pointer or inherited material, near minus `.001f`, far plus
  `.001f`, an unconditional `abs(incidence) < 2^-22` rejection, and material
  flags `0x1800` to permit either facing. It uses the native division-overflow
  guard and inclusive dominant-plane barycentric triangle admission. No
  minimum world-Y normal, physics face flag, or collision-mode filter occurs.
- The polygon callback (`0x4e4370..0x4e43b0`) accepts NULL materials and NULL
  identifiers. It rejects only identifiers beginning `!` or `>`; `?` is
  accepted. It compares the hit point's **MODEL-local Y** directly and stores
  only a strictly greater result. It does not transform this value into world
  space. Equal-height ties retain the first native face.
- `FindYVerticallyBelow2` (`0x4e43c0`) separately retries with `.2f` increments
  and a `-100` test. Those retries are absent from this helper and the ordinary
  falling-score caller.

## Host boundary and numerical limits

The helper consumes `NativeWorldScene`'s real mutable ACT/resource owners.
`prepareActors` lets the host synchronize current transforms and prepared
geometry before traversal. Missing inherited metadata, current resource
ownership, prepared publication, or invertible transforms is an explicit
provider diagnostic; no replacement floor is introduced. The caller must not
interpret an incomplete result as a complete no-hit proof.

Native Float32 storage points, thresholds, order, and the local-Y quirk are
retained. The centered downward ray is expressed directly in MODEL coordinates
instead of constructing and canceling the camera's X/Y field-of-view scale.
General affine inversion uses the existing Three.js matrix implementation and
JavaScript double intermediates; this does not claim bit-identical x87 extended
precision for pathological near-singular transforms or triangle-edge cases.

## Validation

The focused test module covers no-hit and deep floors, source material/facing
filters, steep floors, zero ceiling offset, inclusive edges, candidate/group
ordering, affine transforms and local Y, inheritance, player exclusion, native
bounds/render-style gates, missing providers, and publication synchronization.
Optional original-installation coverage parses three actual Newcity prepared
floor MODEL resources from each of Stock and Advanced without committing any
original-derived fixtures.

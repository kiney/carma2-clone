# Installed ActorBoxPick traversal kernel

`src/native-actor-pick.ts` independently implements installed `ActorBoxPick`,
`45fdc0..460487`, on stable `NativeOrderedActor` linked records. It preserves
MODEL-before-children traversal, local NULL resource inheritance, raw render-style
pruning, authored BOUNDS admission and the identifier-dependent native transform
path. MODEL bounds, prepared-face emission and optional world callbacks are
explicit host inputs. No Three traversal, material-name ordering or generic inverse
is substituted.

## Evidence and scope

Installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Original files were read only. Private probes mapped the executable into process
memory and, for traversal probes, replaced only the private emission call with a
synthetic recorder. No binary/model contents are shipped. rec2 `common/finteray.c`
and BRender matrix code were symbol/structure maps, not copied implementations.

| Installed address | Verified role                                                                  |
| ----------------- | ------------------------------------------------------------------------------ |
| `45fdc0..45fe1b`  | Local MODEL/MAT fallback; raw style-1 early return                             |
| `45fe1e..45fe59`  | Only `&` identifiers transform; effective MODEL required; leaf MODEL type gate |
| `45fe5f..4601ed`  | Inlined leaf transformed-bound rejection, X/Z/Y order                          |
| `4601f0..4602b7`  | pMat accumulation, LP inverse and query rebase                                 |
| `4602ba..460337`  | `&digit` additional effective/own MODEL bounds gates                           |
| `460337..460362`  | Optional pull callback (`callbacks+10`), non-NULL return prunes                |
| `46036d..46038e`  | Raw type-5/6 authored BOUNDS child admission                                   |
| `4603bf..4603e3`  | Save child next before recursion; retain remaining capacity                    |
| `4603f4..460452`  | MODEL availability, global emission gate, bounds overlap, ModelPickBox call    |
| `460457..460480`  | Non-NULL pMat and actual emitted rows trigger stop callback (`callbacks+14`)   |
| `425b00..425bf9`  | Inclusive finite bounds overlap                                                |
| `531c60..531df3`  | Native matrix multiplication and individual live sum associations              |
| `5324f0..53259e`  | LP basis transpose and negative translated dot products                        |
| `532ae0..532b50`  | Native point application                                                       |
| `45fab0..45fb82`  | Stored transformed bounding box                                                |

The rec2 `ActorBoxPick` annotation `45f8c0` differs from this installed image.
Installed branches and instructions take precedence.

## API and host responsibilities

`pickNativeActorBox<Row>(input)` takes:

- one actual linked actor subtree;
- a native query containing box-to-current matrix, original box-local bounds,
  current-frame real bounds, current-frame center and source radius;
- explicit known/NULL/unresolved inherited MODEL/MAT bindings;
- `pMat:null` or an actual native accumulated matrix;
- finite nonnegative signed-int capacity and explicit `emitModels` global state;
- an explicit known/NULL/unresolved world-callback table;
- `modelBounds(model)` and `emitModel(emissionInput)` providers.

`emitModels` is the source `gActorBoxPick_StopGroovidelics` global, not an inferred
renderer visibility property. False skips MODEL emission but retains child traversal
and the earlier `&`/bounds/pull behavior. A known NULL callback table means native
NULL; absent functions on a known table mean NULL function pointers.

The emission callback receives the actual cached effective MODEL/MAT identities,
query, pMat, remaining capacity and output offset. It owns exact ModelPickBox
prepared-group/face ordering, finite face clipping, material selection and cached
record generation. Its rows must not exceed remaining capacity. Unresolved output
stops traversal and retains earlier rows/capacity for inspection; the caller must
not treat that partial result as a complete source prefix. Nothing silently omits
an unknown MODEL/material or fabricates a prepared order.

Matrices, vectors and bounds must be finite before and after Float32 storage.
Reversed bounds, nonfinite/overflowing scalar data, cycles and excessive provider
emission fail explicitly. The standalone overlap primitive returns false for
nonfinite bounds, matching the native finite gate. Input validation is a host
safety boundary, not an emulation of dereferencing corrupt native pointers.

## Traversal and ownership

Known local NULL MODEL/MAT inherits the supplied parent pointer. Unknown local
identity remains unknown; it does not fall back. The kernel delays reporting a
missing identity until the branch actually needs it. For example, raw style 1
prunes an unresolved MODEL and all children without requiring unused geometry.

For type MODEL (1), a NULL effective MODEL returns immediately, including before
children. Otherwise the global gate and inclusive effective MODEL bounds decide
whether to call emission. The MODEL is processed **before** its children. Types
BOUNDS (5) and BOUNDS_CORRECT (6) use actual actor-local authored type_data bounds
against current query real bounds; touching is accepted. Other actor types admit
children without a substituted mesh-union bound.

Child iteration uses the source saved-next rule. Callback removal/reparenting of
the current child retains the already captured sibling; a new prepended head is
not visited. Effective resource bindings remain cached for child inheritance even
if a callback replaces the current actor's local binding.

Capacity reaching zero does **not** terminate ActorBoxPick traversal. Later actors
still run gates and pull callbacks, and admitted MODELs still call ModelPickBox
with zero capacity. The emission provider must return no rows at zero. The native
ModelPickBox callee performs that emission stop; skipping later actors would lose
observable callbacks and hide unresolved source metadata.

`stopGroovidelic` is a notification, not a pruning return value. It runs only after
actual rows were appended with a non-NULL pMat. A non-NULL **identity** matrix still
qualifies. A non-NULL pull return prunes only that actor subtree and leaves remaining
capacity unchanged. The `&digit` second gate dereferences the actor's **own MODEL**,
whereas its first gate uses the effective inherited MODEL. An inherited MODEL with
missing own MODEL therefore reports `native-digit-actor-own-model-provider`, rather
than substituting the inherited bounds for an otherwise invalid native dereference.

## Identifier-dependent transform path

A local actor matrix is ignored by this query traversal unless the identifier
starts with `&`. This is a source collector behavior, not general scene-transform
inheritance. A transforming actor requires an effective MODEL even if it has
children. A childless transforming actor must have type MODEL and pass the inlined
leaf bounds test before any matrix/query rebase.

For `&` actors:

```text
new pMat = actor.localMatrix                         if old pMat is NULL
           nativeMul(actor.localMatrix, old pMat)    otherwise
inverseLocal = nativeLPInverse(actor.localMatrix)
new query.matrix = nativeMul(old query.matrix, inverseLocal)
new query.originalBounds = old originalBounds       (values retained)
new query.center = nativeApplyPoint(old center, inverseLocal)
new query.radius = old radius                       (unchanged, including scale)
new query.realBounds = nativeTransformBounds(originalBounds, new query.matrix)
```

The NULL pMat path borrows the actual local matrix array. An unmodified non-NULL
input pMat also retains its array identity; newly multiplied matrices use temporary
storage. Hosts must keep borrowed native matrix storage valid through traversal.
They must not collapse non-NULL identity to NULL. The kernel copies/validates query
scalar values into source Float32 representation, without introducing a general
world transform or radius scaling.

For `&digit`, after rebase:

1. inclusive overlap between new real bounds and effective MODEL bounds;
2. `actorToBox = nativeMul(actor.localMatrix, nativeLPInverse(old query.matrix))`;
   transform **own MODEL** bounds with actorToBox and overlap original box bounds;
3. invoke the actual optional pull callback; non-NULL return exits the subtree.

## Native matrix and bounds arithmetic

Matrices are twelve scalars: three basis rows followed by one translation row.
`nativeActorPickMultiply(A,B)` stores each output component as Float32 after its
live sum. If terms 0/1/2 mean the X/Y/Z row-product contributions, the installed
basis-cell addition orders (row-major) are:

```text
ZYX XYZ XYZ
XYZ XZY XYZ
XZY YXZ YXZ
```

Translation cell orders are `XYZ,YXZ,XYZ`, followed by B translation, then storage.
`nativeActorPickLPInverse` transposes the basis. Translation is the negated dot
between old translation and transposed basis columns; orders are `XZY,ZXY,ZXY`,
then Float32 storage. Scaled/sheared inputs use this same transpose operation.
It is explicitly **not** an arbitrary-scale mathematical inverse; no determinant,
normalization or reciprocal scale correction is introduced.

Point application uses `(Z+Y)+X+T` and final Float32 storage (the installed X output
adds Y/Z as its first pair, which has the same finite scalar result). The transformed
bounding box starts from the stored transformed minimum point. Extents are stored
Float32 `max-min`. Every extent-times-basis contribution is separately stored
Float32, then added to minimum if negative or maximum otherwise. Each addition is
stored Float32, in basis row order X, Y, Z. No all-corners extrema substitute is used.

The inlined **leaf** bounds gate differs. It stores only the three extents, retaining
a live base sum. Axis testing is X, Z, Y. X base order is `X+Y+Z+T`; Y/Z base order
is `X+Z+Y+T`. Positive/negative support contributions then add in Z,Y,X order to
that live base. Strict separated comparisons reject; equality admits. Replacing
this with overlap of a repeatedly rounded transformed AABB changes boundary cases.

MODEL bounds are a separate prepared-resource provider. Installed BrModelUpdate
`51f06f..51f0de` ordinary bounds scan **raw MODEL vertices**, not pivot-subtracted
prepared vertices. Radius `51effe..51f06c` also uses raw vertex origin lengths.
Prepared vertex pivot subtraction is separate (`51f185..51f19b` on copy update).
Custom model bounds and update flags determine whether those resource fields were
recomputed; the traversal helper cannot infer that history from render geometry.

## Validation and limits

Private installed-helper probes matched **2,000 cases / 66,000 components** for
matrix multiplication, LP inverse, point application and transformed bounds.
Inputs are seeded synthetic finite matrices, including scale/shear and cancellation;
no original geometry is retained. The installed floating-point initialization was
invoked before probes. Compact independently generated captured fixtures are tests.

A private installed ActorBoxPick probe with synthetic leaf actors matched
**18,000 near-boundary admissions** (all axes, both sides, neighboring Float32
values). Captured fixtures demonstrate live rejection where a stored transformed
AABB would admit. The private ModelPickBox replacement only records admission;
all actor gates, transforms and bounds operations remain installed instructions.

A synthetic complete linked tree matched installed order:
MODEL `&X` emission at capacity 2, stop notification, child emission at capacity 1,
child stop notification, `&1` pull at capacity 0, ordinary MODEL emission call with
capacity 0. With the global emission gate false, only the same pull occurs and
capacity stays 2. This distinguishes actor traversal from finite face emission.

Focused tests: **16 passed**, TypeScript and owned formatting passed. Stock and
Advanced original ACT tests each visit 1,346 MODEL actors and retain a 76-actor
synthetic emission prefix using actual ACT topology, authored BOUNDS and local
matrices. MODEL bounds/emission in those two tests are explicitly **MOCK providers**.
They do not claim original face migration, FindNonCars mutation, prepared model
bounds/order or a native accepted face prefix. Missing installations skip cleanly.
No world/main integration or production build occurred.

Production must supply completed native actor/column preparation, actual prepared
MODEL bounds, current resource/material identities and exact finite face emission.
Windows material pointer ranks remain unresolved where multiple keys are involved;
see `c2-prepared-face-order-re.md`. This module neither repairs that gap nor marks
current pedestrian/camera collectors source-equivalent merely by providing traversal.

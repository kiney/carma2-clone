# Native actor list and extracted column ordering

`src/native-actor-order.ts` reconstructs stable native actor records from raw
parsed ACT trees, independently of the Three scene graph. It implements child
prepend, removal, explicit-transform relink, snapshot-next enumeration, source
column wrappers and X-outer/Z-inner column pointer order. It **does not** implement
face migration, non-car/powerup preparation, material allocation order, model
preparation or the finite collision query. Those remain explicit host providers.

## Evidence

Installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Original installation and executable were read only. `madebr/rec2` was used as a
symbol/structure map; several BRender annotations differ from this installed
image. The implementation was written independently, without copying reference
implementation code.

| Installed address  | Verified operation                                                             |
| ------------------ | ------------------------------------------------------------------------------ |
| `523240`           | ACT `ADD_CHILD` pops child and calls `BrActorAdd`                              |
| `51d620`, `529090` | `BrActorAdd`, `BrSimpleAddHead`; prepend and descendant depth update           |
| `51d6b0`, `529100` | `BrActorRemove`, unlink and detached depth renumber                            |
| `51d510..51d53e`   | `BrActorEnum`, saves next at `51d526` before callback                          |
| `51d710`           | BRender actor relink, same-parent early return                                 |
| `40cc50`, `40ce71` | `ExtractColumns`, then child enumeration with `ProcessModelsCB`                |
| `40cf10..40d1dc`   | Column recognition, wrapper creation, game preparation, recursion/finalization |
| `40ca40`, `40c660` | Installed game relink and actor-to-actor transform helper                      |
| `40d530`           | `MungeFaces`; source ascending face migration and ground reprepare             |
| `40d1f0`           | `FindNonCarsCB`; separate game actor mutation/early-stop behavior              |
| `4f5210`           | `SmashFaceMustBeUpdateable`; resource-pointer eligibility                      |
| `4f5a50`           | `SetSmashableModel`, after each processed actor subtree                        |
| `4b5570..4b5701`   | `FindFacesInBox`: X outer, Z inner, then additional actors                     |
| `45fdc0..460487`   | `ActorBoxPick`: local resource fallback and linked child traversal             |
| `5232e0`, `523200` | Native BOUNDS resource read and ACTOR_BOUNDS association                       |

The relevant map files are rec2 `brender/core/v1db/actsupt.c`,
`brender/core/v1db/v1dbfile.c`, `carma2/common/brucetrk.c` and
`carma2/common/finteray.c`. Installed instruction order takes precedence over
reconstructed function annotations.

## Stable actor state and file loading

`createNativeActorOrder(rawRoots, providers)` retains every raw actor and source
root/child path. It creates one stable mutable record per raw node, copies the
native 12-scalar matrix and authored bounds, and calls prepend for each child in
file attachment order. The raw parser's append-order children consequently appear
reversed in the native linked list. Source roots stay separate; the helper does
not invent a native universe parent.

`localModel` and `localMaterial` preserve three distinct states:

- `resolved:true,value:object`: actual loaded resource identity;
- `resolved:true,value:null`: known native NULL;
- `resolved:false,requiredProvider:string`: unavailable source identity.

A missing ACT MODEL/MAT property is known NULL. A present property with no lookup
provider is unresolved, even when a renderer already has a material or mesh.
Provider-returned objects preserve identity across actors. Names and numeric ranks
are rejected as MODEL/MAT identities. Matrices and bounds are checked both before
and after Float32 storage, so finite JavaScript magnitudes that round to infinity
are rejected. Identity objects may represent host resources;
the helper does not prove their Windows pointer rank.

`resolveNativeActorInheritance(actor, inherited)` implements non-NULL local
MODEL/MAT precedence. Known NULL falls back; an unresolved local identity cannot
fall back safely. Render style remains the actor's raw byte. The query's raw
style-1 pruning is separate from renderer style inheritance. Missing type-5/6
BOUNDS produces explicit unresolved bounds, never a derived mesh/children union.

`prependNativeActor`, `removeNativeActor` and `relinkNativeActor` keep stable record
identity. Removal clears list links and renumbers the detached subtree; prepend
renumbers it beneath the new parent. Depth stores the native unsigned 16-bit value.
`previous` is a convenient previous-record representation of the original pointer-
to-link backlink, preserving the same list mutations. Invalid cyclic/shared
raw trees or list mutations fail explicitly. No traversal limit silently truncates
actors. A detached-remove no-op is a host guard, not a claim about calling native
`BrActorRemove` with an invalid NULL backlink.

`enumerateNativeActorChildren` captures the current child's next pointer **before**
the callback. Moving/removing that child therefore does not lose the next sibling;
newly prepended heads are not revisited. Nonzero callback return stops immediately.
This is also the appropriate primitive for the collector's child traversal.

## Column extraction contract and chronology

`extractNativeActorColumns(state, input)` is the explicit multi-column path.
The host supplies parsed nonzero byte dimensions, actual default-track material,
austerity state and preparation callbacks. Root PP parsing, track bounds/column
width and the expanded query range are separate. `nativeSingleActorColumn(root)`
models the source non-PP fallback without running multi-column preparation.

`ProcessModelsCB` recognizes two successive `%u` conversions, then verifies
`x<countX,z<countZ`. It enumerates root children, not the root itself. Non-column
actors recursively enumerate children and finalize after them. A recognized tile
stops recursive column recognition below that tile. Supported names preserve
whitespace/sign conversion, including adjacent signed tokens and unsigned negative
conversion; overflowing decimal magnitude beyond uint32 is explicitly rejected
rather than claiming an unverified CRT overflow behavior.

For a recognized tile the implemented sequence is:

1. Set the tile's local material to the supplied actual default-track identity;
   allocate a type-0 identity wrapper with NULL MODEL/MAT, record table `[z][x]`.
2. Prepend wrapper under the original tile parent. Obtain an explicit actor-to-
   wrapper matrix and relink the same tile record into that wrapper.
3. Select the tile itself if its local MODEL is non-NULL and austerity is false;
   otherwise select the first native linked child whose identifier does not start
   with `&`. This uses local MODEL presence, not inherited/render-model presence.
4. `prepareColumn` performs actual `MungeFaces` mutations/ground-model reprepare
   and returns an explicit optional blendy descriptor (NULL is valid). The helper
   creates that stable detached actor before the next host callback.
5. `findNonCars` performs actual non-car/powerup traversal and mutation.
6. If blendy exists, prepend it under the wrapper: children become **blendy, tile**.
   `finishBlendy` then performs native MODEL registration/reserve/full reprepare.
7. `setSmashableModel` finalizes the actor. Newly prepended wrappers are never
   recursively processed by the saved-next parent enumeration.

The source blendy ACT is allocated during `MungeFaces`; this helper receives its
explicit descriptor after that opaque host operation. A provider needing observable
allocation timing _inside_ `MungeFaces` must model it in its own operation. The
returned descriptor's MODEL resource identity is preserved; the helper does not
synthesize model geometry or claim native heap allocation chronology.

The installed column path calls game relink `40ca40`, not rec2's direct BRender
relink call. `relinkMatrix` is required for arbitrary transforms and observes the
already-attached wrapper. A narrower `identityColumnRelink:{evidence}` option is
allowed only when the tile and its freshly allocated same-parent wrapper are both
identity; original Newcity's 212 selected tiles satisfy that condition. Arbitrary
LP inverse, scale cancellation or Three matrix conversion is not guessed here.

Host success includes an evidence string; explicit unresolved results stop the
operation. Missing callbacks, named resource identity or non-NULL blendy preparation
remain required providers. Partial mutations remain inspectable on failure; no
rollback or source restart is claimed. The result must be discarded for collection
until resolved. `orderedNativeActorColumns` refuses an unresolved result.
Duplicate coordinates overwrite the table pointer in callback order, while older
wrappers/actors remain linked, matching the source assignment rather than eviction.

## Collector use and remaining gaps

`orderedNativeActorColumns(result, inclusiveRange)` visits **X outer, Z inner**.
Known empty squares are NULL and skipped. Actual query range calculation/one-column
expansion remains the host's responsibility. Additional actors follow the column
sequence in their actual supplied pointer order.

A source collector must still apply `ActorBoxPick`'s MODEL-before-children order,
raw style-1 pruning, MODEL availability, finite type-5/6 bounds admission and `&`
transform behavior. Its query starts each column with MODEL NULL, material **gBlack**
and pMat NULL. It must preserve a non-NULL identity pMat once introduced. This
helper provides resource fallback and list state, not those geometric decisions.
Neither gBlack nor gDefault_track_material is replaced with the renderer's default.

Actual `MungeFaces` eligibility compares material-resource pointers; eligible faces
are removed before model preparation and can generate a blendy MODEL. Original
DAT face arrays therefore cannot simply stand in for every final tile MODEL. Native
`FindNonCars` can normalize scaled actor bases or shift undersized actors, and its
nonzero return can stop siblings; powerup branches require their own host provider.
No production-complete migration/non-car provider is supplied by this module.

Prepared face order remains `src/native-face-order.ts`'s separate CRT permutation.
The [owned resource arena](c2-native-resource-arena-re.md) now supplies actual
live host MAT byte addresses for multi-key preparation. Its declared allocator
policy runs the recovered comparator but does not claim a particular Windows
heap's finite prefix. Names, raw DAT material indices and render first appearance
remain invalid replacements. See `docs/c2-prepared-face-order-re.md` and
`docs/c2-prepared-face-re.md` for the independent face and emission requirements.

## Validation

A private 32-bit probe called installed `BrActorAdd`, `BrActorRemove` and
`BrActorEnum` on invented zeroed records. File-like adds produced `[3,2,1]`.
During enumeration, callback 3 prepended 5 and moved 3 to another parent; visits
remained `[3,2,1]`, the old parent became `[5,2,1]`, and the new parent held `[3]`.
Moved child/grandchild depths were 1/2. The complete compact capture is retained as
safe numeric expectations; no executable bytes or original geometry are included.

Focused tests: **15 passed**; TypeScript and owned-file formatting passed.
Stock/Advanced read-only Newcity ACT+DAT tests each retain 1,688 authored actors,
211 authored BOUNDS actors and create 212 wrapper identities, yielding 1,900
records. Their preparation callbacks are explicitly MOCK callbacks with no face
migration, non-car normalization or powerup mutation. They validate source topology
and resource references only, not a production-equivalent face prefix. Both tests
skip cleanly without the installation. No production build/integration occurred.

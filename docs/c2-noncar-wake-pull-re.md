# C2 noncar wake and retained ACT repull

## Evidence and scope

Verified from installed HW, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 base `0x400000`, entry `0x577eb0`. rec2 supplies symbol/structure names;
installed instructions resolve ordering and conditions. No proprietary code
or assets are reproduced. Addresses below refer to this installed executable.

Related evidence:
[quiet-state lifecycle](c2-ped-physics-lifecycle-re.md),
[physical-slot reclaim](c2-noncar-slot-reclaim-re.md),
[persistent face cache](c2-world-face-cache-re.md), and
[connotation debris resources](c2-connotation-debris-re.md).

There are three separate owners: waking an existing registered sleeping body,
pulling an unregistered static ACT during collection, and cascading wake from
an immediately registered body. None requires a positive solved lambda.

## Existing sleeping body: geometry before lambda

`DoCollisions 0x4ba450` prepares objects, then skips primary objects whose
`ec` byte is nonzero (`0x4ba59e–0x4ba5a6`). It calls the contact collector
`0x4bac60`, whose reduced-list construction is `0x4bd5d0`, then
`FindObjectCollisions 0x4bd780` (`0x4bac88–0x4bacac`). Sleeping bodies can
be opposite candidates for an awake primary; two ordinary sleeping bodies
are not independently processed just because their bounds overlap.

Within `FindObjectCollisions`, the body/body branch first rejects
(`0x4bd8de–0x4bd955`):

- The same body.
- A pair with matching nonzero hierarchy tag `+1dc` when pointer ordering
  selects its duplicate occurrence.
- A direct parent/child pair.
- Either cross-intersection of collision filters `+1a0` and `+1a4`.
- Physics flag4 on either body.

It then calls physical contact geometry generator `0x425c00`. A zero return
skips the pair (`0x4bd965–0x4bd970`). This is an actual shape/pose contact
generator using both committed and current ACT transforms, not the broad
AABB predicate and not an impulse solver.

For nonzero geometry, native passive header `f0==2` is cleared recursively
through `0x4bd750` and invokes the world callback table's `activate_passive`
outlet when present (`0x4bd976–0x4bda68`). This header operation is distinct
from `ec` sleeping. Next, if the opposite target's `ec` is nonzero, call
`0x4bde80` (`0x4bda6d–0x4bda7d`). Only afterwards does `0x4bdb70` join
the circular collision ring (`0x4bda82–0x4bda86`). Normal lambda evaluation
and application occur downstream.

`0x4bde80` itself requires target `ec!=0`. It climbs toward a parent only
while the child's `+188` joint pointer is nonnull and that joint's type is
nonzero. It clears the selected ancestor's `ec`, sets its face reference
`+178` to `uint16(globalFaceEpoch - 2)`, wakes its children recursively,
and optionally updates jointed pose with a zero-dt `0x4b72b0` call when
children/joint pointers exist and `+218==0` (`0x4bde96–0x4bdf3a`). It also
cascades through other sleeping hierarchy bounds. An unjointed free leaf
has none of the ancestor/child pose work.

The wake operation does **not** clear velocity, `+1df` quiet state, or motor
counters. Source sleep application already clears `1df` through
`SetCollisionInfoChildsDoNothing 0x4b9c90`; therefore a freshly slept leaf's
quiet state is already zero. `ec` wake does not mean a
`RISE_WHEN_HIT`/translation-motor activation.

World-only rows cannot awaken an existing sleeping ordinary body through
this branch: that body is skipped as a primary, and a world face has no
opposite PHIL body to wake. An accepted body/body geometry row can wake its
sleeping target even when its later lambda is zero.

## Physical bounds used by cascading wake

`0x4b9a80` constructs world bounds at `+f4..+108`:

```text
worldBounds = union(transformBounds(physics.bb1, committedMatrix +8c),
                    transformBounds(physics.bb1, current ACT matrix +2c))
min_i = f32(min_i - double(.0025))
max_i = f32(max_i + double(.0025))
```

The bounding-box helper is `0x45fab0`; its contributions and successive
additions store Float32, as documented in reclaim evidence. The two margins
are literal doubles at `0x5897a8/0x5897b0`. These bounds use **bb1**, not
wheel-extended bb2, with no extra COM translation. Bounds at `+10c` union
the descendants as well (`0x4b9b09–0x4b9b74`).

`CheckForObjectHierachyTouchingAnotherObject 0x4b9d30` tests both leaf-world
bounds on all axes. Reject when any:

```text
A.min_i - B.max_i >= double(.01)
B.min_i - A.max_i >= double(.01)
```

The double at `0x5897b8` is .01. Each comparison is strict for acceptance:
a gap exactly .01 rejects. This is different from inclusive MODEL overlap
in ActorBoxPick and from retained expanded **face-cache** bounds in reclaim.
The helper has no driver/material/collision-filter gate; its caller chooses
sleeping targets, then it checks their `ec` before mutation. It handles
ancestor/child propagation and recursively wakes nearby sleeping groups.
Do not call it indiscriminately for every broadphase overlap: its source
enable and callers matter.

## Retained static ACT: collection-time pull

After reclaim, the retained ACT is static under its track column/root or
additional-actor group, with `type_data=NULL`; its allocated owner is driver0.
`FindFacesInBox` traverses those groups through
`ActorBoxPick 0x45fdc0`. It skips render-style NONE, selects the ACT MODEL
(or inherited model), and handles identifiers starting with `&`. A leaf
first passes its existing MODEL/world-box transform check. Identifiers whose
byte1 is `'0'..'9'` then enter the pull path (`0x4602b7–0x4602c7`). Byte3
`!` does not select this branch; it selects free mechanics inside pull.

Before invoking the callback, ActorBoxPick performs **two** inclusive,
finite MODEL bounds overlaps, in this order:

1. Transform the collection's original local box into ACT space using the
   ACT's LP inverse and the collection box matrix. Compare its resulting
   AABB with the effective MODEL bounds (`0x4602cd–0x4602df`).
2. Transform the ACT's own MODEL bounds into the collection box's original
   local frame using the box's LP inverse. Compare with that original
   local box (`0x4602e5–0x460331`).

Both use `BoundsOverlapTest 0x425b00`, which includes touching and validates
finite bounds. BRender products use row vectors; reverse operand order when
bridging to Three. The inverses here are native LP inverses, not arbitrary
affine inverses. Preserve the actual oriented collection box/ACT hierarchy;
a swept world AABB alone is insufficient.

The world callback table's slot `+10` is
`PullActorFromWorld 0x41ff20`, called at `0x46034b`. It permits pull only
while `gPHIL_doing_physics 0x748798` or the sensible-placement test flag
`0x677c3c` is nonzero, then tail-calls `DoPullActorFromWorld 0x41ff40`.
Nonphysics world/camera queries fall through to static faces.

DoPull rejects nonnull `ACT.type_data` before allocation. It maps the
identifier's two type bytes to the mechanics definition; chooses its
dedicated owner, or if occupied driver4, the first driver0 among the global
40 extras. On success it binds type-data, sets driver4 and initially `ec=1`,
captures pose, clears V/omega and completes mechanics/PHIL setup. The free
`!` branch is described in the debris note. There is no minimum force test.

A nonnull pull result immediately returns ActorBoxPick's unchanged remaining
face capacity (`0x46034d–0x460362`): that ACT contributes **no static faces**
to this collection. A null result continues to static ModelPickBox. This
happens before finite triangle emission/GROOVE interruption, and is separate
from smash geometry-restart/cap handling.

**Sticky failure:** missing mechanics or dedicated/extra-slot exhaustion
changes identifier byte1 to `'x'` (`0x420007–0x420015`). The ACT remains
static and later automatic ActorBoxPick collections skip its numeric pull
branch, even if physical slots become free. No automatic name-restoration
writer was established. Do not silently retry such ACTs every frame.

Browser exception (PHY-21): the installed sticky failure above remains native
evidence. Production now preserves numeric ACT identity on physical capacity
exhaustion so ordinary collection can retry after reclaim. Missing mechanics
still follows the permanent source path. See
[the explicit adaptation and regressions](noncar-capacity-recovery.md).

## Immediate registration and same-collection candidates

While `FindObjectCollisions` queries its world faces, it publishes the
reduced-list pointer `0x692738` and enables cascading wake `0x69273c` only
when the immutable pre-contact world velocity `+1b4..+1bc` has nonzero squared
length (`0x4bd795–0x4bd807`). A stationary source does not unconditionally
wake every overlapping sleeping body through this enable.

Successful pull calls `PHILAddActiveObject 0x4b6080`. This sets the immediate
registration override `0x690a74` while PHIL is running, so
`PHILAddObject 0x4b5ae0` registers immediately instead of waiting in the
ordinary PHIL pending-add queue. During physics it calls
`PrepareObject 0x4b9510`: prepare snapshots/bounds, sort the PHIL list, and,
if the above wake enable is set, wake the newly prepared hierarchy and
cascade `0x4b9d30`. Independently of that enable, it appends the new body
through `+234` to the published reduced list (`0x4b9767–0x4b9778`).

Consequently successful collection-time repull can supply dynamic physical
geometry in the **same collection**, replacing its omitted static triangles.
It does not require a next-frame wait or an artificial lambda-triggered
restart. Outside this collection phase, the reduced pointer/enable are zero
and these additional effects do not occur.

There is also a separate PHIL table of100 registration records
(`0x690ae8..0x691448`, stride24 bytes). `PHILAddObject` can fail when that
table is full. DoPull does not inspect the `PHILAddActiveObject` result at
`0x420322`; it returns its selected owner at `0x420327`. Therefore this
separate saturation must not be described as the null-pull/`'x'` cleanup
branch without further evidence.

## Runtime contract and remaining scope

The browser now has a narrow pre-lambda geometry wake for source-supported
free, unjointed noncar leaves. It must require an accepted body/body contact
and an awake or geometry-activated opposite, clear `ec`, and invalidate that
body's retained face-cache reference. It cannot wake two ordinary sleeping
bodies or treat a world-only row as an opposite body. Normal motor activation
remains separate. Full ancestor/ring propagation is still a provider gap.

A complete retained-ACT adapter needs:

- Independent global ACT retention/count, dedicated owner and shared40-slot
  occupancy. Reclaim frees physical occupancy while preserving ACT capacity.
- Source ACT identifier/type-data, own MODEL bounds, transforms, oriented
  collection box and the two bounds tests in original traversal order.
- Static collision registration after reclaim, and collection-time static
  exclusion plus immediate dynamic registration/reduced-list append on pull.
- Explicit native `ec`, cached physical bb1 world bounds, hierarchy and
  pre-contact-V providers for cascading wake; no motor/TTL substitutes.
- Sticky failure-marker handling and distinct PHIL-table diagnostics.

PERF-16 now implements retained static ACT ownership, shared physical occupancy,
immediate supported-leaf preparation/collection-time candidate discovery,
distinct capacity failure paths and static reclaim/repull. Native packed
column/ACT traversal is retained. Quiet hierarchy/cascade propagation and exact
native physical-resource memory aliasing remain gaps. Browser coordinate rebasing
and conservative borrowed-face invalidation are explicit host adaptations. See
[production evidence](noncar-participation-performance.md).

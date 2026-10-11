# Native pedestrian grounding resource bridge

`src/ped-native-grounding.ts` connects the independently implemented current-root
kernel (`src/ped-grounding.ts`) to the actual render/simple-body runtime and one
shared native85-slot face cache. It is a population resource adapter, not a new
floor ray, walking-speed estimate or physics launch implementation.

Evidence is installed HW SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`:
`RecacheAndSetFace4d1b30`, ordinary caller `4d3e62`, cache unlink/rotation
`4d1fce–4d2099`, counts `65c328`, capacities `65c318`, mode1 position
`40b0a0`, and physics activation `40b620`. See
[c2-ped-grounding-re.md](c2-ped-grounding-re.md),
[c2-ped-set-position-re.md](c2-ped-set-position-re.md) and
[c2-ped-active-move-re.md](c2-ped-active-move-re.md) for numerical and installed
instruction evidence. No original or reference implementation was copied.

## Runtime ownership

Construct exactly one `NativePedGrounding<Owner, Face>` per population using its
`NativePedRuntime`. Install `grounding.beforePose` through the runtime's hook,
using a closure when construction order requires it. `prepareFrame` owns that
one outer visit, before BON advancement and before passive PHIL velocity writes.
The bridge's `advance(ctx)` returns `{ground, completion}` for direct diagnostics;
`beforePose(ctx)` returns only the ordinary runtime completion record. Both
report zero processed BON frames. Calling both for one visit would run support
twice; no timestamp-based deduplication is invented, because two actual outer
frames can share a game timestamp.

Root position comes from `ctx.instance.rootPose`. Cache orientation is the first
nine scalars of `ctx.instance.movement`, preserving source basis/scale rather
than rebuilding heading, world-up or character orientation. Flags, HP and actual
physics flags come from the canonical runtime character. The external input
provider supplies actual gameplay action and process-cache/replay/material
state. Personality `profile.jumpHeight` is authoritative.

The cast retry clearance is `profile.movement.get(form.moves[0].id)`'s offset.
It is the first FORM slot, which need not have ID0. Unmatched personality slots
have allocator-zero offset. Position clearance comes from the current effective
`instance.move.asset.personality`, independently of the slot0 value.

The kernel's `set-position` effect already contains current clearance. The
bridge intentionally passes **`ground.hit.point`**, the raw finite hit, to
`runtime.setGroundPosition`, which adds clearance once and performs the actual
current-frame pose/passive-matrix notification without advancing BON clocks.

For falling, the bridge invokes actual `runtime.activate(owner)` before the
external move72 planner. Native activation copies native character velocity
into the admitted PHIL body; no kick, spin, corpse transport or scalar speed is
synthesized. `selectMove` should route the source request to
`NativePedGameplay.requestMove(ctx, {id: effect.move, speed: effect.period,
completion: !!effect.completion, action: effect.action})`, retaining its actual
FSM and active transition callback. The separate `setAction` outlet owns the
caller's final action3 write. Dead-cache move94 preserves two calls when the
cache remains NULL and the source retry occurs.

## Shared retained cache

The bridge owns one `NativePedGroundCachePool`:40 lists of capacity5,25 of10,
15 of40,5 of75. It uses the pool's source head-to-tail rotation and same-capacity
reuse. Its eviction callback clears the previous owner's cache pointer before
the physical slot is overwritten. Owner release clears the link without moving
the slot; reset restores bucket allocation order.

The collector's scratch records are copied by the pool. The kernel initially
selects from scratch; the bridge then resolves selected support and hit pointers
by record index into the slot's copied array. Both pointers retain exact copied
record identity, including shallow source ACT/model/material identity metadata.
Later scratch coordinate changes cannot modify cached support. Faces retain
emission order, first equal hit and source75-record clamp/overflow semantics.

Per owner, `state(owner)` exposes cache, persistent process-floor normal,
last kernel result and missing providers. The actual initial process normal is
supplied on first visit. Subsequent `readInput` values do not silently overwrite
it; the actual proximity writer returns its updated normal or calls
`setProcessFloorNormal`. It is not automatically replaced by a new support face
normal, since native reselection compares the old support with a separate
process-cache normal. `invalidate(owner)` forces recaching while retaining the
old list for the source same-capacity reuse path.

Call `release(owner)` only when that process-cache owner really goes away.
`releaseFaceCache(owner)` is the narrower installed move-completion operation
at `4cbfa3..4cbfa9`: clear the borrowed slot owner at `+14` and the process
face-list pointer at `+b0`. It keeps the actual process, retained floor normal,
slot records/time and native ring order. The next grounding visit must acquire
and recollect rather than accept the old selected-triangle shortcut. This is
neither whole-pedestrian release nor simple selected-face invalidation.
Render/simple-body culling alone is not proof that the native process cache has
been disposed. Explicit actor mutation/completion owners may call `invalidate`.
There is no cache TTL, view-distance substitute or wheel-ray fallback.

## Required production outlets and limits

`collectFaces` must provide ordered finite native ACT collection, at most76
records, with actual transformed bounds. `queryFace` must provide the installed
finite `CheckSingleFace` segment result/material/sided/endpoint semantics.
Missing providers produce named diagnostics; the bridge does not query a generic
scene ray instead.

Named external effects are `stopSmoothTurn`, `setPedXZDirection`, `selectMove`,
`setAction`, `vanish` and `proximityRescan`. All required named outlets are
preflighted before flags/root/PHIL activation changes. A missing move planner
therefore cannot leave a half-applied fall. A callback itself may report missing
providers; execution then stops at that actual ownership boundary and the
runtime skips BON advancement. Source cache collection can already have
occurred before such an effect diagnostic, matching the support/effect phases.
For an incomplete supported effect, the adapter retains the acquired list but
clears its selected pointer so the next visit reselects and retries effects;
otherwise native triangle retention could falsely accept an ungrounded root.
This is explicit missing-provider retry behavior, not a change to successful
native execution. `lastResult` retains the actual kernel result for diagnosis.

`proximityRescan` receives the recache result when its proximity output is set
and a living passive character has selected support. It is an external ordinary
proximity/turn/avoidance owner, responsible for its remaining smooth-turn,
direction-history, movement, replay and scanner gates. The bridge does not
claim those broader AI branches are implemented. Active character support,
nonordinary actions and replay without override bypass grounding. Articulated,
morph and replay position behavior remain explicit existing-runtime providers.
No production population is claimed by this standalone integration module.

## Validation

Focused tests exercise actual `NativePedRuntime` and its shared PHIL registry:
raw/current clearance, FORM slot30 vs ID0, actual scaled movement basis,
outer BON advance exactly once, fall activation/velocity/omega/active move72,
named-effect preflight, finite-query missing diagnostics, active/replay bypass,
85-slot eviction and copied selected-face identity, process-normal retention,
retry cast,75-record overflow, raw uint32 wrap, dead move94 retry and vanish
ownership. Original read-only Stock/Advanced Blokebl, Bandsman and twolf tests
exercise authored resources and current movement clearances, skipping cleanly
when the original installation is absent. No proprietary fixture is included.

A successful vanish outlet may release current ACT/body resources during
`beforePose`. The outer runtime must recheck resource ownership after the hook
and skip subsequent BON/passive writes when those resources were released.
Native flag80 already prevents later ordinary resource admission. The bridge
reports a successful effect as complete, rather than disguising release as a
missing provider. Vanish owns its event before its new flag80 store; the bridge
passes the final effect mask without writing that bit ahead of the callback.

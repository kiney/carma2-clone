# C2 noncar physical-slot reclaim

## Evidence and scope

Verified from the installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE32 image base `0x400000`, entry `0x577eb0`. Independent instruction analysis;
no original code or assets are reproduced here. rec2 provides names and
structure offsets. Its `common/car.c` labels `CheckForDeAttachmentOfNonCars`
as `0x4203c0`; the installed function starts at **`0x4203e0`**.

`src/physics/noncar-reclaim.ts` independently implements the pure pass with
fifteen numerical/original-model tests. Its host must supply authoritative ec,
driver, model bounds and retained query caches, and apply ordered ownership
changes. Free unjointed props now have a native quiet provider in the real
simulation; jointed/car/part hierarchies and collection-time static repull still
block full production reclaim integration. See [wake and repull](c2-noncar-wake-pull-re.md).

This pass releases physical participation while retaining the ACT. It has no
random draw, fragment lifetime, visual expiry or distance-from-camera gate.

## Phase and accumulated clock

Installed `ApplyPhysicsToCars` calls `FinishCars 0x416520` at `0x41650a`, then
calls this pass at `0x416511`, with the same outer-frame period. The callback
is after the PHIL physics window and graphical/committed car finishing, once
per accepted outer physics frame, rather than once per 40 ms step.

When active noncar count `0x677c7c` is zero, it returns without advancing the
static accumulator. Otherwise it first pipes the active noncars, then:

```text
total = uint32(total + framePeriodMs)
if total < 1000: return
total = 0
visit the original active-noncar list in increasing index order
```

`total` is `0x677cb8` (`0x420443–0x42045f`). A long period runs one pass; the
excess is discarded. All direct references to this accumulator in the
installed text are in this function: no race-start reset was found. The
active list at `0x79c260` is compacted during the pass; surviving order is
preserved. The combined active car/noncar list is not compacted here and is
rebuilt by the next outer physics frame.

## Eligibility and model/cache overlap

Before eligibility, ACT translation Y strictly below `gMin_world_y - 10`
sets physics byte `+0xec` to1 (`0x420480–0x42049c`). The race initializer
obtains minimum world Y from the authored track actor's bounds. The following
`TestForNan 0x515ad0` checks only ACT Y; its exponent-bit test actually catches
both infinities and NaNs. On failure, zero body omega, reset the ACT matrix to
identity with translation `(2000,0,0)`, and set `ec=1` (`0x4204a3–0x4204ec`).

Normal reclaim requires both physics `ec != 0` and noncar owner driver4
(`0x420501–0x420513`). This is the PHIL do-nothing state, not an elapsed-time
or low-speed heuristic. Drivers2/3 for detached/split car pieces are excluded.

For every other entry of the combined active car/noncar list, skip the same
owner and skip entries with `ec != 0`. For each remaining entry, use the
sleeping ACT's **authored MODEL bounds**, not its physics hull union:

```text
B = transformedBounds(ACT.model.bounds,
                      ACT.transform * other.physics.cachedInverse)
```

The product above uses BRender row-vector convention. With Three column
vectors it is `other.cachedInverse * ACT.transform`. The bounds helper is
`GetNewBoundingBox 0x45fab0`; matrix multiplication is `0x531c60`
(`0x420555–0x42057b`). The other bounds at physics `+0x124` and inverse at
`+0x144` are the **persistent face-query cache bounds and inverse**, written
by `GetFacesNearObject` at `0x4c222d/0x4c2245`. They are not the current
body AABB. This includes bb2's wheel extension and the source predictive
expansion retained from the last collection; see
[face-cache evidence](c2-world-face-cache-re.md).

If B overlaps that cached bounds on all three axes, retain the physical slot.
Touching is overlap: disjointness requires `B.min > cache.max` or
`cache.min > B.max` on an axis. The native code does not validate cache epoch
or force a face refresh during this test (`0x420583–0x420610`). A current
world-space hull test would change eligibility and reclaim too aggressively.

## Translation-joint return test

For a noncar whose owner flags at `+0x100` include `0x10000`
(`WORLD_TRANSLATION_JOINT`), additionally compare its authored joint reference
position at physics `+0x17c` with committed transform translation `+0xb0`:

```text
dx,dy,dz = reference - committedTranslation
distanceSquared = dx*f32(dx) + dy*f32(dy) + dz*dz
retain if distanceSquared > f32(.005 * .005)
otherwise committedTranslation = reference
```

The threshold at `0x588938` is exactly Float32
`0.00002499999936844688`. X/Y differences spill to Float32, while their live
x87 values multiply the spills; Z stays live. The reference is populated on
pull by transforming joint-info `+8` through the actor frame
(`0x420236–0x420247`). The successful comparison writes physics translation,
not the ACT translation, at this point in the already-finished frame.

**Important rec2 discrepancy:** reconstructed `car.c` sets `drop=0` for a
moving translation joint but omits the later guard. Installed
`0x4206bc–0x4206c2` explicitly tests `drop` again and skips removal when zero.
Use the installed guard. The viewed owner (`gCar_to_view`, installed pointer
`0x654c0c`) is also retained (`0x4206c8–0x4206ce`).

## Release and retained ACT ownership

When eligible, in this order (`0x4206d4–0x42076e`):

1. Remove the ACT from its current parent (`BrActorRemove 0x51d6b0`).
2. Clear splashes (`0x4fec00`).
3. Exclude the owner from the compacted active-noncar list; set driver0
   (`eDriver_non_car_unused_slot`).
4. For `car_ID != uint16(-1)`, map current ACT X/Z to a track column
   (`XZToColumnXZ 0x40cb90`), add to the column actor when present, otherwise
   the track root (`0x759080`). For `car_ID == -1`, add to
   `gAdditional_actors 0x6b5760` when nonnull; otherwise it remains unparented.
5. Clear ACT `type_data` (`+0x5c`) and remove its physics object through
   `PHILRemoveObject 0x4b5c40`.

No `BrActorFree`, physics-memory free, ACT-array compaction, global ACT-count
decrement, velocity clear or smoke-column stop occurs here. `PHILRemoveObject`
unlinks/clears registration data (or queues removal during PHIL processing);
the allocated physics object and owner storage remain reusable.

The global ACT count `0x75ac5c`, array `0x75ac60` and render cap `0x79c46c`
are untouched. Successful connotation clones permanently consume an ACT
entry for this session even after their physical slots become free. The
decrement at `0x4ebdd7–0x4ebde0` is failed-clone-pull cleanup, a separate path.

## Clone IDs and shared physical resources

Installed `DoPullActorFromWorld 0x41ff40` chooses the mechanics type's
dedicated owner. Only when that owner is already driver4 does it scan the
first40 noncar owners for the first driver0 (`0x41ff97–0x41ffb9`). These are
one **global** extra-body pool, not40 per mechanics type. Reclaim enables
dedicated/extra resource reuse by setting driver0; the old ACT retains its
independent render entry and can be pulled again later.

The sole `car_ID=-1` condition is ACT parent equal to `gAdditional_actors`
at pull (`0x42002a–0x42003c`). Otherwise the installed decoder computes:

```text
car_ID = uint16(100*identifier[5] + 10*identifier[6]
               + identifier[7] - 100*'0' - 10*'0' - '0')
```

Each byte is sign-extended. A connotation clone's `%04d.ACT` suffix encodes
the global ACT index at identifier offset4, so the decoder takes only its
last **three** digits for ordinary four-digit indices. Do not assign these
clones `car_ID=-1` just because the browser keeps them in a separate group.

Initialization `0x47ddfc–0x47de61` proves native `gNon_track_actor=0x7609d8`
and `gDont_render_actor=0x75f204`. Connotation clones are initially staged
under the latter (`0x4ebba0`), then successful pull reparents them to the
former (`0x420070–0x42007f`). The earlier debris note's description of that
successful parent as the universe was imprecise; it is the non-track group.

## Browser integration contract and remaining gaps

Keep physical occupancy and retained ACT count independent. Add a post-finish
outer-frame pass with explicit driver/ec, authored model bounds, ACT pose,
retained face-cache bounds/inverse, translation-joint reference/flags and
viewed-owner providers. Reclaim removes dynamics and active-body registration,
clears the allocated dedicated/extra slot and ACT binding, then retains the
ACT as static track/additional geometry. It must not invoke the failed-pull
`removeActor` callback, decrement retained ACT count or dispose borrowed
geometry/materials.

Existing `NativeWorldFaceState.bounds/inverse` can provide the required
other-object cache state. Browser `NonCarMotorState.sleeping` is not a
complete generic PHIL `ec` provider: `evaluateNativeQuietLeaf` has source
equations, but generic noncar quiet hierarchy/contact-ring ownership remains
explicitly incomplete. Do not substitute a TTL or arbitrary velocity cutoff.
Packed track-column order and exact native physics-resource aliasing remain
host-adapter gaps. This research made no runtime edits or production build.

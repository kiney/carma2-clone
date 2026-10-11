# C2 water-plane face-cache ownership

Evidence: installed HW executable SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The original installation was read only. rec2 provides symbol/structure maps;
`NewFacesListCallback` itself is a stub in that reference. The equations and
ownership below were independently checked against small installed instruction
ranges. No reference implementation was copied.

## Refresh input and lifetime

Installed `GetFacesNearObject` is `0x4c1e10`. Its persistent shared face ring has
300 records, each 80 bytes. `0x4c226d` clears `gPling_face` (`0x79ad0c`) once
before collection. `ModelPickBox`, `0x461018..0x46101d`, replaces this pointer
whenever an emitted face's material identifier begins with `!`. Selection takes
place after the finite triangle/box test and before capacity is exhausted.
`#` materials do not supply this pointer.

An exactly full ring causes another collection from slot zero. The pointer is
not cleared between passes. Therefore a first-pass pointer can remain outside
the second pass's final face range, or its pointed slot can be overwritten by a
different material. These are pointer semantics, not a second scan of the final
range. `0x4c2322..0x4c232a` invokes the callback once after start/end/reference
commit, passing the pointed record directly. The callback also runs before the
flags `0x80` branch clears the object's resulting range. Reused contained
queries, disabled-world queries, and parent-range borrowing do not invoke it.

The simulation adapter retains the pointer's slot number across both passes and
tracks overwritten slots. It updates the body water plane only when collection
actually runs. Physical body/wheel material rejection follows collection and
does not remove a face from water selection or the 300-record capacity.

## Plane callback

Installed `NewFacesListCallback`, `0x414930..0x414cbd`, initially requires owner
pointer `object+0x23c`. Object type `+0x238 == 1` bypasses the subsequent special
volume property gate. Other types require `PHILGetObjectProperty(object, 7)` to
be nonzero; installed getter `0x4b6384` returns owner flags bit 3.

For the supplied last face:

- Accept only `abs(face.normal.y) > Float32(.9)`, whose stored value is
  `0.8999999761581421`. Equality rejects the face.
- Store its normal at `object+0x244`; negate all three components if Y is negative.
- Store `water_d = normal dot face.vertex0` as Float32 at `object+0x250`.
- A missing/rejected last face sets only `water_d = 10000`. It does not search
  earlier faces and does not clear the retained normal, automatic volume, or depth.

The scalar change test is strictly `abs(old_d-new_d) > double(1e-5)`.
The resulting `0x4c6ee0`/`0x4c6f10` calls serialize replay/piping records through
`0x402930` (record types 20 and 59); they do not immediately apply forces or reset
the automatic volume. Player-only branches additionally update raw globals
`0x677c04`/`0x677c74` and set `0x677b58` through `0x413790`, using old/new plane
tests and the second material character (`!!`). Their exact camera/render
adapter remains separate; no speculative splash action was added.

The runtime body's `waterNormal`/`waterDistance` retain the verified plane. The
existing registered physics-body adapter does not yet expose the native raw
owner/property-7 flags for all corpse/drone/child forms. Those eligibility
providers remain a gap rather than an inferred classification.

## Force phase and bounds

Ordinary-car preparation refreshes/reuses the face list before force processing.
At `0x41693a..0x41694e`, a non-sentinel distance invokes
`TestAutoSpecialVolume` (`0x4ff360`), followed by `MungeSpecialVolume`
(`0x4ff1a0`). Plane refresh during a later collision query affects the following
force phase; the callback itself does not project depth.

`TestAutoSpecialVolume`, `0x4ff36e..0x4ff378`, projects local **bb2** (`+0x3c`)
through the committed physics transform (`+0x8c`). For cars, `bb2.minY` includes
the suspension setter's rear/front extension:

`min(bb1.minY, Float32((wpos[0].y-height[0])*Float32(1/6.9)), Float32((wpos[2].y-height[1])*Float32(1/6.9)))`.

For plane `(n,d)`, obtain minimum/maximum projections of this oriented box. No
submersion occurs when `d <= minimum`. Partial depth is the stored Float32
`(d-minimum)/(maximum-minimum)`; `d >= maximum-double(.001)` gives depth 1.
No valid retained plane leaves depth/automatic-volume state untouched until
`MungeSpecialVolume` applies its existing sentinel rule: partial-depth automatic
water clears, while a full-depth latch can remain.

Generic PHIL force handling uses its retained plane before gravity/drag; rec2
`physics.c` maps that phase. The adapter does not invent a new early face query
for these bodies. Their collision collection refreshes the plane, and their next
force phase projects it. Ordinary cars explicitly collect before their volume
force update, including the split/free-body car branch.

Existing finite upward reset retains the original `!`/`#` automatic-water test.
The additional two opposing cached-face ray tests in native automatic-water
entry (`0x4ff4b9..0x4ff640`) are still absent from the browser entry latch; this
change preserves its previous entry behavior and does not claim that gate is
complete. Packed column/model-group traversal order and omitted smashed
passthrough triangles remain world-loader limitations inherited by this cache.

## Clock coherence and validation

World destruction state and contact connotations now use the same injected
integer gameplay `smashClock` as the final queue flush. Physics elapsed remains
separate for crush, mines and oil. This fixes a reproduced backward-time error
when a fractional physics timestamp followed an integer gameplay queue event;
the finite/nonnegative input checks remain intact. Native predicted time can
regress after stall correction (`2000→1032→1048`); the former monotonic guard
was a browser invention and is removed. Chromium captured real corrections
from671 to551/533/634/616ms, confirming that sharing the correct clock alone
does not justify monotonicity. An integration regression uses the existing
native frame-clock kernel, rather than clamping those source timestamps.

`tests/water-face-cache.test.mjs` covers reuse versus refresh, retained state,
last-invalid selection, Float32 slope boundaries, `#` material exclusion,
capacity, both pointer rollover cases, generic phase ownership and the separate
destruction clock domains and native prediction corrections. `tests/volume-simulation.test.mjs` reads original
Eagle and Buggy assets when present and derives partial depth/forces from their
actual suspension-extended bounds rather than the previous bb1 half-depth
expectation. Original assets are optional and never copied into fixtures.

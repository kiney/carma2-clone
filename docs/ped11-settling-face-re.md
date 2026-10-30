# Pedestrian settling reads a retained global face slot

Verified against the read-only installed HW executable, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `400000`, entry `577eb0`. rec2 provides function names;
installed instructions provide the behavior below.

`CBMoved 4d26f0` copies the physical ACT translation and world velocity before
calling settling `417fd0` at `4d2767`, with gain `Float32(1.39)` and minimum
speed `Float32(.1)`. The helper returns when both collision byte `Object+1dd`
and `ec` are zero, or when speed squared is below the minimum squared.
Object contacts set collision bit2 at `4c0896..4c08b0`; world contacts set
bit1 at `4c0f9b..4c0fac`. A car-only contact can therefore enter settling.

The normal provider is independent of the pedestrian grounding/process cache.
`41803a` reads `u16 Object+174`, then `418045..41804b` computes
`7429f4 + 80 * start`: the normal at offset `34` in the shared face record.
`418051` calls `DRVector3SafeCross(normal, velocity)`. There is no check of
the body's range end `+176`, cache epoch, material eligibility or contact
acceptance before this read.

`GetFacesNearObject 4c1e10..4c234d` stores the current shared count as start
at `4c2266`, appends source collector records, wraps start to0 at `4c22d8`,
then stores the final count as end at `4c22fb`. Empty collection and wrap do
not erase retained records. An empty body range can consequently read a slot
later written by another owner. An old epoch can still read the current raw
record. The first normal can also come from a `!` or `>` material excluded
later from ordinary contact rows. Read this slot at the outer callback;
capturing a copy during collection would miss later overwrites.

The original300-record buffer is known zero-filled memory. The PE `.data`
section starts at `58e000`, has raw size `e7200` ending at `675200`, and has
virtual size `210d64` ending at `79ed64`. The complete face buffer
`7429c0..748780` lies in that zero-filled tail. Before a slot is written its
normal is therefore `[0,0,0]`. This is source initialization, not an invented
floor normal. Existing settling normalization handles that zero through its
verified fallback axis.

`NativeWorldFaceCache.rawSlot(index)` exposes precisely this storage access.
It accepts integer indices0 through299, independent of any owner's range or
epoch. It returns the retained record, or `null` for a valid slot's known
initial zero record. Invalid indices throw `RangeError`; null does not mean
an unavailable face provider. Reads never collect faces, advance the ring,
filter materials or change state. The generic cache leaves the caller to
interpret the zero record's fields, such as its zero normal.

The focused regressions cover every initially unwritten slot, invalid bounds,
an empty range whose start is later written by another owner, retained tail
records after wrap/invalidation, current overwritten records, special materials
outside an exposed range, and absence of extra collector calls. Before adding
the reader all four new tests failed with `rawSlot is not a function`.

Keep halt's positive-Y support scan separate: `4d0ead..4d0efc` iterates the
actual `[start,end)` range. Its range semantics do not justify suppressing
the settling helper's independent raw read.

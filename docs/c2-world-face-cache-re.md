# C2 persistent collision-face cache

## Evidence

Verified from installed HW `GetFacesNearObject` at `0x4c1e10–0x4c234d`.
The executable hash and binary metadata are recorded in
[physics evidence](c2-physics-re.md). rec2 supplies names and structures;
implementation is independent.

The global ring holds 300 emitted faces. Each object retains start/end indices,
a 16-bit reference, collection bounds and inverse actor transform. Collection
that reaches capacity, including exactly 300, repeats from slot zero and
advances the global epoch. A previous-epoch range is usable only when its
start is beyond the current insertion count. Strict six-plane containment
reuses a valid range; equality refreshes it. Material filtering happens after
finite collection and therefore cannot free capacity for later faces.

Before wheel forces, actor A is the committed physics transform O. During a
collision trial A is the candidate pose while O remains committed. With Three
column vectors, D = inverse(A) \* O. Collection unions bb2 with its D transform,
expands by Float32 .0025, unions bb2 transformed by inverse(D cubed), then
expands by Float32 .02. `SetCarSuspGiveAndHeight` at `0x41fd96–0x41fe5f`
extends bb2 minimum Y using wheel positions 0/2 and axle suspension heights,
divided by 6.9. It does not enlarge the physical chassis shape.

Raw flag-one collection uses world bounds expanded by .15 and signed
Float32 .12 times velocity. Its retained containment box is **inset** by .005;
instructions `0x4c1fbe/0x4c1fc6` differ from an outward-margin interpretation.
The normal-car adapter does not invent writers for this flag.

## Runtime and limits

`NativeWorldFaceCache` supplies persistent ranges to both body contacts and
wheel rays. Finite triangle emission triggers GROOVE interruption; already
collected triangles retain their pre-interruption moving-world pose. Placement
and topology rebuilding invalidate references. Owned production frames keep
the native ring. Standalone legacy tools that advance ACT animation every
physics tick lack the native outer-frame stop owner, so that explicit fallback
recollects its moving geometry rather than reusing stale world-space triangles.

Tests cover original Eagle/Newhawk bounds, transform expansion, strict equality,
capacity, rollover, ownership flags and invalidation. These establish cache
scheduling, not full world traversal parity. Remaining gaps are original packed
column/model-group order, omitted smashed passthrough faces consuming capacity,
interleaved actor traversal callbacks and separate drivable-object ordering.
Native water-plane refresh ownership is now [implemented](c2-water-face-cache-re.md);
full automatic-entry rays and owner eligibility remain separate gaps. Full epoch overflow requires separate
original-binary validation; ordinary session epochs are covered.

# Pedestrian GIBSLICK settings

`parsePedBloodSettings` reads the six rows following `// GIB SLICK!` in
`PEDS/settings.txt`: registered material identifier (the legacy parser field
is named `pixelmap`), delay and growth pair,
initial and full-size pair, friction pair, smear-distance pair, and smear
material identifier. The parser retains the last three values that the earlier
adapter discarded. Stock and Advanced settings both specify `GIBSLICK`,
`300,0.00001,0.00007`, `0.001,0.05,0.15`, `0.2,1`, `1,1`, and
`GIBSMEAR.MAT`.

Installed `ReadSpillData` (`0x4ee360`) reads these fields into the spill
record; it conditionally consumes smear-distance/material data when maximum
friction is nonzero. Its ABI and record fields are documented in
[`c2-world-slick-re.md`](c2-world-slick-re.md). The parser requires exact tuple
lengths, finite Float32-representable nonnegative values, ordered ranges, and
a material identifier token. Smear distance and material are optional when
maximum friction is zero, matching the installed reader's conditional fields.
These are input-integrity checks, not claims that the original reader enforces
those ranges.

`queueNativePedCorpseSlick` adapts an already-gated native corpse-slick event to
the shared `OilRuntime` pool. It requires the host's actual current runtime
allocation, follows its stable root ACT matrix, and retains the selected root
MODEL selected at queue time, reading that retained MODEL's live raw bounds
at placement. Later ACT model selection does not replace the queued owner.
It makes no chance draw; the native halt
owner remains responsible for chance, latch, and CRT ordering. The existing
legacy `PedBloodRuntime.settled` path remains unchanged. Production recovery
callback wiring and registered material-map ownership remain host duties.

`nativePedCorpseSlickRequirements` validates the same ACT/MODEL/material owners
without allocating or consuming CRT. `preflightNativePedRecoveryEffects` uses
the actual halt decision and replay/once/gore/gravity gates to check these owners
before the kernel can consume its chance draw or latch bit10. The effect broker
then queues once through the shared pool; disabled status recording is explicit
and never changes the physical activation level. Head-sequence observer events
already fulfilled by `NativePedGameplay` are not dispatched a second time.

Installed `QueueOilSpill2` at `4a6a20` stores the ACT at spill+4 and the MODEL at
spill+8 (stores at `4a6ac3`/`4a6acd`). `ProcessOilSpills` at `4a6bf0` uses the
ACT's later live transform and that separately retained MODEL. There is no
snapshot, render-slot pin or reference-count call. `CharacterNoLongerRenderable`
at `408400` clears FORM slot occupancy (`408442`), permitting later allocation
to reuse that preallocated ACT. A pending spill following a reused ACT while
keeping the old MODEL is therefore implied by these verified paths. The exact
reuse interleaving has not been captured from original runtime execution. Tests
retain this pointer behavior instead of introducing an unverified lifetime pin.

`GIBSLICK` is registered from the pedestrian pixelmap; `GIBSMEAR.MAT` is a
separate authored skid material.

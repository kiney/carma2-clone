# PHY-22: ignore-world collision cache ownership and reclaim

## Verified native behavior

Verified by instruction inspection of the installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base is `0x400000`, entry point `0x577eb0`, linker 5.10,
timestamp 1998-10-18 18:13:36 UTC. Addresses below refer to this executable;
no SW equivalence is claimed. rec2 supplies the symbol map and loader field
names, but its inspected `DoCollisions` implementation is a stub. The native
control-flow conclusions below come from the installed binary.

`IGNORE_WORLD_COLLISIONS` maps to physics flags `0x80`, as reconstructed in
rec2 `ReadNonCarMechanicsData`. It suppresses physical world faces, **not**
the retained face-query bounds/inverse used by noncar reclamation:

- `DoCollisions 0x4ba450` skips a primary with nonzero physics `ec` at
  `0x4ba59e–0x4ba5a6`. Motor sleeping alone is not this gate.
- `FindObjectCollisions 0x4bd780` calls `GetFacesNearObject 0x4c1e10`
  at `0x4bd7f8`, before calling world contact geometry `0x422800` at
  `0x4bd814`. There is no preceding `0x80` skip in this function.
- `GetFacesNearObject` has separate early paths for flag `0x40` and
  parent-sharing flag `0x02`. Flag `0x80` does not select those paths.
- On collection refresh, it writes persistent query bounds at physics
  `+0x124` (`0x4c222d`) and inverse at `+0x144` (`0x4c2245`).
  These retain the ordinary predictive expansion and query frame described
  in [the face-cache evidence](c2-world-face-cache-re.md).
- Only afterwards, `0x4c2273–0x4c2285` derives the model-emission enable
  from inverted flag `0x80`. Collection and its ordinary callbacks still
  execute. At `0x4c232c–0x4c233c`, flag `0x80` sets face end equal to start.
  World geometry `0x422800` consequently sees an empty physical face range.

The reclamation pass reads these retained bounds/inverses for every other
awake owner. It skips an owner because `ec != 0`, not because its motor is
idle (`0x420544–0x42054f`). See
[the complete reclaim conditions](c2-noncar-slot-reclaim-re.md).

## Reproduced browser defect

In the preserved Desert playtest, all 49 currently available physical noncar
slots were occupied and 47 noncars were sleeping. The sole awake owner lacking
a retained world-face cache was lift `&99!0013`, model `&99lift01.act`,
mechanics type99: translation joint, `IGNORE_WORLD_COLLISIONS`, `INFINITE_I`,
motor sleeping, but hierarchy `doNothing=false` and `immovable=false`.

The browser's `computeWorldContacts` returned before `facesNearBody` for this
flag. `nonCarReclaimFrame` then detected an awake owner without authoritative
cache bounds and set global `allowRemoval=false`. Thus an intentionally
world-face-free lift prevented the entire ordinary reclamation pass from
releasing sleeping scenery slots. This is an observed host-provider defect;
the paused state does not establish when saturation first occurred.

The roadside-sign incident prompted this investigation, but the nearest
inspected sign was already admitted and detached. Its responsibility for the
truck's historical damage and the identity of the original offending actor
remain unproven.

## Integration contract

Awake ignore-world noncars must reach the ordinary candidate-frame
`facesNearBody` cache path with physics input flag `0x80`.
`NativeWorldFaceCache.get` already supports the native no-model/empty-range
semantics. Preserve sleeping-primary exclusion, ordinary collection callbacks,
empty physical world-contact rows and the world-guard bypass.

Retain the global missing-provider protection for genuinely unavailable
caches. Do not replace native predictive bounds with current physical AABBs,
omit the lift from overlap protection, force its quiet state, enlarge slot
capacity or bypass reclamation eligibility. Restoring the missing cache owner
lets existing native model/cache overlap tests decide which sleepers remain
protected and which can return to static scenery.

## Validation and reported-impact boundary

Focused participation tests exercise the production contact entry point with an
awake owner and sleeping motor, no-model collection, finite predictive cache
bounds/inverse, empty physical face range, near-owner protection and distant
reclaim. Unknown awake providers still retain their existing protection.

`npm run test:ignore-world-reclaim` covers the original type99 Desert lift in
Stock and Advanced data, using ordinary quiet type5 scenery as near/far overlap
probes. Software Chromium is correctness evidence, not an FPS benchmark. A
separate MCP hardware Chromium check confirms the same behavior on AMD ANGLE,
2070×1435, with no console or WebGL errors.

A dry preview of the preserved saturated scene, substituting only the missing
lift query bounds in a separate reclaim-clock instance, identifies 46 otherwise
eligible sleeping owners. It applies no effects, does not inject a cache into
the live simulation, and does not replay native collection callbacks. Thus it
shows the extent of this veto, not a historical crash replay.

A separate clean original Desert1 approach by The Plow at 6 actor units/second
into the nearby type28 sign releases the attachment, displaces the sign and
leaves all truck damage components at 0 after 25 ticks. The original crowded,
damaged-car fatal episode remains unconfirmed; do not claim a universal fix for
light-scenery damage from this cache correction.

`tools/impact-history-recorder.mjs` supplies a separate opt-in diagnostic,
`window.__carmaImpactRecorder.snapshot()`, installed in the preserved live tab.
It retains bounded scalar contact/component-change histories across race-owner
replacement. It distinguishes callback rejection (including discarded joint
release impulses) from final `solverAccepted`, records the counterpart and
source ACT/face, and never hashes meshes, wraps world queries or steps physics.
Reload removes the injected recorder. Its unit regression covers rejection,
acceptance, component deltas, bounded ownership and hook cleanup.

The production source fix takes effect when a fresh page loads the rebuilt
bundle. The user's cached playtest was not reloaded, repaired or hot-patched to
change the failed scene. It remains available for inspection.

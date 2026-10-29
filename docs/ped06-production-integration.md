# PED-06 production evidence and boundaries

The production path is `main` → pre-resolved live MAT bindings/marker pass →
ordered raw MODEL face spawning with the shared CRT → authored population
identities → `OrdinaryPedRuntime` and source movement/scanning. This note
records implementation ownership and inspected source evidence. The integration is validated in Stock/Advanced and Chromium; original
Windows population output has not been captured numerically.

## Data carried into ordinary creation

Installed BuildPedestrian is `4d2dd0`. Its initial period branch
`4d2f27..4d2f4c` selects walking30 with the authored integer movement period
sample, or idle0 with speed−1 when movement+0c is zero. A negative speed selects
the FORM default period; zero is not its idle-animation period. Original
Stock BIPED1/BIPEDF forms supply33ms for move0. The population plan preserves
zero as the stationary-selection sentinel, and the loaded personality/FSM
selects an available initial move before the runtime uses its default period.
Missing0/30 must follow SetPedMove's installed fallback rather than silently
freeze an absent animation. Initial selection has no requested morph, starts
at frame0, and adds no random rotation or phase draw. Ordinary instance/BON
construction with mutant perturbation off consumes no additional CRT samples
in the inspected clone path; this is not a complete native loader call-graph
or global RNG-parity claim.

Installed ReadSettings reads general scalar6 at `4cac6e` and stores Float32
buoyancy factor at `74299c` (`4cac73`). Both local Stock and Advanced SETTINGS
supply2.0. The simple/boned PHIL initialization passes that global through
Object property8, represented by `levelOut`; production now supplies the
parsed scalar instead of substituting0. This is the source header/buoyancy
property, not a replacement gravity coefficient. Relevant underlying evidence
is retained in the simple-body, body-pool and boned-body notes.

Objective ownership is initialized during source face spawning. Type2 selects
all groups for any negative configured count, none for0, or the first matching
entry in its configured group array for a positive count. Matches set Ped
flag200 and increment the initial type2 target total once. Type5 selects its
single configured group, sets flag200 and appends a bounded native target
record instead. `4d30a5..4d30b5` advances the type2 group pointer, correcting
rec2's repeated-field transcription. Main supplies the race group policy to
the plan, and authored objective identity is retained by the runtime record
and character flag. This creation bookkeeping is distinct from OneLessPed's
later once-only mission progress event; it must not seed mission progress.
Exact branch addresses are in the [spawn note](c2-native-ped-spawn-re.md).

## Source scanner input ownership

`PedScanForObjects 4ced30` traverses actual PHIL object order. Its corridor
threshold uses Object radius_squared at+140 and source actor translation;
it does not select objects by renderer or a concatenated cars/noncars list.
Production uses the PHIL roster and actual type/owner/driver metadata. Radius
and transforms must retain their actual physical representation; a body lacking
that representation is a distinct compatibility boundary.

Electric distance belongs to **each owning car**, at car+170c. The installed
scanner compares its computed squared distance directly to this field
(`4cef0e`, `4cefaa`, `4cf05f`); a player-global value cannot represent an NPC.
Installed LoadCar compares exact `STELLA.TXT` at `488fd5..489009`, loads6.0
from589288 for that car or0 from589270 otherwise, and stores+170c at48901b.
Six is already the squared-distance threshold, not a radius to square again.
Action31 at4dea80 replaces it with authored parameter squared; reset4deab0
clears it. Production retains that value per car, including Stella opponents,
and scanner descriptors read the owning car's state. Other scanner predicates
such as driver>5, immortality and its strict5-unit cube still apply.

`NativePedRecordArray` owns actual bounded WebAssembly memory: an initial
2000×54h array and an exact-count compact copy, with known fields updated in
place. `record(index)` is a live byte view and `address(index)` is that view's
real memory offset. Ordinary scanning seeds the shared CRT from this address
and later time-XOR-address, following the recovered algorithm. The reserved
NULL region, monotonic offsets and independent memory are explicit browser
host allocation decisions. They are not Windows heap pointers, captured
native addresses, BrRes class semantics or evidence of identical Windows RNG
results. Unsupported native prerequisites can also change which identities are
represented in this runtime array; that limitation must stay visible.

## Ownership and validation scope

Native prepare precedes the legacy actor update. Every supported enrolled owner,
including a currently out-of-scope or capacity-exhausted owner, retains its
canonical root/action/HP. It never receives legacy mean displacement or a visual
hit sweep. BON supplies passive root displacement and velocity; PHIL owns active
transport. The old presentation remains hidden while a FORM slot draws, and
captures the last native pose for extended static display after release. Truly
unsupported personalities retain their explicit older path. This avoids stale
spawn roots and accidental resurrection when a resource slot is reacquired. Process and borrowed face release retain
their original identity and bounded pool links. Source missing providers are
reported; a wall/floor requiring unavailable prepared-group storage is not
silently assigned group0 or substituted world vertices.

The pure movement, native object-scan, record-array, marker, support and
steering tests provide focused deterministic evidence. The cache-only recovery
outlet is additionally covered with an action4 owner and active PHIL body,
without root/clock/action changes. Full BON/physical recovery coverage and separate PED-07/PED-08 limitations
remain subject to their actual evidence and acceptance criteria.

## Integrated regression findings

Combat target and napalm-box queries use the admitted native root, body-space
bounds and physical orientation, rather than the logical feet/display anchor.
Repulsion preserves the prior velocity of an already-active PHIL body; a second
activation request is not a prerequisite for applying its impulse. Its actual
callback writes process+8c after the ray outlet (`4ce2dd`), and the camera gate
reads that same word for the strict7500ms grace period (`4d3645..4d365b`). Death,
running and general collisions do not fabricate this retention event.

PED-10 remains an explicit browser visibility adaptation: an already visible
retained actor can bypass popup appearance suppression inside the original
process box. It does not broaden process extents or grant an extra FORM/PHIL
slot. Pure native callers leave the optional retained-presentation set absent.
Supported counting owners bind before first prepare, because a first ordinary
object scan can already kill under an active electric powerup. Physical capacity
failure does not create a second logical identity or enable the old hit sweep.

## Completed validation

- `npm test`:3551 tests passed in the integrated repository, no failures/skips.
- `npm run build`:TypeScript and production bundle pass; existing chunk-size
  advisory remains informational.
- `node tests/browser-ped-ordinary.mjs`:Stock and Advanced Newcity1 each load791
  authored identities, acquire original FORM mass/COM/inertia, receive real car
  solver damage, count once, release/reacquire and reload without orphan bodies
  or duplicate census owners. A character can reacquire a different preallocated
  physical slot; native allocation is first-free, not a permanent slot assignment.
- `node tests/browser-ped-ghosts.mjs`:two Stock/Advanced keyboard-driven cases
  preserve PED-10 admission, invalidate the dormant-render certificate immediately,
  enter PHIL and receive actual damage/count once. The old private-RNG pedestrian
  ID/coordinates remain historical evidence; the new fixture chooses a real
  authored identity from the native population and moves only car/camera.
- `node tests/browser-combat-powerups.mjs`:original real-key repulsion,
  annihilator, flamethrower/napalm, electric ray and opponent repulsion checks
  pass through the normal command/grant paths. Controlled fixture placement
  updates canonical roots, never HP, count or reservation state. The firing car
  stays registered in PHIL for its native electric scan.
- Chrome DevTools MCP, hardware Chromium:ordinary walking/render and W-drive
  collision inspected; target HP100→0, one native impact and one population
  count, no diagnostics, console errors or WebGL errors. Actual backend:
  ANGLE AMD Radeon/radeonsi gfx1150, OpenGL4.6, buffer2075×1441. This short
  functional check is not a frame-time performance benchmark.

Browser reports/screenshots are local ignored artifacts. Headless fixtures request
SwiftShader and are not hardware performance measurements. Original game data
remains external/read-only. Detailed falls/get-up/low-gravity and all prepared
floor-group branches remain PED-07; complete severed/articulated presentation is
PED-08; full native cause/award/blood effect coverage remains PED-09. Unknown
source providers stay explicit instead of guessed world-up, synthetic addresses
or a second movement/death integrator.

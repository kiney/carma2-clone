# Pedestrian combat runtime

## Evidence and scope

Independent runtime integration in `src/pedestrians.ts` uses the numerical
kernels in `src/combat-powerups.ts`. Evidence was checked against the read-only
installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841e9ca14ca5ff027bd6c`, PE32 image base
`0x400000`, entry point `0x577eb0`, timestamp October 18, 1998. `.text` starts
at VA `0x401000` / file offset `0x400`, `.rdata` at `0x588000` / `0x186c00`,
and `.data` at `0x58e000` / `0x18c800`. rec2 supplies names and structural
navigation; no reconstructed source or original assets were copied.

The [kernel notes](c2-combat-powerups-re.md) cover selection and numerical
formulas. This note records runtime ownership, rendering and remaining gaps.
PUP-11 remains partial: implemented targeting, impulses, attribution and
visual links do not establish complete native corpse, bone or smoke behavior.

## Runtime contracts

`useCombatPowerup(37 | 45 | 49, floatParams, source, physicsTickMs, gameTimeMs)`
returns whether the installed handler would find a qualifying target. The
source position is native `car.pos`, the live world centre of mass, in raw
actor units; source velocity is raw native velocity. Native `FinishCars`
transforms `collision_info.cmpos` by the live master actor pose to obtain
`car.pos`. No extra `6.9` conversion is applied to combat velocity increments.

The frame supplies the game clock, full outer-frame period, electric squared
range, owner, raw special-volume gravity lookup and optional world COM
`combatPosition`. That COM override affects electric targeting only; ordinary
car contact retains its existing actor-position interface. The latest frame's
immortal-pedestrian gate also applies to command handlers. Production combat
draws use the shared MSVC CRT stream; `combatRandom` can isolate numerical tests.

Installed shared selection `0x4cdef0` traverses the in-sight linked list
(`0x742954`, next at pedestrian `+0x50`), positive hit points, strict squared
range and first segment-face fraction at least one. Runtime `ped.active` is
the existing processing/in-sight proxy. Annihilator and repulsion use the
actual world collision segment. Electric scan `0x4ced30` uses the kernel's
relative-velocity line and strict five-unit cube without LOS.

All actual deaths now pass one ordinary runtime outlet for hit count, group
mission count, existing blood, `onHit`, clock and owner. Repeated callbacks do
not count a dead target twice. Installed `KillPedestrian` `0x4ccc20` skips
physical/gore setup when special-volume gravity is below one (`0x4ccc8b`),
then still calls `OneLessPed` at `0x4ccd86` and scoring at `0x4ccd8f`.
The runtime preserves death, mission counts and scoring while suppressing
corpse motion/blood in that branch. An earlier interpretation incorrectly
treated the jump as a death rejection; the installed control flow resolves it.
Annihilator callback `0x4cde00` installs move 113/action 6 and a visual link;
command success depends on shared selection, not the callback result.

## Repulsion and corporeal motion

Installed callback `0x4ce0e0` sets move 91, draws its period in `[75, 200]`,
enables level-five character physics, then applies raw velocity and three
independent body-axis angular increments. The target mass is the native
character mass; original FORM bone masses are summed and converted from kg
to tonnes. The retained cutoff is last physics tick plus 40 ms, matching
`0x4ce2b2`; it is not a contact-disable duration.

The runtime leaves the target alive and moves its corporeal root under PHIL
gravity and body-axis spin. Installed `ProcessGravity` `0x4b6c60` uses
`-0.05681159420289855` per forty-ms reference step, equivalent to
`-9.8 / 6.9` per second. Current contact remains the pre-existing floor-height
bridge; articulated collision surfaces, inertia, constraints, tumble/get-up
callbacks and BON/SKL playback remain PED-03/ANI-01 gaps. Deaths still use the
existing simplified corpse transport rather than a native articulated body.

## Persistent napalm

`SpawnNapalm` `0x4ce310` uses five records at `0x69a080`, stride `0x6c`.
Allocation chooses the first free record and reserves the nearest eligible
living in-sight target, with no range limit. A target's cache field `+0x98`
is negative while reserved and positive while burning. Source and target
special-volume gravity below one reject/cancel the effect.

Each runtime record retains its target, source/owner, birth clock, raw head
position, direction and seven persistent flame positions. Spawn copies only
the head actor position; the other six positions retain prior slot contents.
`MungeNapalm` `0x4ce580` checks pedestrian flag bit 1 at `0x4ce5c3`; clearing
that active-processing flag releases the reservation and seven actors. The
existing active proxy therefore releases a bolt when its target stops being
processed, independently of whether the browser target object still exists.

The verified motion kernel preserves the 500-ms ascent branch, three
independent random direction factors, full outer-frame period and native
unchanged direction-history clock field `+0x24`. Hit testing precedes trail
refresh: the head distance passes a broad bounds-coordinate test, then any
of seven flame points inside inverse-transformed character bounds can hit.
Current bounds come from original personality data; they do not yet track
native animation-dependent simple-character bounds.

Installed contact `0x4ce971` writes the fifteen-second burn deadline and
`0x4ce994` retains the firing car as culprit. Runtime releases the bolt,
starts authored burning animation and retains ownership until expiry. A
living target dies through the ordinary outlet once its deadline is reached
and immortality is clear; low gravity cancels burning. The scare sequence
currently uses the existing running adapter rather than the complete native
random scared-move/head callback sequence.

Original `NAPALMED PED SPEC` explosion groups and `COMMON/boom` pixelmaps
drive the burn animation. Seven billboard flames use original `EX00006`
and verified scales `[.275, .2245, .2, .175, .15, .075, .05]`, original quad
span `[-.5, 1]` and corresponding one-third sprite centre. Missing original
textures produce no invented replacement.

## Proximity and repulsion links

Installed proximity records at `0x6927d0` have twenty entries, stride `0x0c`:
source car, target pedestrian, start clock. Allocation `0x4cde52` chooses the
first zero timestamp, does not overwrite saturation, and does not suppress
the death callback. `RenderElectroBastardRays` is installed at `0x4d5b30`
(rec2's annotation is shifted); unsigned age `>= 500` releases a record.
Live endpoints are retained through callback functions and actor references.

The ray starts at the world COM plus `(0, -(maxY-minY)/5, 0)` transformed by
the live master actor matrix. Bounds are the primary render
`car_actor->model->bounds`, not physics `bb1`/`bb2` or combined collision hulls
(`0x4d5c61` through `0x4d5c9f`). The target is raw pedestrian position, without
a head/foot offset. Camera orientation transforms each three-axis jitter
sample back into world space. Source loops advance by `.05` twice per segment
and jitter each coordinate by `+/- .1`. The Three.js line uses the verified
proximity shade-table base RGB `(215, 255, 233)`; palette shade/depth behavior
is a WebGL adaptation rather than an exact software-renderer reproduction.

**Installed/reconstruction discrepancy:** `0x4d5da6` through `0x4d5de5` sums
world target XYZ followed by world origin XYZ, stores the result as a float,
loads those bits as an integer, adds the clock and calls `srand` `0x575f70`.
There is no numeric float-to-int conversion. The runtime and test preserve
this float-bit seed, overriding rec2's `(int)seed` expression. Native jitter
re-seeds the shared CRT during rendering; complete main-loop phase ordering
remains an integration concern.

Repulsion has a separate six-record pool at `0x69eff0`, stride `0x28`, allocated
by `0x4da640`. First free wins; saturation replaces the strictly oldest start
clock, retaining the first entry on ties. `MungeRepulseRays` is installed at
`0x4db6d0`, with unsigned age `>= 700` releasing a record. The runtime draws
the original `REPULSE.PIX` on 102 vertices and 100 triangles, with inner/outer
radii `.03`/`.05`, five quantized radial directions, alternating UVs and the
native initial centre advance. The final station overshoots the target to
`51/50` of the displacement. Opacity changes above 70/80/90 percent of the
700-ms lifetime to 75/50/25 percent. A vertical-only displacement skips the
native strip update. `emitOpponentRepulsion(readSourcePosition,
readTargetPosition, timeMs)` shares those same six records with opponent
action 38. Its installed caller `0x4de231` through `0x4de247` passes car world
COM pointers and different inner/outer radii `.06`/`.12`. Pedestrian sources
use `readPosition` when supplied, preserving live COM positions despite a
command's initial numeric position snapshot. Mixed pedestrian/opponent
allocation uses the same first-free/oldest replacement and expiry rules.

## Remaining native outlets

Napalm contact calls `CreateSmokeColumn2` `0x4fb3c0` at `0x4cead7` with
type 2, target character actor and simple-physics pointer, null car,
zero argument five, a native prepared-model vertex selected by inclusive
`IRandomBetween(0, nvertices)`, and lifetime `0x61a8` (25,000 ms). The engine
does not yet expose the native smoke-column subsystem or animated prepared
vertex emitter. A fabricated radial blast or generic smoke sprite would not
complete that outlet. Source firing/hit sound IDs are 3701/3702, at
`0x4ce4aa` / `0x4ceadf`; these dedicated audio outlets remain unwired.

Remaining whole-engine work includes exact ray rendering/RNG phase,
full in-sight flag parity, native kill globals
beyond the exposed immortality/volume gates, animation-dependent character
bounds, the native scared-head sequence, smoke and articulated death physics.

## Validation

`tests/ped-combat-integration.test.mjs` checks active/LOS selection, owner/time
and mission attribution, strict range boundaries, nonlethal mass-scaled
repulsion, draw order and forty-ms cutoff, electric no-LOS and world-COM
override, five-slot reservation, numerical bolt motion, underwater cancellation,
fifteen-second burning, low-gravity death/scoring, twenty-slot/500-ms proximity
links with float-bit seed, and six-slot oldest replacement/700-ms repulse
links, mixed opponent/ped visual saturation and live endpoint readers. The
optional original-installation case loads Newcity1 pedestrians,
FORM masses, original flame/repulse textures, strip counts, source caller
radii, endpoint overshoot and opacity tiers.
No proprietary test fixtures are committed. Native browser combat validation
is owned by the integrating root agent.

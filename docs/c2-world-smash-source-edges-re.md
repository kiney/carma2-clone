# Source edge preparation and native followup collection

Independent implementation in `world-destruction.ts` and
`world-smash-edge-flags.ts`; original resources remain read only. Installed HW
SHA256 is `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base400000, entry577eb0, timestamp1998-10-18 20:13:36.

## Verified source edge ownership

`SpawnSmashAndMungeFaces4f1660` retains original MODEL face pointers at stack12c
and15c (`4f22b9/c0`), before tile generation. Selector0/1/2/3 addresses
partner-mask4/source-mask1/source-mask2/partner-mask2, respectively
(jump table4f32dc). These are literal raw triangle masks, not geometric guesses
about which edge should disappear. The runtime tile spec owns two source-face
pointer slots at98/9c and OR masks ata0/a1. Matching the first slot still enters
the ordinary insertion suffix; duplicate references and retained masks are real.

Enqueue's non-NULL selected level with collision type2 establishes accepted
edges (`4f2a9d..ab3`). Only that branch restores remembered source masks, or
applies the current selector directly when no references exist. Other branches
remember source references/masks without applying them when the original-source
flag permits it. Caller4f14c4..df passes `!spec.field_2dc`; existing per-tile
runtime specs do not add source references on later contacts. No tier, map or payload
is committed by this preparation. Geometry/restart output is always1 at4f2adc.

Native recursion tests the four clipped unit-tile boundaries in selector order,
skips the incoming selector and probes beyond a clipped boundary using
`edgeMidpoint + .001*(edgeMidpoint-oppositeMidpoint)` (`4f2e00..4f2f3a`). The
opposite selector is `(selector+2)%4`. A boundary follows another MODEL face only
when requested unit bounds extend past the original paired quad; equality within
.01 clamps without following. Whole-quad tiles do not invent UV-neighbour damage.
The installed episode counter6a6920 admits at most16 calls (`4f16b8..e9`).
`FindFaceWithPoint4f4a10` scans source order; `PointInFace4f0ad0` first requires
absolute plane distance below.5, projects to the face and uses barycentric
limits−.0001 and1.0001.

The browser retains stable original face objects through clipping and maps their
edge masks onto actual subdivided triangle edges. Created interior diagonals are
suppressed. Source high bits remain intact. Changed flags publish through the
existing per-MODEL collision invalidation outlet; no global rebuild or extra
solver retry policy is introduced. Generic host clipping and Three barycentric
arithmetic remain different from the original x87 sequence at borderline faces;
this is source-semantic integration, not exhaustive floating-point equivalence.

Focused tests cover literal selector masks, original face ownership across two
partial quads, immediate publication before flush, full/equal queue rejection,
pending upgrades, unrelated flag preservation and deferred connotations.

## Native followup prefix

Production supplies `collectNativeFollowupFaces` using the existing
`WorldCollision.collectFaces` owner. Its already clipped/capped prefix is adapted
without renderer traversal, sorting or eligibility filtering. Native ACT identity,
local translation, current MODEL face/group and original MAT/source face links
survive batching. Live identifiers come from the retained ACT object so a later
numbered release marker is observed. Missing native providers throw; the old
renderer collector remains explicitly a standalone fixture fallback.

Stock and Advanced Newcity optional-installation tests compare the entire native
400-face prefix, ACT/group/face identities and vertices. Synthetic tests cover
reversed renderer hierarchy, native local translation after renderer reparenting,
live release-marker reads and a shorter prefix. Carrier's actual Core cuboid is
also checked in Stock and Advanced: migrated `MungeFaces` ACTs deliberately have
no authored Object3D entry. They retain their distinct native ACT identity/name,
with no source-owner ordinary registration. Their source render mesh and triangle
are carried separately for due material mutation; `faceActors` is a geometry
crosswalk, not an alias for native target identity. These tests verify adapter
identity/order against the established native collector, not historical Windows
heap allocation order.

## Replacement MODEL producer

The replacement outlet accepts an Assets-owned MODEL-instance resolver, including
captured MAT bindings and the actual MODEL identity. A same-identity replacement
leaves the live geometry, cap, fire and connotations untouched and disposes its unused
host clone: accepted flag78 starts zero at4f4c8d, only pointer change sets it at4f4cbb,
and4f4e11 gates all final outlets. This branch does not rewrite the packed ACT
identifier or introduce a permanent once-only latch; another MODEL change can make
replacement eligible again. An actual replacement retains the registered identity and invokes the
replacement-fire producer after the MODEL change and before connotations, matching
the installed4f4d20 caller. Fire arithmetic/pool ownership stays with the shared
smoke producer; WorldDestruction does not invent another emitter.

## Carrier pickup prefix and objective validation

The real Stock Core cuboid additionally admits eight pickup-marker ACTs
`&£000107.ACT` through `&£000114.ACT`, whose source MODEL is `&74POWERUPB.ACT`.
They have no ordinary world-smash spec. This admission follows the explicit
pickup marker path in native followup selection; it is not another WIGGLYBIT
objective. `SmashEnvironment4f0f6b..4f0f96` recognizes the marker separately and
calls `HitPowerup4f0db0` with the encoded pickup index and original ACT. Due
pickup work belongs to the ordinary pickup/respawn and final powerup-queue owners.

The former Carrier browser assertion that the Core creates zero delayed tasks
was specific to renderer traversal. Native collection correctly creates eight
fixed-two-second tasks. The regression now retains and drains all eight, verifies
that they cannot supply the nineteenth objective increment, then kills the real
group56 ADMIRAL for19/19 and completion reason3. No mission-variable seed is used.
The fixture uses ordinary recovery and opt-in debug invulnerability while the
real outer-frame clock drains: unprotected Eagle contacts at this Carrier location
can become WASTED and close awards before the later scripted ADMIRAL sweep.
The test keeps normal physics and timed effect expiry running; crash behavior is
validated by the separate crash regressions.

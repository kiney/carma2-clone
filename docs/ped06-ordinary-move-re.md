# PED-06 ordinary movement owner

## Evidence

`src/ped-ordinary-move.ts` independently implements ordinary acceleration,
XZ direction policy, smooth turning, wandering and avoidance. It borrows the
actual `NativePedProcessCache.storage` record (300 bytes); it does not allocate
permanent per-pedestrian movement state. Temporary snapshots reproduce native
whole-process copies, including retained fields unrelated to proximity.

Evidence is read-only installed HW, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
image base `0x400000`, entry `0x577eb0`, timestamp
`1998-10-18T20:13:36Z`. rec2's `common/pedestrn.c` supplies function names and
semantic structure. Installed instructions resolve rec2 transcription errors;
no reference implementation was copied. This note records static instruction
inspection and deterministic source-derived tests, not a new native execution
capture or exhaustive x87 conformance claim.

| Installed range                | Owner                                                            |
| ------------------------------ | ---------------------------------------------------------------- |
| `4d3c84..4d3dcd`               | Inlined AcceleratePed                                            |
| `4cc060..4cc3f9`               | SetPedXZDirection                                                |
| `4d4111..4d4399`               | Inlined SmoothTurnPedestrian                                     |
| `4d439d`                       | Rescan after smooth turning                                      |
| `4d43a9..4d4503`               | Inlined RandomWander                                             |
| `4d4509`                       | PedScanForObjects call                                           |
| `4d451c..4d492b`               | Inlined CheckForAvoidingAction                                   |
| `403f90..40414d`               | SafeCross, including all three epsilon comparisons               |
| `512f00` / `512f30` / `512f90` | Integer range / percentage / float range RNG                     |
| `531f80`                       | Native16 arbitrary-axis rotation, unsigned angle and x87 sin/cos |

## State and effects

The process owns desired direction `+48`, smooth target `+54`, smooth origin
`+60`, start/end timestamps `+6c/+70`, next-turn deadline `+7c`, acceleration
period `+80`, rate `+b8`, object-avoidance deadline `+90`, and all native
proximity fields. The character provider supplies current root translation,
actual direction/up/velocity and signed animation period. A selected support
face normal is required; no world-Y floor substitute is inserted.

Acceleration reads unsigned `+80`, subtracts full outer frame period times
Float32 `+b8`, truncates, and uses the installed unsigned comparison against30.
At the boundary it writes cache0 and sends period30 through the character
period outlet. Reverse replay adds and clamps100. Global speed factor0 skips
division; otherwise the resulting period is divided and stored Float32.
The native unsigned wrap on a sufficiently large forward step is retained and
tested. rec2's subsequent `MAX(30,cache)` statement contradicts the installed
zero sentinel and is not used.

Direction uses SafeCross(globalY,requested), then SafeCross(result,selected
floor normal), then normalizes with the native epsilon/+X fallback. An active
smooth target whose dot with the new direction is strictly greater than
.95 is retained. Positive distance starts the source-duration turn and saves
current direction. Distance0 clears smooth start and invokes the actual
character-direction outlet. Smooth turning sends interpolated unnormalized
vectors to that outlet; the provider owns character normalization, root ACT
updates, physical transform/cache invalidation and replay piping.

Wander draws the next deadline, percentage sign and native16 angle in that
order. It snapshots all0x12c bytes after scheduling, sets a direction, then
calls native proximity. Any resulting proximity flag restores those bytes
and applies the original direction at distance0. The new turn deadline is
retained. Source copy and restore are `4d4490` and `4d44f0`, each0x4b DWORDs.
Rotation uses unsigned16 angle times the installed radian multiplier and
Float32 sine/cosine stores. JavaScript transcendental functions substitute
for x87 FSIN/FCOS; bitwise parity for all angles is not claimed.

Avoidance preserves source short circuits and RNG chronology: distance
randomization precedes object cooldown, the running back-wall dismissal
consumes PercentageChance100, and suicidal/blind branches retain their own
gates. Tangents use SafeCross without extra normalization; object velocity
chooses the preferred side. The second-candidate snapshot occurs after its
direction setter and before its scan (`4d48da`). A second distance less than or
equal to the first restores all0x12c bytes (`4d4901`), reapplies the first
candidate and clears scan direction. Two-sided borrowed face mutations from
proximity survive these process-only restores, just as in native code.

Providers must operate on the same live character/process and borrowed face
records. Direction/proximity calls must not rebind the process, its owning
pedestrian, its borrowed face-cache reference or killer reference: the source
routines do not change those pointer owners. JS reference slots therefore do
not need invented numeric pointers in the byte snapshots. Provider-required
results can follow earlier ordered stores; these routines do not promise
transactional rollback of callbacks, face mutations or CRT draws.

## Integration boundary

Call acceleration before ordinary grounding, then supported position/direction
updates and the required initial proximity rescan. With a selected floor and a
movement-causing animation, call smooth+rescan or wander, then object scan and
conditional avoidance. `advanceNativeOrdinaryPedSteering` implements that last
sequence; its caller owns action/animation/support eligibility. Character
animation/root displacement follows steering, then current character velocity
is copied into the passive body. These kernels do not predict a next XZ point,
perform floor rays, invent gravity/fall transitions, choose animations or own
physical activation. Those remain their existing subsystem providers.

`PedScanForObjects4ced30` is deliberately an explicit provider boundary. Its
source `srand(pedPointer)` call at `4ced5c` cannot be replaced with a browser
identity number while claiming source CRT chronology. The combined steering
entry returns `source-PedScanForObjects-pointer-CRT-provider` before mutating
state when that outlet is absent. Individual movement functions remain usable
with an explicitly documented object-scan adapter. This module does not
implement the full scanner or claim production population parity by itself.

## Validation

`tests/ped-ordinary-move.test.mjs` covers the canonical100-record pool, outer
period/speed-factor acceleration, clamp sentinel and unsigned wrap, missing
floor atomicity, sloped projection, target retention and smooth timestamps,
SafeCross fallback, full-record rollback with opaque retained-byte sentinels,
second-tangent ties, conditional RNG/cooldown order, and the actual
`rescanNativePedProximity` writing the same canonical process record. The
combined missing-pointer-provider check verifies no preceding mutation.
TypeScript checking and the focused deterministic tests pass. Production
browser validation belongs to the root integration, not this kernel note.

## Production source scanner and recovery cache outlet

`OrdinaryPedSteering` accepts `scanForObjects(context,movement)` as the real
source scanner provider. The host calls `scanNativeOrdinaryPedObjects` with
its actual allocated0x54 Ped record/address, live canonical process bytes,
PHIL object order and gameplay/head/noise/electric outlets. That provider
runs after smooth/wander and before avoidance. Successful installation removes
the former missing-pointer diagnostic; actual scanner requirements propagate
without silently invoking a compatibility fallback. `scanForObjectsAdapter`
is used only when the real provider is absent and retains the explicit
pointer/CRT boundary label.

`ready(owner)` is a synchronous gate for the legacy update, backed by successful
support ownership. It is false until the first real prepare. Therefore the
outer population owner must prepare native owners before its legacy movement
loop to prevent an extra initial mean-displacement step. Process eviction,
borrowed-slot release, world invalidation, unprocessed/vanished flags and
physical activation revoke readiness. A previously supported living source
fear animation (action2) retains native ownership while the ordinary grounding
phase is source-bypassed; the old movement owner must not replace its BON clock.

Public `movementInput`, `directionForRecovery` and `rescanForRecovery` reuse
that same live process/selected-floor ownership. `recacheForRecovery` calls
`NativePedGrounding.recache`, the extracted cache-only RecacheAndSetFace phase.
Unlike the ordinary Munge wrapper, that phase does not gate on walking/running
or active physics. It uses the actual root/basis, native interior/triangle
retention, finite76-face collection, 75-face truncation and existing85-slot
rotation. It publishes the real process+b0 before finite support selection,
then stores an actual selected face from that slot's copied records. Its
result exposes the finite hit and separate needGround/needProximityRescan
outputs. One call owns one acquisition; a native caller requiring a NULL retry
must issue its own second call.

Cache-only recaching does not clear ordinary Munge flags, reposition/reorient
the character, activate PHIL, select a fall action or pretend that action4 is
walking. The installed dead-cache move94 branch remains its explicit move
outlet. Living recovery tests verify a forced action4/active-PHIL recache with
unchanged root, clock, action and physics state; nonforced retained support
does not rotate a slot or update its timestamp. Other recovery providers own
the subsequent passive grounding, move and physical-level transitions.

The steering integration suite now covers twelve deterministic scenarios,
including the real object-scan kernel with an actual host-allocated Ped address,
source-provider failure propagation and readiness before the legacy loop.

## PED-07 recovery readiness and resolved NULL support

Installed `4cc06b..4cc07f` dereferences the current process, then returns when
its borrowed list or selected-face pointer is NULL. `setNativePedXZDirection`
now treats that resolved state as a successful no-op before reading requested
direction or requiring a character-direction callback. The production wrapper
still reports a missing current canonical process. Likewise the proximity
wrapper preserves `4cf87f..4cf890`'s early NULL return before resolving MATs.
No missing support is replaced with world Y.

`OrdinaryPedSteering.preflightRecovery(context, direction, recoveryAction)`
checks the forced living-halt recache/direction/proximity chain using temporary
copies of source face records and canonical process bytes. Pass action1 for an
upright recovery and action4 for a lying/get-up recovery, matching the action
at the later rescan. It uses actual native bounds, slot0 clearance, finite
support selection and source direction/proximity kernels. It performs no pool
acquisition/ring rotation, root/action/clock mutation or CRT draw. It preserves
explicit rejection of excluded negative prepared groups rather than supplying
group0, raw vertices or a synthetic floor normal. The object scanner's later
callbacks retain their own readiness contract.

A dedicated `previewWorldFaces` provider is mandatory: the normal simulation
collector can pull ACTs and stop grooves, so silently invoking it in a read-only
preflight would change the scene. An unavailable preview is an explicit
`source-recovery-readonly-world-face-provider` diagnostic before collection.
The host owns correctness and mutation safety of its preview provider.

The optional production `vanish` outlet forwards the complete native event,
flag80, physics/render release and once-only count operation to its host.
Grounding still preflights the missing outlet. A successful vanish ends ordinary
steering immediately; the runtime's existing resource/flag checks prevent later
BON advancement. The transitional fall-owner warning remains only for hosts
without that outlet. Focused tests cover resolved NULL versus missing process,
negative-group preflight with unchanged canonical records/roots/rings/shared
CRT, and once-only vanish forwarding.

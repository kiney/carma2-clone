# Pedestrian contact attribution before damage

## Evidence and scope

The complete installed HW routine `0x4cdc60–0x4cddd7` was checked against the
read-only executable SHA-256
`698c2b11865578b6ea2a77324fbc1840080841e9ca14ca5ff027bd6c`. Image base is
`0x400000`; `.text` VA/file offset is `0x401000/0x400`. rec2's
`src/carma2/include/rec2_types.h` provides the object-layout map. Its
`tPhysics_object.parent` is **object `+0x228`**, distinct from car-spec culprit
`+0xc8`. The pointer branches and stores below are verified in the installed
binary, independently implemented without copying reconstructed code.

`src/ped-contact-attribution.ts` supplies the standalone kernel and a concrete
`NativePedGameplay.attributeContact` outlet. It writes only process-cache
killer `+0xc0` and cause WORD `+0x2e`. It consumes no RNG and does not require
positive contact lambda. It leaves napalm deadlines, motion, HP, impact count,
interpolation, blood, noise, scoring and physical impulses to their owners.

## Caller order

- Passive contact `0x4cd9e9–0x4cda0b` increments the pedestrian impact WORD,
  clears cache retry `+0x19` and direction-interpolation clock `+0x6c`, then
  calls attribution at `0x4cda0b`, before momentum and Damage. Those earlier
  writes belong to the shared contact/gameplay prelude, not this module.
- Active contact `0x4d20e0` first rejects the replay global `0x6751b4`, obtains
  the pedestrian through the body owner's `+0xe4` and calls attribution at
  `0x4d210c`, before the later damage-force adjustments. The contact owner must
  retain this ordering; the attribution leaf itself has no replay check.
- A world contact passes a NULL other object. The helper returns unchanged;
  it does not erase an earlier car or indirectly inherited killer.

## Exact pointer and flag algorithm

1. NULL other or NULL pedestrian process cache returns (`0x4cdc66–73`).
2. Independently, an other object whose `+0x23c` owner exists and whose type
   byte `+0x238` is 2, 3 or 4 can inherit attribution if the current cache killer
   is NULL (`0x4cdc79–b4`). Follow owner `+0xe4` to another pedestrian, then
   its cache `+0xc`; if both exist, copy its cache killer. No cause flag is
   written, even when the copied killer is NULL. An existing killer is sticky.
3. The remaining accepted types (`0x4cdcba–4cdd03`) are:

   | Type         | Admission                                                                  | Candidate car-spec pointer          |
   | ------------ | -------------------------------------------------------------------------- | ----------------------------------- |
   | `1`          | Other owner must exist                                                     | Other owner `+0x23c`                |
   | `0x20` tail  | Mode `0x7036e0 == 2`, or unsigned `(GetTotalTime514610 - 0x703d10) < 7500` | Other owner `+0x23c`, possibly NULL |
   | `0x40` mine  | Type alone                                                                 | Mine owner `+0x30`                  |
   | `0x10` drone | Type alone                                                                 | Drone owner `+0x5d4`                |

   Other types return after any preceding character inheritance. Equality at
   7500 ms rejects a tail; subtraction wraps uint32. Mode2 never calls the
   clock. Mine/drone owner NULL would be dereferenced by native code. The safe
   adapter instead diagnoses that malformed/unsupported provider and performs
   no guessed fallback.

4. At `0x4cdd30–47`, a non-NULL candidate with signed32 driver `+0xc > 5`,
   **or any non-NULL other-object parent `+0x228`**, enters direct attribution.
   Write the candidate pointer to cache killer, replacing an earlier owner.
   The parent branch permits even a NULL candidate.
5. Direct cause changes (`0x4cdd4d–ae`): ordinary type1 preserves the WORD.
   A tail with non-NULL raw other owner ORs `0x08`; mode1 additionally ORs
   `0x10`. Mine **replaces the entire WORD** with `0x40`. Drone replaces it
   with `0x01`. The upper byte survives the OR paths, but not replacements.
6. Otherwise, a non-NULL candidate can supply indirect attribution only when
   the existing cache killer is NULL (`0x4cddb1–d1`). Copy candidate car-spec
   culprit `+0xc8`, then OR `0x01` into the low byte. The OR occurs even when
   the copied culprit is NULL. An existing killer bypasses both writes.

Thus ordinary direct contact can preserve an earlier napalm or indirect cause;
latest contact does not determine the final score classification. A parented
low-driver part uses its own wrapper as a direct killer, rather than borrowing
the parent car. [The score consumer](c2-pedestrian-awards-re.md) still requires
the selected pointer's current driver to equal 8 for local financial awards.

## Concrete host contract

`attributeNativePedContact(cache, snapshot, providers)` accepts actual native
pointer identities represented by objects. Its `typeByte`, `owner` and
`parentPresent` are explicit. Character-cache, mine-car and drone-car providers
distinguish unknown `undefined` from actual native NULL `null`. Car driver is a
bounded signed32 value, and cause flags are a bounded WORD. Invalid numeric
state throws; unrecovered required pointer paths return named diagnostics.

`createNativePedContactAttribution(options)` returns the callable gameplay
outlet. `readOther(context, dispatch)` receives the actual
`NativePedContactDispatch`, including the original physical other, phase and
retained first row/force. World other `undefined` bypasses this provider.
`readCarDriver`, `readCarCulprit` and `readTailState` supply native ownership,
not derived gameplay guesses. The outlet refreshes browser-only
`cache.killerDriver` from the retained pointer's current driver, including on
world contact; NULL/unknown clears stale metadata rather than leaving a false
driver8 award. The installed routine itself does not store that driver field.

Current simulation source distinguishes ordinary cars, independent part
wrappers and pulled noncars. Its `nativeCrashDriver` maps ordinary cars to
human8/AI6, jointed parts1, split/free parts2/3 and noncars4; `crashOwnerSlots`
holds culprit ownership separately. That table is private. The integration
must expose its actual native descriptor/culprit facts rather than infer
type1 ownership from `.owner`, actor parentage, `.human`, or the latest pair.
Normal existing ped-body type2 uses the character-owner chain. Type5 detached
bone is rejected by this helper; mapping it to type2 would invent inheritance.
Full native hierarchy, drone and tail ownership remain provider seams until
their actual runtime descriptors exist. The module does not fabricate them.

## Speed, height and starting context are separate

No instruction in `0x4cdc60–0x4cddd7` reads or stores speed, contact point,
height, velocity, pre-contact velocity or a hit timestamp. Score `0x4cd010`
reads actual state later, after attribution and ordinary damage/Kill ordering:

- Ordinary Kill supplies height zero at `0x4ccd8f`; falling-forever supplies
  Float32 pedestrian-Y minus `FindYVerticallyBelow` at `0x4d53ce`. Height is
  not contact penetration or car-relative Y.
- Cached killer must exist and its current signed driver must equal 8. Its
  body-axis omega `+0x74`, ACT up/origin-Y, world COM `car+0x4c`, inverse
  physics pose and stored local velocity `+0x1a8` feed geometric alternatives.
  Simulation `RigidState.angularVelocity` is world-axis and needs the actual
  body-axis provider; actor-origin `state.position` is not car COM.
- The actual simple pedestrian body supplies raw world velocity `+0x68` and
  starting velocity `+0x1b4`. A NULL simple-body pointer skips this alternative.
  Neither is derived from the contact's closing speed or force. The score
  comparison is squared length at least two; it does not multiply by 6.9.
- Cache napalm deadline `+0x98` and persistent cause WORD survive attribution
  unless a verified replacement occurs. Positive deadline is a score input,
  not a new deadline stamped by contact.

`NativePedAwardContext` already exposes these optional actual-source inputs.
Missing providers must remain unknown; the attribution module deliberately
does not overwrite them with contact snapshots or invented zeros.

## Validation

Focused tests cover signed-driver and parent branches, sticky indirect and
character inheritance, NULL culprit OR1, full-WORD mine/drone replacement,
tail strict edge and uint32 wrap, mode2 without a clock, zero-lambda dispatch,
unsupported providers and stale-human metadata. The read-only original Eagle
and Buggy fixtures use real loaded rigid states through the same outlet,
exercise noncar-wrapper/direct/world transitions and verify that pose,
velocity, angular velocity and retained napalm deadline remain unchanged.
Original tests skip cleanly when the installation is absent. No proprietary
fixtures or binary dumps are included.

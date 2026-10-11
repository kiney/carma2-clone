# Native pedestrian contact other-body descriptors

## Evidence and implemented contract

The installed HW executable remains read-only, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The binary's pointer assignments and contact consumer were checked against the
rec2 layout map; no reference implementation or original fixture was copied.

`src/physics/ped-other.ts` exports:

- `classifyNativePedOther(body: RigidBody | undefined): PedContactOther | null`
  for contact momentum/damage. It snapshots current raw mass and world V as
  finite Float32 values and preserves the actual owner-present test.
- `describeNativePedAttributionOther(body, providers)` for
  [contact attribution4cdc60](c2-ped-contact-attribution-re.md). It returns
  `NativePedAttributionOther | undefined`. Driver and culprit lookup remain
  simulation-owned; this function never substitutes repair ownership.
- `NativePedOtherAttributionProviders.readCharacterCache(owner, body)` follows
  type2..4 owner `+e4` to the pedestrian/cache. NULL means a real missing native
  chain, while `undefined` means an unavailable provider.

No shared runtime files are changed by this module. Production simulation must
call it from its contact and gameplay attribution adapters; the standalone
descriptor is not evidence of displayed native pedestrian population.

## Source body and owner mapping

| Current body                       | Native type byte | Native owner representation                      | Driver provider                                            |
| ---------------------------------- | ---------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `SimulatedCar`                     | 1                | Its own stable body identity                     | Current `state.driver`, normally8/6                        |
| Jointed `DetachedBody`             | 1                | Independent stable part-body identity            | 1                                                          |
| Free `DetachedBody`                | 1                | Independent stable part-body identity            | 2                                                          |
| Split `DetachedBody`, `part == -1` | 1                | Independent stable split-body identity           | 3                                                          |
| Pulled `NonCarBody`                | 1                | Independent stable noncar-body identity          | 4                                                          |
| Intact native pedestrian           | 2                | Actual `body.owner`, possibly NULL               | Not a car wrapper                                          |
| Explicit native character tags3/4  | 3/4              | Actual tagged owner plus explicit cache provider | Not inferred                                               |
| Detached native bone               | 5                | Actual bone owner                                | Not a car wrapper; attribution rejects type5               |
| `MineBody`                         | `0x40`           | Its `body.mine` object                           | Candidate is `mine.owner.victim`, not the contacted victim |

Installed semi initialization writes driver1 at `436f28`, culprit original-car
pointer at `436f87`, and body owner/type1 at `436f8d–96`. Generic wrapper setup
writes culprit at `42f2e5`, body owner at `42f2f1` and type1 at `42f2fa`.
Detached/split wrapper drivers2/3 are initialized by crush-system setup;
the split3 literal store is `42a0c0`. Pulled noncar driver4 is `42001c` and
its initial culprit NULL store is `42015b`.

The independent wrapper's JavaScript identity is the actual body object.
This is a representation of the native car-spec owner, not a claim that
native physics and car-spec structures occupy the same memory. It maintains
one stable identity for simulation's separate driver/culprit providers.
`DetachedBody.owner` is the original repair car and must not replace that
identity. Current crash-owner storage can legitimately differ from it.

For type2 and type5, a released NULL owner produces `ownerPresent=false`.
An intact bare simple-body fixture with no bound owner likewise does not
pretend to have a native character owner. The actual runtime binds the owner
before inserting the body and clears it only after removal. A type2 descriptor
with a live owner and absent cache provider reports `characterCache=undefined`;
the attribution kernel diagnoses that requirement rather than inventing a
corpse killer. Type5 never requests the character-cache provider.

The mine candidate comes from its firing-owner `victim` identity (the current
`MineCar<T>` wrapper representation), distinct from `mine.victim`, which is
the later struck car. Its cached MineCar driver is not the current driver's
authority; the selected actual car still goes through the simulation provider.
Absent candidate is unknown; an explicit NULL candidate remains NULL.

## Physics parent and culprit are independent

Semi setup at `43705a` calls `PhysicsAddObject4c6160`. That routine stores the
actual hierarchy parent in child `+228` at `4c6172`; rec2 independently maps
the field to `tPhysics_object.parent`. The descriptor reports parent presence
only for a `DetachedBody` joint whose `child` is that body and whose parent is
not itself. This reflects the current concrete semi-detached child binding.
Deleting/rebinding the joint changes the next descriptor immediately.

An ordinary noncar world joint uses the engine's infinite solver anchor.
It is not evidence of native PHIL hierarchy parenting and does not set this
descriptor's `parentPresent`. Actor scene parenting, original repair ownership,
and a generic `!!body.joint` check must not establish the parent branch.
The current descriptor does not reconstruct absent full articulated hierarchy.

`4cdc60` follows **one** candidate culprit `+c8` in its indirect branch.
If a noncar's first culprit is another part/noncar, that pointer itself becomes
the cached killer and cause1 is ORed. It must not recursively chase an eventual
player owner. The later score's driver8 guard can therefore reject that death.
Simulation's public `pedestrianAttributionDriver` and
`pedestrianAttributionCulprit` supply the current wrapper facts separately.

## Mass, velocity and unsupported adapters

Passive `4cda49–77` loads other object mass `+4` three times and multiplies
raw world V `+68/+6c/+70`. There is **no type1 mass cap** in this path.
With zero character V, mass1/2/10 and other V.x=.5 produce squared momentum
`.25/1/25`; the descriptor retains those source masses. It does not multiply
V by6.9, substitute actor movement speed, or normalize by vehicle mass.
The contact kernel owns subsequent source HP normalization/signed-byte rules.

Negative/nonfinite or Float32-overflow mass and nonfinite/overflow velocity
fail explicitly. Explicit rigid tags must be integer BYTE values. Unprepared
type0 bone resources are not admitted as type5 bodies. Only fields read by
these consumers are validated; inertia/model bounds are not invented inputs.

World other `undefined` returns NULL for contact and undefined for attribution.
For existing controlled `RigidBody` fixtures without a native tag, contact
retains the engine compatibility packet type0/ownerfalse and actual M/V.
Known `moving-world` kinematic partners receive the same explicit adapter
fallback. This **does not certify native tagged type0** or complete native
moving-world momentum behavior; attribution is unsupported/undefined.
The source world-only path should remain NULL when there is no physical other.

Explicit source tags on otherwise controlled bodies are retained for contact,
with the actual owner-present check. There is currently no concrete tail/drone
owner runtime chain, so their attribution descriptor stays undefined. The
module never maps them to an ordinary car or invents their clocks/car pointers.

## Validation

Tests cover all supported body categories, independent wrapper identity,
joint-child binding and noncar world anchors, actual simple-body owner release,
type3/4 cache NULL versus unknown, bone5 rejection, mine firing versus struck
owner, finite/F32 boundaries and uncapped raw contact momentum. The read-only
original-data test loads Eagle, creates real free hood and jointed bumper
bodies through the existing detachment host, loads Carrier gun ACT/mechanics
and original mine DAT/GENERAL mass, then validates production driver/culprit
getters and the one-link low-driver attribution case. It skips cleanly when
the original installation is absent. No proprietary fixtures are committed.

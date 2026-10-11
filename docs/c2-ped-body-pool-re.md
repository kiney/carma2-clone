# C2 pedestrian body pools and production registration

## Evidence and integration conclusion

**Verified installed binary, with rec2 used as a symbol/layout map.** Read-only
`carma2_orig/carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
base `0x400000`, entry RVA `0x177eb0`, linker5.10, timestamp1998-10-18
20:13:36. Static instructions were inspected in `/tmp/c2-hw-smash-disasm.txt`;
original FORM/settings data were read through existing parsers. No original
assets or binary dumps are included.

Native pedestrians do **not** each receive an independently registered body.
One shared FORM owns a bounded, preallocated simple-body table and render table.
An ordinarily processed pedestrian reserves its first free render slot, then its
first free simple-body slot and a global PHIL header. Registration happens before
the walking update and before contact eligibility bit0x40. Failure hides/releases
that attempted render allocation and clears its processed bit; it does not evict
an already owned simple body or grant a generic fallback collider.

Production needs shared FORM ownership, the actual native camera/settings gate,
and a shared PHIL header provider. A cache keyed only by personality/template
would give every male personality another30 bodies and violate the source pool.
The stable FORM bone actor is the body actor: changing its current model does
not replace the ACT identity, root matrix or registered owner.

## Owning tables and limits

FORM fields: bone count byte+29; rendering capacity+2a; simple capacity+2b;
boned capacity+2c; stored dismembered capacity+2d; render table pointer+30;
boned table+34; simple table+38. Each render/simple/boned slot is8 bytes,
occupied byte0, owned actor-array/body/body-array pointer4. The global loaded
FORM registry contains20 entries and FindOrOpenForm reuses a matching FORM.
Personality model tables are separate from these shared tables.

Installed original stock data, also present in Advanced:

| FORM                      | Simple | Boned | Render | Stored dismembered | Bones |
| ------------------------- | -----: | ----: | -----: | -----------------: | ----: |
| BIPED1, BIPEDF            |     30 |    10 |     30 |                 30 |    10 |
| DOG1                      |     15 |    10 |     15 |                 15 |    16 |
| cow_form, deer_form       |     15 |    10 |     15 |                 15 |    12 |
| sheep_form, elephant_form |     15 |    10 |     15 |                 15 |    11 |
| Elephant                  |     15 |    10 |     15 |                 15 |    10 |
| penguin_form              |     15 |    10 |     15 |                 15 |     7 |

`SetUpCharacterForm 404f60` allocates the tables, each simple object and BOX shape
once, and assigns the FORM total mass. Each boned slot owns a FORM-bone body
array with authored shapes/joints; this is a distinct provider, not another
intact simple object. Race population may contain thousands of character
records while only these bounded slots have actor/body ownership.

PHIL normal headers occupy `690ae8..691448`, stride18, exactly100 entries.
`PHILGetFreeCount 4b5ad0` returns100 minus global registered count `690a70`.
`4b5ae0` scans all headers: remember the first empty header, return2 for an
existing identical body pointer, return1 if none is free, otherwise clear the
header and set state1. The body receives header pointer+240, indicator+239=1
and passive flag+19c|=20. It joins global object list `748790` through next+220
and previous+22c; existing nonempty lists insert after their current head.
Objects added during actual physics call `PrepareObject 4b9510` immediately.
The100 limit applies to the PHIL object header owner; do not infer that every
entry in the engine's combined car/part/prop contact list uses one PHIL header.

**Correction to earlier lifecycle prose:** `4085f0` calls `4b6050`, an immediate
registration wrapper. If object munging `748788` is nonzero, this wrapper sets
guard `690a74=1`, calls underlying `4b5ae0`, then clears the guard. Therefore
the ordinary pedestrian initializer bypasses the generic deferred-add branch
(`4b5af4..4b5b45`). The generic queue storage is a union with the normal headers,
not another100 available object slots. Do not route ordinary ped registration
through a deferred host queue merely because a collision callback is running.
The PHIL disabled flag `65bb74!=0` makes the wrapper return0 without registration;
this replay/global-disable behavior needs an explicit owner if exposed.

## Camera processing gate and allocation order

Installed `MungePedestrians` starts **4d3510**, not rec2's annotation4d3740.
Outside replay, `4d35e1..4d36ea` visits the source pedestrian array in index order.
There is no view-frustum test, car-distance sort or alive-only test here.

Let `d=abs(ped.pos-cameraWorldOrigin)`, `P=settings.processDistance`,
`Q=settings.popupDistance`, and `recent=(cache exists && cache+8c!=0 &&
uint32(now-cache+8c)<7500)`. Set processed bit1 unless either condition holds:

```text
(vanishedFlag80 || d.x>=P || d.y>=innerP || d.z>=P) && !recent
!previousProcessedBit1 && !globalPedNearness &&
    d.x<=Q && d.y<=innerQ && d.z<=Q
```

The outer extent comparison is strict-inside; the newly appearing inner extent
comparison is inclusive. Processing uses a camera-centered box, not a sphere.
`ReadSettings 4cabee..4cac15` stores inner distances after multiplying the live
scalar by double0.6. Both installed settings files giveP=12 andQ=9 native world
units, so stored inner values are Float32(7.2) and Float32(5.4). Keep native/world
conversion at the caller boundary. `globalPedNearness` is an explicit one-frame
source override, reset at the outer-update tail.

At `4d372a`, an unprocessed character follows the release path. At `4d3734`, a
processed character with negative render-slot byte+4 outside replay executes:

1. `MakeCharacterRenderable 4083b0`: already rendered returns2; otherwise first
   free FORM render slot; full returns1. On1, clear processed bit1 and skip.
2. `MakeCharacterCollideworthy 409030(character, simpleMode0, extra0)`.
   `408c30` can ensure rendering itself; ordinary Munge already has the render.
3. Simple allocation `408eb2..408f38`: first free simple slot for requested−1;
   no free slot returns21. Prepare/init its body and register PHIL; initializer
   failure also returns21. Only success writes character flags+14 **literally1**,
   slot byte+5 and occupied=1. Matching existing simple mode returns23.
4. Return21 calls `CharacterNoLongerRenderable 408400`, clears processed bit1
   and skips. PHIL failure therefore does not leave an occupied simple slot.
5. Successful processing joins `gPedestriansInSight 742954` through ped+50.
   `4d37c4..4d37d2` sets0x20 on first processed visit, else0x40. These bits are
   retained across ordinary offscreen release; do not rearm them solely because
   a body slot was reacquired. Root animation then updates actual actor pose/V.

Alive and dead processed intacts use this same allocation gate. A recent event
can retain an out-of-range or vanished character through the7500ms grace branch;
do not replace that exception with permanent active-body pinning.

## Exact initializer and callback boundary

`4085f0` receives character, existing pooled body, stable prepared actor,
personality bounds, optional COM, type selector and registration/extra fields.
The intact call `408ef0..408f16` supplies root actor0, personality bounds+34,
COM+54, type selector0 (body type+238=2), register1 and extra0.

It copies native actor12 to rigid+8c and records actor at rigid+0; calculates
shape/bounds, inertia and radius through4087b0; stores character owner+23c;
sets ec=1 and ed=1; zeroes world V+68, local omega+74, auxiliary omega+1c0 and
mutable solver-local V+1a8; records byte+190; sets world friction+60=1 and clears
volume pointers+258/+25c. It is not a full memset on reuse: shape/mass are FORM
owned, and untouched fields must not be inferred from a fresh-object default.

Register first, then set properties: gravity0=1, property3=(extra==0),4=1,5=1,
7=1 and8=`global74299c`. Intact extra0 gives all three suppressions3/4/5.
Header drag remains0. Finally vtable+10 invokes `CBFillInObject 4cc860` with
type2, restoring exclusion filters10000/50000. On PHIL return!=0, initializer
returns0 **before** properties and fill callback; the still-free slot may retain
partial actor/owner/preparation writes and must be reinitialized on retry.

No contact flag40 is checked by allocation. A real passive contact activates
header1 through `4162d0 -> 40b620` before the damage callback's flag40 gate.
Activation copies live character V, clears ec, selects header2 with halt callbacks,
sets ed/gravity and clears properties3/4/5; no extra impulse/RNG is introduced.
Walking animation must keep root ACT and character V synchronized while passive.
Moved callback ownership writes the solver root/V back before displayed posing.

The contact provider's `damageTail` must execute sever selection/register/mask
mutation and the common HP/kill tail once before passive/active caller
continuation. Native chance/reserve/register failure still reaches that tail;
a genuinely missing provider is the only deferred outlet. `onContactDamage`
must consume that result without repeating HP subtraction or replacing ACT
identity. See [contact/sever evidence](c2-ped-sever-contact-re.md).

## Halt, release and reassignment

Accepted halt does **not** free a simple slot or PHIL header. `409400` derives
character O from physical root/current animation, poses mode3 and clears active
bit4 before pedestrian halt; callback0 restores bit4 and continues active.
Accepted callback1 keeps ec=1, copies final V to character V, restores properties
3/4/5 and PHIL becomes state1/passive. Ordinary living get-up completion selects
RUN41 or blind/valium WALK30. Dead intacts can remain rendered/passive in their
source dead/lying move and still own the same simple slot; there is no mandatory
"dead means convert to articulated" transition. Head/current model changes can
select modelset1 while retaining the same actor, body and pooled slot.

Modelset1 exists before any hit or registration: ReadPersonality clones each
contiguous nonnull pose0..3 model into set1 after the general remap, and marks
the original set0 model updateable. Installed clone loop begins406e61 and stops
at the first NULL source model. Render-slot acquisition assigns pose0 of the
character's current modelset at40832c..408342. Therefore a dead character
returning to scope can select its existing set1 resources immediately; lazy
modelset1 fabrication in a damage callback is not the native initialization
boundary. Ordinary known NULL selection preserves the40b420 return semantics;
missing actual resources are a provider error, not a reason to replace the ACT.

`SetCharacterPhysicsLevel 409570`:0 releases;1 passive simple;5 active simple;
level bit2 selects boned mode. Lowering an active level calls the halt wrapper
first, then proceeds with requested level0 release. Do not delay out-of-scope
release indefinitely waiting for voluntary quiet-halt acceptance.

`CharacterNoLongerCollideworthy 409090` ordinary simple branch removes PHIL via
`4b5c40`, clears contact-ring pointer+1d8 and owner+23c, marks the same FORM
simple slot free and ultimately clears character flags+14. `4b5c40` cancels a
queued registration, or can defer removal during object munging when its guard
is clear; immediate removal clears header pointer, decrements global count and
unlinks the object list. It returns3 for an absent header. Host mutation must
honor this release phase before allowing another character to use the slot.

`CharacterNoLongerRenderable 408400` also releases collisions outside replay,
marks its render slot free, copies current root to stored character pose+2c,
stores removed-part matrices if storage exists, removes bone actors and sets
render-slot byte+4=-1. Missing storage does not authorize reattaching severed
parts. Offscreen active peds additionally run the source falling-forever/vanish
and kill/award outlets (`4d5366..4d53d3`) before normal release.

Boned roots and removed parts have additional ownership: simple characters with
removed mask+0c may reserve a boned slot+6 for type5 bodies; only bits removed
and not vanished+10 are registered. Simple exhaustion never steals these slots.
`408f46..409019` independently tolerates absent boned capacity or failed part
registration. Release checks each part's PHIL state and sets vanished bits for
state2 before removing it. Full boned mode uses hierarchy/root discovery and
authored constraints. Keep those branches explicit until the actual bone-body
and stored-pose providers are installed; a generic corpse is not equivalent.

## Production provider sequence

```text
for each source ped index:
    update camera/settings/recent-event processed bit
    if not processed: source offscreen outlets, release PHIL/body/render
    else if not rendered:
        reserve first free shared FORM render slot; prepare stable flat ACT poses
        reserve first free FORM simple body, reinitialize against actual root ACT
        request immediate shared PHIL header
        on failure: release render, clear processed bit, skip (no eviction)
        on success: mark simple ownership/character flags, then arm processed flags
    run walking frame root deltas; copy resulting character V/native actor to passive body
physics: normal masks/contact activation/solver/quiet
outer moved/halt: synchronize root/V, apply source decision, retain pool ownership
render: pose existing flat ACTs with active root mode3 or ordinary passive root
```

Required host state is FORM identity and slot occupancy, stable ACT/current model,
render/simple/boned slot indices, independent PHIL state/header reservation,
camera origin/settings, recent-event timestamp, processed/eligibility flags,
root pose/V, stored removed-part ownership, source animation/halt callbacks and
sever/common-tail providers. Fresh-object allocation per population member,
nearest-ped eviction, frustum-based collision eligibility and a fixed fall timer
are unsupported substitutions. This audit changes no runtime modules and runs
no production build; integrated browser/physics tests remain the root owner's
next validation step.

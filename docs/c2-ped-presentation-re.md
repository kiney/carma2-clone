# Ordinary population native animation presentation

`src/ped-presentation.ts` connects existing FORM/BON/SKL asset and pose kernels
to the ordinary `PedestrianSystem` visual actor. It is a rendering adapter over
the existing gameplay movement and corpse transport. It does not enroll a
pedestrian in native PHIL, claim a native physical root, or replace the process,
grounding, contact, severing and recovery owners tracked by PED-06/07/08.

## Source evidence and resource ownership

The verified equations and installed addresses remain in
[root pose](c2-ped-root-pose-re.md), [bone pose](c2-ped-bone-pose-re.md), and
[active move](c2-ped-active-move-re.md). The installed HW executable SHA256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The read-only `madebr/rec2` source map is MPL-2.0; no reference implementation
was copied. `ReadPersonality` maps personality identifiers to MODEL resources
and remaps their vertices/attachments. An identifier ending in `.ACT` does not
instruct the renderer to append an ACT hierarchy's saved default transform.

`loadNativePedAssets` supplies immutable remapped DAT geometry, material/model
pose identities and all FORM moves. The presenter creates private indexed ACT
groups and private mutable world matrices through `createNativePedInstance`.
It never mutates the original asset library, geometry or materials. Disposal
releases only this adapter's actors: by construction it never lends them to
PHIL or a detached-body owner. A later native physical integration must replace
this ownership contract explicitly rather than borrowing these actors silently.

Read-only original measurements with direction world +Z:

| Personality | FORM   | Walking ID / slot | Frame0 root row0                      | Ground offset |
| ----------- | ------ | ----------------- | ------------------------------------- | ------------- |
| CitySwat    | BIPED1 | 30 / 15           | (.0142869912,.999859214,-.0087992903) | .1539999992   |
| Blokebl     | BIPED1 | 30 / 15           | same authored motion                  | .1539999992   |
| Twolf       | DOG1   | 30 / 3            | approximately (1,0,0)                 | .1140000001   |

CitySwat selects MODEL `MANBWC.ACT`. Its native walking sequence has30 frames
at33ms and move scale .3499999940. The full authored root basis places remapped
local X upright. This removes the observed46.63-degree default ACT lean without
a CitySwat correction. The dog's approximately identity root demonstrates why
a shared humanoid upright-axis rotation would be incorrect.

## Runtime contract and deliberate bridges

`NativePedPresentation.update` receives the actual gameplay parent, world
position, heading, raw ground Y, move ID, period, unsigned game time and alive
state. FORM move slot remains independently observable through `moveSlot`.
The presenter uses full root matrices and quantized flat-bone poses; children
are positioned through personality attachments, with orientation `E*O`, not
parent-relative rotations. Its group is attached below the gameplay actor for
existing visibility/render preparation. The group matrix is explicitly the
inverse of the parent's complete world matrix. Native actor matrices remain
world matrices; parent translation/yaw/scale are consequently not applied twice.
Do not write procedural group position/rotation, foot offsets or sinusoidal
limb motion on this path.

Gameplay displacement remains authoritative. The adapter advances the native
clock/root delta kernel, then anchors root X/Z at actual gameplay X/Z and poses
children around the corrected root. It retains authored vertical root delta
phase and shifts its baseline with actual gameplay vertical displacement.
Grounded move selection adds the authored clearance to raw ground Y once.
There is no mesh-derived foot correction or per-fraction ground reprojection.
This deliberately preserves legacy movement/avoidance instead of introducing a
second root transport. Native animation velocity is diagnostic within this
render-only instance and must not be interpreted as the gameplay or PHIL V.

On a move change the adapter initializes via existing source-informed helpers,
then sets the animation timestamp to0, matching installed SetCharacterMove's
reset sentinel. The next clock visit initializes without applying new-move
translation. A period-only update preserves frame/fraction/timestamp. Heading
changes use the existing root reorientation helper, preserving the authored
current frame basis. The generic instance helper combines direction and move
selection; this adapter's ordering is a presentation bridge rather than a full
replacement for native SetCharacterMove/SetCharacterDirection dispatch.

For `legacyRigid:true`, alive corporeal movement retains the last native pose
and clock, following the gameplay actor's full rigid transform from its previous
parent matrix. Ordinary animation resumes with a zero timestamp so offscreen or
rigid transport time is not consumed as a catch-up burst. Death likewise freezes
the native bone pose/clock; `legacyFall` supplies the existing corpse pitch and
root height. One rigid transform moves all frozen bones coherently, retaining
attachment coincidence. This is explicitly the legacy corpse approximation,
not BON death playback, articulated contacts or a native physical root. Revival
requires `reset`, which is also the race reset entry point.

Unsupported requested moves report named providers and retain an existing
supported pose. With no supported initial pose the group remains hidden rather
than displaying an invented upright rig. The presenter does not choose a generic
move fallback. Morph interpolation, active-body ownership, removed/severed bones,
mutant RNG, altered scale/head rendering and prepared powerup vertex playback
remain their existing explicit providers and follow-up integration scopes.

## Validation

`tests/ped-presentation.test.mjs` loads original CitySwat, Blokebl and Twolf
resources read-only and skips cleanly without an installation. It verifies
source model/resource identity, full frame0 bases, distinct ID/slot mapping,
attachment coincidence, native clock initialization, parent inverse compensation
under nested translation/rotation/nonuniform scale, single gameplay transport,
reset, unsupported-move diagnostics and coherent frozen rigid/corpse movement.
No original model or motion fixtures are committed.

## Integrated ordinary population and remaining ANI-01 scope

The production population now creates this presenter for actual Assets-backed
personalities and retains its existing gameplay/count identity as the parent.
The minimal procedural path exists only for isolated synthetic hosts without an
Assets resource library. All 791 Newcity1 pedestrians use native presentation in
both Stock and Advanced. The selected race's resource root reaches settings,
personality, FORM, REMAP and motion loading. Exact unsupported resources produce
structured loader errors; mixed populated groups also report missing personalities
rather than claiming complete availability after filtering them.

Only processed ordinary actors advance their animation. Distant retained actors
keep their current pose, and native-counting/body owners are excluded from this
render bridge. Walking and running use their current gameplay frame periods;
stationary move0 uses its authored period rather than freezing a multi-frame idle.
Original DOG1 idle has32 frames at33ms and is a regression case. Reset reselects
the source initial pose; presenter actors release before template resources.

ANI-01 remains **wip**. The normal living root/bone bridge does not complete
native death-animation selection/playback, morph interpolation, mutant-angle RNG,
altered head/model-set rendering or exact prepared pedestrian vertex consumers.
Those animation/render obligations remain with ANI-01 or their existing powerup
owner; they are not silently reassigned to physics. Legacy death currently freezes
the supported BON pose and applies its existing rigid fall/transport coherently.
Actual population PHIL, recovery, sever and contact-cause ownership remains
PED-06/07/08/09, in the selected queue order.

## Browser and regression evidence (2026-10-29)

The full numerical/original-installation suite passes3,359 tests, zero failures,
with five optional saved-capture skips. Subsequent focused integration tests also
cover the stationary dog idle correction and explicit mixed-group unavailability.
Production build passes. `browser-ped-animation.mjs` passes Stock/Advanced Newcity1:
791/791 native presentations, source move30/slot15, changing frame/bone matrices,
no doubled gameplay translation, original model geometry under identity resource
groups, ordinary sweep death counted once, visible retained corpse, reset and
old-template disposal on race reload. These are labelled controlled presentation
checks, not native PHIL contact proof. Headless backend is SwiftShader at1280x800;
console errors, failed requests and WebGL errors are empty.

Separate Chrome DevTools hardware inspection uses the isolated production build
without reloading the user's paused game. Actual processed CitySwat advances to
frame16 of move30, remains alive, and has local-X world-up0.99994 instead of the
prior46.63-degree package-ACT lean. GL error0, no animation diagnostics. Original
assets, screenshots and generated reports stay outside Git; the original game
installation is read only.

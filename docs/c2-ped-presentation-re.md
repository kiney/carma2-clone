# Native pedestrian animation presentation (ANI-01)

`NativePedPresentation` connects original FORM/MODEL and BON/SKL data to the
ordinary displayed population. ANI-01's animation/render scope is implemented.
Population PHIL admission, articulated contacts, severing and native recovery
remain PED-06/07/08/09; animation completion does not complete those owners.

## Evidence and source data

The installed HW SHA256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The read-only rec2 MPL-2.0 checkout supplies symbols; binary inspection resolves
its incomplete or conflicting branches. No reference implementation was copied.

- [Root clock/pose](c2-ped-root-pose-re.md) and
  [flat bone pose](c2-ped-bone-pose-re.md).
- [Morph and mutant equations](c2-ped-special-animation-re.md): installed
  SetCharacterMove, MorphCharacterBonePositions, StopCharacterMorphing and
  guarded byte-angle CRT perturbation. rec2's morph-rate expression and root
  deltas differ from the installed implementation.
- [MODEL scaling and prepared vertices](c2-ped-render-effects-re.md): installed
  body/head scale setters, per-bone powerup remaps, attachment scaling, private
  living/dead MODEL ownership and actual prepared allocation order.
- [Dead models](c2-ped-dead-model-re.md),
  [passive Stillify](c2-ped-passive-stillify-re.md), and
  [move FSM/completion](c2-ped-native-gameplay-re.md).

`loadNativePedAssets` loads exact named MODEL resources, remaps DAT vertices and
attachments, and retains actual material-pointer preparation options. A token
ending in ACT does not append that ACT package's saved transform. CitySwat's
MANBWC walking root consequently has local-X world-up approximately .99994,
instead of the package's 46.63-degree default lean. DOG1 uses its distinct authored
root basis and multi-frame stationary idle, without a humanoid axis correction.

## Pose and transport ownership

Full native world matrices live under an inverse-parent group. Gameplay
translation/yaw therefore applies once, including nested parents with scale.
Existing gameplay owns ordinary X/Z displacement. The renderer advances the
native clock but reanchors X/Z once and retains authored vertical phase; its
second child reanchor uses cached sampled angles, without another CRT draw.

Only processed ordinary actors advance clocks. Distant presented actors retain
poses. PED-10 admits already visible near actors before movement/contact checks;
its correction and strict source camera-jump threshold remain in place.

Alive legacy corporeal/repulsed actors retain their current BON pose and follow
their existing full rigid transform. That is a transport bridge, not a PHIL claim.
Dead actors now select the gameplay caller's actual death BON and advance child
angles around the legacy body's root. No new impact-direction classifier is
invented. Source positive completion moves 90–92 to 97 and 96/97 to 94 when dead;
actual FORM availability uses the original executable's 118-row fallback table.
For example DOG1's missing 97 falls back to 72, not a guessed humanoid pose.

The existing two-second ordinary corpse settling/root transport remains a
physics approximation. Animation does not replace it with another body solver.
Its settled move94 invokes source Stillify after BON: period is changed only
when the mutant-speed/period zero status mismatches. Move113 is exempt. Cached
reanchoring still follows a moving root at period zero, retaining attachments.

## Models, head sequences and powerups

On an eligible physical/gore death, the displayed instance selects actual blood
MODEL set1, all pose0 then head pose2, and clears its head sequence. Known NULL
head poses preserve the source model-selection return behavior. Scare/calm
sequences use the verified source tables and strict 125 ms gate; model swaps do
not advance BON. Reset restores MODEL set0/pose0 as well as the clock and root.

Powerup actions 2, 32 and 33 use normal grants, shared group cancellation, timed
expiry and reset. `PowerupSystem.pedestrianAnimationState` provides body XYZ,
head factor and mutant speed. Authored giants, dwarfs, huge heads and mutant
corpses reach the renderer; debug grants reuse the same paths. Positive finite
sizes are explicit host input bounds; installed callbacks themselves do not
validate those parameters. Native physical resize remains PUP-08/PED-06.

A private personality resource copy is shared by all its presenters, rather than
cloning vertex buffers per person or mutating source assets. Body/head changes
update living/dead vertices, remapped child/parent anchors and personality data.
Whole-body ACT-origin correction follows ScaleForm: for supplied supportY>-100,
`actorY=f32((oldY-supportY)*ratioX+supportY)`, with up to eleven support attempts
raised by Float32 .2. Head scaling has no origin correction. Retained distant
poses are reposed once from cached angles so extended visibility stays coherent.
BON phase and shared RNG do not advance during this refresh.

Mutant jitter uses the shared CRT integer stream only for eligible children of
signed-HP<=0/action6 corpses on a new clock visit. Authored BON angle arrays stay
immutable; cached reanchors do not consume extra random samples. Morph playback
has source signed-byte interpolation, its twenty-slot ownership, interruption,
retained-root controls and ordinary-clock handoff. The zero-angle/zero-elapsed
native Infinity\*0 case is explicitly diagnosed instead of publishing NaN poses.

## Prepared effect consumers and lifetime

Napalm now selects a vertex from the actual root ACT's current MODEL prepared
allocation. It preserves the inclusive first-group upper bound, which may reach
the next group's first vertex. Invalid final one-past-allocation reads fail
safely; there is no clamp or render-corner deduplication. Sampling follows model
switches and scale changes without a second world transform.

Presenters release before shared effect geometry, dead MODEL geometry, the
race's cloned MAT registry and original templates. Active burning outlets are
stopped before their geometry is disposed. Original resources remain read-only;
all generated screenshots/reports stay ignored.

## Validation

Numerical tests cover signed-angle morphs, clock handoff/interruption/pool reuse,
mutant guard/draw order, original human and DOG death sequences, frozen-time root
transport, head variants, reset, native prepared order/welding/material identity,
source-preserving body/head scaling and shared resource release.

`npm run test:ped-animation` runs the original living-population checks and the
completion integration checks. Stock and Advanced Newcity1 retain all 791 native
presentations. The latter uses actual source powerup grants/expiry plus a labelled
controlled death call followed by ordinary population updates. It verifies
set1/head2, advancing death frames, Stillify, moving corpse roots, shared mutant
RNG, body/head changes across shared personalities, immutable source arrays,
set0 reset and clean console/request/WebGL results. Headless SwiftShader
1280x800 is correctness evidence, not hardware performance evidence.

Hardware DevTools inspection uses ANGLE AMD/Radeon gfx1150 at 2070x1435. A real
processed CitySwat actor displays the source walking pose, action32 head factor4,
death91 frames0–4, blood set1/head2 and move94 mutant period132 with changing
joint matrices. No animation diagnostics, console errors or WebGL errors occurred.
The isolated diagnostic camera/controlled kill do not claim native contact proof;
the user's original paused game remains untouched.

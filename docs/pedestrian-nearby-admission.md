# PED-10: nearby visible pedestrian admission

## Reproduced live failure

In the user's paused original Newcity1 scene, `ped-spec1-456` stood 1.0765 actor
units from Eagle. It was alive and visibly rendered, but inactive, in the retained
`dormantRenderActors` set and frozen at animation frame 0. Its rendered root
matched its gameplay position; this was not a BON transform/contact displacement.
Camera and actor were inside both process 12/7.2 and popup 9/5.4 bounds.

The native popup predicate prevents a previously unprocessed character from
appearing suddenly in the inner camera box. Native unprocessed characters lose
rendering; see the installed gate 4d35e1–4d36ea in
[body-pool evidence](c2-ped-body-pool-re.md). PERF-04's browser presentation
extension instead exposed these retained poses. Keeping the native appearance
suppressor unchanged after showing an actor could leave a permanent visible,
stationary, unhittable pedestrian in front of the car.

## Bounded correction

Normal ordinary admission is now:

```text
inside original process box AND
(previously active OR one-frame nearness reset OR outside popup box
 OR already admitted by retained presentation)
```

Retained presentation membership is read before its next render-phase rebuild.
Do not use raw `actor.visible`: initial/default visibility does not establish
presentation admission. Promotion runs before the inactive early return, movement,
combat and ordinary car sweep. Immediate removal from the dormant set invalidates
its retained-matrix certificate before the pose changes. A same-update hit counts
once through the existing population/award path.

The process box, popup dimensions and distant 48-unit visual range are unchanged.
Distant presentation-only actors remain animation-frozen and combat-ineligible.
Unopted callers retain native popup behavior. Reset, disposal and native body
binding clear the existing retained-presentation membership; native-owned
transport is not re-enrolled by this rule. Rendering newly exposed nearby poses
can precede admission by one graphical frame, but the next ordinary pass cannot
leave them permanently inert.

`CalculateCameraStuff` in rec2 (`mainloop.c`, annotated 4940e0) calls
`ResetPedNearness` (annotated 4d6390) when squared camera displacement is strictly
above 400, i.e. greater than 20 actor units. This camera hook is reconstructed from
rec2; these annotations are not presented as newly verified installed addresses.
The browser now observes actual camera calculations after pedestrian processing,
setting the override for the next population pass. Extra paused drawing frames
retain the sampled pose. Equality at 20 does not reset. The camera phase is not moved
and no second pedestrian update is added.

## Validation and ownership

Ten presentation-distance tests cover the exact near-popup deadlock, same-update
ordinary hit/count, strict camera threshold, unchanged process boundaries,
unpresented popup suppression, distant no-RNG/no-combat behavior and reset/native
transport invalidation. Thirty-nine focused tests also include native rule,
animation, dormant matrix and population-availability regressions.

`npm run test:ped-ghosts` replays the captured original actor/location in Stock
and Advanced Newcity1. It establishes an inactive but visible retained actor
inside popup, confirms first-pass activation while the camera-reset override is
false, then drives Eagle with real keyboard input into it. Each target is counted
once and retains its visible corpse. Headless SwiftShader buffer 1280x800 is
reported separately from hardware/manual playtesting. Both cases pass with no
console, request or WebGL errors. Controlled dormant setup is labelled explicitly;
normal application updates, physics, keyboard input and death callbacks are used.

Original assets stay external/read only; generated reports/screenshots are
ignored. This repairs browser-added visibility/activation coherence, not the
separate native PHIL, recovery, severing or remaining ANI-01 animation providers.

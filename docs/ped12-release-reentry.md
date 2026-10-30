# PED-12: repeated part release stalled TIMBER

## Observed failure

A user playtest on Stock TIMBER, production commit `9ca9f6c`, repeatedly threw
`Prepared native bone resource required`. Each animation callback aborted in
`NativePedRuntime.boneHost.registrar.remove` through `releaseRemovedParts`,
ordinary root removal and population scope release. This was a lifecycle
exception, not evidence of a slow vehicle collision solver or insufficient GPU
throughput.

The live scene was paused and a114,570,844-byte `.c2bug` diagnostic was saved
locally before any reload. The affected original BIPED1 owner32156 had
`removedBoneMask=vanishedBoneMask=56`, slot0 in `release-pending`, root PHIL
state0 and absent bone resources with cleared owners. Captures and derived
reports remain ignored in `artifacts/`.

## Root cause and correction

Reacquisition correctly skips vanished removed bones. It can nevertheless
reserve the FORM's stable boned slot for a character whose removed parts have
all vanished. A later ordinary release correctly visits every removed bit.
The runtime registrar adapter incorrectly required each resource to be a fully
prepared solver body before checking whether PHIL still owned it.

The fix restores the registry contract at that boundary: PHIL state0 returns
code3/complete directly for the stable resource identity. A live resource still
must pass `preparedBone()` validation and complete actual simulation removal;
deferred removals retain their existing proof and pending-slot ownership. No
exception is swallowed, and vanished bits are not blindly skipped: an active
part can become marked vanished before its deferred removal completes.

Evidence is the live reproduction, deterministic lifecycle tests, the existing
PHIL absent-identity code3 contract and the independently reconstructed
[removed-part release/reacquisition rules](c2-ped-bone-runtime-re.md). This is
an adapter correction; vehicle physics, pedestrian damage, randomness and
source masks are unchanged.

## Regression coverage

`tests/ped-release-reentry.test.mjs` covers:

- Active severed part release, re-entry and three further release cycles.
- Mixed vanished active and surviving passive parts; only the latter reacquire
  a body and pose, with zero velocity/omega.
- Stable FORM slot reuse by another personality before the original returns.
- Malformed **live** bone resources still fail validation.

The first three scenarios failed with the exact reported stack on the old
engine; the fourth already passed. All four now pass without editing the
frozen test file (SHA256
`1ead6cdb44e071ae15448129ad6d4f9b04539283fcedcd9e74421f9fc1b572be`).
Assertions include damage/masks, stable identities, no new random draws, no
vanished-pose reads, exact pool/PHIL ownership and idempotent completed release.
Existing18 concrete runtime bridge cases cover deferred releases and also pass.

## Live-scene validation

After saving the evidence, the same absent-identity branch was applied to the
live runtime's registrar object without reloading or resetting the race. This
is a runtime validation patch; the production source contains the identical
correction. Over1.8seconds the exact stalled scene completed96 game updates
and98 render callbacks, with no new errors and WebGL error0. Owner32156
released slot0; all five previously severed characters retained their HP and
removed/vanished masks. The player moved normally from its original location.
The game was paused again afterward. The rolling capture is diagnostic, not a
claim that an arbitrary full-game snapshot can be restored.

## Final validation

- Production build/TypeScript passes in the isolated candidate and root checkout.
- Full original-installation suite:3,760 pass,6 optional skips,0 failures.
- Original Stock/Advanced Chromium sever/population fixture passes actual PHIL
  contact, damage, severing, scope release/reacquisition and teardown, with no
  browser errors or failed requests.
- Asset-free CI:3,257 pass,439 original-dependent skips; one known intermittent
  Vite HMR shutdown timeout. This unrelated server lifecycle race is separately
  tracked as QUA-15/TASK-138, without weakening or retrying its assertion.
- The user's exact stalled hardware-rendered scene recovered without reload as
  recorded above. The live registrar patch remains installed for that tab;
  future page loads use the corrected production build.

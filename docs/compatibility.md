# Compatibility

## Executive Summary

The engine loads many stock and Advanced tracks and cars from a local installation, including original geometry, materials, pixelmaps, and TIFF textures. Its ordinary vehicle/crash paths are reconstructed from C2 evidence, while mission, campaign and AI behavior remain incomplete. Some individual source assets are malformed or incomplete, and mission/campaign and several animation systems remain outside supported behavior.

## Supported content

The asset service reads loose files and Carmageddon TWT archives. Readers cover BRender DAT geometry, ACT hierarchies, MAT materials, PIX/P16 pixelmaps, TIFF textures, WAM deformation metadata, BON/SKL motion data, and track/car/race configuration. Track setup uses source grid positions, gates, race paths, sky settings, and available lap and timer values. Car setup reads practical mechanical values and model references. Missing pixelmap names can fall back to filenames.

The browser reuses original scene and vehicle assets. Its menus and HUD are new browser UI. Opponents, pedestrians, audio and some race rules remain approximations. Opponents follow available path graphs. WAM crush planes, part softness, bend/split fields and damage programs drive localized permanent deformation, twelve component levels and physical detachable parts. Component faults affect the drivetrain, steering, brakes and wheels. Pedestrians use original textured models with simple generated limb movement and flee/hit behavior. BON/SKL motion is parsed but not played back. Engine, impact, checkpoint, and gesture-unlock sounds are supported.

Partial funk/groove behavior includes rolling and steering objects, brake-light atlas changes, water, and fans. Four-wheel suspension, steering, tyre limits, gears and angular dynamics use the independently reconstructed ordinary-road solver. Race completion supports configured laps, eliminating all opponents, or eliminating pedestrians when selected; mission logic is approximated and unsupported objectives are presented as free driving.

Power-up support covers original placed credit, repair, time, engine/grip, invulnerability, free repairs, damage magnification, granite protection, APO levels/slots and active-effect cancellation. Source duration, parameter and reset rules drive the damage effects; granite protects without changing physical mass. Source APO fallback, limits and compensation are implemented. Unsupported effects remain visible; credit/time random ranges currently use deterministic midpoints.

## Known limits

Special-volume/water and oil physics, moving-platform reactions, some articulated special cases, FLIC playback, replays, campaign progression/unlocks, remaining power-up effects and full mission logic remain incomplete. Physics acceptance is still under validation; see `c2-physics-re.md` for current gaps. BON/SKL playback is also not implemented. Funk/groove support is selective and does not reproduce every original directive.

Some source content has concrete data issues. Legacy ACT string references with stale chunk lengths, including `CPOINT.ACT`, are supported. `PROG.ACT` lacks a BRender header. The ADV Digga ACT is truncated; two Forklift DATs contain non-finite UV values, normalized with diagnostics while preserving strict finite geometry parsing. All 52 stock car mechanics/shape pipelines now load, including Forklift. The Nuke race config has no player start and its expected ACT is absent. These entries may fail to load or cannot be driven as configured. Some mission/arena configs contain no usable checkpoint gates and therefore cannot complete a checkpoint race.

The Advanced installation also contains malformed MAT and UI PIX files. Some Advanced track texture references point to TIFF images in nested directories; those are supported, but unresolvable or missing source files can still produce fallback materials or incomplete surfaces. Large scenes may be limited by browser and GPU memory, especially when building collision queries.

## Tests

`npm test` runs unit and fixture tests; tests requiring the original installation skip when it is absent. `npm run test:browser` builds the production app and launches an installed Chromium through Playwright Core. The browser check drives configured stock and Advanced races and records screenshots in ignored test artifacts. It requires a local installation and a compatible Chromium binary.

# Compatibility

## Executive Summary

The engine loads stock and Advanced tracks and cars from a local installation, including original geometry, materials, pixelmaps, and TIFF textures. Ordinary driving and crash behavior has numerical, headless, and prior Chromium checks. Water, oil, moving platforms, world destruction, noncars, and mines now have source-based runtime paths and stock/headless coverage; the current integration of these newer systems still awaits browser regression. Mission, campaign, AI, and several animation systems remain incomplete.

## Supported content

The asset service reads loose files and Carmageddon TWT archives. Readers cover BRender DAT geometry, ACT hierarchies, MAT materials, PIX/P16 pixelmaps, TIFF textures, WAM deformation metadata, BON/SKL motion data, and track/car/race configuration. Track setup uses source grid positions, gates, race paths, sky settings, and available lap and timer values. Car setup reads practical mechanical values and model references. Missing pixelmap names can fall back to filenames.

The browser reuses original scene and vehicle assets. Its menus and HUD are new browser UI. Opponents, pedestrians, audio and some race rules remain approximations. Opponents follow available path graphs. WAM crush planes, part softness, bend/split fields and damage programs drive localized permanent deformation, twelve component levels and physical detachable parts. Component faults affect the drivetrain, steering, brakes and wheels. Pedestrians use original textured models with simple generated limb movement and flee/hit behavior. BON/SKL motion is parsed but not played back. Engine, impact, checkpoint, and gesture-unlock sounds are supported.

Partial funk/groove behavior includes rolling and steering objects, brake-light atlas changes, water, and fans. World GROOVE poses preserve source actor hierarchy; 212 stock blocks parse. Relative-frame contact against finite moving triangles is implemented independently, but exact native platform callbacks and original stop-animation behavior remain open. Four-wheel suspension, steering, tyre limits, gears and angular dynamics use the independently reconstructed solver. Race completion supports configured laps, eliminating all opponents, or eliminating pedestrians when selected; mission logic is approximated and unsupported objectives are presented as free driving.

Power-up support covers original placed credit, repair, time bonuses/freezing, weighted random effects, engine/grip, invulnerability, free repairs, damage magnification, granite protection, APO levels/slots and active-effect cancellation. Actions 34/35 provide negative-`initialValue` charge inventories, selected with Tab and activated with F; mine, mortar, oil-drop, direct mine-hit and visual crush paths are integrated. Mine mass comes from GENERAL, and explosion animation uses the source frame setting. Mine sphere contacts currently use a sampled convex approximation (PHY-05); no radial explosion damage is applied. OILDRUM definition data includes three stock actors above the original 32-polyvertex limit, which produces a warning and static fallback. Remaining unsupported effects are collected with an explicit `NOT IMPLEMENTED` notification.

## Known limits

Water and oil formulas have source-based stock tests and prior MCP checks; the latest world/powerup integration still needs browser regression. Moving-platform contact is headless integrated, with exact native callback behavior still unproven. Mine sphere contacts remain approximate; wire contacts are not implemented. FLIC playback, replays, campaign progression/unlocks, remaining power-up effects, full mission logic, and BON/SKL playback remain incomplete. Funk/groove support is selective and does not reproduce every original directive.

Some source content has concrete data issues. Legacy ACT string references with stale chunk lengths, including `CPOINT.ACT`, are supported. `PROG.ACT` lacks a BRender header. The ADV Digga ACT is truncated; two Forklift DATs contain non-finite UV values, normalized with diagnostics while preserving strict finite geometry parsing. All 52 stock car mechanics/shape pipelines now load, including Forklift. The Nuke race config has no player start and its expected ACT is absent. These entries may fail to load or cannot be driven as configured. Some mission/arena configs contain no usable checkpoint gates and therefore cannot complete a checkpoint race.

The Advanced installation also contains malformed MAT and UI PIX files. Some Advanced track texture references point to TIFF images in nested directories; those are supported, but unresolvable or missing source files can still produce fallback materials or incomplete surfaces. Large scenes may be limited by browser and GPU memory, especially when building collision queries.

## Tests

`npm test` runs unit and fixture tests; tests requiring the original installation skip when it is absent. `npm run test:browser` builds the production app and launches an installed Chromium through Playwright Core. Existing browser checks cover configured stock and Advanced driving/races; browser regression for the newer water/oil, world destruction, noncar, platform, and mine paths is still pending. Screenshots are stored in ignored test artifacts. The browser check requires a local installation and a compatible Chromium binary.

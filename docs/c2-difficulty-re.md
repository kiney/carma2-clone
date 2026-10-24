# C2 difficulty selection reconstruction

The selection menu offers Easy, Medium and Hard as original skill indices 0,
1 and 2. Easy is the default. The chosen index is stored in browser local
storage and captured when a race load begins and published only when its new vehicle is committed; changing the menu while paused
affects the next load and does not mutate the live simulation.

The runtime applies the selected skill index to original three-column GENERAL
and pedestrian award tables: initial upgrades and starting money, upgrade and
repair pricing, collision softness and car damage, crash damage awards, race
checkpoint/time/wastage/completion awards, pedestrian awards, cunning-stunt
credits, and the native opponent AI skill hook. Network columns, campaign
progression, and parsed-but-unused recovery/rolling award fields remain outside
this selector scope.

This is a browser wiring of parsed original values, not a claim that all native
difficulty behavior has been reconstructed. The pure selector mapping is
covered headlessly; the optional browser test verifies persisted selection,
the Easy default path indirectly through the default parser, and that changing
difficulty affects the next race load rather than the current simulation.

The headless Chromium application check also compares actual starting upgrade
levels, potentials and money against its original parsed tables at Medium and
Hard. An unavailable-track preflight preserves the loaded skill, and a clean
browser context starts at Easy. No fatal console/request errors were observed.
This is functional SwiftShader validation without a physical-display handling
comparison. `npm run test:difficulty` reproduces the browser check.

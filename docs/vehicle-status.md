# Vehicle status display

The vehicle status view exposes the twelve native `DAMAGE_SYSTEMS` in source
order: engine, transmission, driver, steering, four brakes and four wheels.
Each row displays the raw component damage value on its authored 0–99 scale.
Progress bars use a maximum of 99 and carry accessible component labels; the
view does not infer a health percentage or write back to simulation state.

The compact HUD presents the component grid in three columns and active
powerups in a short list. It shows up to six effects and reports how many more
are available in the full menu. The vehicle-status details section contains all
twelve full component names, their damage values and every active powerup.
Durations are supplied by the caller from powerup state: `null` means `Race`,
and timed effects display ceiling seconds in `M:SS`. Authored effect names are
inserted as text.

`createVehicleStatus` builds its DOM nodes once and updates displayed values
only when they change. Effect rows are keyed by native powerup index. Missing
or invalid component levels hide the HUD damage grid and show `No vehicle
loaded` in the details section. An empty effect list hides the HUD effects and
shows `No active powerups` in the menu. The component accepts state snapshots
and does not advance clocks, change damage, apply repairs or control powerup
lifecycle.

Formatting and source-order tests live in `tests/vehicle-status.test.mjs`.
`tests/powerup-status.test.mjs` checks recipient ownership, copied snapshots,
group cancellation, renewal, and the existing begin/finish-frame timing boundary.
`npm run test:vehicle-status` checks the integrated original Newcity/Eagle scene:
all twelve explicit component values, normal debug full repair, authored timed
and whole-race effects, renewal, cancellation, pause, expiry while the race timer
is frozen, and reset on a new race. A shortened duration is an explicitly marked
in-memory test fixture. The headless Chromium check uses SwiftShader WebGL2;
it verifies DOM/runtime behavior and a screenshot, not hardware performance.
This is a compact diagnostic/status view, not a claim of original HUD pixel
parity.

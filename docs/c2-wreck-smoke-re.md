# C2 wasted-car smoke producers and repair lifecycle

Verified by static analysis of the installed read-only HW executable, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Image base is `0x400000`; addresses below are VAs. rec2 supplies names and
structure hypotheses; the installed instructions determine behavior. The port
is independent and does not include executable dumps or proprietary fixtures.

| Path                        | Installed address              | Browser implementation                                            |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| CheckDamage wreck producers | `0x43f7b5–0x43f80f`            | `createNativeWreckColumns`, ordinary `onWasted`                   |
| CreateSmokeColumn wrapper   | `0x4fb620`                     | Wet gate and caller/smudge random draws                           |
| StopCarSmoking              | `0x4fc7d0`                     | `SmokeSystem.shortenCarColumns`                                   |
| StopCarSmokingInstantly     | `0x4fc800`                     | `SmokeSystem.expireCarColumns`                                    |
| TotallyRepairACar           | `0x439460`, call at `0x439469` | `VehicleSimulation.onFullRepair`, before damage/suspension repair |
| Special-volume update       | `0x4ff27a–0x4ff2a8`            | `VehicleSimulation.onWetSmoke` after selecting the live volume    |

## Wasted event

Only network mode zero reaches this producer in CheckDamage. It first draws
integer `0..1`. A nonzero draw shortens existing matching-car columns to at
most 2000 ms, then attempts a 20000 ms fire column. Regardless of that branch,
it attempts a 180000 ms fire column. Both use mode 1 and colour 0.

Each attempt draws integer `0..11` before calling the wrapper. This is the
column's first-prepared-group index, **not** an original DAT index and **not**
the car-file fire-vertex array. The wrapper rejects when the selected special
volume's stored gravity multiplier is below 1 (`0x589ffc`). When dry and
knackered, it consumes another `0..11` selection into the authored fire array
before SmudgeCar. Installed SmudgeCar `0x4fc750` is a RET, so that second draw
has no visible smudge effect. It still advances the shared CRT stream.

Persistent damage state, existing explosion/sound feedback and race awards
remain separate from column creation. It is called once on ordinary newly
wasted transition, not repeatedly from render frames or a global armour bar.

## Repair and water

StopCarSmoking caps every matching active source's remaining lifetime without
changing the ring cursor, allocation state or another car's columns.
StopCarSmokingInstantly writes remaining lifetime zero; the next column pass
performs retirement. Full repair invokes this before repairing bodywork. Held
incremental repair is not automatically treated as that full-repair call.

The volume routine repeats its gravity-below-one test on every update, including
an unchanged volume. If the car has smoke, it shortens those columns to 2000 ms.
The verified comparison constant at `0x58a16c` is Float32 1. The port can safely
skip the separate IsCarSmoking call because shortening an empty matching set
does nothing and consumes no random values.

## Source positions, validation and remaining gaps

Mode 1 samples live deformed principal geometry, adds the principal ACT's
translation, and then maps through the column/master ACT. See
[prepared-model ordering](c2-car-prepared-re.md) for DONT_WELD smoothing sums,
NULL-material group selection and the explicit positive-material ordering gap.
The smoke consumer handles the original upright hysteresis, inverted shape Y
and split-half predicate. Cockpit adjustment requires the live cockpit state
and original driver Z offset; it must not be mistaken for an Eagle-only effect.

Numerical tests verify caller order, all random draws, wet rejection, network
exclusion, matching-car lifetime changes and full-repair ordering. Original
Eagle/Buggy tests verify repeated wet-volume callbacks and dry recovery.
Chromium verifies the ordinary wreck path produces the two authored durations
and visible flames after impact explosions expire. The browser harness records
controlled impact placement separately from driven crashes.

This implements the wasted producer and lifecycle, not every component-damage
smoke tier. Other source producers, native material allocation order for cars
without a NULL group, complete random-consumer chronology and positional audio
remain tracked separately; this note does not claim full effect parity.

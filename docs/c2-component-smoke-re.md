# Component damage smoke and fire

Evidence is verified from the installed read-only HW executable (image base
`0x400000`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`).
Addresses below are VAs. rec2 supplies symbol/structure names; these functions
are independently implemented from the installed instructions and original
configuration, without reference source or proprietary fixtures.

| Native path                                                   | Implementation                                                   | Important contract                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CrashEarnings 0x440530`, `DoCrashEarnings 0x440550–0x441239` | `nativeCrashSmokeReturn`, `VehicleSimulation.attributeCrashPair` | Smoke return is independent of attacker selection and accumulator cleanup.                   |
| `SortOutSmoke 0x440120`                                       | `dispatchNativeDamageSmoke`                                      | Twelve component levels and a separate previous-smoke baseline.                              |
| `SetCarSmoke 0x4fc840`                                        | `SmokeSystem.spawnComponentColumn`                               | Ordered quality replacement, existing-owner lifetime writes, wet gate and long-lived column. |
| `StopCarSmoking 0x4fc7d0`                                     | `shortenCarColumns`                                              | Cap matching-owner lifetimes, including inactive retained slots.                             |
| Held repair `0x44342a`, call `0x4434f7`                       | `VehicleSimulation.step`                                         | Copy repaired component levels to smoke baseline, then shorten matching columns to 2000 ms.  |
| Full repair call `0x439469`                                   | `VehicleSimulation.repair`                                       | Expire columns before clearing damage and baselines.                                         |

## Crash wrapper and separate baselines

The native wrapper calls SortOutSmoke on its **original arguments in original
order** only if DoCrashEarnings returns 1. A nullable selected attacker cannot
stand in for that return. Original first damage is saved through `__ftol`'s low
DWORD (`0x4405ab`, helper `0x575190`); original second damage uses Float32
nonzero (`0x4405d0`). Both are captured before normalization and cleanup.
Knackered and low-damage exits use these saved gates. The expired world-history
branch (`0x440a81`) instead returns 1 unconditionally at signed wrapped age

> =5000 ms, even with zero damage. Secondary saved damage only contributes if
> the normalized secondary is still a car. The independent return kernel retains
> this asymmetric integer/float behavior; attribution and awards remain separate.

Smoke comparison uses the component's source `+0x4e8` previous value, distinct
from crash-earnings `+0x4e4`. PrepareCars copies the current levels once per
outer frame. SortOutSmoke updates its own baseline after dispatch; earnings
attenuation/cleanup must not erase smoke deltas. Held repair also copies this
baseline. Full repair clears it.

Ordinary component writes invoke CheckDamage synchronously inside each receiver's
damage path (`0x43f883–0x43f885`), before pair CrashEarnings at `0x41d438`.
Its newly-knackered column producer therefore runs through a separate once-only
`onKnackeredSmoke` hook. Delayed attributable WASTED feedback cannot own that
random consumer. Earnings redistribution's guarded local-player CheckDamage
at `0x440df1` uses the same hook; offline AI attenuation retains its deferred
check. Explosion/feedback chronology remains a separate effect-order audit.

## Native tier selection

The divisor byte table at `0x58ef98` is
`[20,20,0,10,10,10,10,10,10,10,10,10]`. For each enabled unit in index order,
`colour = trunc((99-level)/divisor)`. A column request requires worsening damage,
colour <=2, and a changed quantization interval. Engine/transmission start
colour2 at level40, colour1 at60 and colour0 at80. Other enabled units start
at70/80/90. Unit2 contributes neither a column nor smoke-retention eligibility.
If no component currently qualifies, existing columns are shortened. Unchanged
qualifying levels retain existing smoke without repeatedly allocating columns.

Driver<=5 returns before any baseline copy. SetCarSmoke changes requested
colour0 to colour1 for driver<7; this applies to ordinary driver6 opponents,
while newly WASTED columns retain their separate producer's colour0.

When any matching active column exists, SetCarSmoke scans all ten physical ring
slots in order. A matching active equal/better colour with nonzero lifetime
returns immediately. Before that return, every preceding matching-owner slot
receives lifetime2000 unconditionally, including inactive slots and slots whose
old lifetime was shorter. This is not a global minimum-colour replacement.
Column retirement preserves the native owner record; race unloading explicitly
releases those retained references. The gravity<1 gate follows this quality
protocol. A dry knackered request consumes the no-op SmudgeCar random draw,
then creates mode1 with lifetime **10,000,000 ms**.

## Authored fire points

Car TXT supplies twelve signed integer fire-point records. LoadCar stores their
low uint16 values, clamps values outside the total prepared-vertex count to0,
tests whether this clamped table is all zero, and remaps source IDs to the first
matching flattened prepared index. The all-zero fallback replaces the table
with twelve shared CRT draws across the total prepared count. Stock Buggy and
Copcar use that fallback; Eagle has authored nonzero IDs. The parser diagnoses
malformed/missing data instead of inventing bounds-based positions.

Component index selects this initialized table. It differs from WASTED's raw
random0..11 column indices. Mode1 samples live deformed geometry and the
principal actor's source transform; see [prepared ordering](c2-car-prepared-re.md).
Native positive-material allocation addresses are still unavailable: exact null
group order is reconstructed, while later groups are explicitly an approximation.

## Validation and open issues

Numerical tests cover tier boundaries, independent baselines, driver exclusion,
ordered partial lifetime writes, inactive-owner retention, wet/RNG ordering,
uint16 clamp/remap and all-zero startup draws. Read-only original Eagle/Buggy
integration tests check original-order dispatch after earnings cleanup, expired
world and knackered returns, outer-frame baseline capture and repair isolation.
The fire-table audit covers 104 local Stock/Advanced car configurations.

Browser validation is recorded by `tests/browser-component-smoke.mjs`, separately
from headless boundary fixtures. The five-case production Chromium run on
`index-CSe1pQBw.js` drives original Eagle/Buggy into rival cars and Newcity walls.
It verifies an accepted, finite mode1 engine-fire sample before knackered state,
held-E 2000 ms shortening, action7 full repair, and immediate knackered-column
production before the delayed WASTED feedback callback. No console, asset-request
or WebGL errors occurred. This run reached engine tiers40/60; engine80 and
steering70/80/90 remain explicitly uncovered in the browser. Numerical tests
cover those thresholds; the browser report does not claim complete tier coverage.
Complete shared random-consumer chronology,
positive-material allocator ordering and all other effects producers remain
open under DMG-03; these tests do not establish complete original effect parity.

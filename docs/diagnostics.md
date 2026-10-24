# Runtime diagnostics

The pause menu's **Diagnostics** report consolidates warnings that the engine
already records, plus failures caught while opponent or pedestrian populations
load. It groups findings by source, labels session history separately from the
active or most recently loaded race, and counts exact repeated messages.

Asset warnings are session-scoped: the asset store retains them across race
loads, so they do not describe only the selected track. Background failures
include the race name captured when the error was recorded; this history keeps the most recent 100 events. Animation,
power-up, pedestrian, smoke-effect, world-destruction, world-groove,
special-volume and population information comes from the current runtime
objects and may describe the last successfully loaded race after a failed
preflight. Damage-system warnings are written to the shared asset warning list,
so they appear in the session-scoped asset/runtime group rather than a separate
damage provider.

The panel refreshes when the pause menu opens, when the report is expanded, or
when **Refresh** is selected. It does not poll during gameplay or traverse the
scene. **Download report** saves a local JSON snapshot; no data is sent to a
remote service. Existing warning arrays and console logging remain available.

The deterministic aggregation test checks scope, repetition counts, population
state and serialization. `npm run test:diagnostics` verifies the actual headless
Chromium menu, safe text rendering, grouping and downloaded JSON contents using
controlled in-memory warning inputs. No physical-display styling judgment is
claimed. The menu refreshes snapshots rather than introducing gameplay polling.

# AI-02: opponent navigation and placement completion

## Scope

The existing native regular fleet already follows authored directed routes,
selects physical/remote movement, pursues player trails and returns to physical
simulation. This change completes collision preparation at that return boundary
and verifies the existing retry/fallback orchestration. AI-01 retains objective,
crash-reaction and roster/personality RNG review; AI-04 retains integrated struggle
and recovery verification. No tyre, drivetrain, collision impulse or crush formula
is changed here.

## Source evidence and implementation

The read-only HW/SW identity is recorded in [the binary audit](ped11-topology-re.md).
rec2 provides names and layouts; its sensible-place helper remains a stub.
Installed instructions supply the following behavior:

| Entry | HW | SW | Implemented behavior |
|---|---|---|---|
| Car sensible-place wrapper | `41fe70` | not separately mapped | A testing scope permits collection-time ACT pulls without pretending a physics tick is running. Scope always unwinds on exception. |
| Object sensible-place | `428fc0` | `429050` | World preparation first, then current PHIL roots and descendants. Obstruction returns0; clear returns-1. |
| Shared nearby faces | `4c1e10` | `4bdd60` | Existing300-face ring, capacity/wrap, containment, emission order, callbacks and water ownership are reused. |
| Pair filters | `4ba290` | not separately mapped | Self, either direct-parent relationship, either exclusion-mask intersection or either object's flag4 suppresses that pair. Descendants remain independently eligible. |
| Placement shape tests | `428d10` | not separately mapped | BOX/WIRE/SPHERE use common BOX bounds for this query; POLY/WIREPOLY retain authored edges and planes. Target expansion is Float32 .005. |

Placement previously bypassed the shared collector with an unlimited local query
and then checked only active cars and detached parts. It now reads registered
roots after collection, so newly acquired scenery, passive bodies, mines and
pedestrian bodies participate. Physical child links provide depth-first traversal;
source AddObject prepending is retained when assembling siblings. Neither sleep
nor immovability is interpreted as free space. Shapes and other gameplay state
are borrowed, never rewritten into placement proxies.

The broad phase uses physical aggregate bb1 with verified Float32
GetNewBoundingBox contributions and target padding of double .0025 followed by
Float32 stores. This is distinct from the narrow phase's LOCAL .005 plane
expansion; rotated/acute targets must not conflate those two tests. A rotated-box
regression explicitly distinguishes them. Wheel-extended bb2 is confined to
world-face collection. This matches stationary prepared targets. Exact lifetime
parity with native moving target+f4 is not claimed: original preparation unions
OLD/current bb1; finish commits ACT to+8c but retains that earlier envelope.
The browser uses the committed current-pose envelope, never raw predicted poses.
A moving target may therefore differ at the tiny placement-tolerance boundary;
this does not change ordinary moving contacts or impulses. Exact retained target
bounds ownership is noted under the existing PHY-15 / TASK-109 investigation,
without claiming it explains the reported delayed debris contact.

## Route and fallback boundaries

- Finished empty complete-race routes enter GetNear through the real objective
  owner. Native reads an uninitialized return slot in this branch. Production
  explicitly chooses0; the fleet now also chooses0 when its optional hook is
  omitted. Explicit hook values remain authoritative, and the standalone native
  coordinator still requires a supplied raw value. No fabricated native constant
  or premature GetNear completion is introduced.
- Safe-location relocation retains the existing4096-endpoint browser termination
  bound. A closed component wholly inside the view radius returns an explicit
  `bound-exhausted` diagnostic, clears dynamics and remains hidden/nonphysical.
  It does not report successful physical placement or alter damage/orientation.
- All24 placement tests may fail. The source wrapper still returns1 after exactly
  one fallback, with physics disabled. Success on attempt24 resets the special
  volume once and does not run fallback. Source nearest-end forces are applied
  after the placement call, including its exhausted branch.

## Validation

Numerical regressions cover shared finite preparation/cache reuse and invalidation,
nonblocking faces consuming capacity before filtering, actual postcollection PHIL
ownership, passive roots, masks/flag4, symmetric parent exclusion, independent
children, source SPHERE/WIRE/car tags, small-gap tolerance and query-scope cleanup.
Adapter checks exercise all24 failures, last-attempt success, zero-length sections
and the strict five-unit nearest-end branch. Fleet checks exercise finished empty
routes and bounded relocation. Original Eagle3, Buggy and Bigdump retain component
damage, hull and part ownership across real placement; the Eagle includes actual
original-data crush before rematerialization. Original files remain read-only.

The existing Stock/Advanced/Snow Chromium checks cover real-key driving,
normal opponent motion, freeze/thaw and physical/remote/rematerialized transitions.
The Advanced fixture now selects authored USS LEWINSKY with12 rivals: its former
Carrier_mission selection is free-drive-only and cannot supply a racing fleet.
Original one-section quarrynet is likewise uncatalogued. Its browser regression
now verifies actual free-drive input/render/physics without inventing opponents;
its original one-section GetNear construction remains numerically covered.

Chrome DevTools checks use the hardware AMD radeonsi backend at2072x1436. Clear
placement succeeds on its first actual query. A separately labelled forced-rejection
fixture executes all24 real queries and the real fleet fallback once, retaining
finite poses/damage, zero velocities and inactive/hidden ownership. This is
controlled fallback coverage, not a naturally blocked-terrain reproduction.
A fresh race advances29 frames with real W-key input and five registered opponents,
without console or WebGL errors. Reports/screenshots remain ignored in artifacts/.


Final checks (2026-10-30): production build and TypeScript pass. Full suite:
3729 tests,3723 passed, six optional skips, no failures. Source-only CI copy:
3660 tests,3226 passed,434 asset-dependent skips, no failures. Three native-AI
browser races retain their authored5/12/7 rivals; quarrynet free-drive advances
real keyboard/render/physics frames with no fleet. Final hardware MCP Dune
retains10 registered rivals, advances67 frames with W input, and has no fleet,
console or WebGL diagnostics. Clear placement uses one attempt; controlled
exhaustion uses24 and one actual fleet fallback. Screenshot inspected.

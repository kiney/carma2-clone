# C2 effect producer coverage audit

## Executive Summary

The single-player world/car effect paths audited here have production outlets
for world and car/car sparks, FRAG shrapnel, smoke columns and puffs, authored
replacement fire, WAM/world debris, tyre effects and persistent skid marks.
The installed frame order and these runtimes use the shared native CRT sampler.
Ordinary population blood/giblet production still belongs to the PED-06/PED-09
integration. Two direct type-7 puff calls remain in a network-only remote-car
recovery path. Positional event audio remains AUD-03 scope.

This note records callsite and asset coverage. It does not claim complete
whole-engine CRT chronology, native WinHeap allocation order, or browser QA.

## Installed callers and production owners

Addresses are VAs from the installed read-only `carma2_HW.exe` whose SHA-256 is
recorded in [physics evidence](c2-physics-re.md). rec2 supplies source names;
installed instructions and local production bindings determine the conclusions.

| Native source                                            | Production owner and shared pool                                                                                                             | Coverage                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World collision sparks, `0x41d773–0x41d7d4` → `0x4f7af0` | `simulation.onWorldSparks` → `SparkSystem`; 32 records                                                                                       | Implemented for qualifying single-player world contacts.                                                                                                                                      |
| Car/car sparks, `0x41d593` → `0x4f8020`                  | `simulation.onCarSparks` → `CarSparkAllocator`, inserting into the same `SparkSystem` ring                                                   | Implemented for car/car collisions.                                                                                                                                                           |
| Spark-created FRAG shrapnel, `0x4f8590`                  | `ShrapnelSystem`; 30 FRAG4/FRAG5 records shared by world and car/car spark callers and connected authored abstract shrapnel                  | Implemented for the connected single-player sources. Other wrappers/replay/network consumers are outside this claim.                                                                          |
| Smoke columns, `0x4fb3c0`; wrapper `0x4fb620`            | `SmokeSystem`; 10 column records, including authored replacement fire, component/wreck smoke, napalm mode 2, and connected world/WAM effects | Connected single-player producers use the shared pool. Replacement fire calls the production `onReplacementFire` outlet after a model change and uses the new retained MODEL's prepared data. |
| Smoke puffs, `0x4fb0c0`                                  | `SmokeSystem`; 25 puff records, including continuous surface dust, tyre type-4 puffs and smoke-column emission                               | These ordinary single-player sources are connected.                                                                                                                                           |
| Persistent skid marks, `0x4e9c90`/`0x4ea030`             | `SkidMarkSystem`; 100 sections                                                                                                               | Force-step requests, original material filtering, oil requests and outer-frame transform restoration are connected.                                                                           |
| Authored triangle shards and ghostparts                  | `ShardRuntime`; capacity 200, a separate priority-managed pool                                                                               | This is not the native 30-record FRAG shrapnel pool. WAM/world connotation sources use this runtime where authored.                                                                           |

In the outer graphical frame, `main.ts` advances smoke columns, then native
FRAG shrapnel, flushes deferred smash effects, advances the shared spark ring,
and finally advances smoke puffs. This preserves the relevant native producer
boundary: columns spawned during final smash flush age on the next early phase;
their puffs can join the current later smoke render phase. `RenderSparks`
precedes `RenderSmoke`.

The audited effect runtimes default to `sharedNativeRandom.random`; production
also explicitly injects that sampler into `SmokeSystem`, `ShardRuntime` and
`ExplosionRuntime`. The connected world/car spark and shrapnel outlets therefore
consume one CRT stream. This establishes stream sharing and the documented
local call order; it does not establish every engine-wide consumer or exact
whole-engine RNG chronology.

## Remaining producer boundaries

- Installed `CheckRecoveryOfCars` begins at `0x4423f0` in the installed HW
  binary; rec2 labels the corresponding source function `0x442500`. It calls
  `ExplodeCar` only under
  `gNet_mode != eNet_mode_none`. Its two direct type-7 puff calls are at
  `0x4425a3` and `0x4425ed`. These are remote network-car recovery glows, not
  ordinary single-player recovery. No direct production puff adapter is bound
  for these two callers.
- Installed `0x4eb717` calls the general shrapnel wrapper `0x4f88e0` from the
  smash/effect path. This is covered by the authored abstract-connotation
  route: `src/main.ts` dispatches smash connotations through
  `emitSmashDebris`/`spawnAbstractShrapnel`, which builds the native abstract
  shrapnel source and submits it to the shared `ShrapnelSystem`. It is not a
  separate unimplemented producer. The evidence establishes the matching
  producer class and implementation path; it does not claim instruction-level
  equivalence for every native wrapper invocation.
- Ordinary population blood and giblet production still uses its legacy
  pedestrian outlet. Integrating those production identities and native
  contact/effect causes belongs to PED-06 (TASK-96) and PED-09 (TASK-99).
  Other independent world awards, replacement fire, debris, smoke and car
  repair do not require the full pedestrian stack.
- Positional sound selection, attenuation and spatial presentation remain
  AUD-03 (TASK-71) ownership; shared effect dispatch does not claim positional
  audio parity.
- Installed native producers beyond the connected callers, replay/network
  piping, WinHeap allocation behavior and complete engine-wide CRT consumer
  chronology remain outside the scope verified here.

## Stock and Advanced track-data census

The inventory used the local original asset store, parsed each `RACES.TXT`,
selected same-stem sibling track TXT files configured by that catalog, then
parsed the smashable sections with `parseTrackSmashables`. There are 40 catalog
entries per root and 39 unique configured track TXT files per root (the catalog
repeats SkiTrack3 in Stock and Junkyard in Advanced): 78 files total.

| Measure                                                  |                     Stock + Advanced total |
| -------------------------------------------------------- | -----------------------------------------: |
| Smash specs                                              |                                        508 |
| Structurally unique full specs                           |                                        138 |
| Connotation payloads                                     |                                        759 |
| Structurally unique connotation payloads                 |                                         93 |
| `texturechange` / `replacemodel` / `remove` / `nochange` |                         309 / 53 / 89 / 57 |
| World `crush` specs                                      |                                          0 |
| Positive replacement-fire records                        |                                         43 |
| Followup side-effect entries                             |                                        111 |
| Authored `parallel` side-effect directions               |                                          0 |
| `integerSecond` values                                   | 137 occurrences of `0`; no negative values |

All 43 positive replacement-fire records have chance 100. The six referenced
replacement models and record counts are `petpump_broke` (12),
`&GUN_BROKE.act` (10), `&gaspipe_blow.act` (6), `comsat3` (6),
`&pump_broke.act` (5), and `gasbase.act` (4). Authored fire parameters are
`[1,0,0]` or `[3,0,0]`. Representative source files are Newcity1,
Carrier1, Desert1, Silo1, Newcity mission and Silo mission under `data/RACES/`.
This confirms that the replacement-fire runtime path is exercised by original
data, not only synthetic fixtures.

All 111 authored side-effect directions are `away`; the unresolved parallel
direction branch is therefore not exercised by these original track catalogs.
The 137 authored `integerSecond` values are all zero; no catalogued Stock or
Advanced connotation requires a negative fancy index. The currently implemented
public fancy selector rejects negative indices, and the original catalog data
does not require that boundary case.

## Confidence and validation limits

Installed direct-call addresses and the two network-only callers were checked
against the read-only HW executable. Single-player provider ownership and phase
order were checked against current `src/main.ts` bindings and the effect runtime
modules. Asset totals were computed from the local Stock/Advanced catalogs and
track TXT resources.

## Integration validation, October 28, 2026

- Production build passes. Full numerical/original-installation suite: 3,351
  passes, zero failures, five optional saved-capture skips.
- `browser-world-effects.mjs` passes four Stock/Advanced Newcity/Carrier cases:
  actual authored replacement MODEL/ACT, mode-zero ownership and live prepared
  sampling, original-textured animated flame meshes, same-MODEL rejection,
  unrelated car repair and original-font fancy dispatch. Prop contacts are
  controlled production `handleContact` calls; the nonzero fancy award is a
  labelled synthetic payload because the original catalog authors zero.
- `browser-smash-followup.mjs` passes its original Stock/Advanced cases and
  complete Carrier chain: eighteen ACT increments, eight actual pickup ACT
  followups consumed through normal final flush, then the actual ADMIRAL death
  completing19. The test uses existing debug invulnerability while waiting;
  it does not seed mission progress or bypass award gates. The pedestrian sweep
  remains the labelled legacy adapter, not native articulated contact proof.
- `browser-noncar-debris.mjs` passes four original track cases, including physical
  motion, native prepared sources, fire and race cleanup. Successful focused
  browser runs have no fatal console, asset-request or WebGL errors.
- Hardware Chrome DevTools inspection confirms original City pump replacement
  fire renders with six visible original-textured flame meshes, no smoke
  diagnostics or console errors, and GL error0. Backend: ANGLE AMD Radeon
  Graphics, radeonsi gfx1150, LLVM19.1.7, OpenGL4.6; buffer2070x1435.
  The close-up is a controlled camera capture, not a performance measurement.
- The older `browser-crash-effects.mjs` still fails its arbitrary loaded-noncar
  approach's expected driver4 packet. Both unchanged HEAD `3b89d2d` and this
  candidate fail the same sole assertion, with no application errors. Other
  driven car/car, wall, tyre, wreck/repair and loose/split-part checks pass.
  QUA-12 / TASK-124 owns making that actual-contact fixture reproducible;
  no native collision gate was weakened to satisfy it.

Generated reports/screenshots remain ignored. Historical Windows heap order,
complete engine-wide CRT chronology, ordinary native pedestrian production and
multiplayer are not claimed by these checks.

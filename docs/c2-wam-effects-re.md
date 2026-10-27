# C2 WAM smash connotations

## Evidence and scope

The original installed `carma2_HW.exe` is authoritative. `madebr/rec2` is used as a symbol and structure map; no reference implementation was copied. The parser and regression fixtures are independently authored. Original WAM files are read externally through the existing asset store and are never committed.

Reconstructed by rec2: `common/crush.c:446`, `LoadSmashableLevels`, reads sounds, shrapnel, explosions, slicks, delayed activation boxes, follow-up smash side effects, extension/room fields, awards and variable changes before the pixelmap list. `LoadCarCrushSmashDataEntries` at source line 517 calls that reader with `pIs_texture_change=0`. WAM therefore shares the world connotation grammar, but does not carry the world texture-change collision-type line. `readSmashConnotations` in `src/world-smash.ts` now accepts a bounded structural reader and is reused by `parseWam`; each `WamSmashLevel` retains the complete `SmashConnotations` value.

Verified from bounded installed HW disassembly:

| Address                            | Behavior                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x431d70`, call at `0x43200f`     | Crush texture damage submits a smashable through `0x4edfd0` to `0x4ee010`, before the detachment path at `0x432055`. Effects belong to texture damage tier advancement, not exclusively to physical part detachment. |
| `0x4ee010`                         | Selects the highest reached threshold, deduplicates the authored smashable and retains its highest queued target. Native shared queue capacity is 20.                                                                |
| `0x4ecd20`, `0x4ed020`             | Deferred flush applies the final target texture.                                                                                                                                                                     |
| `0x4ece71–0x4ecf13`                | Iterates crossed tiers. A crossed tier with `flags & 1` is skipped when `target - old != 1`. Each permitted iteration invokes `DoConnotations` with the **final target tier's payload**.                             |
| `0x4ed200`, `0x4ed243–0x4ed253`    | `DoConnotations` chooses **one** sound randomly from the authored alternatives and submits positional playback through `0x456520`. Multiple alternatives do not mean simultaneous playback.                          |
| `0x4ed27b`, `0x4ed299`             | Dispatches delayed activation (`0x4ed5d0`) and follow-up smash (`0x4ed950`).                                                                                                                                         |
| `0x4ed376`, `0x4ed509`, `0x4ed54d` | Dispatches shrapnel (`0x4eb660`), visibility-gated explosion (`0x4eaa70`, visibility `0x4e5aa0`) and spill (`0x4a6a20`).                                                                                             |
| `0x4ed575`, `0x4ed5c3`             | Applies variable changes (`0x4e71d0`, special 9999 through `0x4e71f0`) before the mission-goal completion path.                                                                                                      |

Installed evidence identifies the retained `roomCode` field as a powerup index, with verified human-owner and proximity gates. Awards, the separate fifty-record powerup queue and normal delayed followup selection/execution are integrated; parallel followup direction remains separately tracked. See [smash gameplay](c2-smash-gameplay-re.md).

## Implemented event boundary

`DamageSystem.onWamSmash` receives one `WamSmashEvent` per permitted repetition. Its `connotations` is always the final target payload. `oldLevel` and `targetLevel` are reached-tier counts; `repetition` is zero based and `repetitions` is the total permitted count. The event includes the authored `smash`, its `part`, bound `actor`, car-root `bodyActor`, affected `mesh`, `timeMs`, and independent `localPoint`/`localDirection` vectors in car-root model coordinates.

The reached-tier state is keyed by the authored `WamSmash`, independently of pixelmap availability and material/LOD identity. Shared LOD meshes emit one repetition set. Repeated impacts at an already reached tier emit no additional events. Missing textures do not suppress effects. Full repair clears reached-tier state immediately. Clean-principal held repair decrements one tier and starts its timed animation. Neither repair path executes connotations.

The simulation gathers the highest target for each authored smashable in the shared twenty-entry WAM/world queue. Capacity is tested before deduplication; an overflowing repeat cannot upgrade an existing entry. The first impact context is retained and the live reached tier is read at flush. Linked textures reach the final tier before its permitted effect repetitions. Overflow entries remain eligible for a later impact. Explicit standalone damage tools use a local queue and immediate flush.

`VehicleSimulation` initializes the shared queue per outer frame, flushes it at wheel/environment and world/noncar barriers before early collision exits, and retains WAM requests from deferred crush until the final game-clock barrier. Main dispatch runs this after ordinary effects and before glass-fragment update. The separate fifty-entry powerup queue now drains during the final argument-zero barrier before the twenty records clear. Structural bends follow shape/flap/detachment phases with a shared tick-seeded MSVC random stream. The WAM producer, visibility and ownership outlets described below now reuse the existing shared runtimes. Whole-engine cross-producer chronology remains DMG-03 work. See [queue evidence](c2-smash-queue-re.md) and [deferred crush](c2-crush-queue-re.md).

## External Stock and Advanced inventory

All 52 Stock and 70 Advanced WAMs parse successfully. Stock has 462 damage levels and 295 shard entries; Advanced has 696 levels and 435 shard entries. Each level authors one sound entry. Neither edition authors ghost parts, noncar/abstract shrapnel, explosions, slicks, activation boxes, followups, room effects, awards or variable changes in WAM data. These counts describe the local installation, not a parser restriction or a required proprietary fixture.

| Car    | Damage levels | Sound entries | Shard entries |
| ------ | ------------: | ------------: | ------------: |
| Eagle3 |            10 |            10 |             7 |
| Copcar |            16 |            16 |            10 |
| VLAD3  |             3 |             3 |             3 |

## Deterministic validation

`tests/wam-effects.test.mjs` uses redistributable synthetic WAM/world data to check the complete shared grammar, record alignment, bounded counts, truncation and integer activation delays. Runtime cases cover below-threshold impacts, final-target repetition, crossed-tier flag suppression, missing textures, repeated-impact idempotence, repair rearming, shared LOD deduplication and queue capacity/overflow. The optional external inventory case reads all available WAMs and checks the three stock metadata counts when those cars are present; it skips when the installation or WAM inventory is absent.

Run `node --import tsx tests/wam-effects.test.mjs`. Additional focused suites cover captured shard links, asset preparation, dispatch, actor frames, actor-owned explosions and the repair queue. No original asset fixtures are stored in the repository.

## Integrated browser outlets

The live WAM event binding selects one authored sound, queues activation boxes, applies variable changes and dispatches explosions through the existing world outlets. `DoConnotations` draws integer pitch `0xe000..0x12000` at `0x4ed227` before the alternative draw at `0x4ed244`; playback now uses that fixed-point rate, including both draws for a single sound. Source positional attenuation remains open. Shards use the current physical root and ACT/model-local hierarchy; stale interpolated render transforms do not determine their world placement. Material lookup is scoped to each original car, with independently owned identity UV state and shared texture images. Starting-step model velocity is captured before 40 ms forces/contacts and converted to Float32 metric units by the verified enqueue formula. The WAM source-link limits are 50 vertices/50 faces, independently of the later 200-fragment pool.

`tests/browser-wam-effects.mjs` tests original Eagle3/Copcar/VLAD3 tier advancement, no same-tier replay and repair rearming. A driven Eagle crash observes actual WAM sounds and shards. Separate explicitly scripted paused fixtures check visible triangle geometry, current-physics placement despite a stale root transform, movement and expiry. The browser regression also isolates original Copcar multi-tier glass and verifies that the production outer-frame updater advances its timed repair without emitting fresh smash effects. These checks do not establish complete whole-engine random-consumer chronology.

## Captured source links and effect ownership (DMG-01 completion)

Verified from installed HW `MungeMaterial4f5270` / `LinkSmashies4f5560`: the principal MODEL links at most 50 unique original vertices and 50 compact face tuples during setup. Matching uses material identity; the linked vertex centroid is calculated once from those admitted original MODEL vertices. `InitVertexDataCB` in rec2 links detail zero only. `DamageSystem` now captures that topology and bounded centroid once, unifies matching render slots, and samples live deformed coordinates/UVs through those retained links. Later draw-range, material-slot and index changes cannot silently select another surface. LODs share the authored tier and texture draw.

`DoShrapnel4eb660` gates abstract (`4eb6d2`), shards (`4eb738`) and ghosts (`4eb7d1`) by the supplied impact point before creation or RNG. Physical noncar production at `4eba86` has no equivalent visual gate. Both world and WAM callers use `dispatchSmashDebris`; ghost and noncar WAM ACT dependencies resolve from the active race directory through existing registries/providers (`ReadShrapnelSpec` retains that path for a WAM caller at `4eeccd`, `4eefa1`, `4ef015`); mechanics use the race edition's NONCARS scope, with libraries retained offscene until race disposal. Only the synthetic conformance fixtures author these additional WAM types in this installation.

The retained physics/car owner and queued visual ACT are distinct. After detachment the ACT keeps its independent live frame; attached ACTs replace the interpolated render root with the current physical car root while retaining local transforms. Explosion visibility (`4ed4e2`) tests this ACT's origin, then `4eaa70` uses its direct MODEL bounds and live affine frame. Slick creation (`4ed543`) uses the same ACT/MODEL follower. Child models and whole-car bounds cannot substitute. Explosion frames can borrow car-scoped PIX resources independently of world textures. Neither repair path recollects loose glass: native shard updates have no repair reclamation.

## Native glass repair

Verified HW addresses differ from current rec2 annotations:

| Installed function                        | Behavior                                                                                                                                                                                                                                                         | Browser implementation                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `43b38f -> 4ef690`                        | Clean principal MODEL: immediately decrement each nonzero smash by one; insert/refresh its record in the shared 25-slot pool at `6a6658` with current game time and car owner, even if the tier becomes zero. A full pool still permits the immediate decrement. | `finishPrincipalModelRepair`, `NativeWamRepairQueue.start`           |
| `4ef5c0`                                  | Commit selected repair tier and one authored texture alternative, drawing RNG even with one alternative; retain single-shot award state. Local human/racing repair plays sample **4550**.                                                                        | `applyWamRepair` / shared texture commit and racing/human audio hook |
| `4efe70 -> 4efed0`, then `4efe7b..4efebb` | After glass movement, visit repair slots ascending. Unsigned elapsed >=150 ms decrements at most once per slot/update; advance stored time by 150, clear a zero-tier record. No catch-up loop.                                                                   | Main's fragment-then-repair order, `NativeWamRepairQueue.update`     |
| `4ed031..4ed04c`                          | A committed new damage texture cancels the matching repair animation first.                                                                                                                                                                                      | `dispatchWamSmash`                                                   |
| `4ef740`                                  | Full repair sets damaged smash tiers directly to zero; animation records remain until the next due update clears them.                                                                                                                                           | `DamageSystem.repair`                                                |

The deterministic tests cover capacity, first-free selection, slot refresh, 149/150 ms, long frames, unsigned wrap and sign-bit crossing, redamage cancellation, full repair, LOD textures, sound callbacks and absence of repair connotations. The production browser check advances the real frame clock to finish original Copcar glass repair.

## Native default MODEL crush

Exact WAM matching has no extension or ancestor alias. The installed loader then supplies normal-softness default crush data to eligible MODEL ACTs without their own WAM record or GROOVE: `LoadCar48b31d -> CreateDefaultCrushData42a160/42a170`, before vertex initialization at `48b324 -> 42a970`. Current rec2 guards in `ActorModelAttachCrushData` are inverted relative to this binary. Explicit uncrushable records, grooved ACTs and ACTs without a MODEL do not receive this fallback. The runtime-only default record has ID 233 and never expands the authored WAM ID/count range. Bugtoo5 and Advanced Ped-o-matic main-body omissions are real uses of this default, not an alias to another authored record.

`default-car-crush.ts` resolves GROOVE owners using the installed case-sensitive complete ACT identifier and native child order; `CarAnimation`'s extension-normalized visual lookup is not reused. The runtime fallback requires loaded WAM limits, a native MODEL ACT and original MODEL provenance, and never overrides an explicit WAM record. It adds no authored smashes, flap or detach behavior. Damage diagnostics continue counting authored bindings separately from defaults.

`tests/default-car-crush.test.mjs` checks eligibility, explicit uncrushable priority, duplicate/case/extension GROOVE ownership, authored-table stability and original Bugtoo5/Advanced Ped-o-matic localized deformation with held/full repair. Chrome DevTools MCP also loaded both actual cars: the root changed 12 of 828 coordinate values for Bugtoo5 and 12 of 342 for Ped-o-matic at a localized contact. Held/full repair restored the compressed repair targets exactly; both authored WAM tables remained 32 records. Runtime defaults were 2 and 33 respectively. This is a source-driven fallback, not an alias or whole-car scaling.

## Explicit boundaries

- DMG-03 retains whole-engine shared RNG chronology, cross-producer lifecycle and positional attenuation work. Browser object identities substitute for native pointers in queued ghost seeds; identities are unique across cars, but their numerical values do not reproduce original allocation addresses.
- Native structural split topology is still unresolved. A split replaces browser render geometry; captured effects borrow the retained linked MODEL and can therefore emit pre-split polygons. This belongs with the structural split fidelity work (PUP-04), not a material-name fallback or an invented remap.

### Completion validation (2026-10-27)

The full suite passed 3313 checks with five optional saved-capture skips and no failures. `npm run build` passed (existing bundle-size advisory only). The production WAM browser regression passed original Eagle3/Copcar/VLAD3 crash/tier/fragment/repair cases plus real outer-frame Copcar repair timing, with no failed asset requests, console errors or WebGL errors. Chrome DevTools MCP independently observed a W-driven Eagle/Skyline collision: 10 authored effect events, 132 glass fragments and component damage 54 on the opponent. Hardware was ANGLE AMD Radeon/radeonsi, drawing buffer 2069×1430; this was functional validation, not an FPS benchmark.

An explicitly scripted WAM producer fixture borrowed original Newcity ghost/noncar specs and resources without modifying files. Through the ordinary bound WAM callback it produced five priority 4 ghosts and one independent physical noncar, WebGL error 0. These effects are not authored in the installed WAMs. The existing positive prepared-material ordering diagnostic on that physical noncar is retained under the cross-producer fidelity work; it is not presented as solved here.

Existing world producer regressions also passed all four Stock/Advanced ghost cases and four Newcity/Carrier physical-noncar cases. The ghost expiry harness now retains the clock value observed when its deadline predicate succeeds: the browser game clock's documented prediction can regress after a scheduling stall. The final snapshot must still contain no ghosts or priority-4 fragments. This corrects a false negative without changing clock, physics or fragment rules.

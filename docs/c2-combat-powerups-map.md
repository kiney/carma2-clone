# Combat powerup handler map

## Evidence and handler table

The installed `carma2_HW.exe` is PE32, image base `0x400000`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Its loader references the got, lose, and periodic handler tables at
`0x65d480`, `0x65d560`, and `0x65d640` (`0x4d98a3`, `0x4d98ad`,
`0x4d98b7`). The addresses below come from the installed table entries,
decoded directly from the executable. The installed stock
`data/POWERUP.TXT` rows supply the names and authored values. rec2's
`powerups.c` got-table supplies the corresponding handler names, but its
individual handler implementations are stubs; its annotated function
addresses differ from the installed entries. rec2 was inspected as a symbol
map only; no code was copied.

| Stock index / action | Name                           | Authored duration and uses                  | Float parameters    | Flags         | Installed got / lose / periodic |
| -------------------- | ------------------------------ | ------------------------------------------- | ------------------- | ------------- | ------------------------------- |
| 25 / 31              | Pedestrian Electro-bastard Ray | 30 seconds; not a keyboard charge           | `[3.5]`             | `66` (`0x42`) | `0x4dea80` / `0x4deab0` / null  |
| 55 / 37              | Pedestrian annihilator!        | instantaneous; 3 uses (`initialValue=-3`)   | `[36]`              | `66` (`0x42`) | `0x4ddf40` / null / null        |
| 56 / 38              | Opponent repulsificator!       | instantaneous; 3 uses (`initialValue=-3`)   | `[12, 0.2, 3, 7]`   | `0`           | `0x4ddfe0` / null / null        |
| 65 / 45              | Pedestrian repulsificator!     | instantaneous; 5 uses (`initialValue=-5`)   | `[15, 0.25, 5, 10]` | `66` (`0x42`) | `0x4de340` / null / null        |
| 91 / 49              | Pedestrian Flame-thrower!      | instantaneous; 15 uses (`initialValue=-15`) | none                | `66` (`0x42`) | `0x4ddf90` / null / null        |

The action number indexes the handler table; it is not the pickup index. The
stock table also supplies pratcam sequence `38` for all five records. Indices
55, 56, 65, and 91 are keyboard inventory definitions; index 25 is a timed
pickup. `GotPowerupX` (`0x4d8f30`) applies the common command eligibility
checks and decrements negative initial-value charges only after a nonnegative
got-handler return (`0x4d9153`–`0x4d915b`). For records with flag `0x40`,
the command is substituted with definition zero when the installed AI-count
check fails. In multiplayer, flag `0x02` also substitutes definition zero.
Thus indices 55, 65, and 91 carry both gates; index 56 carries neither.
These are eligibility substitutions, not handler-specific cooldowns.

The original loader documents flag bits `1` as net-global, `2` as
net-inappropriate, and `4` as off-before-snapweld. The installed command
dispatcher visibly tests `0x40` as the AI-availability gate. Do not assign a
meaning to the remaining `0x40` bit from the older loader comment alone.
Index 25 has the same `0x42` flags but is a timed pickup rather than one of
the negative-charge keyboard commands; whether the same command substitution
path governs its world-collection path is not established here.

## Installed call paths and consumers

- **Action 31, electric ray.** `0x4dea80` stores the square of float parameter
  0 at the car field `+0x170c`; reset handler `0x4deab0` clears it. rec2 names
  that field `proxy_ray_distance` and maps the renderer to
  `RenderElectroBastardRays`. The installed graphics code calls the ray
  renderer; the ray render routine tracks proximity-ray start times and
  expires each ray after 500 ms. The powerup's own 30-second timer is separate
  from each ray's visual lifetime. There is no periodic handler in the table.
- **Action 37, annihilator.** `0x4ddf40` passes the powerup's first float
  parameter and the car to `0x4cdde0`, which delegates to `0x4cdef0` with a
  callback at `0x4cde00`. The action handler returns the helper's success
  result as the charge-consumption result. rec2 names the table entry
  `AnnihilatePeds`, but its handler body is a stub; exact target selection and
  the parameter's geometric meaning need further interpretation.
- **Action 38, opponent repulsion.** `0x4ddfe0` selects mode `1` and enters
  `0x4ddff0`. The installed helper visits car records, excludes the source
  car, tests distance against authored powerup data, and modifies eligible
  opponent collision velocities. It also has a multiplayer message path.
  rec2 maps the entry to `RepulseOpponents`. The specific meanings and units
  of `[12, 0.2, 3, 7]`, and which message recipients consume the network path,
  are not resolved by the handler table alone.
- **Action 45, pedestrian repulsion.** `0x4de340` forwards all four authored
  floats to `0x4ce030`; that function enters shared pedestrian callback
  processing at `0x4cdef0` with callback `0x4ce0e0`. rec2 names the entry
  `RepulsePedestrians`. The exact callback parameter semantics and per-ped
  state transitions require interpretation of that shared callback.
- **Action 49, flamethrower.** `0x4ddf90` calls `0x4ce310`. This handler
  searches a pedestrian-sized record pool and enters the pedestrian effect
  path; the related pedestrian system owns five `tNapalm_bolt` records,
  updates them in `MungeNapalm`, and handles bolt impacts/explosions. The
  installed main loop invokes the napalm update. rec2 names the got handler
  `NapalmPeds`; its handler body is a stub. Exact spawn eligibility, targeting,
  and how a charge maps to a bolt need interpretation.

## Browser implementation boundary

`src/powerups.ts` currently marks actions `31`, `37`, `38`, `45`, and `49` as
unsupported. `PowerupSystem.apply()` has no cases for them and emits an
`unsupported` event. Existing `PedestrianSystem` tracks population and
ordinary hits, but it has no electro-ray, annihilator, repulsion, or napalm
state. The five rows therefore remain genuinely unimplemented; event labels
alone would not reproduce their effects.

The concrete evidence needed before implementation is now localized: the
installed action-to-function mapping, exact stock definitions, shared command
gates, electro proximity renderer path, opponent repulsion velocity path, and
the pedestrian effect loops. The four-float repulsion parameter meanings,
annihilator targeting, napalm allocation/eligibility, and the relationship
between the `0x40` powerup flag and the modern option/UI policy remain
interpretation work for the physics/gameplay owner.

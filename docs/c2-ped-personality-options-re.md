# Native pedestrian personality callback metadata

Implemented in `src/ped-form.ts` and reused by the existing population loader.
Evidence is verified against the read-only installed HW executable (SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`).

After `END OF MOVES`, the personality has minimum bounds, maximum bounds,
centre of mass, a sound-definition filename, then optional callback metadata.
Installed `CBLoadPersonality` starts at `4cc700`; rec2's annotated `4cc950` is
not this installation's address.

| Address          | Operation                                                                              |
| ---------------- | -------------------------------------------------------------------------------------- |
| `4cc79a`         | Store sound table at personality `+64`.                                                |
| `4cc7fd`         | Set personality `+50` jump height to Float32 zero.                                     |
| `4cc804..4cc82e` | Check EOF once, read one first token and compare case-insensitively with `JUMPHEIGHT`. |
| `4cc830..4cc837` | Read the scalar from the next meaningful line and store Float32.                       |
| `4cc83a..4cc840` | Close the file immediately. There is no options loop.                                  |

There is no `OPTIONS` marker. An unknown first token ends option handling;
later or duplicate `JUMPHEIGHT` entries are ignored. `GetAString` (`490480`)
discards remaining tokens on its line, so `JUMPHEIGHT 1.0` does not supply the
value. Token delimiters are tab, space, comma and slash. The browser rejects a
missing/nonfinite recognized value rather than reproducing unchecked native
`sscanf` failure. Ordinary parser scalars retain their bounded validation.

Jump height is raw world/model distance, without remap or a 6.9 conversion.
The native ground-cache vertical bounds use `±2.5/6.9 ± jumpHeight`; supported
drop is compared with `jumpHeight + 3/6.9`. All 320 local Stock/Advanced
personality records were inspected: 316 have no option; Elephant and sheep in
both installations have first-token `JUMPHEIGHT`, followed by `1.0`.

Initial HP is unrelated to personality options. Installed `BuildPedestrian`
(`4d2dd0`, store `4d2f13`) sets the signed HP byte to 100 and speed factor to
Float32 one (`4d2f1d`). FORM move slot zero, not move ID zero, supplies the
baseline grounding clearance.

The sound filename is retained separately from loaded native handles. Eleven
12-byte sound groups at personality `+64` each contain a count and up to five
WORD references. Ordered groups are survivable impact, fatal impact, severe
fatal impact, tipping thud, living collision, dead collision, threat recognition,
injured get-up, pleading, falling and catching breath. `MakePedNoise` (`4cd630`)
selects using inclusive `IRandomBetween(0,count-1)`; duplicate authored IDs must
remain as weights. Runtime sound outlets must use authored IDs resolved by the
browser, not the original loaded handles.

Tests cover first-token/next-line behavior, ignored markers/later duplicates,
Float32 storage, malformed values, profile propagation, and original Stock and
Advanced human/Elephant/sheep records. No original fixtures are committed.

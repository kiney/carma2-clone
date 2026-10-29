# Pedestrian move substitution and fallback

`src/ped-move-fsm.ts` reads the original 118-by-7 signed-int table from a local
x86 PE32 executable. It does not execute or emulate the executable. The table
is not copied into source or the production bundle. A bounded initialized-data
section scan requires a unique signature and a complete validated table.
The short signature describes the first two behavioral rows; the remaining
payload comes from the user's installation.

Read-only installed evidence:

| Binary | SHA256                                                             | Table VA   |
| ------ | ------------------------------------------------------------------ | ---------- |
| HW     | `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c` | `0x65c360` |
| SW     | `15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d` | `0x656ca8` |

All 826 values agree between these two installed binaries. Their RVAs differ.
The parser therefore uses bounded section/signature discovery rather than the
HW address in both images. Control row116 contains negative run IDs (`-41`),
so validating every value as a positive move/count would incorrectly reject
both real tables. No proprietary fixture is committed.

## Installed SetPedMove

rec2's `pedestrn.c` identifies the corresponding symbol, but its address
annotation differs from this image. Installed HW `4cba70..4cbcd0` supplies
the actual branch evidence:

- `4cbad0..4cbae8`: update action only for nonnegative requested action and
  move when current action is not6.
- `4cbae8..4cbb48`: priority is drunk (`742958`), dancing (`742948`), panic
  (`742998`), missing bone bit8, missing bone bit20, then ordinary. These
  select table columns5,4,6,2,3 respectively. Column1 is ordinary fallback.
- `4cbb48..4cbb84`: substituted IDs112/31/111 force running action1. A
  current process cache clears run-speed `+80` except for112/31/40/41/42.
  These stores occur before the fallback loop; they are not recomputed from
  its eventual selected ID.
- `4cbb8b..4cbbc9`: convert the signed integer walk-speed argument, divide
  by stored float speed factor `742980` only when nonzero, and store the
  resulting float before `SetCharacterMove40a050`.
- `4cbbce..4cbc38`: return2 follows the current move's fallback column1.
  Values−2/−3 trigger distinct missing-core/bad-move failures; ten failed
  attempts trigger cyclic-definition failure. ID−1 changes the current
  period and breaks the loop.

`planNativePedMove` performs this policy against actual available FORM/
personality move IDs. Its result keeps selected action, speed, cache-run-speed
write and attempted IDs together. It does not itself mutate ACTs, clocks,
physics or invoke completion. The population owner must apply the plan through
the actual passive/active/recovery move provider. `createNativePedMovePlanner`
supplies the concrete gameplay outlet from the local table, current powerup
globals, removed-bone mask and this personality's loaded moves. A numerical
completion test exercises installed97→72 fallback, preserved physical state,
the original action/cache stores and speed-factor-scaled period through the
real active move owner.

The installed substitution branch `4cbb38..4cbb41` has no guard for requested
ID−1: it reads before the table **before** invoking the core's period-only
branch. Missing-leg columns2/3 address initialized zero words at HW
`65c34c/65c350`, SW `656c94/656c98`. Both installed images agree. Static scans
of the complete HW instruction stream and address constants find no references
or address escapes for either word, hence no source writer; these cells are
stable neighboring initialized data. They have no recovered semantic symbol
and must not be described as an authored FSM row. Nearby column0 aliases gore
and column1 aliases the mutable signed halt-spin scalar, demonstrating why a
whole invented row would be wrong.

The bounded PE reader retains only these two cells when the complete preceding
28-byte row lies inside the same initialized, non-executable section and both
values are valid move IDs. Their actual file offsets and virtual addresses
remain attached as provenance. The planner accepts this optional provider only
for columns2/3 with matching table-relative provenance; no zero fallback is
embedded. On the installed images a request−1 with either missing leg selects
actual move0, then uses its ordinary fallback if necessary. Tables without this
provider and drunk/dancing/panic negative requests retain the explicit
`native-negative-FSM-row-under-substitution` boundary. Replay piping and
control-row random selection belong to separate owners.

## Personality initialization

Installed `ReadPersonality407325..407378` allocates one 12-byte personality
record for **every** FORM move. It writes scale1 at `40735f` and floating mode−1
at `407366`, then reads default-file and personality-file overrides in order.
It does not initialize the grounding-offset word. The host represents this
unread floating-mode field as zero; that is not a claim of a native zero store.
`parsePedPersonalitySimpleBody` now seeds every FORM move before both overlays.
Stock/Advanced Blokebl and Bandsman each have valid FORM IDs4/5/6 without either
authored override. Previously their null personality records caused
`native-move-4-and-personality-record-provider` and would also reject missing-leg
IDs5/6. These IDs are ordinary moves, independent of the active character bit4.

Confidence: **verified installed branch/data evidence**, with focused tests
covering both original images, precedence, fallback, fatal/cyclic boundaries,
action chronology, Float32 speed, parser bounds/ambiguity, the source-backed
negative missing-leg reads and original Stock/Advanced personality defaults.

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

The installed substitution branch has no guard for requested ID−1 and reads
before the table in that case. That memory belongs to other live process
state. This remains an explicit `native-negative-FSM-row-under-substitution`
boundary; the helper neither reads arbitrary browser memory nor invents an
identity substitution. Replay piping and control-row random selection belong
to separate owners.

Confidence: **verified installed branch/data evidence**, with seven tests
covering both original images, precedence, fallback, fatal/cyclic boundaries,
action chronology, Float32 speed and parser bounds/ambiguity. Runtime population
integration remains pending; a passing parser is not completion of PED-03.

# AI-06: short authored graphs freezing the game

## Confirmed failure

The reported hardware Chromium freeze occurred on original Stock
`data/RACES/quarrynet/quarrynet.txt`, with Green Eagle. Debugger interruption
found the main RAF entry, not a stuck physics solver. Runtime's retained buffer
contained 1,000 uncaught `Opponent next-slot metadata is missing` errors.
Every failure followed GetNearPlayer → shared physical follower → GetStraight →
`nextProjectedPathSlot`. `animate` schedules its next RAF before updating
opponents, so the exception repeated before simulation and rendering could run.
The browser could still handle input/pause; the frozen image was an aborted
application frame, not evidence of a GPU or collision-loop deadlock.

Captured fleet data has two path nodes and one authored section. BUZZ's
GetNearPlayer objective began at 21638 ms and held twelve alternating references
to section zero. These are valid route entries: random top-up fills the original
twelve-slot backing store by revisiting/reversing available sections. A previous
bounds check incorrectly described this small original graph as malformed.

Ignored evidence: `artifacts/freeze-20261016/console.json`, `state.json`,
`fleet.json`, `exception-paused.json`, and associated stack/scope captures.
One attempted debugger local-variable evaluation could not read an optimized
parameter; exact graph/route values instead come from the live fleet owner.
That debugger limitation is separate from the application exception.

## Fix and evidence boundary

Installed GetNext `0x4ae7f1–0x4ae802` indexes global metadata by next projected
slot, rather than by the authored section ID in the route. Preserve this verified
quirk wherever metadata exists, including the type-2 exclusion, route-end order
and cheating bypass. If the slot has no authored metadata, end this traversal
with -1 instead of throwing. The actual native value outside authored metadata
is unknown; this is an explicit browser robustness policy, not a recovered C2
constant or a correction to all native indexing.

The route storage, acquisition, forces, collision handling and physics are
unchanged. Invalid cursors and invalid referenced geometry retain their errors.
There is no global catch that conceals unrelated AI failures.

## Validation

Headless coverage builds twelve valid alternating entries from one section,
exercises every starting slot through straight/corner/SOC/physical following,
and runs repeated GetNearPlayer updates. A local-installation test uses the
original quarrynet TXT without committing its contents. Existing native
slot-index/type-2 and cheating tests remain mandatory.

```sh
npm test
npm run build
node tests/browser-short-opponent-path.mjs
CARMA_BROWSER_CASE=stock node tests/browser-native-ai.mjs
```

The focused production browser check forces the real GetNearPlayer transition
on a registered physical opponent at the current fleet clock, then drives through
ordinary frames. It checks rendered frames, physics time, player motion, console,
requests and WebGL. This reproduces the failing path without claiming a natural
21-second gameplay replay. The separate Stock AI case checks existing transitions.
Chromium's software backend is a correctness check, not an FPS measurement.

Final results: all 3,100 headless tests pass without failures/skips; production
build passes. The new suite run against the old `baf9431` code fails three cases
with the captured missing-metadata error, including the original quarrynet test.
The fixed production quarrynet run advances 20 gameplay and 20 rendered frames,
physics time 1.60 → 2.68 seconds, and moves the player, with a twelve-entry valid
GetNearPlayer route. There are no console, failed request/HTTP response or WebGL
errors. The existing Stock native-AI transition regression also passes. The
focused screenshot was inspected. The new browser case is included in
`test:browser`, `test:native-ai`, and `test:short-opponent-path`.

## Scene recovery limitation

Chrome 155 reports that `Debugger.setScriptSource` is no longer available. A
subsequent debugger module-binding update succeeded, but queued Vite source
updates reloaded the page. An attempted WebSocket message listener did not
prevent Vite's already registered handler from scheduling that reload. The
original evidence was saved before source edits, but the running race state was
lost. Track/car selection persisted. The user was informed; do not describe this
as recovery of the unchanged live scene. No original game files were modified.
The final user tab is responsive and paused on the same track/car selection at
the reset race start; its rendered counter advances normally and WebGL is clean.

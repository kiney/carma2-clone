# Rolling playtest bug captures

The recorder starts automatically, including with debug mode off. **Save bug
capture** in the upper-right corner downloads a local `carma-bug-….c2bug` file.
It works in normally opened Chromium/Firefox sessions without MCP, an upload,
or a directory permission request. The button title shows retained seconds and
recording memory. A capture can also be read through `window.carma.bugCapture`.

Retention is up to **180 seconds of unpaused play**. Pauses and race loading
preserve history; an immediate pause notification protects history even if a
locked workstation stops animation callbacks. Race changes retain the rolling
history with separate generation IDs. The data is in RAM: reloading/closing the
page loses it. A completely blocked browser main thread must become responsive
before it can process a save click.

## Budget and runtime policy

The recorder budget is **512 MiB**, allocated on demand. It reserves 16 MiB for
bounded construction/scratch and half the remainder for one immutable download;
the rolling storage itself has a **248 MiB accounted limit**. Bookkeeping and
fixed slots are charged as well as exact-sized payload backing buffers. Oldest
records are evicted on time/byte pressure; an additional bounded record count
protects against extremely dense tiny events. Memory pressure can shorten the
retained time below three minutes. Drop/eviction/omission counters are exported.

This is an accounting budget for recorder-owned data, not a promise that the
whole browser process or garbage collector stays below512MiB. The game and GPU
assets have their own memory. The controls retain at most one download URL,
revoke it before the next export, and release it after60seconds. External callers
that retain multiple snapshots/Blobs own that extra memory.

Hot paths copy Float64 records into a circular store. They do not hash meshes,
wrap collision/query providers, force GPU synchronization or change random
streams. Before/after physics states, computed normal-contact candidates,
accepted normal responses and joint candidates are separate phases. Deferred
friction is finalized later. Geometry/context keyframes are bounded and sampled
every five active seconds; their omissions are explicit. Observer errors stay
inside the recorder, with bounded error messages; repeated faults stop recording
rather than breaking the game.

## Recorded evidence and limitations

- Active rigid bodies: stable weak IDs, pose/candidate pose, velocities,
  mass/inertia/COM, player/AI controls, component damage, structural revisions,
  attachment/sleep/recovery flags and shared native RNG state.
- Contacts: body/source actor IDs, source face, finite face triangle, both solver
  points, normals, impulse/closing speed, callback acceptance, final normal-solver
  acceptance and post-normal response velocities. Rejected callbacks remain
  distinguishable; their proposed impulses are not claimed as applied.
- Keyframes: bounded collision hulls and joint geometry, owners and names.
- Frames/events: game/real timing, CPU time, camera, visible geometry counts,
  skipped physics time, race/car/track/difficulty, race state, key transitions,
  pause/resume, load generations and uncaught browser error summaries.
- Export metadata: production bundle URL through context, user agent, GPU
  renderer, drawing-buffer dimensions, pixel ratio, schema and recorder counters.

This is **diagnostic reconstruction**, not a deterministic whole-game replay.
Render-mesh deformation, all AI/pedestrian state machines, pending world queues,
custom random streams, asynchronous work and every outer-frame mutation are not
fully serialized. Unsupported analytic bone shapes and geometry truncation are
marked. It is useful for deriving numerical collision fixtures and attributing
damage/costs without promising restoration of an arbitrary complete race.

Captures can contain original-game-derived collision geometry. Keep them local
or in ignored `artifacts/`; `*.c2bug` is ignored. Never commit captures or decoded
original-derived JSON, and never write them into `carma2_orig/`.

## Reading a downloaded file

```sh
node --import tsx tools/read-bug-capture.mjs ~/Downloads/carma-bug-example.c2bug
node --import tsx tools/read-bug-capture.mjs ~/Downloads/carma-bug-example.c2bug --json /tmp/bug.json
```

The first command prints metadata/counts/time ranges. The optional output streams
decoded records to a **new** file under `/tmp` or repository `artifacts/`; it
refuses existing files, source paths and the original installation. Nonfinite
Float64 values become explicit `NaN`/`Infinity`/`-Infinity` strings in JSON. The
binary file preserves their actual numeric values.

Container `C2BUGCAP` version1 has a20-byte little-endian header:8-byte magic,
uint32 version, uint32 metadata-byte length and uint32 record count. UTF-8 JSON
metadata follows. Each record has a16-byte header (Float64 active milliseconds,
uint32 kind, uint32 payload length), followed by payload. Numeric payloads are
Float64 on the supported little-endian browser targets. Metadata supplies header
and row schemas. Kinds1/2/3/7 are body/frame/contact/joint numbers;4/5/6 are UTF-8
JSON context/events/collision keyframes. Flags bits0–8 mean immovable,
rotation-locked, attached, sleeping, wasted, world-recovery, world-overlap,
body-recovery and body-overlap. Body kinds1–6 mean car, noncar, car part,
pedestrian, pedestrian bone and other.

`npm run test:bug-capture` builds and tests a real browser download. Unit tests
cover age/byte/count eviction, aliasing, format bounds, pause-without-RAF,
nonfinite data, joint/contact phases, scalar ownership, fault isolation and
exact procedural physics parity with recording installed.

## Validation (2026-10-29)

The full isolated suite recorded3,470 tests:3,465 pass,5 skip,0 failures.
Focused ring/runtime/CLI checks also pass after integration. The production build
passes. Actual Chromium input, pause/resume, race replacement, a real downloaded
file and decoded same-generation body coordinates are checked by the browser
harness. An initial browser-test mismatch compared a pre-reload position with
an unrelated post-reload record; the test now explicitly selects the matching
generation and committed phase, retaining the exact-coordinate assertion.

A short serial hardware MCP run used ANGLE AMD Radeon (radeonsi gfx1150 /
LLVM19.1.7), OpenGL4.6, drawing buffer2073×1438, DPR about1.48, 4×MSAA. After a
one-second warm-up, recording-off/on windows lasted1.8seconds each:

| Metric                      | Recording off | Recording on |
| --------------------------- | ------------- | ------------ |
| Physics ticks               | 46            | 45           |
| Tick CPU median / p95       | 6.05 /19.1ms  | 6.30 /12.0ms |
| Frame interval median / p95 | 16.7 /33.4ms  | 16.7 /33.4ms |
| Recorder callback CPU total | 0ms           | 12.3ms       |

The12.3ms includes body/contact and frame records, about0.27ms per observed tick.
A subsequent one-second run crosses the five-second geometry/context interval:
9ms total recording work, zero recording errors. These are different evolving
scene states on a shared workstation, not a controlled statistical FPS claim.
They show no major regression in this sample. No console warnings/errors or
WebGL errors were observed; gameplay/menu screenshots were visually inspected.
The decoded browser download and hardware reports/screenshots remain ignored in
`artifacts/bug-capture/`.

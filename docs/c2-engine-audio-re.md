# C2 engine audio evidence

## Native source and parameters

Verified against the read-only installed `carma2_HW.exe` (SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`).
The rec2 reference is commit `249f6be9925b7632295b74a47e3d4b07857b1649`.

| Function          | rec2 map   | Installed HW address |
| ----------------- | ---------- | -------------------- |
| InitSoundSources  | `0x455bb0` | `0x456150`           |
| MungeEngineNoise  | `0x456070` | `0x456610`           |
| SetEngineFactor   | —          | `0x4dc840`           |
| ResetEngineFactor | —          | `0x4de3d0`           |

The loader reads three engine IDs at car offsets `0x470/474/478`. The normal
continuous car source binds **only the first ID**, at `0x45628d–2b6`.
The update at `0x456974` passes sound ID `-1`, retaining that sample.
The special-volume engine index changes pitch and volume, not the sample ID.
Consequently, playing all three IDs as gear/load samples would contradict the
reconstructed native path. Police category 3 instead uses siren ID 5350;
spatial opponent/police sources remain a separate audio task.

For RPM `r`, pitch is `40960 + 10*r`, multiplied by `0.75` for volume index 1
or `0.55` for index 2, then clamped to `[4096, 131072]`. Native pitch is 16.16;
Web Audio playback rate is the truncated integer pitch divided by 65536.
Volume is `(96 + .0015*r)` times 5 for index 1, 2 for index 2, or 2.5 otherwise,
capped at 255. If the car engine factor exceeds 1, multiply that capped value
by `1 + (engineFactor-1)/12`, then truncate for the S3 call. There is no second
cap here. Browser gain is that integer volume divided by 255.

The engine factor is initialized/reset to 1 and written by the engine powerup;
it also multiplies vehicle acceleration. Browser motion and audio share this
same state. Local human RPM comes from vehicle motion, which already uses the
transmission. The cosmetic speedometer-to-RPM cycling in `car.c` is guarded by
`driver < 7` and must not replace local-human RPM (`driver=8`). The source stays
active while stationary. Replay pitch multiplies by absolute replay rate;
the pure helper supports this, but the browser has no replay system yet.

## Implementation and validation

`engine-noise.ts` independently implements the equations. `AudioSystem.update`
uses real player RPM, the active special-volume index and the motion engine
factor. Direct AudioParam updates preserve the native values; the previous
speed/throttle/health heuristics and stationary cutoff have been removed.
The original configured WAV loop is retained across ordinary RPM/index changes.

Numerical tests cover idle, index changes, pitch clamps, negative proxy RPM,
post-cap engine boosts and invalid inputs. `npm run test:engine-audio` checks
actual Chromium audio unlock, idle, deterministic RPM/index/factor cases,
pause/resume loop ownership and keyboard driving with changing RPM. Reports
and screenshots remain ignored under `artifacts/`. Chrome DevTools MCP was
unavailable in this runtime; the existing Chromium harness verifies console,
network and WebGL errors separately from numerical audio assertions.

This closes the player engine source task. Spatial other-car engines, sirens,
speech priority, general effect outlets and replay are separate compatibility
gaps; this change does not claim those systems are complete.

# PERF-24: runaway wreck and bumper stall

Follow-up: [reproduced contact/solver cause](runaway-contact-root-cause.md)
isolates extreme energy injection on one generated floor triangle, and compares
the identical matrix/RHS with the original HW numerical routine. This supplies
a concrete repair target without claiming recovery of FAIR's first event.

## Outcome (2026-10-29)

The user reported a severe FPS collapse while being rammed by Screwie in
**SHEIK, RATTLE & ROLL**, driving The Plow. This capture establishes genuine
engine CPU saturation, separately from the earlier
[browser frame-delivery episode](live-browser-cadence.md). The major recorded
world-contact consumers are wrecked opponent **FAIR** and bumper **FRBUMPR.DA**.
The retained WAM part confirms the bumper belongs to FAIR, is in detached phase2
and has been removed from its render parent by late inspection.
The original impulse that produced their extreme motion is not recorded.

The tab had reloaded into production `index-mpUUxKme.js` / `72f263d`; the
previously injected recorders had disappeared. Do not imply they retained the
ramming event. Recorders were reinstalled without focusing or reloading the
page, capturing the ongoing slowdown. The scene is now paused and retained.

## Direct observations

Hardware: AMD Radeon Graphics / radeonsi gfx1150 / LLVM 19.1.7 through ANGLE,
drawing buffer 2067×1430. No WebGL error was observed. The initial native game
period was clamped at 1000ms; this scalar alone is not a measured CPU duration.

At the first snapshot, wrecked FAIR was still inside the track envelope:

| Quantity | Observed value |
| --- | --- |
| Position | `[-134.18225, 3.246486, -54.13617]` |
| Linear velocity, actor units/s | `[547.9355, 1063.4322, 671.6401]` |
| Linear speed | 1371.94 actor units/s; approximately 34,079 km/h at 6.9 m/unit |
| Angular velocity, rad/s | `[1220.7705, -12348.1791, 8047.6924]` |
| Angular speed | 14,789.63 rad/s; approximately 2354 revolutions/s |

The later retained collision hull has radius 0.48143, 18 vertices and 16 faces;
the orientation quaternion norm squared is approximately 1. The later position
is `[4143.48, 10115.66, -655.64]`, far outside the authored track bounds
`[-202.38,-31.80,-251.77]` to `[285.15,48.66,155.53]`.
Thus an enormous deformed collision hull is not supported by that snapshot.
Earlier orientation and exact first query bounds were not recorded.

The bounded timing recorder captures 30 ticks consuming 29.29s of CPU wall time.
Its ring spans tool installation as well as the requested short running sample;
these totals are **not** an average over a controlled two-second benchmark.
The requested 2000ms RAF/timer sample itself took 8791.5ms to complete, with only
one 100ms heartbeat callback and multi-second RAF callback delays. This differs
from the earlier timely-timer/late-RAF episode.

| Recorded cost | Measurement |
| --- | --- |
| Worst individual 40ms physics tick | 1448.2ms |
| Angular world guards in that tick | 975.9ms across 195 calls |
| Ordinary world contacts in that tick | 410.1ms across 129 calls |
| Pair contacts / final body guard in that tick | 12.0ms / 3.5ms |
| Worst outer physics update | 5836.9ms, containing five ticks |
| Largest recorded RAF interval in the early ring | 5850.3ms |
| Render CPU during that frame bucket | 22.1ms across two passes |
| Slow world-contact rows: FAIR | 262 retained rows, 2216.6ms total, 1931.3ms collecting faces |
| Slow world-contact rows: FRBUMPR.DA | 250 retained rows, 1386.6ms total, 1284.2ms collecting faces |

These wall timings are inclusive; parent and child values must not be added.
Only world-contact calls taking at least 2ms enter that 512-row ring. Both named
consumers reach the 300-face cap; their retained counts are not the complete
call population. GPU time was not captured in this episode.

By the late pause, FAIR had escaped, one part had been retired, and recent ticks
cost approximately 10–34ms again. Admission deferrals increased from 48,332 to
143,646, while active scenery fell from 24 to 5 through ordinary reclamation.
The increased deferrals establish excessive repeated admission attempts; exact
query extents and callback chronology still need first-event capture.

## Code paths and limits

- `computeAdvanceWorldContacts` permits up to 128 angular samples. Each guard
  pose may integrate high spin with up to 400 integration substeps. The complete
  COM-tube clearance shortcut only helps when its entire volume is clear.
- `NativeWorldFaceCache.get` expands predictive queries using the committed /
  candidate transform and inverse cubed delta. A saturated 300-face ring can
  collect twice, with ordinary native ACT callbacks. Large displacement can
  therefore amplify world traversal/admission independently of visible meshes.
- `containEscapedBodies` deliberately covers eligible free noncars and detached
  parts, not whole cars, split secondaries or attached hierarchies. Its existing
  criterion also preserves legitimate high jumps rather than using upper Y.
- Native reconstructed AI returns before its fallen check for wreck/freewheel
  objectives. Merely moving that check changes source behavior and is not a
  demonstrated repair of the originating numerical event.

PERF-24 owns the selected P1 follow-up. Preserve original contact coverage and
callback semantics while isolating actual oversized queries, unnecessary
trajectory work and coherent wreck containment. Retain first pre/post force,
solve, integration and mutation states before changing numerical safeguards.
[PHY-19](timber-runaway-props.md) already records an unresolved occasional
extreme-energy gap and explicitly permits reopening for disruptive in-world
stalls; this episode meets that condition without proving the same cause.

No physics policy or coefficients changed during this investigation. Local
original-derived snapshots are ignored under
`artifacts/screwie-drop-2026-10-29/`. The reinstalled impact recorder captures
player damage only; it cannot reconstruct an earlier remote FAIR impulse.
Reload-safe, all-owner first-anomaly capture remains a concrete requirement,
not a capability claimed for the current ephemeral recorders.

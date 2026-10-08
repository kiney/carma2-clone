# C2 wasted feedback reconstruction

## Executive Summary

The ordinary player-wasted message uses original font lettering. Native C2 selects `YOU ARE WASTED` from `SCROLLERS.TXT` and renders the available `Big_Italic` glyph archive. Damage-triggered wasting plays the configured explosion sound, stock ID 5400 / `PUPXPLOD.WAV`. The player race countdown lasts ten seconds; the lettering has its own scrolling animation. Player-caused rival wasting also selects `YOU WASTED 'EM`, while the rival HUD abbreviation flashes in a five-entry queue.

`src/wasted.ts` and `src/native-font.ts` implement these established paths using locally supplied original text, glyphs, colours and audio. The native loading table mentions `UWASTED.PIX`, but this ordinary race-wasted drawing path uses the available font archives.

## Native evidence

Addresses below belong to the local HW executable whose SHA-256 is recorded in [c2-physics-re.md](c2-physics-re.md). The rec2 checkout targets another executable revision, so its addresses were not applied directly. Decompiled output and disassembly remain outside Git.

| Local HW address              | Path                       | Verified behavior                                                                                                                                                                  |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x43f620`                    | CheckDamage                | Engine, transmission or driver 99, or all four wheels 99, triggers explosion creation and the configured sound before setting the knackered flag.                                  |
| `0x43f4e0`                    | KnackerThisCar             | Sets the flag, queues the car index, handles race completion and oil; its player branch calls `RaceCompleted(6)`. It does not independently play the explosion sound.              |
| `0x502d80`                    | RaceCompleted              | Ordinary reason 6 selects fancy index 24, then sets the single-player race-end countdown to 10000 ms. This branch has no separate sound call.                                      |
| `0x44ac60`                    | DoFancyHeadup              | Selects `SCROLLERS[index + 10]`; lower-priority indices are suppressed within 2000 ms of a higher-priority message.                                                                |
| `0x44a170`                    | DoHeadups                  | Scrolls at `trunc(325 * frameMs / 1000)` pixels per HUD update, holds at the authored centre for strictly more than 1000 ms, then scrolls left until outside the screen.           |
| `0x492370`                    | QueueWastedMessage         | Five-entry FIFO; drops the oldest at capacity and resets the head timer. Starts the timer when adding to an empty queue.                                                           |
| `0x4926a0`                    | Race loop / HUD update     | Rival abbreviation plus localized `WASTED` flashes through `Flash(150)`. Removes one expired head when `now > start + 5000`, resetting the next head's timer to the current frame. |
| `0x440550`, branch `0x440e85` | Collision damage aftermath | A human culprit and newly knackered victim select fancy index 20, `YOU WASTED 'EM`, once before credit/time rewards. No additional sound call occurs in this reward branch.        |

The native HUD draw uses `original_x + offset` during scrolling and `original_x` while holding. This was checked in the executable: rec2's reconstructed `DoHeadups` omits the authored X coordinate in its fancy-text calls. The browser follows the executable.

## Original lettering and timing

The asset server exposes the archive entries as ordinary virtual paths:

- `data/SCROLLERS.TXT`, entry 34: `4,21,YOU_ARE_WASTED`.
- The same file, entry 30: `4,21,YOU_WASTED_'EM`.
- `data/64x48x8/FONTS/Big_Italic/font.txt` and `PIXIES.P16` contain the metadata and individually named ASCII glyph pixelmaps.
- `data/FontCol.TXT`, polygon font 21, supplies the orange-to-yellow vertex colours.
- `data/TEXT.TXT`, localized string 19, supplies `WASTED`. Rival flash control byte `0xf9` selects DR font 7, mapped to polygon font 17 / `Medium_Headup`, whose authored colour runs from red to white.

The stock glyph maps are format 18, ARGB4444, with authored alpha including intermediate coverage values. `NativeFont` preserves that alpha and applies the original vertex-colour modulation. Its width scan follows native `FindCharacterWidth`: the rightmost nonzero 16-bit texel determines the glyph advance, including nonzero alpha. The stock `YOU ARE WASTED` width is 210 pixels.

`Big_Italic` has 32×32 glyph textures and native 32×32 polygon quads. The metadata's 24-pixel `fontCharacterHeight` controls text line height; it does not shrink the rendering quad. `Medium_Headup` uses 16×16 glyphs/quads. The renderer therefore draws those original full glyph dimensions. At the normal 640×480 HUD resolution, fancy slot 6 is centred at `(320,400)` and the rival counter/message slot 12 starts at `(416,13)`.

The native initial fancy offset is `320 + trunc(textWidth / 2)`. It reaches zero, holds for strictly more than 1000 ms, then exits until `offset <= -320 - trunc(textWidth / 2)`. This lifetime is distinct from the ten-second player race countdown. Both player index 24 and rival index 20 share the source priority rule, so a simultaneous rival reward does not replace the player-wasted message. Rival flashing toggles only when elapsed time is strictly greater than 150 ms and uses the current frame as its next time reference, without catch-up toggles.

## Sound evidence

`data/GENERAL.TXT` supplies the wasted-explosion sound ID; stock `data/SOUND/SOUND.TXT` maps 5400 to `PUPXPLOD.WAV`. Native loading passes local global `0x75f47c` to the explosion settings parser. Damage wasting reads that same global at `0x43f6b4` and calls `0x455c60` for the human player. The rival branch reads it at `0x43f6e7` and calls positional sound routine `0x456520` with the car position.

This establishes 5400 for normal damage-triggered wasting. It does not justify playing it on an arbitrary forced `KnackerThisCar` call, whose native path does not create the explosion or play that sound. The browser's physical wasting integration passes the parsed configured ID; the feedback component accepts it explicitly and deduplicates the event. Original positional versus non-positional native outlets are documented here; the existing browser `AudioSystem.playSound` plays the original WAV without reproducing those native outlets.

## Integration and validation

Create `WastedFeedback(assets, audio)`, await `init()` after asset initialization, and call `reset()` for a new race. On the first damage-wasted edge, call `wasted(kind, stableCarId, abbreviation, simulationTimeMs, explosionSettings.soundId, creditedToPlayer)`. Set the final argument only when the player caused that rival's wasting. It controls the rival fancy reward message, not the ordinary queued rival abbreviation.

Each frame, clear the full-screen overlay and call `draw(ctx, simulationTimeMs)`. It scales the authored 640×480 HUD coordinates to the canvas. `state(now).playerVisible` exposes the ten-second player countdown; `playerTextVisible` and `fancyVisible` expose the separately animated lettering. The world explosion renderer remains responsible for the original explosion frames.

Focused tests verify event deduplication/audio dispatch, strict flash and expiry boundaries, FIFO capacity, original archive text and glyph availability, the 210-pixel stock lettering width, scrolling versus countdown lifetime, and player-message priority over a credited rival reward. The focused tests and TypeScript checks pass with the local original installation.

The verified native boundary-race variant chooses fancy index 33 instead of24; this document and the current feedback component cover the ordinary Carma race used by the browser integration. Canvas rendering preserves source glyphs, advances, alpha and colours, but is not a claim of pixel-identical historical BRender rasterization.

# Drink Driving

Independently verified from the read-only installed HW executable documented in
[pedestrian awards](c2-pedestrian-awards-re.md). rec2 names the handlers but its
bodies are stubs and annotations are shifted for this installation.

Stock and Advanced pickup index **90** invokes action **48**, lasts 30 seconds,
and supplies integer `[3]` and floats `[.075, 1500, 2500, 1]`.

| Installed address                | Behavior                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x4df040` SetPissed             | Local driver 8 only; sound 3601, voice deadline `now + IRandomBetween(1500,3000)`, earned-credit multiplier, projection amplitude/period/phase |
| `0x4df120` ResetPissed           | Clears the credit multiplier and resets camera actor rotations while preserving translation                                                    |
| `0x4df1d0` PissedEffect          | Modulates the camera field of view and periodically plays 3602/3603                                                                            |
| `0x4e4b2e` cosine initialization | Generates 65 Float32 values `cos(i*pi/128)`, not a copied asset/table                                                                          |
| `0x44b960` EarnCredits2          | Signed wrapping earned multiplication/addition; zero multiplier means identity; finished-race guard                                            |

SetPissed draws the voice deadline first, then a Float32 period in the authored
range, then a phase in `[0,period)`, using the shared MSVC stream. The periodic
projection is `cosTable((now+phase)%period) * amplitude + 1`, multiplied by
GENERAL's camera angle, truncated to a BRender 16-bit angle. The four-quadrant
lookup and truncating quarter-table index are retained. The fourth float is
stored at `0x703e14`; no other installed reference to that location was found.
This handler does not inject arbitrary steering, grip or body torque.

Voice scheduling compares unsigned absolute timestamps strictly. It consumes
the pitch draw in `[0xc000,0x14000]`, then PercentageChance(50), then the next
1500–3000 ms delay. The browser converts the pitch to a Web Audio rate.

`NativeDrinkDriving` is bound to the normal timed powerup owner. Renewal,
expiry, cancellation and disposal update the same race earned-credit field;
debug grants use the normal handler. The projection is applied to the actual
camera before rendering. The browser's camera look-at path already regenerates
its rotation each frame, so no extra rotation reset is needed. Final payout,
repair spending and administrative debug credit editing remain separate.

Four numerical tests cover draw ordering, quantized projection, strict audio
deadlines, signed credit behavior, normal grants/renewal/expiry/cancellation and
the separate payout path. `tests/browser-native-rewards.mjs` checks original
index 90 through the debug UI, normal credit pickups, real W driving under the
projection effect, native graphical stunt rewards and cancellation. Its fixed
spin scenario is a controlled award-consumer fixture, not collision evidence.

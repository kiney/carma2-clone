# C2 cheaty opponent movement

Scope: the installed executable's nonphysical opponent-path mode, its transition back to physical simulation, and the fields changed when physics is disabled. This note does not specify route construction or the physical path follower; see [c2-ai-paths-re.md](./c2-ai-paths-re.md). The reference executable is `carma2_orig/carma2_HW.exe`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`. All binary observations below are from the installed HW executable; rec2 source is used only as a map and is called out where it disagrees.

## Mode ownership and transitions

`ProcessThisOpponent` in rec2 (`opponent.c`, annotated `0x4aa570`) owns the view-distance policy: a recently visible opponent is stopped from cheating, while an out-of-view opponent starts cheating. For ordinary opponents, the high-level cheating state is opponent flags bit `0x20` at `+0xb0`. `ProcessFollowPath` at installed `0x4af700` compares that bit with the follow-path cheating bit 10 in the packed word at `+0xf0`. A mismatch enters the transition branch; a stable cheaty state takes the cheaty-motion branch. Thus setting the opponent bit does not itself perform the transition movement: the next follower call does.

On transition into cheaty mode, installed code (`0x4b05fb–0x4b08d8`) projects the actor onto the current section segment in 3D. It computes `t=dot(actor-start, finish-start)/lengthSquared(finish-start)`; the section-delta components are Float32 stack locals, while actor-start remains live for the dot product. The quotient is stored as Float32 before clamping: `t<0` selects start, `t>1` selects finish, and both exact endpoints use interpolation. The resulting intersection is stored as three Float32 values at follow-data `+0xdc,+0xe0,+0xe4`. It then calls `TurnOpponentPhysicsOff` (`0x4a7740`) and moves the actor toward the intersection by at most this frame's step. The step is `float32(framePeriodMs * 0.001 * 6.0)` using the double constant at `0x589688` and float constant at `0x589668`. If the distance is at least the step, it advances by the step and leaves the moving-to-intersection flag set; otherwise it snaps to the intersection and clears that flag. This transition frame does not carry leftover distance into path traversal. Target deltas used for movement are stored as Float32 locals, and each resulting actor translation component is stored Float32.

On transition out, installed `ProcessFollowPath` calls `RematerialiseOpponentOnThisSection` at **`0x4a7cc0`**, passing the current signed section index and desired-speed float. (The nearby `0x4a7f10` is the nearest-section rematerialization routine; it is not the current-section transition call.) For an already-physical opponent (`+0xb0` bit `0x08` set), `0x4a7cc0` immediately returns 1. Otherwise it projects the actor onto the supplied section, writes the projected point to the actor transform translation at `+0x50,+0x54,+0x58`, points the actor along the section direction, and calls `0x4a8540` with desired speed. The projection uses the segment endpoints and clamps to an endpoint when the projection is outside. A zero-length-segment branch skips projection and orientation but still calls `0x4a8540`.

Return polarity is verified at the call site `0x4b0a29–0x4b0a62`: nonzero makes the caller zero car brake and acceleration forces (`car +0x12c0`, `+0x12b8`) and return follow result 0 (OK). **This does not prove physical placement:** the lower-level routine also returns 1 after exhausting placements, disabling physics and invoking fallback; see [rematerialization evidence](c2-ai-pursuit-re.md#rematerialization-boundary). Zero sets follow-data cheating bit 10 (`+0xf0`, mask `0x400`) and continues through the cheaty-motion path. This caller does **not** set made-it. That differs from rec2's `FollowCheatyPath` reconstruction, which sets `data->made_it=1` on failure; do not import that state mutation without further binary evidence.

## Cheaty movement and end result

Stable cheaty movement is inlined in `ProcessFollowPath` at `0x4b0a64–0x4b0e22`. It sets collision velocity to `(0, 41.4, 0)` (`41.4` is Float32 `0x4225999a`) and derives a per-call path distance from the same `framePeriodMs * 0.001 * 6.0` step, stored Float32. While moving to the stored intersection, it approaches that point and clears the transition flag only when distance is strictly less than the step. Equality moves the full step and retains the flag; every such approach frame returns immediately, discarding unused distance. It then consumes remaining step distance over projected sections: on reaching a section finish (`distance < remaining`), it snaps to the finish, subtracts the distance, stores the remainder as Float32 at stack `+0x24` (`0x4b0cb5–0x4b0cc5`), calls `GetOpponentsNextSection` (`0x4ae7d0`), and stores the next signed-16 section in follow data `+0xe8`. Otherwise (`distance >= remaining`) it advances proportionally along the segment, stores translation components as Float32, and retains the current section; equality therefore lands on the endpoint without advancing until a later positive-step call. The actor is pointed along the current movement vector through `PointActorAlongThisBloodyVector` (`0x4013d0`), which uses world-up and preserves translation. Section positions and current section indices therefore have explicit Float32 and signed-16 storage boundaries.

When no next section exists, this cheaty branch zeros acceleration and brake forces and returns 1 (`0x4b0dea–0x4b0e22`). The installed branch establishes that result for cheaty end-of-route; how each objective interprets it is objective-dispatch behavior, not a general follower result. Rec2's objective handlers map it inconsistently across objectives; those mappings are not claimed as installed-binary verified here. In particular, do not use this result as proof that a physical follower has reached its destination.

## Physics-off side effects

### Shared follow lifecycle implementation

`src/ai/follow-lifecycle.ts` now composes physical following with the recovered
cheaty entry/steady-motion helpers. Follow START clears its cheating bit
(`0x4b0ec8–0x4b0eef`), even when the outer opponent is already cheating; the
following RUN therefore enters the nonphysical mode again. START on an inactive
non-cheating car requests nearest-section rematerialization with the stored
velocity magnitude (`0x4b0ef5–0x4b0f50`). These callbacks are synchronous.

Exit uses authored finish maximum speed when below255, otherwise positive
minimum speed, converted by double .14492753623188406 and stored Float32.
When neither limit applies, it uses Float32 distance-to-finish and clamps twice
that distance to [1,7] (`0x4b0955–0x4b0a1b`). This is not the physical follower's
desired-speed field. A nonzero rematerialization result clears car forces and
returns immediately without physical following in the same call. Zero restores
the follow cheating bit and proceeds through cheaty motion, without changing
made-it. Raw path-end result1 clears forces and remains an objective-owned
notification, distinct from physical result2 give-up.

The adapter's tests cover both motion branches, transition side-effect order,
authored speed tiers, direction-dependent endpoints, raw return polarity and
cursor synchronization. `src/ai/rematerialization-state.ts` separately composes
the24 placement attempts, full saved-matrix restoration, activation, aligned
velocity resets and exhausted fallback. Both are still independent adapters:
engine cache/shape queries, objective dispatch and live rendering callbacks
must be bound before replacing RoadNavigator.

`TurnOpponentPhysicsOff` is installed at **`0x4a7740`** (the rec2 annotation `0x4a79a0` does not match the installed address). It performs these stores on every call:

- car fields at `car +0x12b8`, `+0x12c0`, `+0x1254`, `+0x135c`, and `+0x1340` are zeroed;
- collision-info fields at `collisionInfo +0x74,+0x78,+0x7c,+0x68,+0x6c,+0x70` are zeroed.

If opponent flags `+0xb0` contain bit `0x08`, it clears that bit, sets byte `1` at the render/model object `+0x20`, calls `0x4c8dd0`, and sets global active-car-list rebuild flag at `0x68fdcc` to 1. If the bit was absent, this conditional render/list update is skipped. The offsets are binary-verified; semantic names for all zeroed fields are not established here. The car force fields `+0x12b8/+0x12c0` are also directly used as acceleration/brake forces at the rematerialization caller, and `+0x1254` is curvature in the physical follower. Avoid assigning unverified meanings to the remaining offsets.

This is more than hiding an actor: physics-off clears dynamic state and collision vectors, clears the physical/materialized flag when set, updates the render object's byte, invokes a helper, and requests active-list rebuild. A browser transition should preserve this ordering and conditional side effect rather than merely toggling an AI mode boolean.

## Entry points and evidence limits

For ordinary racers, rec2's `StartToCheat`/`OiStopCheating` show setting/clearing opponent cheating state; installed `ProcessFollowPath` confirms the two-state comparison and transition behavior. Rec2 also calls physics-off directly for police/ROZZER handling, including its `TeleportCopToStart` path, but this note has not established the installed population or all police mode transitions. Police-specific behavior remains unresolved.

The mode and movement addresses, return polarity, flag write, Float32 actor/collision stores, force clearing and active-list side effects above were inspected in the installed HW executable. Rec2 supplies readable function/field names and a useful control-flow map, but does not override the installed evidence where they differ. Exact x87 rounding between memory stores, semantic labels for every physics-off offset, objective-specific interpretation of cheaty result 1, and police population behavior remain open.

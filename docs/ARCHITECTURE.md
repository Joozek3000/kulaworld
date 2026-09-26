# Architecture: Kulaworld MVP

## 1. Scope of the MVP

- 1–8 players in a browser, server-authoritative, one mode: **Key Race**.
- Grid movement: roll, turn, jump, edge-flip (gravity change), fall, death/respawn.
- Players block each other (no bumping yet).
- Placeholder visuals.
- Out of scope for the MVP: bumping/knockback, pickups, client-side prediction, other modes, level editor, art.

## 2. Repo layout

```
kulaworld/
  CLAUDE.md
  package.json            (workspaces, root scripts)
  tsconfig.base.json
  levels/                 test-flat.json, test-cube.json, ...
  packages/
    shared/src/
      dir.ts vec.ts rng.ts constants.ts
      level/   types.ts load.ts validate.ts
      sim/     world.ts actions.ts tick.ts keyRace.ts
      pose.ts  (float render interpolation, used by client + bots)
      index.ts
    server/src/
      index.ts            (Colyseus server, env config)
      rooms/RaceRoom.ts
      schema/State.ts     (Colyseus schema mirror of sim state)
    client/src/
      main.ts net.ts input.ts
      render/ scene.ts level.ts players.ts items.ts camera.ts
      ui/     hud.ts debug.ts
  tools/bots/src/index.ts
  docs/ ARCHITECTURE.md DECISIONS.md prompts/ reports/
```

The layout is a suggestion. The rule that all game rules live in shared is not.

## 3. Coordinates and directions

- World is an integer grid. `Vec3 = { x, y, z }` (ints). A **block** fills a cell. Empty cells are air.
- `Dir` enum: `PX=0, NX=1, PY=2, NY=3, PZ=4, NZ=5`. JSON uses strings `"+X" "-X" "+Y" "-Y" "+Z" "-Z"`.
- Helpers: `dirVec(d)`, `opposite(d)`, `cross(a, b)` (returns a Dir; asserts perpendicular), `add`, `sub`, `scale`, `cellKey(v)` → `"x,y,z"`.
- Three.js is right-handed, and so is this grid (same axes).

## 4. Player sim state

A ball occupies one **empty cell**. `up` is its gravity (the face normal of the block it stands on). `fwd` is perpendicular to `up`.

```
cell: Vec3        // the air cell the ball is in
up:   Dir         // ball stands on block at cell - up
fwd:  Dir         // perpendicular to up
action: Idle | Roll | Turn | Flip | Jump | Fall | Dead
from: {cell, up, fwd}   to: {cell, up, fwd}
startTick, endTick
keys: number
```

When an action starts, `from` is the current state and `to` is the result. When `tick === endTick` the player's state becomes `to` and the action becomes `Idle` (or chains, see §6).

## 5. Movement rules

Notation: `C` = cell, `U` = up vector, `F` = fwd vector, `solid(v)` = a block is at v, `free(v)` = not solid and not reserved by another player (§7).

**Forward (Roll / Flip)**, from Idle:
1. `A = C + F`. If `solid(A)`, the move is **blocked** (wall) and nothing happens.
2. If `solid(A − U)`, **Roll**: `to.cell = A`, same up/fwd. Requires `free(A)`.
3. Otherwise, **Flip** over the edge of the block the ball stands on: `to.cell = C − U + F`, `to.up = F`, `to.fwd = −U`. Requires `free(A)` and `free(C − U + F)`.

**Turn** (left/right pulse): the cell is unchanged.
- `left: to.fwd = cross(U, F)`
- `right: to.fwd = cross(F, U)`
- Check: with U=+Y and F=+Z, right is −X. This matches a Three.js camera behind the ball looking along F. Unit-test it.

**Jump selection** (like the original, per Jakub's playtest):
- Jump is a **held** button. While it's held, the ball keeps bouncing: each hop chains into the next with no idle tick.
- A bounce is **forward** if forward is held when it starts, otherwise it's in place. So holding Space+W chains forward jumps.
- **Forward latch:** pressing forward (rising edge) *during a Hop* makes the next action a forward jump immediately on landing, even if forward or jump is released before then. Forward pressed during a forward Jump doesn't latch; the ball just rolls on landing if W is still held.
- A tap shorter than one tick still gives one bounce, via the jump pulse.
- **Mid-air turning** (per Jakub, from the original): a left/right press while **airborne** (Hop, Jump, Fall) turns the ball **immediately**. It changes `to.fwd` on the tick the input is applied, with no Turn action and no delay, and the ball spins in the air. The jump's trajectory (`to.cell`) doesn't change. Only the facing does, so the next forward jump or roll goes the new way. Several presses in one airborne action stack. Turns on the ground stay a 3-tick Turn action.
- If a forward jump is blocked (A1 solid or taken), it falls back to a hop.

**Hop**: the ball bounces up along U and lands on the same cell. `to` = the current pose, duration `JUMP_TICKS`. It reserves only its own cell. It's blocked if `solid(C + U)` (a low ceiling). With push on, a hopping player can only be pushed in the low part of the hop (§14 pushable states). This is the counterplay to a push.

**Jump forward** (pulse + fwdHeld), up to 2 cells along F through the air:
1. `A1 = C + F`, `A2 = C + 2F`. If `solid(A1)` or `!free(A1)`, the jump is blocked.
2. If `solid(A2)` or `!free(A2)`, it becomes a short jump with landing cell `L = A1`. Otherwise `L = A2`.
3. Jump action: `to.cell = L`, same up/fwd, duration `JUMP_TICKS` (short jumps also use it).
4. On landing, if `solid(L − U)` the player goes Idle. Otherwise a **Fall** starts immediately.

**Fall**, one cell per `FALL_TICKS_PER_CELL` along −U:
- Before each step: if `solid(C − U)`, land and go Idle.
- Otherwise step to `C − U`.
- If the cell leaves the level AABB expanded by `KILL_MARGIN` on all sides, the player goes **Dead**.
- MVP simplification: falls ignore other players. Overlap is allowed until one of them moves.

**Dead**: after `RESPAWN_TICKS`, respawn at a free spawn point. With push off, keys are kept. With push on, a death drops 1 key (§14). Knockout mode uses lives instead (§15).

## 6. Timing and input

Server tick is 20 Hz (50 ms). Constants live in `shared/constants.ts`:

| Constant | Ticks |
|---|---|
| ROLL_TICKS | 5 |
| TURN_TICKS | 3 |
| FLIP_TICKS | 6 |
| JUMP_TICKS | 10 |
| FALL_TICKS_PER_CELL | 2 |
| RESPAWN_TICKS | 40 |
| INPUT_BUFFER_TICKS | 6 |
| KILL_MARGIN (cells) | 6 |

- The client sends an `input` message when input changes: `{ seq, fwdHeld: boolean, turn: -1|0|1, jump: boolean }`. `turn` and `jump` are pulses.
- The server stores `fwdHeld` plus **one buffered pulse** (the latest wins). A pulse expires after `INPUT_BUFFER_TICKS`.
- Input also carries `jumpHeld: boolean`. The server derives the forward latch itself from the `fwdHeld` rising edge while the player is Hopping.
- Since phase 09 an input may carry `tick`: the tick the client wants it applied at. The server queues it (§17). Without `tick` (bots) it applies on the next tick.
- When a player is Idle on a tick (including the tick its previous action ended), it picks the next action in this priority order:
  1. buffered jump pulse or forward latch → jump (forward if `fwdHeld || latch`, else hop)
  2. buffered turn
  3. `jumpHeld` → jump (forward if `fwdHeld`, else hop)
  4. `fwdHeld` → roll

  The latch is cleared at every decision. So holding forward rolls continuously, and turning mid-roll takes effect the moment the roll ends.
- Actions can't be cancelled.

## 7. Tick order and reservations

Each tick, `step(world, inputs)` in shared runs:
1. Apply inputs received since the last tick.
2. **Finish actions** where `endTick === tick`: apply `to`, run pickups/exit checks (§8), and continue falls.
3. **Start actions** for Idle players. Iterate players in join order, rotated by `tick % playerCount` for fairness.
4. Run mode logic (§8): win check and timer.

**Reservations**: a map `cellKey → playerId` containing each player's current cell plus the target cell(s) of their in-progress action. `free(v)` = not solid and (not reserved, or reserved by self). The sim must be deterministic, and replaying the same inputs must give the same state (test this).

## 8. Key Race mode

- The level defines `keys[]`, an `exit`, `keysRequired` and `timeLimitSec`.
- A key is collected when a player's action **finishes** in its cell (roll, flip, jump landing or fall landing, not mid-air). A collected key is removed for everyone.
- The exit is locked for a player until they hold `keysRequired` keys. The first player to finish an action in the exit cell while unlocked wins.
- Timeout: most keys wins. A tie is a draw.
- Room phases: `lobby → countdown (3 s) → playing → results (5 s) → lobby`.
  - Lobby: players toggle ready (R). Start when everyone is ready and players ≥ `MIN_PLAYERS` (env, default 1 in dev, 2 in prod).
  - Each round reloads the level (keys reset, players at spawns).

## 9. Level format (`levels/*.json`)

```json
{
  "id": "test-cube",
  "name": "Test Cube",
  "version": 1,
  "blocks": [[0,0,0], [1,0,0]],
  "boxes": [{ "min": [0,0,0], "max": [4,4,4], "hollow": false }],
  "spawns": [{ "cell": [2,5,2], "up": "+Y", "fwd": "+Z" }],
  "keys":   [{ "cell": [2,-1,2], "up": "-Y" }],
  "exit":   { "cell": [5,2,2], "up": "+X" },
  "keysRequired": 3,
  "timeLimitSec": 120
}
```

- Optional `"sky": ["#top", "#bottom"]`: the client's gradient sky colours (render-only, phase 07b).
- `blocks` and `boxes` are merged. The loader expands boxes into a `Set<cellKey>`.
- `validateLevel()` returns a list of errors. It checks that:
  - spawn, key and exit cells are empty and `solid(cell − up)`
  - each spawn's `fwd` is perpendicular to its `up`
  - there are ≥ 4 spawns
  - there are no duplicate item cells
  - `keys.length ≥ keysRequired`
- The server refuses to load an invalid level. A Vitest suite validates every file in `levels/`.

Required test levels:
- `test-flat`: a 9×1×9 platform with a 1-wide gap (jumpable), a 2-wide gap (not jumpable), a wall block and an edge to flip over. 4 spawns, 3 keys, keysRequired 2.
- `test-cube`: a solid 5×5×5 cube. Spawns on the top face. Keys spread over the other 5 faces. Exit on the bottom face. keysRequired 3. This exercises flips on every face.

## 10. Networking (Colyseus)

- Room name `race`, `maxClients 8`, join options `{ name }`.
- Schema `GameState`:
  - `phase`, `tick`, `phaseEndTick`, `levelId`, `winnerId`
  - `players: MapSchema<PlayerS>`, `items: MapSchema<ItemS>`
- `PlayerS`: `id`, `name`, `color`, `action`, `from*` / `to*` (cell xyz as int16, up, fwd), `startTick`, `endTick`, `keys`, `ready`.
- The server owns a plain sim `World` and copies it into the schema after each step. Don't make the schema the sim state.
- Messages: client → server `input` and `ready`. Server → client `event` (`{type:'key'|'win'|'death', ...}`) for sounds/FX later.
- Env (read from `.env`): `PORT` (2567), `MIN_PLAYERS`, `LEVEL` (default `test-cube`), `LATENCY_MS` (use Colyseus `simulateLatency` if available, otherwise log in DECISIONS.md what you used).

**Client time and rendering**: the client doesn't simulate. It keeps `estServerTick` (a float), updated from each patch's `tick` plus the local elapsed time, and smoothed so it never jumps backwards. It renders at `renderTick = estServerTick − INTERP_TICKS` (2). For each player, `pose.ts` computes the position/orientation from `(action, from, to, progress)`:
- Roll: lerp the position and rotate the ball around the axis `cross(U, F)`.
- Turn: slerp the orientation around U.
- Flip: the ball's centre sweeps a semicircle around the edge line `E = (C − U) + 0.5·U + 0.5·F`. The offset `(C − E)` rotates by 0→π about the axis `cross(U, F)`. Meanwhile the up vector rotates 90° from U to F (the camera follows the up vector, not the position arc). Unit-test the start, mid and end points.
- Jump: lerp plus a parabola along U (peak 1.2 cells).
- Hop: the same parabola along U with no lateral movement (peak 1.0 cell).
- Ball contact: the ball's radius is 0.4 and the cell centre is 0.5 above the face, so render the ball offset by `−U·0.1` so it touches the surface.
- Fall: linear along −U.
- Dead: hidden.

`pose.ts` is float math used only for display. It never feeds back into the sim.

## 11. Client

- Controls:
  - W/↑: forward (hold)
  - A/D or ←/→: turn (pulse)
  - Space: jump
  - R: ready
  - M: mute, `[` / `]`: master volume
  - F3: debug overlay, F4: feel-tuning panel (dev builds only)
- Level: `InstancedMesh` of unit boxes with thin edge lines.
- Ball: a sphere (r = 0.4) with two coloured hemispheres so rolling is visible.
- Keys: yellow spinning octahedrons. Exit: a torus, grey when locked and green when unlocked for the local player.
- Other players get CSS2D name labels.
- Feel (phase 08): balls squash and stretch on a per-ball spring (render only). Sounds are procedural WebAudio synths, overridable by dropping `public/sfx/<name>.ogg|wav`. Ball sounds are triggered by rendered segment transitions (render time), and other players' sounds are positional.
- Camera: follow cam at `ball − F·4 + U·2.5` looking at `ball + F·1.5`, with `camera.up = U`. The position and quaternion are damped (not snapped) so flips and turns rotate smoothly.
- HUD (HTML overlay): phase/countdown, timer, keys x/required, player list with ready state and keys, and a results banner.
- Debug overlay: estServerTick, ping, local player action/cell/up/fwd, patch rate.
- URL params: `?name=Bob` and `?server=ws://host:2567`. Vite runs with `--host` for LAN tests.

## 12. Solo multiplayer testing

1. **Unit tests**: the sim is where the bugs are. Test every rule in §5–§8 with tiny hand-built worlds. Include a determinism replay test.
2. **Multiple tabs**: each tab is a player (`?name=A`, `?name=B`).
3. **Bots** (`npm run bots -- --count N --behaviour wander|seek`): headless Colyseus clients.
   - `wander`: random inputs.
   - `seek`: BFS over `(cell, up, fwd)` states using the shared move rules to reach the nearest key, then the exit.
4. **Latency**: set `LATENCY_MS=150` in `.env`, run `npm run dev`, then check that motion is still smooth.
5. **LAN**: join from a phone or a second PC.

## 13. Roadmap after the MVP (not now)

Bump/knockback, pickups (speed, heavy, gravity lock, crumble trap), client prediction using the shared sim, paint/tag/arena modes, a level editor, a visual style pass, audio.

## 14. PvP: push (phase 06)

**Pushable states.** Only players on the same gravity face (`V.up === P.up`) can be pushed. A victim V is pushable when it is:
- Idle, Turning, or Stunned **from a failed push (bounce)**, or
- Hopping within `HOP_PUSH_WINDOW` (2) ticks of the hop's start or end, i.e. while it's low.

Mid-hop (high), Rolling, Flipping, Jumping, Falling, Knocked, **Stunned after being knocked** (stagger) and Dead players can't be pushed. The stagger rule stops chain pushes: one push can't carry a victim across a whole platform (decided after phase 06, when one push on a straight edge was always a kill). Holding jump therefore gives partial cover, 6 of every 10 ticks, not immunity.

**Push**
- Trigger: P's fwd intent targets cell `A = C + F` and `A` holds a pushable V. P doesn't need a special button: rolling into someone pushes them.
- **Success** when `A + F` is not solid and not reserved:
  - V gets `Knocked` (moves `A → A + F` over `KNOCK_TICKS` = 4), cancelling any Turn/Hop/Stun it was in.
  - P's Roll into `A` proceeds normally.
  - When the knock ends: if `solid(A + F − U)` V becomes `Stunned` for `STUN_TICKS` (6) and can't be pushed during it (stagger). When it recovers, the escape rule gives it first move. Otherwise V starts a **Fall** (the reusable fall function); off the map that means death.
- **Fail** when `A + F` is solid or reserved (a wall or another player behind V): P gets `Stunned` in place for `STUN_TICKS` with a *bounce* flag, rendered as a short lunge and recoil. V is unaffected, so pinning against a wall doesn't work.
- **Not pushable:** if V is in a non-pushable state, P is simply blocked (MVP behaviour, no stun) and retries next tick if fwd is still held. So holding W against a bouncing player pushes them the moment they're low.

**Same-tick precedence.** Collect all Idle players' intents first, then resolve:
1. **Escape first.** Victims whose own intent this tick is a Roll, Flip, Jump or Hop start it, and pushes aimed at them are blocked with no stun. A victim whose intent is a Turn is still pushed.
2. **Mutual push.** If P and Q each target the other's cell, both are Stunned (bounce). Nobody wins through tick order.
3. **Other pushes** resolve in fair order. A victim is knocked at most once per tick.
4. **Non-push moves** into the same empty cell keep the existing fair-rotation rule.

**Death with PvP**
- Any death drops 1 key (if the player has any). The key reappears at its original spot and a `keyDrop` event is sent.
- If the victim was knocked within `KNOCKOUT_CREDIT_TICKS` (60) before dying, a `knockout {pusherId, victimId}` event is sent.

**Config**
- `PUSH=on|off` in `.env` (default on). It's passed into `createWorld` as a rule flag, so tests can run both ways.
- With PUSH=off, the MVP rules apply exactly, including death keeping keys.

**Modes using it**: Key Race with push is the default. Knockout is §15.

**Later options (don't build yet)**:
- Charged ram: hold fwd for 1 s to push 2 cells.
- Heavy pickup: can't be pushed.
- Jump-stomp: landing on a player stuns them.

## 15. Knockout mode (phase 07)

**The level decides the mode.** A level JSON gets `"mode": "race" | "knockout"`, defaulting to race. Knockout levels have no `keys`/`exit`/`keysRequired`. Instead they have:

```json
"mode": "knockout",
"lives": 3,
"timeLimitSec": 180,
"crumble": { "startSec": 45, "intervalSec": 10, "warnSec": 2 }
```

`LEVEL` lists can mix race and knockout levels, and the mode switches per round. `Rules` stays `{ push }` (push is always on in Knockout). The mode lives in `world.mode` + `world.knockout` state.

**Lives**
- Each player starts with `lives`. A death costs 1 life.
- With lives left, the player respawns after `RESPAWN_TICKS` at a random free spawn (seeded RNG). It gets **spawn protection**: unpushable for `SPAWN_PROTECT_TICKS` (40), rendered translucent. Protection ends early if the player pushes someone.
- At 0 lives the player is **eliminated**. It spectates (the camera follows whoever knocked it out, or orbits) and reserves no cells.

**Win**
- Last player with lives > 0 wins.
- If the last players are all eliminated on the same tick, it's a draw between them.
- On timeout: most lives, then most knockouts; still tied means a draw.
- In solo dev (1 player) the round ends only by timeout or death, so it's testable alone.

**Crumble**
- The world gets an overlay `removed: Set<cellKey>`. `isSolid(world, v) = level.solid.has(v) && !removed.has(v)`. Every sim/BFS/validation path that asks "is there ground" must use the world version.
- Crumble order: blocks grouped by exact squared distance from the level's bounding-box centre, furthest first. Consecutive groups are then merged (outside in) until each band has at least 4 blocks; a short leftover core joins the band before it (phase 07b). Every `intervalSec` after `startSec`, the next band is removed.
- `warnSec` before removal, a band is marked `warning`, which is synced and rendered as shaking and red blinking.
- A block is never removed if that would leave fewer blocks than 2× the number of alive players. Stop crumbling there.
- A player standing on a removed block starts a Fall on the next tick. Mid-action players are checked when the action finishes (existing landing logic).

**Events**: `lifeLost {playerId, livesLeft}`, `eliminated {playerId, byId?}`, `crumbleWarn {band}`, `crumble {band}`.

**Arenas**
- `arena-01`: a 9×9×1 plate with 4 single-cell holes and 8 spawns around the edge. Flat brawling.
- `arena-02` "Sky Cross" (phase 07b): a 5×5 plate with four different arms (beam to a pad, a beam with a 1-cell jump gap to a pad, a ladder of two rails, and a beam that wraps down a hanging column to a lower pad). 8 spawns, 4 on top and 4 underneath. Pads crumble first, the plate core last.
- `arena-cube`: the old arena-02, a solid 5×5×5 cube. Kept for tests, not in the default rotation.

## 16. Jump-over and stomp (phase 10)

Decided with Jakub: jumping onto an enemy is an attack that **displaces**, and the bump goes in **the attacker's jump direction** (option A). It's aimable and readable, with no randomness.

**Jump over**
- A forward jump is no longer blocked by a *player* on A1. The ball passes over (peak 1.2). A1 being **solid** still blocks it (falls back to a hop).
- The player on A1 is unaffected. A1 isn't reserved by the jumper when a player stands there.

**Stomp (forward jump landing on a player)**
- At jump start, landing cell L (A2, or A1 on a short jump) is checked. If it holds a player V on the same face, the jump is a **stomp jump** when the bump cell `B = L + F` is not solid and not reserved.
  - A stomp jump reserves C, L and B for its whole duration, so nobody else can move into B.
  - If B is blocked at jump start, L counts as not free, and the existing short-jump/hop fallback applies.
- **At landing:**
  - **V still in L and grounded** (Idle, Turning, Stunned, or Hop within the low window): **stomp**.
    - V is Knocked to B. It uses the push knock (`KNOCK_TICKS`), then falls if B has no ground.
    - V then gets a stagger stun (`STUN_TICKS`, unpushable, can't be stomped again).
    - The attacker lands in L.
    - Events: `stomp {attackerId, victimId}`. Knockout credit works as for a push.
  - **V in L but high in a hop:** **clash**. The attacker **rebounds** to its takeoff cell C (`Rebound` action, `REBOUND_TICKS` = 6, a reverse arc; C stayed reserved). No stun. V's hop continues. Event `clash`. Holding jump is the defence against stomps.
  - **V already leaving L** (its action targets another cell): it escaped. The attacker lands normally.
  - **L empty:** normal landing.
- **Hop never stomps**: it lands on its own cell.
- **Fall landing on a grounded player:** the faller stomps it. The bump direction is the first free of [faller fwd, faller left, faller right, faller back]. If none is free, the MVP overlap rule applies (rare).
- **Stomp vs push:**
  - A stomped victim is staggered (unpushable) for `STUN_TICKS`, so there are no stomp→push or push→stomp instant combos.
  - After the stagger, the victim's escape precedence applies as for pushes.
- **Prediction (§17):** jumps with a player on A1 or L are not predicted. `Rebound` is a server-only state (prediction pauses, like Knocked).
- **Clarifications (phase 10):**
  - **Stompable = pushable.** It's the same helper, `isPushable`: Idle, Turning, Stunned by a *bounce*, or Hop in the low window, and not spawn-protected.
    - A victim that's still in L but not stompable **clashes**. That covers high in a hop, but also staggered or spawn-protected: the attacker can't land on top of it, so it rebounds.
  - **"Leaving"** means the victim's action targets another cell: Roll, Flip, Jump, Knocked away, Rebound, Fall. A Turn, Hop or Stun stays in L.
  - **A1 "held by a player"** covers anyone standing there or moving into it. The ball flies over either way, and A1 then isn't reserved by the jumper.
  - **L counts as a stomp target** only when a live player *stands* there on the same face. If L is merely reserved (someone moving in), it's not free, and the short-jump/hop fallback applies.
  - **Fall stomp direction:** the bump cell must be free (not solid, not reserved), but it needs no ground; the victim then falls.
  - **Rebound:** from L back to C, facing kept, `REBOUND_TICKS` = 6. Pose: the jump parabola in reverse at `REBOUND_HEIGHT` 0.8. It's airborne, so mid-air turns apply.
  - **Push rules off:** jump-over stays; stomps and fall stomps are off. A player in L makes L not free (the old short-jump/hop fallback), and a fall onto a player overlaps as in the MVP.
- **Readability:** during a forward jump, a landing marker (ring in the attacker's colour) is drawn on L, visible to everyone. It turns red when L holds a player (a stomp is incoming).

## 17. Client prediction (phase 09)

**Goal**: your own ball reacts on the next tick after a key press, whatever the ping, while the server stays authoritative. Other balls are unchanged (interpolated at `estServerTick − 2`).

**Input timing**
- The client runs a predicted clock `predTick = estServerTick + lead`. `estServerTick` itself trails the server by about RTT/2, so the lead covers the whole round trip: `lead = ceil(RTT / 50 ms) + margin`.
  - `margin` starts at 2 ticks, because patches aren't phase-locked to ticks.
  - It grows by 1 (up to 5) whenever an ack shows an input applied later than stamped, and eases back 1 per 15 s without one.
  - The lead grows at most 2 ticks/s and shrinks 0.5 ticks/s, so `predTick` never jumps. It never runs backwards.
- Every input is stamped `tick = floor(predTick) + 1`.
- **Scheduling** (`InputSchedule`, shared by server and predictor, so both agree):
  - An input applies at `max(stamp, now + 1, the previous input's tick)`.
  - A pulse never shares a tick with an earlier pulse. The sim buffers one pulse, so a turn would overwrite a jump.
  - A stamp more than 20 ticks ahead is clamped to +20, not dropped: a jump is never dropped.
- **Server:** a per-player `InputQueue`. Before each step it applies the inputs due on that tick, and echoes `ackSeq`/`ackTick` (the last input applied and its tick) in the player's schema.

**Predictor** (`shared/src/predict.ts`, pure; `client/src/predict/local.ts` wraps it)
- A private `World`: the level, crumbled blocks and collected keys from the server, the local player, and every other player frozen at its latest server state (an obstacle whose action never ends).
- It runs the shared `step()` with push off, no mode logic (no crumble schedule, no timeout), and events ignored.
- It steps the local player up to `floor(predTick)`, applying its own logged inputs at their ticks, and records the local state per tick.
- **Reconcile**, on every patch at server tick T:
  1. Move logged inputs to the server's truth. The acked one goes to `ackTick`. An unacked one whose tick T has already passed arrived late, so it and everything after it are held back until acked, rather than guessed tick by tick.
  2. Compare the recorded state at T with the server's (action, from, to, start/end ticks).
  3. On a match, drop older history. On a mismatch, reset to the server state at T and re-simulate the logged inputs to the current predicted tick.
     - Held flags come from the log.
     - The buffered pulse and latch come from our own history, unless the server decided at T (it's Idle, or an action started at T), in which case they were spent.
  4. A mismatch counts as a **misprediction**, or as a **deferral** when a held-back move toward a player was involved.
- **Not predicted**:
  - **Moves toward other players:** a roll, flip or forward jump whose next cell, the one beyond it, or the flip's landing cell is held by another player. The local player holds still and the server decides. That covers pushes, and in phase 10 jumps over or onto players (§16).
  - **Knocks, stuns, deaths, respawns:** while the local player is Knocked, Stunned or Dead on the server or in the prediction, every patch resets and replays (nothing counted), and the ball renders from the server. Dead never respawns in the predictor.
  - **Keys, exits, crumble falls, lives:** these only come from the server. A crumble fall is simply corrected when the patch arrives.

**Rendering**
- The local ball renders the predicted player at `predTick`.
- It follows the server timeline (as with `?predict=0`, at `estServerTick − 1`) while:
  - it is Knocked, Stunned, Dead or eliminated; or
  - a held-back move was just resolved by the server (a push, a bounce, or a roll once the way cleared), until the server has it Idle again with nothing held back. The server's action starts from the cell the predicted ball was holding in, so the switch is seamless and pushes render exactly as without prediction.
- A correction, or a switch between the timelines, blends the drawn pose into the new one over 100 ms (a decaying position offset and orientation slerp) instead of teleporting.
- Sounds and squash come from the rendered segments, so for the local ball they happen at press time.
- `?predict=0` turns prediction off: unstamped inputs, server timeline only (phase 08 behaviour).
- F3 shows `predTick`, the lead, mispredictions per minute, deferrals and the last correction's size.


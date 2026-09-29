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
1. `A = C + F`. If `solid(A)`, it's a **Climb** (changed in phase 11, per Jakub: like Kula World, a vertical wall becomes the floor). The ball stays in cell C and rotates onto the wall: `to.cell = C`, `to.up = −F`, `to.fwd = U`, duration `CLIMB_TICKS`. Holding W then rolls up the wall; at its top edge a normal Flip takes the ball onto the wall's top. There's no "blocked by wall" for rolling any more. Walls block only jumps (A1 solid → hop) and pushes/knocks (bump cell solid → bounce).
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
- **Jump grace** (phase 10b): W and Space pressed "together" from a standstill often reach the server a tick or two apart, which would roll a tile first.
  - A jump pulse arriving within `JUMP_GRACE_TICKS` (2) ticks after a Roll that started **from rest**, with fwd still held, cancels that roll. "From rest" means the player was Idle for at least a tick; not a roll chained on the tick a previous action ended.
  - The cancelled roll's target cell is released (reservations are rebuilt every tick), and the player decides again the same tick, from the roll's origin cell. With the pulse and fwd held, that's a standing forward jump under the normal jump/stomp rules, starting on the current tick.
  - Chained rolls never cancel, so W held plus a Space tap mid-run still jumps at the end of the tile.
  - It's shared sim code, so the predictor applies it too. The client blends the few rendered roll frames back into the jump.

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

**Reservations**: a map `cellKey → playerId` containing each player's current cell plus the target cell(s) of their in-progress action. A ball high in a hop reserves nothing (§14 roll under). `free(v)` = not solid and (not reserved, or reserved by self). The sim must be deterministic, and replaying the same inputs must give the same state (test this).

## 8. Key Race mode

- The level defines `keys[]`, an `exit`, `keysRequired` and `timeLimitSec`.
- A key is collected when a player's action **finishes** in its cell (roll, flip, jump landing or fall landing, not mid-air). A collected key is removed for everyone.
- The exit is locked for a player until they hold `keysRequired` keys. The first player to finish an action in the exit cell while unlocked wins.
- Timeout: most keys wins. A tie is a draw.
- Room phases: `lobby → countdown (3 s) → playing → results (5 s) → lobby`.
  - Lobby: players toggle ready (R). Start when everyone is ready and players ≥ `MIN_PLAYERS` (env, default 1 in dev, 2 in prod).
  - **Level vote** (phase 14): the lobby offers up to 3 candidates from the level pool (random, never the level just played, at least one race and one knockout when the pool allows) plus Random. Players vote with 1–4 or a click and can change their vote. At countdown the most votes wins, a tie is broken by the room's seeded RNG, and no votes (or Random winning) picks a random pool level other than the last. Votes are cleared on every new lobby; a leaving player's vote goes with them. Pure logic in `shared/src/vote.ts`.
  - Each round reloads the level (keys reset, players at spawns).
  - **Lobby backdrop** (phase 14b): behind the vote panel the scene shows the leading candidate (most votes, the first candidate on a tie or with no votes), with a 150 ms fade to black between levels.

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
- Optional `"pool": true` (phase 14): the level is in the lobby vote's pool. Default false (test levels, arena-cube, traps-lab).
- Optional `"theme"` (phase 14b): one non-lethal trap type (ice, arrow, boost, crumble) exempt from the modifier cap (LEVEL-DESIGN 7.2), e.g. arena-03 `"theme": "ice"`.
- Optional `"notes"` (phase 14b): `{ "<rule> <where>": "why" }`, the id `level:check` prints for a warning. A noted warning is intentional (LEVEL-DESIGN 7.5 asks for it on push lanes into lethal tiles).
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
  - `candidates` (level ids) and `voteCounts` (3 candidate slots, then Random), and `PlayerS.vote` (-1 = none) (phase 14)
- `PlayerS`: `id`, `name`, `color`, `action`, `from*` / `to*` (cell xyz as int16, up, fwd), `startTick`, `endTick`, `keys`, `ready`.
- The server owns a plain sim `World` and copies it into the schema after each step. Don't make the schema the sim state.
- Messages: client → server `input`, `ready` and `vote` (a candidate index 0–2, or 3 = Random; lobby only). Server → client `event` (`{type:'key'|'win'|'death', ...}`) for sounds/FX later.
- Env (read from `.env`): `PORT` (2567), `MIN_PLAYERS`, `LEVEL` (optional testing override of the pool: one id or a comma list, voted on like the pool; unset = every `"pool": true` level), `LATENCY_MS` (use Colyseus `simulateLatency` if available, otherwise log in DECISIONS.md what you used).

**Client time and rendering**: the client doesn't simulate. It keeps `estServerTick` (a float), updated from each patch's `tick` plus the local elapsed time, and smoothed so it never jumps backwards. It renders at `renderTick = estServerTick − INTERP_TICKS` (2). For each player, `pose.ts` computes the position/orientation from `(action, from, to, progress)`:
- Roll: lerp the position and rotate the ball around the axis `cross(U, F)`.
- Turn: slerp the orientation around U.
- Flip: the ball's centre sweeps a semicircle around the edge line `E = (C − U) + 0.5·U + 0.5·F`. The offset `(C − E)` rotates by 0→π about the axis `cross(U, F)`. Meanwhile the up vector rotates 90° from U to F (the camera follows the up vector, not the position arc). Unit-test the start, mid and end points.
- Jump: lerp plus a parabola along U (peak 1.2 cells).
- Hop: the same parabola along U with no lateral movement (peak 1.0 cell).
- Ball contact: the ball's radius is 0.4 and the cell centre is 0.5 above the face, so render the ball offset by `−U·0.1` so it touches the surface.
- Fall: linear along −U.
- Climb (phase 11): the ball stays in C. The frame rotates −90° about `cross(U, F)` (up U → −F, fwd F → U), with a little forward spin. The contact offset follows up, so the ball rolls from the floor into the corner onto the wall.
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
  - **Occlusion (phase 11):** on a climbed wall the usual spot is inside the old floor. The rig tries progressively higher, closer offsets (each looking at `ball + F·1.5`) and takes the first with a clear line to the ball. As a last resort it pulls the camera toward the ball until the line is clear.
- HUD (HTML overlay): phase/countdown, timer, keys x/required, player list with ready state and keys, and a results banner.
- Debug overlay: estServerTick, ping, local player action/cell/up/fwd, patch rate.
- URL params: `?name=Bob` and `?server=ws://host:2567`. Vite runs with `--host` for LAN tests.

## 12. Solo multiplayer testing

1. **Unit tests**: the sim is where the bugs are. Test every rule in §5–§8 with tiny hand-built worlds. Include a determinism replay test.
2. **Multiple tabs**: each tab is a player (`?name=A`, `?name=B`).
3. **Bots** (`npm run bots -- --count N --behaviour wander|seek`): headless Colyseus clients.
   - `wander`: random inputs.
   - `seek`: BFS over `(cell, up, fwd)` states using the shared move rules to reach the nearest key, then the exit.
   - `bully`: hunts the nearest opponent and pushes it (knockout play).
   - `blocker` (phase 12b): sits in a 1-wide corridor on the others' route to the keys/exit (knockout: the arena centre), facing the approach. It moves only to step off a hot tile and back, or to return after being pushed. On its way it waits rather than push anyone in its path; it pushes only at its post, when someone is right in front (phase 12c).
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

**Roll under a high hop** (phase 14b, per Jakub: when a ball bounces in place, others can roll underneath it):
- A ball that's **Hopping and high** (`airHop`: more than `HOP_PUSH_WINDOW` ticks after the hop's start tick and before its end) doesn't reserve or block its ground cell for rolls, flips or climbs. Its cell is "air-occupied": other balls roll into it and through it. The hop's start tick is neither low nor high (blocked, as an escape).
- A roll into a **low** hopper is a normal push. A roll into a **high** hopper passes under it. So holding W at a bouncing ball either pushes it (low) or rolls under it (high), whichever the timing gives.
- **When the hop lands** (its end tick) on a cell another ball is on the ground in or rolling through (its pose or its target is the cell; airborne balls don't count), the landing is resolved **after that tick's moves**, so a ball that rolls on from under the hopper that tick counts as passing:
  - a ball **standing** there (its pose and target are the cell) and stompable is **stomped** by the fall-landing rule (§16: bump to the first free of hopper fwd, left, right, back; stagger; credit). No free direction: the MVP overlap.
  - a ball standing there but not stompable (staggered, spawn-protected), or balls only **passing** (rolling in or out): the hopper **re-hops** at once (a new Hop from that tick, even with jump released). Rolling under someone keeps them in the air, and they come down on whoever stops.
  - Otherwise it lands normally. The hopper then decides from the next tick (no chained hop on that tick).
- A forward jump whose landing L holds a high hopper is still a stomp jump (L is unreserved but not a place to land), and it **clashes** if the hopper is still high at the landing (§16).
- A high hopper **ends a cradle line**: it isn't a middle ball. A roller passes under it and strikes the line behind from there, and a line pushed toward it knocks its last ball in under it.
- Two balls on the ground in one cell (one under a landing hop) block a roll into it.
- Nobody spawns under a hopper.
- Push rules off: rolling under and re-hopping still apply (it's movement, not PvP); a ball that stops under a hopper gets the MVP overlap instead of a stomp.
- Prediction: rolls into a hopper's cell are deferred to the server like every move toward a player (§17).
- Bots: seek and blocker roll under a high hopper on their path; the bully never picks a cell with someone in it as a place to stop.
- Client: a ball under a hopper renders normally; the hopper's shadow sits on top of it, and a roll under plays a short whoosh.

**Cradle push** (phase 12b, replaces the phase 12 "whole line moves" chain push, per Jakub: like the kinetic toy, only the **last** ball flies):
- When P's fwd targets V1 and there's a contiguous line V1..Vn (n ≥ 2, n ≤ `CHAIN_MAX` = 6) of live players on P's face, each in the next cell, it's a **cradle strike**:
  - **P doesn't move.** It gets `Strike` (appended action, `STRIKE_TICKS` = 4): a lunge-and-recoil in place, with no stun and no push immunity change.
  - **Middle balls V1..Vn−1 don't move** and aren't stunned (render-only shudder). They transmit if they're grounded and not moving: Idle, Turning, Stunned (bounce or stagger), or a low Hop.
  - **The last ball Vn** is Knocked one cell along F if it's pushable and `cell(Vn) + F` is not solid and not reserved. Then stagger, or a fall if there's no ground. P gets knockout credit. Events: `cradle {pusherId, victimId, length}`.
  - If the last ball isn't pushable, or its next cell is blocked, **P bounces** (as a failed push).
  - If any middle ball is moving (not transmitting), the line is broken: P is **blocked** (no stun) and retries.
- n = 1 (a single victim, nothing behind it) is the normal push: P rolls in and V is knocked.
- Escape precedence still applies to every ball in the line. An escaping ball breaks the line at that point.
- Stomps don't chain (§16).
- `rules.chain: false` → a player behind the victim means P bounces (phase 11 rules).

**Edge push** (phase 12c, around corners):
- A Flip whose target cell T holds a player V standing on the face being flipped onto (`V.up === F`, the flipper's new up) pushes V (event `push` with `edge: true`) along the flipper's arrival direction `D = −U` (its old up reversed, i.e. down or along V's face, away from the edge).
- **Success** (V pushable, `T + D` not solid and not reserved): V is Knocked to `T + D`, then staggers, or falls if there's no ground. The flipper completes its flip into T. Knockout credit and a `push` event as usual.
- **Fail** (V pushable but `T + D` blocked): the flipper bounces (Stunned with bounce, stays in C).
- **V not pushable** (moving, staggered, high hop): the flip is blocked, as today.
- It works both ways: top → side and side → top. On a climb (concave), the ball ends on the same face as anyone above it, so the normal push already applies.
- Opposite faces (top vs underside of a plate) never interact.
- Readability: when an enemy is on an adjacent face within 1 cell of the shared edge (in T, where a roll over that edge would push it), that edge glows faintly in the enemy's colour for the local player.

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

**Hot tiles** (phase 12, anti-camping, both modes):
- Heat belongs to the **tile** (cell, up), not the player (phase 12c). A tile heats 1 per tick while a ball on it is Idle, Turning or Hopping. Hopping counts at half rate, on even ticks only (phase 12b: the hop is the stomp defence). A ball on it that is Stunned, Striking, Knocked or leaving holds the heat (being a victim isn't camping). A tile with no ball on it cools 1 per 2 ticks. So stepping off at the warning and straight back resumes near the old heat, and players taking turns on one tile share it.
- At `warnTicks` (default 50 = 2.5 s) the tile glows. At `burnTicks` (default 80 = 4 s) the ball **pops**: a death with the usual consequences (a life in knockout, a key drop and knockout credit in race), plus event `burn {playerId}`. A burn resets its tile to 0.
- Level config: `"heat": { "warnSec": 2.5, "burnSec": 4 }`, or `false` to turn it off. Default on for race and knockout levels. Race levels warn later: race-01 has `{ "warnSec": 3, "burnSec": 5 }` (phase 12b).
- The world keeps `hot` (tileKey → heat, only tiles above 0), synced as the `hot` map in the room state. Clients glow the tile under a heated ball (orange → flickering red), play a sizzle, show "MOVE!" to the local player, and puff on a burn. The predictor ignores heat: burns are the server's call.

**Sudden death in race** (phase 12): race levels may define `crumble` too; race-01 crumbles over its last 30 s (`startSec` 90 of 120). Crumble bands never include the block under a key or the exit, in any mode.

**Arenas**
- `arena-01`: a 9×9×1 plate with 4 single-cell holes and 8 spawns around the edge. Flat brawling.
- `arena-02` "Sky Cross" (phase 07b): a 5×5 plate with four different arms (beam to a pad, a beam with a 1-cell jump gap to a pad, a ladder of two rails, and a beam that wraps down a hanging column to a lower pad). 8 spawns, 4 on top and 4 underneath. Pads crumble first, the plate core last.
- `arena-cube`: the old arena-02, a solid 5×5×5 cube. Kept for tests, not in the pool.

**Level pool** (phase 14, `"pool": true`; `npm run level:stats` lists their traps):
- Race (7 keys, 3 required, 8 spawns since phase 14b, heat 3/5, sudden death over the last 30 s): race-01 Four Islands (+ a crumble bridge and a boost shortcut), race-02 Ice Garden, race-03 Pillar Garden, race-04 Sky Ladder, race-05 Underside, race-06 Boost Relay.
- Knockout (3 lives, crumble 45/10/2): arena-01, arena-02 Sky Cross (+ spikes in the pad's centre, crumble rails), arena-03 Ice Rink, arena-04 Crumble Tower, arena-05 Fire Ring, arena-06 Pillar Field.
- Phase 14b reworked several of them to pass the LEVEL-DESIGN rules (details in `docs/reports/14b-report.md`).

**Trap placement rules** (phase 14b): `npm run level:check` also runs every rule in `docs/LEVEL-DESIGN.md` (`checkTrapRules` in `shared/src/level/rules.ts`): [E] rules print as errors with the rule id and tile (`3.1 12,0,1 +X`), [W] rules as warnings unless noted in the level's `notes`. An error fails a pool level (the check exits 1, and a Vitest suite asserts every pool level has no errors and no unnoted warnings). Distances are rolls/flips/climbs; reachability is the bots' planning (lethal tiles as walls for 2.2/3.3/5.2); retracting spike lanes are simulated at ROLL_TICKS per tile, both ways, with waiting allowed on safe tiles.

**Level lint** (phase 12): `npm run level:check` lists 1-wide straight runs (≥ 4 tiles on one face) with the length of the way round them. It warns when there's no way round (`lintCorridors` in `shared/src/level/lint.ts`).

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
- **A hop never stomps by jumping**: it lands on its own cell (only someone who stopped under it gets stomped, above).
- **Hop landing on a grounded player** (§14 roll under): the hopper stomps it by the fall-landing rule below.
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
- **Readability:** during a forward jump, a landing marker (ring in the attacker's colour) is drawn on L, visible to everyone. It turns red when L holds a player (a stomp is incoming). How long it shows is a client tuning value (`markerLeadTicks` in the F4 panel: 0 = the whole jump, the default; N = only the last N ticks).

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
- **Sub-tick start (phase 11):** a press while the predicted local player is at rest runs the stamped tick at once. The local ball is drawn from that tick immediately; the ≤ 1-tick render offset eases back to `predTick` over 150 ms. So motion starts on the next frame instead of the next tick boundary (up to 50 ms). The sim and the stamps are unchanged.
- **Precise deferral (phase 11):** a move is held back only when another player changes its outcome. The first viable command is planned with and without the other players, and any difference (push, block, jump over or onto, a shortened jump, a flip onto a taken cell) defers. A player merely nearby doesn't.
- The local ball has no takeoff anticipation squash (a wind-up reads as input lag); remote balls keep it.
- `?predict=0` turns prediction off: unstamped inputs, server timeline only (phase 08 behaviour).
- F3 shows `predTick`, the lead, mispredictions per minute, deferrals and the last correction's size.

## 18. Tiles & traps (phase 13a/13b)

Kula World's special blocks, as data in the level file, simulated in shared (deterministic, tick-based), and working in every mode.

**Addressing.** A *tile* is a block face: `(block cell, face dir)`. A ball stands on tile `(pose.cell − up, up)`. Whole-block types (ice, fire, crumbling) apply to all six faces of that block.

**Level JSON**
```json
"tiles": [
  { "block": [3,0,4], "type": "ice" },
  { "block": [5,0,2], "type": "fire" },
  { "block": [6,0,2], "type": "crumble", "regrowSec": 8 },
  { "block": [2,0,7], "face": "+Y", "type": "spikes", "period": 40, "up": 20, "phase": 0 },
  { "block": [4,0,7], "face": "+Y", "type": "arrow", "dir": "+Z" },
  { "block": [1,0,1], "face": "+Y", "type": "boost", "variant": "far" }
]
```
- `spikes` without `period` are static (always up).
- `boost` variants: `far` (3 cells forward, landing like a jump) or `high` (2 forward + 1 along up). A boost needs a `dir` ⟂ its face (phase 14b).
- `"deathtrap": true` on an ice or boost tile (phase 14b): a forced move from it may end in death on purpose (LEVEL-DESIGN 3.3: once per level, race only, never on the only route to a key).
- `crumble.regrowSec` is optional (default: never in single player, 8 s in multiplayer).

**13a rules**
- **Spikes:** a ball whose action *finishes* on a tile with spikes up dies (`death` cause `spikes`). Spikes rising under a standing ball kill it too. Jumping over spikes is safe (mid-air cells don't touch tiles).
- **Fire:** Kula rule. Each landing on a fire tile increments `fireCount`, and landing on a non-fire tile resets it. At 3 the ball pops (cause `fire`). Standing on fire doesn't count extra (tile heat §12 still applies).
- **Crumble:** when a ball leaves a crumble block (it finishes an action elsewhere), the block is removed via the `world.removed` overlay after `CRUMBLE_DELAY_TICKS` = 4. It regrows after `regrowSec` if set and nobody occupies the cell. A ball standing on it when removed falls.
- **Ice:** a roll or flip that finishes on ice immediately continues as a forced roll in the same direction (input ignored) until it finishes on a non-ice tile or is blocked. Blocked means it just stops: a climb happens if it's a wall, because climb is a roll. A jump pulse on ice gives a forward jump even without W (Kula rule). Forced rolls can push (normal push rules).
  - **Knocked onto ice** (phase 14b): a knock that finishes on ice continues as a forced slide in the knock direction (the knocked ball turns to face it), with the normal slide rules (climb at walls, flip at edges, push into balls). The stagger (§14) starts when the slide stops, not when the knock lands.
  - A slide across a 1-thick, 1- or 2-wide ice beam flips round its cross-section forever (input is ignored), so level:check rule 6.1 rejects any slide with no stopping tile.
- **Arrow:** on an arrow tile, `fwd` moves (roll, flip, climb, jump) are only allowed if the ball's fwd equals the arrow dir. Turning is allowed, and so is hopping.
- **Boost** (phase 14c): a ball that **arrives** on a pad by a roll, flip, climb, knock or ice slide, from any direction, launches **along the pad's `dir`**: a forced jump of the variant's length (`BOOST_TICKS`), with the normal landing, stomp and fall rules. The ball turns to face `dir` in the air (the mid-air turn record), and the camera swings with it. Jumps and falls landing on a pad don't launch.
  - **Blocked launch:** if a flown-through or landing cell is solid, the landing is reserved, or the ball standing there can't be stomped (staggered, spawn-protected, high in a hop, or no room to bump it), the ball holds on the pad: `Charge` (1-tick actions, input ignored, pushable, render squashed with a rising hum). It retries every tick for up to `BOOST_HOLD_TICKS` (10). Still blocked: it's released as on a plain tile (Idle, normal input), and that pad won't fire for it again until it has left the pad (`boostSpent`).
  - **Knock onto a pad:** the knock ends and the launch starts (a push onto a pad is a combo); the stagger comes after the landing. An ice slide onto a pad ends there and launches.
  - Events: `boost {playerId, result: launch | held | released, reason?, byId?}`. The server logs holds and releases with the reason (`boost: held X (landing reserved by Y)`) and counts all three per round.
  - Prediction: a launch with another player within `BOOST_NEAR` (3) cells of its landing is deferred to the server; `Charge` is server-only (prediction pauses).
  - The pad's chevrons run along `dir` all the time and speed up while it glows. The local launch kicks the camera back briefly.

**13b rules** (phase 13b)
```json
"blocks": [[1,0,1], { "cell": [3,0,6], "vanish": { "period": 60, "on": 40, "phase": 0 } }, { "cell": [9,0,4], "invisible": true }],
"boxes": [{ "min": [2,0,5], "max": [9,0,5], "invisible": true }],
"lasers": [{ "group": "red", "from": [2,1,4], "dir": "+X", "length": 3, "on": true }],
"tiles": [{ "block": [6,0,2], "face": "+Y", "type": "teleport", "pair": "home" }, { "block": [3,0,5], "face": "+Y", "type": "switch", "group": "red" }]
```
- **Teleporters:** exactly two tiles per `pair`. Arriving on one by a roll, flip, climb, knock or ice slide starts `Teleport` (Action 14, TELEPORT_TICKS 6, reserves both cells; render: fade out, then in on the partner). The facing is rotated by the rotation taking the source face onto the target face (same or opposite face: unchanged). Partner cell taken (reserved, or any ball in it): the ball holds (`Charge`, as a boost) up to BOOST_HOLD_TICKS, then is released as on a plain tile until it leaves. Arriving by teleport never re-triggers. Events `teleport {result: go | held | released}`.
- **Lasers and switches:**
  - A laser covers `length` air cells from `from` along `dir`, in a `group`. Group states (`world.lasers`, synced as the `lasers` map) start from the level (`on`).
  - A ball whose action finishes in, or passed through, an active beam cell dies (cause `laser`), checked over the action's path cells when it finishes. A beam switched on through a standing ball kills it.
  - A switch tile toggles its group when an action finishes on it (a hop too), at most once per SWITCH_COOLDOWN_TICKS (20) per switch. Event `laser {group, on}`.
- **Invisible blocks:** solid, rendered only within 2 cells of the local ball (fading out to 3), or everywhere with `revealInvisible` (sunglasses, 15a).
  - race-05 has an invisible beam at z=5 from x=2 to x=9 as the counter-direction shortcut across its one-way ring.
- **Vanishing blocks:** solid for `on` of every `period` ticks, offset by `phase`, derived from the tick inside `isSolid`. A ball standing there when it vanishes falls. Planning treats them as gaps. Invisible and vanishing blocks never crumble.
- **Levels:** race-07 Switchyard (two laser cages, a teleporter home), arena-07 Warp Ring (two teleporter pairs, a blinking vanishing inner ring); race-01 got a laser fence with a switch each side, arena-01 blinking hole plugs and two invisible ledges. traps-lab is `"lab": true`: exempt from the [E] rules, never pooled.

**Common**
- Death causes are added to the `death` event (`fall`, `spikes`, `fire`, `laser`, `burn`) for HUD and toasts.
- Planning (13b): `resultPose` follows teleports and rejects any move through an active beam (an off beam is open); planning worlds have no vanishing blocks.
- BFS (`findPath`/`resultPose`) must follow forced moves (ice slides, boosts, teleports) and treat lethal outcomes as invalid, like fatal falls. Retracting spikes count as lethal at planning time (bots don't time them in v1).
  - Fire (phase 14b): the planning state tracks `fire` (landings on fire in a row, reset by any other landing), so a plan may cross up to 2 fire tiles in a row but never a 3rd. `findPath(..., fire, fireMax)` takes the player's current count; `fireMax` 0 makes fire a wall (level:check's safe routes).
- The predictor runs the same rules. The trap state (crumbled blocks, laser groups) comes from server state each patch, like `removed`.

## 20. Moving collisions (phase 14d)

Per Jakub, from playing Ice Rink: until now only *standing* balls could be pushed. On ice everyone is moving, so nobody ever got pushed. Moving balls now collide.

A **mover** is a ball in Roll, Flip, Climb, forced slide, Knocked or boost flight on the ground plane (not airborne jumps or hops). `dM` is its motion direction on its face. When a mover M's next move targets cell X, and X is involved with another mover V on the same face (`V.up === M.up`), whose motion direction is `dV`:

| Case | Condition | Result |
|---|---|---|
| **Head-on** | V is entering X, or entering M's cell, with `dV = −dM`; or both start into the same empty X from opposite sides on the same tick | **Both bounce back:** each is Knocked one cell *opposite its own motion*, if that cell is free (otherwise it bounce-stuns in place), then bounce-stun. On ice, the knock-back continues as a slide (§18), so on Ice Rink a head-on sends both flying apart. |
| **Side hit (T-bone)** | V is entering X with `dV ⟂ dM`, and V started its move **earlier** than M | **V is pushed:** V's move is cancelled and V is Knocked from X to `X + dM` (stagger, or fall/slide per the usual rules). M continues into X. If `X + dM` is blocked, M bounces instead. |
| **Simultaneous T-bone** | Both start into the same empty X on the same tick, perpendicular | Both bounce (as head-on, each knocked back opposite its own motion). |
| **Dodge** | V is *leaving* X (X is V's from-cell) in any direction | No collision: V dodged. M is blocked until X is free (unchanged). |
| **Rear-end** | V moves in the same direction as M (`dV = dM`) | No collision: M follows (blocked while X is reserved). |
| **Standing V** | V isn't moving | The existing push, cradle, edge-push and roll-under rules (§14). |

- Knockout credit and events work as for pushes (`push` with `moving: 'headon' | 'side'`).
- Stagger rules from §14 apply to everyone knocked. A staggered ball can't be hit again until it recovers.
- Moving collisions are resolved in the same intent/resolution pass as pushes, in fair order, after escapes.
- Prediction: involves players, so it's deferred.

## 21. Pickups & pills (phase 15a)

Kula World's pills, as map pickups, in every mode. Score items (coins, gems, fruit, hourglass, clock) belong to single player (15b).

**Level JSON**
```json
"pickups": [ { "cell": [4,1,4], "up": "+Y", "type": "bouncy", "respawnSec": 15 } ],
"randomPickups": { "everySec": 20, "types": ["bouncy","heavy","sunglasses","lethargy"], "maxOnMap": 2 }
```
- Collected when a ball's action *finishes* in the cell (roll, flip, climb, landing, knock, slide, teleport arrival). That's the key rule, so being knocked onto a pill picks it up.
- In multiplayer a spot respawns after `respawnSec` (default 15). `randomPickups` spawns on random safe tiles (LEVEL-DESIGN §11), deterministic from the world seed.
- Effects are per player: `effects: { type, untilTick }[]`. The same type refreshes its duration. Death clears all effects.

**Pills**

| Pill | Duration | Effect |
|---|---|---|
| **Bouncy** (Kula) | 10 s | Every forward roll becomes a **2-tile bounce** (a jump of length 2, with stomp rules). Forward+jump becomes a **3-tile jump**. Hops unchanged. |
| **Lethargy** (Kula, a *bad* pill) | 8 s | All your action durations ×1.6 (rounded up), and the camera sways slightly. Avoid it, or push others onto it. |
| **Heavy** (new) | 8 s | You can't be pushed, stomped, cradled, edge-pushed or side-hit. Attempts bounce the attacker. Your pushes knock 2 tiles, unless blocked after 1. You still die to traps and falls. |
| **Sunglasses** (Kula) | 15 s | Reveals invisible blocks (client-only, for you). |

- The predictor must apply your own effects: they're synced, and they change durations and jump lengths.
- Bots: seek takes good pills within 4 moves; everyone avoids lethargy; the bully values heavy and bouncy.

## 22. Single player (phase 15b)

Kula World's campaign, played fully in the browser with no server: the same shared sim, stepped locally at 20 Hz. So there's no latency and no prediction.

**Flow**: Main menu → (Single player | Multiplayer) → level → results → next level. Pause menu (Esc): resume, restart level (costs a life-penalty as a death), quit to menu.

**Level goal** (Kula): collect all `keysRequired` keys (in single player that's normally *all* keys), then reach the exit. The level timer runs down. At 0 it counts as a death.

**Score (Kula-like)**:
- coin 250, gem 3 000, key 1 000, fruit 2 500
- level completion: time bonus = seconds left × 20
- **death: −(500 + 50 × level number)**, and the level restarts with its items reset
- game over when the score would go below 0; restart from the last checkpoint (every 5 levels)

**Single-player-only items** (in the level JSON `items`, alongside pickups):
- `coin`, `gem` (score)
- `fruit` (5 kinds). Collecting all 5 across levels unlocks the next bonus level after the current one.
- `hourglass`: flips the timer (remaining becomes total − remaining)
- `clock` tile: freezes the timer for 5 s when you finish an action on it
- Pills (§21) work as in multiplayer, with fixed spots and no respawn.

**Bonus levels** (Kula): roll over every tile marked `paint` to light it. Light them all before time runs out for a big score bonus. You can't die from time here (it just ends). Falling ends it.

**Rules in single player**: `push` rules irrelevant (no other balls), heat off, crumble without regrow, sudden death off.

**Progress** is saved in localStorage (try/catch): the highest level reached, checkpoint score, fruits collected, best time per level. Resetting is available from the menu.

## 23. Matches (phase 18)

Multiplayer rounds are grouped into a **match**, so there's something at stake beyond a single round.

- **Length:** `MATCH_ROUNDS` (lobby option 3 / 5 / 7, default 5, chosen by vote alongside the level; the host default comes from `.env` `MATCH_ROUNDS`). Level vote each round as now.
- **Points per round:**
  - **Race:** exit winner 5. Everyone else is ranked by keys held at the end (ties share the higher place): 2nd 3, 3rd 2, 4th+ 1 if they hold ≥ 1 key, else 0. A timeout with no exit ranks everyone by keys.
  - **Knockout:** by elimination order: last alive 5, 2nd 3, 3rd 2, others 1. Plus **+1 per knockout** credited that round (cap +2, same as race, so knockout rounds don't outweigh races).
  - **Race with push:** +1 per knockout credited (cap +2), so fighting pays in races too.
- **Crown:** the match leader (most points; ties → nobody) wears a crown. It's only seen in line of sight (no x-ray, see 18b). Their name label and board line show 👑, and their off-screen arrow gets a crown icon.
  - **Line of sight rule (18c):** nothing about another player shows through blocks: no silhouette, and no name label. A label shows only while its ball is visible from the camera.
  - Knocking out the crowned player gives **+1 bonus**, so the leader is a target.
- **End of match:** a podium scene (the top 3 balls on stepped blocks, confetti, a stinger), then a stats card per player (points, wins, knockouts, pushes, stomps, deaths, keys) and "MVP" badges (most knockouts, most keys, fewest deaths). Then back to a fresh lobby, with a Rematch vote (same players, points reset). The rematch passes with **at least half** of the connected players (1–1 → rematch).
- **Match tie:** broken by round wins, then knockouts, then keys. Still tied → they share the place (same number, both on that step of the podium, side by side), and the title reads "X and Y share the match!".
- **Joining mid-match:** a new player joins with 0 points and spectates until the next round's lobby, as now. **Leaving:** their points stay on the board, greyed.
- Match state lives in the room (server), not the sim. Scoring is a pure function in shared (`scoreRound(result, events) → points`) so it's testable.


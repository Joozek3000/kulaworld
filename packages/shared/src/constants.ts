export const TICK_RATE = 20; // Hz, 50 ms per tick
export const ROLL_TICKS = 5;
export const TURN_TICKS = 3;
export const FLIP_TICKS = 6;
export const CLIMB_TICKS = 5; // rolling into a wall: it becomes the floor (§5)
export const JUMP_TICKS = 10;
export const FALL_TICKS_PER_CELL = 2;
export const RESPAWN_TICKS = 40;
export const INPUT_BUFFER_TICKS = 6;
export const KILL_MARGIN = 6; // cells
// PvP push (ARCHITECTURE §14)
export const KNOCK_TICKS = 4;
export const STUN_TICKS = 6;
export const HOP_PUSH_WINDOW = 2; // a hop is pushable this many ticks after its start and before its end
export const KNOCKOUT_CREDIT_TICKS = 60;
// Stomp (ARCHITECTURE §16)
export const REBOUND_TICKS = 6; // clash: the attacker arcs back to its takeoff cell
/** A jump pulse this soon after a roll started from rest turns it into a standing forward jump (§6). */
export const JUMP_GRACE_TICKS = 2;
// Anti-stalemate (phase 12)
/** Hot tiles: a ball standing on the same tile this long glows, and pops at HEAT_BURN_TICKS (level-configurable). */
export const HEAT_WARN_TICKS = 50;
export const HEAT_BURN_TICKS = 80;
/** Cradle push (phase 12b): the longest line of balls that transmits a strike to its last ball. */
export const CHAIN_MAX = 6;
/** A cradle strike: the pusher lunges and recoils in place. */
export const STRIKE_TICKS = 4;
// Knockout (ARCHITECTURE §15)
export const SPAWN_PROTECT_TICKS = 40;
// Tiles & traps (ARCHITECTURE §18)
/** A crumble block vanishes this long after a ball leaves it. */
export const CRUMBLE_DELAY_TICKS = 4;
/** Default crumble regrow time in multiplayer (§18). */
export const CRUMBLE_REGROW_SEC = 8;
/** Landings on fire in a row that pop a ball (Kula rule). */
export const FIRE_MAX = 3;
/** A boost launch's flight time (a normal jump is JUMP_TICKS). */
export const BOOST_TICKS = 12;
/** A blocked launch holds the ball on its pad (Charge) this long, retrying every tick, before releasing it (phase 14c). */
export const BOOST_HOLD_TICKS = 10;
/** A teleport (phase 13b): fade out on one pad, in on its partner. */
export const TELEPORT_TICKS = 6;
/** A switch tile toggles its laser group at most once per this many ticks. */
export const SWITCH_COOLDOWN_TICKS = 20;
/** BFS gives up following a forced chain (ice slides, boosts) after this many steps: an ice loop. */
export const FORCED_MAX = 64;
// Pickups & pills (ARCHITECTURE §21, phase 15a), durations in ticks.
export const BOUNCY_TICKS = 10 * 20;
export const LETHARGY_TICKS = 8 * 20;
export const HEAVY_TICKS = 8 * 20;
export const SUNGLASSES_TICKS = 15 * 20;
/** A fixed pickup spot comes back this long after it's taken (level `respawnSec` overrides). */
export const PICKUP_RESPAWN_SEC = 15;

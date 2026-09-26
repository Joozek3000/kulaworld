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

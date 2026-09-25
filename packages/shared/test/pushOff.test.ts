// ARCHITECTURE §14: with push off the MVP rules apply exactly. Re-runs every pre-push sim suite with push off.
import { rules } from './util.ts';

rules.push = false;
await import('./sim.test.ts');
await import('./keyRace.test.ts');
await import('./heldJump.test.ts');
await import('./airTurn.test.ts');
await import('./path.test.ts');

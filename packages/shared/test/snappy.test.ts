// Phase 17: the movement timing presets. Re-runs the core movement suites with TIMING=snappy (quicker rolls, turns,
// flips and jumps); their tick counts come from util.ts's live bindings, so every expectation follows the preset.
import { useTiming } from './util.ts';

useTiming('snappy');
await import('./sim.test.ts');
await import('./keyRace.test.ts');
await import('./heldJump.test.ts');
await import('./airTurn.test.ts');
await import('./climb.test.ts');
await import('./grace.test.ts');
await import('./push.test.ts');
await import('./stomp.test.ts');
await import('./rollUnder.test.ts');
await import('./moving.test.ts');
await import('./boost.test.ts');
await import('./edgePush.test.ts');
await import('./cradle.test.ts');

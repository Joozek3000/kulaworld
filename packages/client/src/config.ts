import pkg from '../../../package.json' with { type: 'json' };

/** The player-facing name and version (phase 17). Code identifiers, `@kula/*` packages and save keys keep "kula". */
export const GAME_NAME = 'Flipside';
export const GAME_VERSION: string = pkg.version;

import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerS = schema({
  id: t.string(),
  name: t.string(),
}, 'PlayerS');
export type PlayerS = SchemaType<typeof PlayerS>;

export const GameState = schema({
  players: t.map(PlayerS),
}, 'GameState');
export type GameState = SchemaType<typeof GameState>;

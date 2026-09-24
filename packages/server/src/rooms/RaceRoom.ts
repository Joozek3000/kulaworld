import { Room, type Client } from 'colyseus';
import { GameState, PlayerS } from '../schema/State.ts';

export class RaceRoom extends Room<{ state: GameState }> {
  maxClients = 8;
  state = new GameState();

  onJoin(client: Client, options?: { name?: unknown }) {
    const name = String(options?.name ?? 'anon').slice(0, 16);
    this.state.players.set(client.sessionId, new PlayerS({ id: client.sessionId, name }));
    console.log(`join ${name} (${client.sessionId}), players=${this.state.players.size}`);
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`leave ${p?.name} (${client.sessionId}), players=${this.state.players.size}`);
  }
}

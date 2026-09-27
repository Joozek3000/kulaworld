import type { Dir, DirName } from '../dir.ts';
import type { Vec3 } from '../vec.ts';

type V3 = [number, number, number];

export type Mode = 'race' | 'knockout';

/** Tiles & traps (ARCHITECTURE §18). ice/fire/crumble cover the whole block; spikes/arrow/boost are one face. */
export type TileType = 'ice' | 'fire' | 'crumble' | 'spikes' | 'arrow' | 'boost';
export const BLOCK_TILES: readonly TileType[] = ['ice', 'fire', 'crumble'];
export const FACE_TILES: readonly TileType[] = ['spikes', 'arrow', 'boost'];
/** Lethal tile types (LEVEL-DESIGN: "lethal" also means void) and the non-lethal modifiers. */
export const LETHAL_TILES: readonly TileType[] = ['spikes', 'fire'];
export const MODIFIER_TILES: readonly TileType[] = ['ice', 'arrow', 'boost', 'crumble'];
export interface TileJson {
  block: V3;
  type: TileType;
  face?: DirName;
  /** crumble: seconds until the block grows back (default 8 in multiplayer). */
  regrowSec?: number;
  /** spikes: retracting when set, in ticks: up for `up` ticks of every `period`, offset by `phase`. */
  period?: number;
  up?: number;
  phase?: number;
  /** arrow: the only allowed fwd. boost (required): it launches only a ball entering it moving this way. */
  dir?: DirName;
  /** boost: far = 3 cells forward, high = 2 forward + 1 up. */
  variant?: 'far' | 'high';
  /** ice/boost: a forced move from here may end in death on purpose (LEVEL-DESIGN 3.3; once per level, race only). */
  deathtrap?: boolean;
}
export interface Tile {
  block: Vec3;
  type: TileType;
  /** null for whole-block types. */
  face: Dir | null;
  regrowTicks: number;
  period: number;
  upTicks: number;
  phase: number;
  dir: Dir | null;
  variant: 'far' | 'high';
  deathtrap: boolean;
  /** crumble: regrowSec was given (without it the block never regrows in single player, §18). */
  regrows: boolean;
}
/** Knockout floor crumbling (ARCHITECTURE §15), in seconds. */
export interface Crumble { startSec: number; intervalSec: number; warnSec: number }

/** On-disk format, see ARCHITECTURE §9 and §15. Knockout levels have no keys/exit/keysRequired. */
export interface LevelJson {
  id: string;
  name: string;
  version: number;
  mode?: Mode;
  /** In the lobby vote's level pool (phase 14). Default false. */
  pool?: boolean;
  lives?: number;
  crumble?: Crumble;
  /** Hot tiles (phase 12): on by default (2.5 s warn, 4 s burn); `false` turns them off. */
  heat?: { warnSec: number; burnSec: number } | false;
  /** Optional sky gradient, top and bottom colour ("#rrggbb"). Render-only. */
  sky?: [string, string];
  blocks?: V3[];
  boxes?: { min: V3; max: V3; hollow?: boolean }[];
  spawns: { cell: V3; up: DirName; fwd: DirName }[];
  keys?: { cell: V3; up: DirName }[];
  exit?: { cell: V3; up: DirName };
  keysRequired?: number;
  timeLimitSec: number;
  tiles?: TileJson[];
  /** One non-lethal trap type exempt from the modifier cap (LEVEL-DESIGN 7.2), e.g. "ice" for an ice rink. */
  theme?: TileType;
  /** Why a level:check warning is intentional, keyed by the id it prints (e.g. "7.5 3,0,4|+Y"). Text only. */
  notes?: Record<string, string>;
}

export interface Placement { cell: Vec3; up: Dir }
export interface Pose extends Placement { fwd: Dir }

export interface Level {
  id: string;
  name: string;
  version: number;
  mode: Mode;
  pool: boolean;
  /** Knockout: lives per player (0 in race). */
  lives: number;
  crumble: Crumble | null;
  /** Hot-tile thresholds in ticks, or null when off. */
  heat: { warnTicks: number; burnTicks: number } | null;
  sky: [string, string] | null;
  solid: Set<string>; // cellKeys
  min: Vec3; // AABB of all blocks, inclusive
  max: Vec3;
  spawns: Pose[];
  keys: Placement[];
  /** null in knockout. */
  exit: Placement | null;
  keysRequired: number;
  timeLimitSec: number;
  tiles: Tile[];
  theme: TileType | null;
  notes: Record<string, string>;
  /** Whole-block tiles by block cellKey, face tiles by tileKey (block cellKey|face). */
  blockTiles: Map<string, Tile>;
  faceTiles: Map<string, Tile>;
}

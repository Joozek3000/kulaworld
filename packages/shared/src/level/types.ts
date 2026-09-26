import type { Dir, DirName } from '../dir.ts';
import type { Vec3 } from '../vec.ts';

type V3 = [number, number, number];

export type Mode = 'race' | 'knockout';
/** Knockout floor crumbling (ARCHITECTURE §15), in seconds. */
export interface Crumble { startSec: number; intervalSec: number; warnSec: number }

/** On-disk format, see ARCHITECTURE §9 and §15. Knockout levels have no keys/exit/keysRequired. */
export interface LevelJson {
  id: string;
  name: string;
  version: number;
  mode?: Mode;
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
}

export interface Placement { cell: Vec3; up: Dir }
export interface Pose extends Placement { fwd: Dir }

export interface Level {
  id: string;
  name: string;
  version: number;
  mode: Mode;
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
}

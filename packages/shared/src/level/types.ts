import type { Dir, DirName } from '../dir.ts';
import type { Vec3 } from '../vec.ts';

type V3 = [number, number, number];

/** On-disk format, see ARCHITECTURE §9. */
export interface LevelJson {
  id: string;
  name: string;
  version: number;
  blocks?: V3[];
  boxes?: { min: V3; max: V3; hollow?: boolean }[];
  spawns: { cell: V3; up: DirName; fwd: DirName }[];
  keys: { cell: V3; up: DirName }[];
  exit: { cell: V3; up: DirName };
  keysRequired: number;
  timeLimitSec: number;
}

export interface Placement { cell: Vec3; up: Dir }
export interface Pose extends Placement { fwd: Dir }

export interface Level {
  id: string;
  name: string;
  version: number;
  solid: Set<string>; // cellKeys
  min: Vec3; // AABB of all blocks, inclusive
  max: Vec3;
  spawns: Pose[];
  keys: Placement[];
  exit: Placement;
  keysRequired: number;
  timeLimitSec: number;
}

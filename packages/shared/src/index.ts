export const VERSION = '0.0.1';

/** Grid cell key, e.g. "1,2,3". */
export function cellKey(v: { x: number; y: number; z: number }): string {
  return `${v.x},${v.y},${v.z}`;
}

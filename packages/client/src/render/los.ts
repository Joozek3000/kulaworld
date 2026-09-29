/**
 * Line of sight over the block grid (phase 18c, render only): a 3D DDA (Amanatides–Woo) from `a` to `b`. Block cells
 * are unit cubes centred on integer coordinates. The cell holding `a` counts (a camera inside a block sees nothing);
 * the cell holding `b` doesn't (it's the target's own cell). No allocations.
 */
type Opaque = (x: number, y: number, z: number) => boolean;
interface P { x: number; y: number; z: number }

const MAX_STEPS = 512;

export function lineClear(opaque: Opaque, a: P, b: P): boolean {
  let x = Math.floor(a.x + 0.5), y = Math.floor(a.y + 0.5), z = Math.floor(a.z + 0.5);
  const ex = Math.floor(b.x + 0.5), ey = Math.floor(b.y + 0.5), ez = Math.floor(b.z + 0.5);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  // t (0..1 along a→b) per cell crossed on each axis, and t of the next crossing.
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (sx > 0 ? x + 0.5 - a.x : a.x - x + 0.5) * tdx : Infinity;
  let ty = dy ? (sy > 0 ? y + 0.5 - a.y : a.y - y + 0.5) * tdy : Infinity;
  let tz = dz ? (sz > 0 ? z + 0.5 - a.z : a.z - z + 0.5) * tdz : Infinity;
  for (let n = 0; n < MAX_STEPS; n++) {
    if (x === ex && y === ey && z === ez) return true;
    if (opaque(x, y, z)) return false;
    if (tx <= ty && tx <= tz) { if (tx > 1) return true; x += sx; tx += tdx; }
    else if (ty <= tz) { if (ty > 1) return true; y += sy; ty += tdy; }
    else { if (tz > 1) return true; z += sz; tz += tdz; }
  }
  return true;
}

/** One mulberry32 step: the next uint32 state and a float in [0, 1). Lets sim state keep the RNG as an integer. */
export function rngNext(state: number): { state: number; value: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** mulberry32: small seeded PRNG returning floats in [0, 1). Deterministic for a given seed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    const r = rngNext(s);
    s = r.state;
    return r.value;
  };
}

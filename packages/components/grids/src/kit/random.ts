/** A seeded generator in `[0, 1)` — mulberry32, so a shuffle is the same on every frame and every machine. */
function seededRandom(seed: number): () => number {
  let a = Math.floor(seed) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `values` in a seeded random order. */
export function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values]
  const random = seededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A stable number for a string — a node's id, so its "random" stagger never changes between builds. */
export function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

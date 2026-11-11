/**
 * `order` lists items in slot order (slot `k` holds item `order[k]`), repaired into a
 * permutation of `0..count-1` — valid entries first, then the rest — so a stale entry, a
 * repeat or a child added or removed never leaves a slot empty or doubled.
 */
export function normalizeOrder(order: readonly number[] | undefined, count: number): number[] {
  const out: number[] = []
  const taken = new Array<boolean>(count).fill(false)
  for (const entry of order ?? []) {
    const item = Math.round(entry)
    if (item >= 0 && item < count && !taken[item]) {
      taken[item] = true
      out.push(item)
    }
  }
  for (let item = 0; item < count; item++) if (!taken[item]) out.push(item)
  return out
}

/** For each item, the slot it sits in. */
export function slotOfItem(order: readonly number[]): number[] {
  const slots = new Array<number>(order.length)
  order.forEach((item, slot) => {
    slots[item] = slot
  })
  return slots
}

/** An order written as `"2, 0, 1"` or as numbers. */
export function parseOrder(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite)
  if (typeof value !== "string") return []
  return value
    .split(/[\s,]+/)
    .filter((part) => part !== "")
    .map(Number)
    .filter(Number.isFinite)
}

/**
 * Visvalingam–Whyatt weights for a hand-defined ring, in the same buckets the
 * generated data carries (`-2·log2` of the effective area in steradians), so a
 * shape passed to `geoRegistry.define` answers to `detail` like any other.
 *
 * Planar in degrees with longitude scaled by latitude: accurate enough for the
 * handful of shapes an author defines, where the generated data uses the exact
 * spherical area.
 */
export function ringBuckets(points: Float64Array): Uint8Array {
    const n = points.length / 2
    const buckets = new Uint8Array(n)
    if (n < 3) return buckets

    const radians = Math.PI / 180
    const weight = new Float64Array(n)
    const prev = new Int32Array(n)
    const next = new Int32Array(n)
    for (let i = 0; i < n; i++) {
        prev[i] = i - 1
        next[i] = i + 1
    }

    const area = (a: number, b: number, c: number): number => {
        const cos = Math.cos(points[b * 2 + 1] * radians)
        const ax = points[a * 2] * cos, ay = points[a * 2 + 1]
        const bx = points[b * 2] * cos, by = points[b * 2 + 1]
        const cx = points[c * 2] * cos, cy = points[c * 2 + 1]
        return (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2) * radians * radians
    }

    const heap: number[] = []
    const position = new Int32Array(n).fill(-1)
    const less = (i: number, j: number) => weight[heap[i]] < weight[heap[j]]
    const swap = (i: number, j: number) => {
        ;[heap[i], heap[j]] = [heap[j], heap[i]]
        position[heap[i]] = i
        position[heap[j]] = j
    }
    const up = (i: number) => {
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (!less(i, parent)) break
            swap(i, parent)
            i = parent
        }
    }
    const down = (i: number) => {
        for (;;) {
            const l = 2 * i + 1
            const r = l + 1
            let smallest = i
            if (l < heap.length && less(l, smallest)) smallest = l
            if (r < heap.length && less(r, smallest)) smallest = r
            if (smallest === i) return
            swap(i, smallest)
            i = smallest
        }
    }
    const push = (i: number) => {
        position[i] = heap.length
        heap.push(i)
        up(heap.length - 1)
    }
    const remove = (i: number) => {
        const at = position[i]
        const last = heap.pop()!
        position[i] = -1
        if (at < heap.length) {
            heap[at] = last
            position[last] = at
            up(at)
            down(position[last])
        }
    }

    for (let i = 1; i < n - 1; i++) {
        weight[i] = area(i - 1, i, i + 1)
        push(i)
    }

    let floor = 0
    const final = new Float64Array(n)
    final[0] = final[n - 1] = Infinity
    while (heap.length > 0) {
        const i = heap[0]
        remove(i)
        floor = Math.max(floor, weight[i])
        final[i] = floor
        const p = prev[i]
        const q = next[i]
        if (p >= 0) next[p] = q
        if (q < n) prev[q] = p
        for (const j of [p, q]) {
            if (j <= 0 || j >= n - 1 || position[j] < 0) continue
            remove(j)
            weight[j] = area(prev[j], j, next[j])
            push(j)
        }
    }

    for (let i = 0; i < n; i++) buckets[i] = weightBucket(final[i])
    return buckets
}

export function weightBucket(weight: number): number {
    if (weight === Infinity) return 0
    if (!(weight > 0)) return 255
    return Math.min(254, Math.max(1, Math.round(-2 * Math.log2(weight))))
}

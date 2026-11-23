import { Graphics2D, Types, component2d } from "@motionscript/sdk/v1"

// Scratch stress case: a lattice where every cell has its own colour that changes every frame (pixel fire, a sprite sheet,
// a dissolve). `mode` 0 draws one rect+fill per cell, 1 buckets cells by palette colour (one Graphics2D per colour).
const PALETTE = Array.from({ length: 16 }, (_, i) => {
    const t = i / 15
    return [{ type: "solid" as const, color: [0.2 + 0.8 * t, 0.15 + 0.6 * t * t, 0.1 + 0.3 * (1 - t), 1] as [number, number, number, number] }]
})

function hash(a: number, b: number, c: number) {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return (h ^ (h >>> 16)) >>> 0
}

export default component2d({
    key: "mosaic",
    state: {
        cell: Types.number(12, { min: 2, step: 1 }),
        phase: Types.number(0, { step: 1 }),
        mode: Types.number(0, { min: 0, max: 1, step: 1 }),
    },
    defaults: { width: 1920, height: 1080 },
    commands: { shift: { args: ["phase"] } },
    render: (ctx, state) => {
        const { width, height } = ctx.size
        const cell = state.cell
        const columns = Math.floor(width / cell)
        const rows = Math.floor(height / cell)
        const left = -(columns * cell) / 2
        const bottom = -(rows * cell) / 2
        const frame = Math.floor(state.phase)
        const pick = (c: number, r: number) => hash(c, r, frame) & 15
        if (state.mode === 0) {
            for (let r = 0; r < rows; r++)
                for (let c = 0; c < columns; c++) {
                    const x = left + (c + 0.5) * cell, y = bottom + (r + 0.5) * cell
                    ctx.draw(new Graphics2D().rect({ x, y, width: cell, height: cell }).fill(PALETTE[pick(c, r)]))
                }
            return
        }
        const buckets = PALETTE.map(() => new Graphics2D())
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < columns; c++) {
                const x = left + (c + 0.5) * cell, y = bottom + (r + 0.5) * cell
                buckets[pick(c, r)].rect({ x, y, width: cell + 0.5, height: cell + 0.5 })
            }
        buckets.forEach((g, i) => ctx.draw(g.fill(PALETTE[i])))
    },
})

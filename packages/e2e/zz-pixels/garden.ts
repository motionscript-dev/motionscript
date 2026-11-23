import { Graphics2D, PathBuilder, Types, clamp, component2d } from "@motionscript/sdk/v1"

// Scratch: the promo's pixel garden as pasted by the user (2026-11-22), unchanged.
type Cell = [number, number]

interface Flower {
  column: number
  tall: number
  large: boolean
  leaves: [number, number][]
  delay: number
}

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CLOUDS = [
  ["....XXX.....", "..XXXXXX.XX.", ".XXXXXXXXXXX", "XXXXXXXXXXXX"],
  ["...XX.....", ".XXXXX.XX.", "XXXXXXXXXX"],
  [".....XXXX.......", "..XXXXXXXXX.XXX.", ".XXXXXXXXXXXXXXX", "XXXXXXXXXXXXXXXX"],
  ["..XXX...", "XXXXXXX.", ".XXXXXXX"],
]

interface Cloud {
  shape: string[]
  column: number
  row: number
  speed: number
}

function sky(columns: number, rows: number, count: number): Cloud[] {
  const next = random(11)
  return Array.from({ length: count }, (_, i) => ({
    shape: CLOUDS[i % CLOUDS.length],
    column: Math.floor(next() * columns),
    row: rows - 4 - Math.floor(next() * rows * 0.32),
    speed: 0.6 + next() * 0.7,
  }))
}

function garden(columns: number, count: number): Flower[] {
  const next = random(7)
  const out: Flower[] = []
  const span = columns / count
  for (let i = 0; i < count; i++) {
    const column = Math.round(span * (i + 0.5) + (next() - 0.5) * span * 0.6)
    const tall = 4 + Math.floor(next() * 9)
    const leaves: [number, number][] = []
    for (let row = 2; row < tall - 1; row += 2 + Math.floor(next() * 3)) leaves.push([row, next() < 0.5 ? -1 : 1])
    out.push({ column, tall, large: next() < 0.4, leaves, delay: next() * 0.55 })
  }
  return out
}

function grow(flower: Flower, steps: number): { stem: Cell[]; bloom: Cell[]; heart: Cell[] } {
  const stem: Cell[] = []
  const bloom: Cell[] = []
  const heart: Cell[] = []
  const x = flower.column
  const shown = Math.min(steps, flower.tall)
  for (let y = 0; y < shown; y++) stem.push([x, y])
  for (const [row, side] of flower.leaves) {
    if (row >= shown) continue
    stem.push([x + side, row])
    if (flower.large) stem.push([x + side * 2, row + 1])
  }
  const top = flower.tall
  if (steps > flower.tall) heart.push([x, top + (flower.large ? 1 : 0)])
  if (steps > flower.tall + 1) {
    const reach = flower.large ? 2 : 1
    const cy = top + (flower.large ? 1 : 0)
    for (let d = 1; d <= reach; d++) {
      bloom.push([x - d, cy], [x + d, cy], [x, cy + d], [x, cy - d])
    }
    if (flower.large) bloom.push([x - 1, cy - 1], [x + 1, cy - 1], [x - 1, cy + 1], [x + 1, cy + 1])
  }
  return { stem, bloom, heart }
}

export default component2d({
  key: "pixelGarden",
  state: {
    fill: Types.fill([{ type: "solid", color: [0.945, 0.929, 0.898, 1] }]),
    stroke: Types.stroke([{ weight: 3, fill: [{ type: "solid", color: [0.98, 0.973, 0.953, 1] }] }]),
    stem: Types.fill([{ type: "solid", color: [0.82, 0.792, 0.733, 1] }]),
    bloom: Types.fill([{ type: "solid", color: [0.741, 0.71, 0.651, 1] }]),
    heart: Types.fill([{ type: "solid", color: [0.62, 0.584, 0.522, 1] }]),
    cloud: Types.fill([{ type: "solid", color: [1, 1, 1, 1] }]),
    cell: Types.number(14, { min: 4, step: 1 }),
    flowers: Types.number(22, { min: 0, max: 60, step: 1 }),
    clouds: Types.number(5, { min: 0, max: 20, step: 1 }),
    grown: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    wind: Types.number(0, { step: 1 }),
  },
  defaults: { width: 1920, height: 1080 },
  commands: {
    grow: { args: ["grown"] },
    blow: { args: ["wind"] },
  },
  render: (ctx, state) => {
    const { width, height } = ctx.size
    if (width <= 0 || height <= 0) return
    const cell = Math.max(4, state.cell)
    const columns = Math.floor(width / cell)
    const rows = Math.floor(height / cell)
    const left = -(columns * cell) / 2
    const bottom = -(rows * cell) / 2
    const at = ([column, row]: Cell) => ({ x: left + (column + 0.5) * cell, y: bottom + (row + 0.5) * cell })
    ctx.draw(new Graphics2D().rect({ width: columns * cell, height: rows * cell }).fill(state.fill))
    const puffs = new Graphics2D()
    let cloudy = false
    for (const cloud of sky(columns, rows, Math.round(state.clouds))) {
      const across = cloud.shape[0].length
      const span = columns + across
      const shift = Math.floor(state.wind * cloud.speed)
      const start = ((((cloud.column + shift) % span) + span) % span) - across
      cloud.shape.forEach((line, r) => {
        for (let c = 0; c < line.length; c++) {
          if (line[c] !== "X") continue
          const column = start + c
          if (column < 0 || column >= columns) continue
          const { x, y } = at([column, cloud.row - r])
          puffs.rect({ x, y, width: cell + 0.5, height: cell + 0.5 })
          cloudy = true
        }
      })
    }
    if (cloudy) ctx.draw(puffs.fill(state.cloud))
    const grown = clamp(state.grown, 0, 1)
    const paints = { stem: new Graphics2D(), bloom: new Graphics2D(), heart: new Graphics2D() }
    const drew = { stem: false, bloom: false, heart: false }
    for (const flower of garden(columns, Math.round(state.flowers))) {
      const steps = flower.tall + 2
      const shown = Math.floor(clamp((grown - flower.delay) / (1 - 0.55), 0, 1) * steps + 1e-6)
      if (shown <= 0) continue
      const parts = grow(flower, shown)
      for (const key of ["stem", "bloom", "heart"] as const) {
        for (const spot of parts[key]) {
          if (spot[0] < 0 || spot[0] >= columns || spot[1] >= rows) continue
          const { x, y } = at(spot)
          paints[key].rect({ x, y, width: cell + 0.5, height: cell + 0.5 })
          drew[key] = true
        }
      }
    }
    if (drew.stem) ctx.draw(paints.stem.fill(state.stem))
    if (drew.bloom) ctx.draw(paints.bloom.fill(state.bloom))
    if (drew.heart) ctx.draw(paints.heart.fill(state.heart))
    const gaps = new PathBuilder()
    for (let c = 0; c <= columns; c++) {
      gaps.moveTo(left + c * cell, bottom)
      gaps.lineTo(left + c * cell, bottom + rows * cell)
    }
    for (let r = 0; r <= rows; r++) {
      gaps.moveTo(left, bottom + r * cell)
      gaps.lineTo(left + columns * cell, bottom + r * cell)
    }
    const frame = [-width / 2, -height / 2, width / 2, height / 2] as const
    ctx.draw(new Graphics2D().path({ data: gaps.toCommands(), centerBounds: frame }).stroke(state.stroke))
  },
})

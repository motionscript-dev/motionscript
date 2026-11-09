import type { PathCommand, Size2D } from "@motionscript/sdk"

/**
 * The shapes a path grid can follow without a path of its own, each drawn to
 * fill the grid's box. Centred and y-up, like every path in the library; the
 * closed ones run clockwise, so an item flowing along any of them travels the
 * same way round.
 */
export const PATH_TEMPLATES = [
  "circle",
  "square",
  "star",
  "heart",
  "infinity",
  "wave",
  "spiral",
  "arc",
  "line",
] as const
export type PathTemplate = (typeof PATH_TEMPLATES)[number]

/** What a template is drawn at when the grid has no box to fill. */
const FALLBACK = 400

const DRAWN = new Map<string, PathCommand[]>()
const DRAWN_CACHE = 64

/**
 * `template` drawn to fill `box`. The same template at the same size is the
 * same array, which is what lets the path's measurement be kept between frames.
 */
export function templatePath(template: PathTemplate, box: Size2D): PathCommand[] {
  const key = `${template}:${Math.round(box.width * 100)}:${Math.round(box.height * 100)}`
  const hit = DRAWN.get(key)
  if (hit) return hit
  const path = drawTemplate(template, box)
  if (DRAWN.size >= DRAWN_CACHE) DRAWN.delete(DRAWN.keys().next().value!)
  DRAWN.set(key, path)
  return path
}

function drawTemplate(template: PathTemplate, box: Size2D): PathCommand[] {
  const w = box.width > 0 ? box.width : FALLBACK
  const h = box.height > 0 ? box.height : FALLBACK
  const rx = w / 2
  const ry = h / 2
  switch (template) {
    case "square":
      return closed([
        [-rx, ry], [rx, ry], [rx, -ry], [-rx, -ry],
      ])
    case "star": {
      const points: [number, number][] = []
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5
        const r = i % 2 === 0 ? 1 : 0.45
        points.push([Math.sin(angle) * rx * r, Math.cos(angle) * ry * r])
      }
      return closed(points)
    }
    case "heart":
      return closed(sample(96, (t) => {
        // The classic heart curve, from its top notch, clockwise.
        const a = t * 2 * Math.PI
        const x = 16 * Math.sin(a) ** 3
        const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)
        return [(x / 17) * rx, ((y + 2.5) / 15.5) * ry]
      }).slice(0, -1))
    case "infinity":
      return closed(sample(96, (t) => {
        const a = t * 2 * Math.PI
        const d = 1 + Math.sin(a) ** 2
        return [(Math.cos(a) / d) * rx, ((Math.sin(a) * Math.cos(a)) / d) * ry * 2]
      }).slice(0, -1))
    case "wave":
      return open(sample(96, (t) => [(-1 + 2 * t) * rx, Math.sin(t * 4 * Math.PI) * ry * 0.6]))
    case "spiral":
      return open(sample(160, (t) => {
        const a = t * 3 * 2 * Math.PI
        const r = 0.08 + 0.92 * t
        return [Math.sin(a) * rx * r, Math.cos(a) * ry * r]
      }))
    case "arc":
      return open(sample(64, (t) => {
        const a = -Math.PI / 2 + t * Math.PI
        return [Math.sin(a) * rx, -ry + Math.cos(a) * h]
      }))
    case "line":
      return [{ type: "M", x: -rx, y: 0 }, { type: "L", x: rx, y: 0 }]
    default:
      return ellipse(rx, ry)
  }
}

/** Four quarter-arcs from the top, clockwise. */
function ellipse(rx: number, ry: number): PathCommand[] {
  const k = 0.5522847498
  return [
    { type: "M", x: 0, y: ry },
    { type: "C", x1: k * rx, y1: ry, x2: rx, y2: k * ry, x: rx, y: 0 },
    { type: "C", x1: rx, y1: -k * ry, x2: k * rx, y2: -ry, x: 0, y: -ry },
    { type: "C", x1: -k * rx, y1: -ry, x2: -rx, y2: -k * ry, x: -rx, y: 0 },
    { type: "C", x1: -rx, y1: k * ry, x2: -k * rx, y2: ry, x: 0, y: ry },
    { type: "Z" },
  ]
}

function sample(steps: number, at: (t: number) => [number, number]): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) points.push(at(i / steps))
  return points
}

function open(points: [number, number][]): PathCommand[] {
  return points.map(([x, y], i) => (i === 0 ? { type: "M", x, y } : { type: "L", x, y }))
}

function closed(points: [number, number][]): PathCommand[] {
  return [...open(points), { type: "Z" }]
}

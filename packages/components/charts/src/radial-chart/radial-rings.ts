import {
  Graphics2D,
  PathBuilder,
  Rect,
  Text,
  Types,
  clamp,
  component2d,
  fillOps,
  textOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type Fill as _Fill,
  type FillResolved as _FillResolved,
  type TextStyle,
  type Vector2,
} from "@motionscript/sdk"

import { asParts, fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { DEG, ringFills, ringPoint, selectionFade, type CenterConfig } from "../kit/polar"
import { radialFractions, type RadialMarks, type RadialRow } from "./shared"

/** Share of the entrance one ring's sweep starts after the last. */
const STAGGER = 0.12
/** A selected ring's thickness grows by this share of itself, on each side. */
const GROW = 0.12
const ARC_STEP = 4 * DEG
const LABEL_PAD = 10
const CENTER_FIT = 0.78
const GLYPH_RATIO = 0.62
/** How far the radius is held in from the box, for the sake of a ring's growth. */
const EDGE = 4

const DEFAULT_MARKS: RadialMarks = { innerRadius: 0.3, ringGap: 8, sweep: 360, startAngle: 0, track: true, roundCaps: true }
const DEFAULT_LABEL: TextStyle = { fontSize: 28, fontWeight: 500, textAlign: "center", fill: "#a1a1aa" }
const DEFAULT_CENTER: CenterConfig = {
  labelStyle: { fontSize: 50, fontWeight: 800, textAlign: "center", fill: "#f4f4f5" },
  captionStyle: { fontSize: 22, fontWeight: 500, textAlign: "center", fill: "#a1a1aa" },
}

interface RingsState {
  readonly rows: RadialRow[]
  readonly max: number
  readonly marks: RadialMarks
  readonly label: TextStyle
  readonly centerStyle: CenterConfig
  readonly ringLabels: boolean
  readonly pops: readonly number[]
  readonly dimOpacity: number
  readonly centerLabel: string
  readonly centerCaption: string
}

function sizeOf(style: TextStyle, fallback: number): number {
  return typeof style.fontSize === "number" ? style.fontSize : fallback
}

/** Every radius and angle for one box, derived wherever read so the drawing and the labels cannot disagree. */
export class RadialGeometry {
  constructor(
    private readonly s: RingsState,
    private readonly box: { readonly width: number; readonly height: number }
  ) {}

  get count(): number {
    return this.s.rows.length
  }

  get outerRadius(): number {
    return Math.max(0, Math.min(this.box.width, this.box.height) / 2 - EDGE)
  }

  get holeRadius(): number {
    return clamp(this.s.marks.innerRadius, 0, 0.9) * this.outerRadius
  }

  /** Radial depth of one ring. */
  get thickness(): number {
    const n = this.count
    if (n === 0) return 0
    return Math.max(0, (this.outerRadius - this.holeRadius - (n - 1) * Math.max(0, this.s.marks.ringGap)) / n)
  }

  /** Rim of ring `index`; ring 0 is the outermost. */
  ringOuter(index: number): number {
    return this.outerRadius - index * (this.thickness + Math.max(0, this.s.marks.ringGap))
  }

  ringMid(index: number): number {
    return this.ringOuter(index) - this.thickness / 2
  }

  get fractions(): number[] {
    return radialFractions(this.s.rows, this.s.max)
  }

  get startRad(): number {
    return this.s.marks.startAngle * DEG
  }

  get sweepRad(): number {
    return clamp(this.s.marks.sweep, 0, 360) * DEG
  }

  popOf(index: number): number {
    return clamp(this.s.pops[index] ?? 0, 0, 1)
  }

  get selectionStrength(): number {
    let strongest = 0
    for (let i = 0; i < this.count; i++) strongest = Math.max(strongest, this.popOf(i))
    return strongest
  }

  ringOpacity(index: number): number {
    return selectionFade(this.selectionStrength, this.s.dimOpacity, this.popOf(index))
  }

  /** How far ring `index`'s sweep has come at entrance progress `growth`: rings start in turn, outer first. */
  progress(index: number, growth: number): number {
    const total = 1 + STAGGER * Math.max(0, this.count - 1)
    return clamp(growth * total - index * STAGGER, 0, 1)
  }

  get labelFont(): number {
    return Math.max(1, Math.min(sizeOf(this.s.label, 28), this.thickness * 0.62))
  }

  /** Where ring `index`'s caption is pinned: just behind its start, reading away from the sweep. */
  labelAnchor(index: number): { at: Vector2; side: 1 | -1 } {
    const a = this.startRad
    const back = { x: -Math.cos(a), y: Math.sin(a) }
    const p = ringPoint(this.ringMid(index), a)
    const side: 1 | -1 = back.x <= 0 ? -1 : 1
    return { at: { x: p.x + back.x * LABEL_PAD, y: p.y + back.y * LABEL_PAD }, side }
  }

  get centerFont(): number {
    const { centerStyle, centerLabel, centerCaption } = this.s
    const wanted = sizeOf(centerStyle.labelStyle, 50)
    const hole = this.holeRadius
    if (hole <= 0) return wanted
    const ratio = sizeOf(centerStyle.captionStyle, 22) / Math.max(1, wanted)
    const glyphs = Math.max(1, centerLabel.length, centerCaption.length * ratio)
    return Math.min(wanted, (hole * 2 * CENTER_FIT) / (glyphs * GLYPH_RATIO))
  }
}

/**
 * An arc band between `rIn` and `rOut` over `a0`..`a1` (radians clockwise from
 * 12 o'clock), the ends squared or capped with half circles. A band shorter
 * than its caps is two overlapping caps, which fill as a pill.
 */
export function bandPath(a0: number, a1: number, rIn: number, rOut: number, round: boolean): PathBuilder {
  const path = new PathBuilder()
  const mid = (rIn + rOut) / 2
  const cap = (rOut - rIn) / 2
  const delta = round && mid > 0 ? Math.min(cap / mid, (a1 - a0) / 2) : 0
  const from = a0 + delta
  const to = a1 - delta
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / ARC_STEP))
  const arc = (r: number, x: number, y: number, first: boolean) => {
    for (let i = 0; i <= steps; i++) {
      const p = ringPoint(r, x + ((y - x) * i) / steps)
      if (first && i === 0) path.moveTo(p.x, p.y)
      else path.lineTo(p.x, p.y)
    }
  }
  // The end at `angle` rounded through a tip `direction` along the sweep.
  const semicircle = (angle: number, direction: 1 | -1, fromOuter: boolean) => {
    const centre = ringPoint(mid, angle)
    const radial = { x: Math.sin(angle), y: Math.cos(angle) }
    const tangent = { x: Math.cos(angle) * direction, y: -Math.sin(angle) * direction }
    const turns = 12
    for (let i = 1; i < turns; i++) {
      const phi = (Math.PI * i) / turns
      const r = fromOuter ? Math.cos(phi) : -Math.cos(phi)
      path.lineTo(centre.x + cap * (radial.x * r + tangent.x * Math.sin(phi)), centre.y + cap * (radial.y * r + tangent.y * Math.sin(phi)))
    }
  }
  arc(rOut, from, to, true)
  if (round) semicircle(to, 1, true)
  arc(rIn, to, from, false)
  if (round) semicircle(from, -1, false)
  path.close()
  return path
}

const NO_BOX = { width: 0, height: 0 }

function labelBlocks(s: RingsState & { readonly labelReveal: number; readonly centerReveal: number }) {
  const blocks: Node2D[] = []
  const geometry = () => new RadialGeometry(s, (blocks[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? NO_BOX)
  const side = geometry().labelAnchor(0).side

  s.rows.forEach((_, index) => {
    const anchor = () => geometry().labelAnchor(index).at
    blocks.push(
      new Rect({
        flow: "vertical",
        width: "hug",
        height: "hug",
        align: side > 0 ? "centerLeft" : "centerRight",
        opacity: () => (s.ringLabels ? clamp(s.labelReveal, 0, 1) * geometry().ringOpacity(index) : 0),
        centerLeft: side > 0 ? anchor : undefined,
        centerRight: side > 0 ? undefined : anchor,
        children: [
          new Text({
            ...textOps.styleProps(s.label),
            text: () => s.rows[index]?.category ?? "",
            textAlign: side > 0 ? "left" : "right",
            fontSize: () => geometry().labelFont,
          }),
        ],
      })
    )
  })

  if (s.centerLabel !== "" || s.centerCaption !== "") {
    const children: Node2D[] = []
    if (s.centerLabel !== "") {
      children.push(new Text({ ...textOps.styleProps(s.centerStyle.labelStyle), text: s.centerLabel, fontSize: () => geometry().centerFont }))
    }
    if (s.centerCaption !== "") {
      children.push(
        new Text({
          ...textOps.styleProps(s.centerStyle.captionStyle),
          text: s.centerCaption,
          fontSize: () => geometry().centerFont * (sizeOf(s.centerStyle.captionStyle, 22) / sizeOf(s.centerStyle.labelStyle, 50)),
        })
      )
    }
    blocks.push(
      new Rect({
        flow: "vertical",
        width: "hug",
        height: "hug",
        gap: 2,
        align: "center",
        opacity: () => clamp(s.centerReveal, 0, 1),
        center: { x: 0, y: 0 },
        children,
      })
    )
  }
  return asParts(blocks)
}

/**
 * The rings: row `i` is the `i`-th ring from the outside, an arc from
 * `startAngle` whose sweep is `value / max` of the full sweep, over an
 * optional full-sweep track. A selected ring thickens and the rest dims.
 */
export const RadialRings = component2d({
  key: "radialRings",
  state: {
    rows: fresh<RadialRow[]>(() => []),
    max: 0,
    marks: Types.custom<RadialMarks>(DEFAULT_MARKS),
    label: Types.custom<TextStyle>(DEFAULT_LABEL),
    centerStyle: Types.custom<CenterConfig>(DEFAULT_CENTER),
    /** The empty-ring colour drawn under each arc. */
    trackFill: Types.fill("white/15"),
    ringLabels: Types.boolean(false),
    /** Entrance progress `[0, 1]`: rings sweep in turn. */
    growth: 1,
    labelReveal: 1,
    pops: fresh<number[]>(() => []),
    dimOpacity: 0.25,
    centerLabel: "",
    centerCaption: "",
    centerReveal: 1,
  },
  defaults: { width: "fill", height: "fill" },
  children: (state) => labelBlocks(state),
  load: (loader, state) => loadPaints(loader, { fills: [...ringFills(state.rows), fillOps.resolve(state.trackFill)] }),
  commands: {
    /** Sweep the rings in, outer first. */
    sweep: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ growth: ease(t) }))
    },
    /** Fade the ring captions up. */
    revealLabels: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ labelReveal: ease(t) }))
    },
    /** Fade the centre summary up. */
    revealCenter: (timeline, state) => {
      const ease = frameEase(timeline)
      const from = clamp(state.centerReveal, 0, 1)
      return timeline.animate((t) => ({ centerReveal: from + (1 - from) * ease(t) }))
    },
  },
  render: (ctx, state) => {
    const g = new RadialGeometry(state, ctx.size)
    const thickness = g.thickness
    if (g.outerRadius > 0 && g.count > 0 && thickness > 0) {
      const half = g.outerRadius + EDGE + 1
      const frame = { centerBounds: [-half, -half, half, half] as [number, number, number, number], width: half * 2, height: half * 2 }
      const fills = ringFills(state.rows)
      const fractions = g.fractions
      const a0 = g.startRad
      const round = state.marks.roundCaps
      // Selected rings last, so a thickened ring is never under its neighbour.
      const order = [...state.rows.keys()].sort((a, b) => g.popOf(a) - g.popOf(b))
      for (const i of order) {
        const grow = thickness * GROW * g.popOf(i)
        const rOut = g.ringOuter(i) + grow
        const rIn = g.ringOuter(i) - thickness - grow
        const opacity = g.ringOpacity(i)
        if (state.marks.track && g.sweepRad > 0) {
          ctx.draw(new Graphics2D().path(bandPath(a0, a0 + g.sweepRad, rIn, rOut, round).toPathState(frame)).fill(state.trackFill).opacity(opacity))
        }
        const span = g.sweepRad * fractions[i] * g.progress(i, state.growth)
        if (span <= 1e-4) continue
        ctx.draw(new Graphics2D().path(bandPath(a0, a0 + span, rIn, rOut, round).toPathState(frame)).fill(fills[i] ?? []).opacity(opacity))
      }
    }
    ctx.children()
  },
})

export type RadialRings = NodeOf<typeof RadialRings>

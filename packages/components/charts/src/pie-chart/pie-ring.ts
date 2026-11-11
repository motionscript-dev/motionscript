import {
  Graphics2D,
  PathBuilder,
  Rect,
  Text,
  Types,
  clamp,
  component2d,
  fillOps,
  shadowOps,
  strokeOps,
  textOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type TextStyle,
  type Vector2,
} from "@motionscript/sdk"

import { asParts, fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { formatPercent } from "../kit/shared"
import {
  DEFAULT_PIE_CHART_THEME,
  pieArcs,
  relaxLabels,
  ringPoint,
  selectionFade,
  type CenterConfig,
  type LabelConfig,
  type PieArc,
  type PieLabelMode,
  type PieLabelPlacement,
  type PieSlice,
  type RingConfig,
} from "./shared"

const LABEL_GAP = 12
const LABEL_PAD = 14
/** Rough glyph width as a fraction of the font size, for gutter sizing. */
const GLYPH_RATIO = 0.62
const LEADER_LIFTOFF = 6
const LEADER_LENGTH = 34
const LABEL_STUB = 26
const TEXT_INSET = 8
/** Floor on the elbow's distance from the ring's axis, as a fraction of the leader radius, so a label pushed above or below the ring still elbows out sideways. */
const MIN_ELBOW = 0.18
const ARC_STEPS = 240
const ELBOW_RADIUS = 8
const BARE_PAD = 2
const INSIDE_CAPTION_RATIO = 0.44
/** Where an inside label sits on a solid pie, as a fraction of the radius: far enough out to clear the point every wedge converges on. */
const PIE_LABEL_RADIUS = 0.62
const CENTER_LABEL_FIT = 0.78
const INSIDE_LABEL_FIT = 0.9
/** Below this a wedge's bisector counts as axis-aligned and that bound stops binding. */
const AXIS_EPSILON = 1e-3
/** Type size when a theme style leaves it unset or on autofit. */
const FALLBACK_SIZE = 26

function sizeOf(style: TextStyle, fallback = FALLBACK_SIZE): number {
  const size = style.fontSize
  return typeof size === "number" ? size : fallback
}

interface LabelPlacement {
  index: number
  /** +1 right, -1 left. */
  side: 1 | -1
  /** Wedge edge, elbow, label. */
  leader: Vector2[]
  /** Where the label's inner edge is pinned. */
  text: Vector2
}

/**
 * A wedge over `a0`..`a1` (radians clockwise from 12 o'clock) from `rInner` to
 * `rOuter`, centred on `cx`; with `rInner <= 0` it closes through the centre.
 * `halfGap` is half the px gap to the neighbour, converted to an angle per
 * radius (wider near the hole) so the channel keeps one width across the band.
 * The inset is capped at the wedge's half-span so a sliver narrows to nothing
 * rather than turning inside out.
 */
function wedgePath(
  a0: number,
  a1: number,
  rInner: number,
  rOuter: number,
  halfGap: number,
  cx: number
): PathBuilder {
  const path = new PathBuilder()
  const span = a1 - a0
  const steps = Math.max(
    2,
    Math.ceil((Math.abs(span) / (Math.PI * 2)) * ARC_STEPS)
  )
  const insetAt = (r: number): number =>
    r <= 0 ? 0 : Math.min(halfGap / r, span / 2.2)
  const arcTo = (r: number, i: number): Vector2 => {
    const inset = insetAt(r)
    const from = a0 + inset
    const to = a1 - inset
    const point = ringPoint(r, from + ((to - from) * i) / steps)
    return { x: point.x + cx, y: point.y }
  }

  if (rInner <= 0) {
    // The sides converge on the centre, so only the rim carries the gap.
    path.moveTo(cx, 0)
    for (let i = 0; i <= steps; i++) {
      const p = arcTo(rOuter, i)
      path.lineTo(p.x, p.y)
    }
    path.close()
    return path
  }

  for (let i = 0; i <= steps; i++) {
    const p = arcTo(rOuter, i)
    if (i === 0) path.moveTo(p.x, p.y)
    else path.lineTo(p.x, p.y)
  }
  // The inner arc's own wider inset makes each side edge a chord `halfGap` px off the divide at both ends.
  for (let i = steps; i >= 0; i--) {
    const p = arcTo(rInner, i)
    path.lineTo(p.x, p.y)
  }
  path.close()
  return path
}

interface RingState {
  readonly slices: PieSlice[]
  readonly ring: RingConfig
  readonly label: LabelConfig
  readonly centerStyle: CenterConfig
  readonly labelMode: PieLabelMode
  readonly labelPlacement: PieLabelPlacement
  readonly pops: readonly number[]
  readonly dimOpacity: number
  readonly centerLabel: string
  readonly centerCaption: string
}

/** Every radius, gutter and label position for one box, derived afresh wherever read so the drawing and the labels' bound positions cannot disagree. */
export class RingGeometry {
  constructor(
    private readonly s: RingState,
    private readonly box: { readonly width: number; readonly height: number }
  ) { }

  /** Re-read every frame so a value tween re-cuts them. */
  get arcs(): PieArc[] {
    return pieArcs(this.s.slices, this.s.ring.startAngle)
  }

  /** Leader labels are the only thing that costs a gutter. */
  get hasLeaderLabels(): boolean {
    return this.s.labelPlacement === "leader" && this.s.labelMode !== "none" && this.arcs.length > 0
  }

  /**
   * Px a horizontal label centred in `arc`'s band can run before leaving the
   * wedge: bound by the band's thickness near 3 o'clock, by its arc near 12.
   * Measured off the unpopped radius, so a slice growing out of the ring does not
   * resize its own text mid-animation.
   */
  insideRoom(arc: PieArc): number {
    const outer = this.outerRadius
    const hole = this.holeRadius
    const band = hole > 0 ? outer - hole : outer * (1 - PIE_LABEL_RADIUS) * 2
    const mid = hole > 0 ? (hole + outer) / 2 : outer * PIE_LABEL_RADIUS
    const sin = Math.abs(Math.sin(arc.mid))
    const cos = Math.abs(Math.cos(arc.mid))
    const acrossBand = sin > AXIS_EPSILON ? band / sin : Infinity
    const alongArc = cos > AXIS_EPSILON ? ((arc.a1 - arc.a0) * mid) / cos : Infinity
    return Math.max(0, Math.min(acrossBand, alongArc))
  }

  /** Widest line, in glyphs at the leading line's size, an inside label runs to. */
  insideGlyphs(arc: PieArc): number {
    const mode = this.s.labelMode
    const category = this.s.slices[arc.index]?.category.length ?? 0
    const percent = mode === "both" || mode === "percent" ? formatPercent(arc.fraction).length : 0
    // The caption is a fraction of the leading line, unless it is the leading line.
    const caption = mode === "category" ? category : mode === "both" ? category * INSIDE_CAPTION_RATIO : 0
    return Math.max(1, percent, caption)
  }

  /** The theme's `insideStyle.fontSize` shrunk to fit, an upper bound. One size across every inside label (the smallest any needs): mismatched sizes read as a mistake. */
  get insideFont(): number {
    let size = sizeOf(this.s.label.insideStyle, FALLBACK_SIZE * 1.9)
    for (const arc of this.arcs) {
      const fits = (this.insideRoom(arc) * INSIDE_LABEL_FIT) / (this.insideGlyphs(arc) * GLYPH_RATIO)
      size = Math.min(size, fits)
    }
    return Math.max(1, size)
  }

  /** The configured size capped to fit across the hole, which derives from the box: a smaller reflow would otherwise push the summary through the ring. */
  get centerFont(): number {
    const { centerStyle, centerLabel, centerCaption } = this.s
    const wanted = sizeOf(centerStyle.labelStyle, 46)
    const hole = this.holeRadius
    if (hole <= 0) return wanted
    const captionRatio = sizeOf(centerStyle.captionStyle, 22) / Math.max(1, wanted)
    // Both lines must clear the hole; the caption is a fraction of this size, so the wider once drawn binds, not the longer.
    const glyphs = Math.max(1, centerLabel.length, centerCaption.length * captionRatio)
    return Math.min(wanted, (hole * 2 * CENTER_LABEL_FIT) / (glyphs * GLYPH_RATIO))
  }

  /** Rim radius of a fully selected slice as a multiple of the ring's. */
  get growFactor(): number {
    return Math.max(1, Math.min(1.6, this.s.ring.selectedGrow))
  }

  get maxPop(): number {
    return this.outerRadius * (this.growFactor - 1)
  }

  /** Height of one leader label block, the unit the columns are spaced by. Inside labels cost no vertical reserve. */
  get labelRowHeight(): number {
    if (!this.hasLeaderLabels) return 0
    const caption = sizeOf(this.s.label.textStyle) * 1.25
    const percent = sizeOf(this.s.label.percentStyle) * 1.25
    if (this.s.labelMode === "both") return caption + percent + 2
    return this.s.labelMode === "category" ? caption : percent
  }

  /** Widest line in glyphs a leader label for slice `index` runs to. */
  captionGlyphs(index: number): number {
    const mode = this.s.labelMode
    // "100%" is the widest a percentage gets; captions are their own length.
    const percent = mode === "percent" || mode === "both" ? 4 : 0
    const category = mode === "category" || mode === "both" ? (this.s.slices[index]?.category.length ?? 0) : 0
    return Math.max(percent, category)
  }

  /** Room reserved per side for leaders and labels, from the slices that leader out that way. Excludes selection growth, which scales with the radius and is divided out in {@link outerRadius}. */
  get labelGutters(): { left: number; right: number } {
    const gutters = { left: BARE_PAD, right: BARE_PAD }
    if (!this.hasLeaderLabels) return gutters
    const glyph = sizeOf(this.s.label.textStyle) * GLYPH_RATIO
    for (const arc of this.arcs) {
      const room = LEADER_LENGTH + LABEL_STUB + TEXT_INSET + this.captionGlyphs(arc.index) * glyph + LABEL_PAD
      const key = sideOf(arc.mid) > 0 ? "right" : "left"
      gutters[key] = Math.max(gutters[key], room)
    }
    return gutters
  }

  /** Slides the ring into the empty half when labels all fall one way, keeping the ring-plus-labels group centred. */
  get centerX(): number {
    const { left, right } = this.labelGutters
    return (left - right) / 2
  }

  /** Fitted to what the gutters leave. The divisor keeps a fully selected slice (`radius * growFactor`) inside the box, and the ring one size whether or not anything is selected. */
  get outerRadius(): number {
    const { left, right } = this.labelGutters
    const room = Math.min((this.box.width - left - right) / 2, this.box.height / 2 - this.labelRowHeight - 4)
    return Math.max(0, room / this.growFactor)
  }

  get holeRadius(): number {
    const configured = this.s.ring.holeRadius
    if (configured <= 0) return 0
    const px = configured < 1 ? configured * this.outerRadius : configured
    return Math.min(px, this.outerRadius * 0.95)
  }

  /** The circle every leader elbows on, clear of even a popped-out slice. */
  get elbowRadius(): number {
    return this.outerRadius + this.maxPop + LEADER_LENGTH
  }

  popOf(index: number): number {
    return clamp(this.s.pops[index] ?? 0, 0, 1)
  }

  anchorRadius(index: number): number {
    return this.outerRadius + this.maxPop * this.popOf(index)
  }

  /** Halfway across the band on a donut, further out on a solid pie, where halfway would crowd the point the wedges converge on. Rides the slice's pop. */
  bandMidRadius(index: number): number {
    const rim = this.anchorRadius(index)
    const hole = this.holeRadius
    return hole > 0 ? (hole + rim) / 2 : rim * PIE_LABEL_RADIUS
  }

  insideAnchor(index: number): Vector2 {
    const arc = this.arcs.find((a) => a.index === index)
    if (arc === undefined) return { x: this.centerX, y: 0 }
    const point = ringPoint(this.bandMidRadius(index), arc.mid)
    return { x: point.x + this.centerX, y: point.y }
  }

  /** The most-grown slice, so the dim in {@link sliceOpacity} rides the pops' tween. */
  get selectionStrength(): number {
    let strongest = 0
    for (let i = 0; i < this.s.slices.length; i++) strongest = Math.max(strongest, this.popOf(i))
    return strongest
  }

  /** Opacity of slice `index` with its leader and label. */
  sliceOpacity(index: number): number {
    return selectionFade(this.selectionStrength, this.s.dimOpacity, this.popOf(index))
  }

  percentText(index: number): string {
    const arc = this.arcs.find((a) => a.index === index)
    return formatPercent(arc?.fraction ?? 0)
  }

  /** Labels split into left and right columns by their slice's bisector, each spread so nothing overlaps or leaves the box, then a leader built to each. */
  placements(): LabelPlacement[] {
    if (!this.hasLeaderLabels) return []
    const arcs = this.arcs
    if (arcs.length === 0 || this.outerRadius <= 0) return []

    const radius = this.elbowRadius
    const rowHeight = this.labelRowHeight
    const top = this.box.height / 2 - rowHeight / 2
    const bottom = -top
    const cx = this.centerX

    interface Slot {
      index: number
      side: 1 | -1
      mid: number
      ideal: number
      y: number
    }
    const right: Slot[] = []
    const left: Slot[] = []
    for (const arc of arcs) {
      const side = sideOf(arc.mid)
      const ideal = ringPoint(radius, arc.mid).y
      ;(side > 0 ? right : left).push({ index: arc.index, side, mid: arc.mid, ideal, y: ideal })
    }
    relaxLabels(right, rowHeight + LABEL_GAP, top, bottom)
    relaxLabels(left, rowHeight + LABEL_GAP, top, bottom)

    return [...right, ...left].map((slot) => {
      const start = ringPoint(this.anchorRadius(slot.index) + LEADER_LIFTOFF, slot.mid)
      // The elbow sits where the label's y crosses the leader circle. Solving
      // x^2 + y^2 = radius^2 for x keeps it on that circle (never inside the
      // ring); a label pushed past the circle's top or bottom falls back to the
      // sideways floor so its leader still reads as pointing outward.
      const onCircle = Math.sqrt(Math.max(0, radius * radius - slot.y * slot.y))
      const elbowX = cx + slot.side * Math.max(onCircle, radius * MIN_ELBOW)
      const endX = cx + slot.side * (radius + LABEL_STUB)

      return {
        index: slot.index,
        side: slot.side,
        leader: [
          { x: start.x + cx, y: start.y },
          { x: elbowX, y: slot.y },
          { x: endX, y: slot.y },
        ],
        text: { x: endX + slot.side * TEXT_INSET, y: slot.y },
      }
    })
  }

  placementFor(index: number): LabelPlacement | undefined {
    return this.placements().find((placement) => placement.index === index)
  }
}

function sideOf(mid: number): 1 | -1 {
  return Math.sin(mid) >= 0 ? 1 : -1
}

const NO_BOX = { width: 0, height: 0 }

/** Fills resolved once per paint, not per frame: a theme tween hands over new paint, but a frame that moves nothing must not re-resolve. Keyed by the paint, so it needs no node. */
const resolvedFills = new WeakMap<object, FillResolved[]>()

function resolvedFill(fill: Fill): FillResolved[] {
  if (typeof fill !== "object" || fill === null) return fillOps.resolve(fill)
  let resolved = resolvedFills.get(fill)
  if (resolved === undefined) resolvedFills.set(fill, resolved = fillOps.resolve(fill))
  return resolved
}

export function ringFills(slices: readonly PieSlice[]): FillResolved[][] {
  return slices.map((slice) => resolvedFill(slice.fill))
}

/** One label per drawn slice (a zero-valued slice has no wedge), then the hole's summary. Only the choice of form is settled here; the pinned points stay reactive. */
function ringLabels(s: RingState & { readonly labelReveal: number; readonly centerReveal: number }) {
  const blocks: Node2D[] = []
  // A label block's parent is the ring, whose box it was laid out at.
  const geometry = () => new RingGeometry(s, (blocks[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? NO_BOX)

  const label = (arc: PieArc): Node2D => {
    const opacity = () => clamp(s.labelReveal, 0, 1) * geometry().sliceOpacity(arc.index)
    const wantsCategory = s.labelMode === "both" || s.labelMode === "category"
    const wantsPercent = s.labelMode === "both" || s.labelMode === "percent"

    if (s.labelPlacement === "inside") {
      // The number leads: inside a wedge the reader knows which slice it is. Sizes are bound because the fitted size derives from a radius unknown until layout.
      const inside: Node2D[] = []
      if (wantsPercent) {
        inside.push(new Text({
          ...textOps.styleProps(s.label.insideStyle),
          text: () => geometry().percentText(arc.index),
          fontSize: () => geometry().insideFont,
        }))
      }
      if (wantsCategory) {
        inside.push(new Text({
          ...textOps.styleProps(s.label.insideStyle),
          text: () => s.slices[arc.index]?.category ?? "",
          fontSize: () => (s.labelMode === "category" ? geometry().insideFont : geometry().insideFont * INSIDE_CAPTION_RATIO),
        }))
      }
      return new Rect({
        flow: "vertical",
        width: "hug",
        height: "hug",
        gap: 0,
        align: "center",
        opacity,
        center: () => geometry().insideAnchor(arc.index),
        children: inside,
      })
    }

    const side = sideOf(arc.mid)
    const at = () => geometry().placementFor(arc.index)?.text ?? { x: 0, y: 0 }
    const children: Node2D[] = []
    if (wantsCategory) {
      children.push(new Text({
        ...textOps.styleProps(s.label.textStyle),
        text: () => s.slices[arc.index]?.category ?? "",
        textAlign: side > 0 ? "left" : "right",
      }))
    }
    if (wantsPercent) {
      children.push(new Text({
        ...textOps.styleProps(s.label.percentStyle),
        text: () => geometry().percentText(arc.index),
        textAlign: side > 0 ? "left" : "right",
      }))
    }
    return new Rect({
      flow: "vertical",
      width: "hug",
      height: "hug",
      gap: 2,
      align: side > 0 ? "centerLeft" : "centerRight",
      opacity,
      centerLeft: side > 0 ? at : undefined,
      centerRight: side > 0 ? undefined : at,
      children,
    })
  }

  if (s.labelPlacement !== "none" && s.labelMode !== "none") {
    for (const arc of pieArcs(s.slices, s.ring.startAngle)) blocks.push(label(arc))
  }

  // Pinned to the ring's centre, so it tracks the sideways shift a one-sided label column causes.
  if (s.centerLabel !== "" || s.centerCaption !== "") {
    const children: Node2D[] = []
    if (s.centerLabel !== "") {
      children.push(new Text({
        ...textOps.styleProps(s.centerStyle.labelStyle),
        text: s.centerLabel,
        fontSize: () => geometry().centerFont,
      }))
    }
    if (s.centerCaption !== "") {
      children.push(new Text({
        ...textOps.styleProps(s.centerStyle.captionStyle),
        text: s.centerCaption,
        fontSize: () =>
          geometry().centerFont * (sizeOf(s.centerStyle.captionStyle, 22) / sizeOf(s.centerStyle.labelStyle, 46)),
      }))
    }
    blocks.push(new Rect({
      flow: "vertical",
      width: "hug",
      height: "hug",
      gap: 2,
      align: "center",
      opacity: () => clamp(s.centerReveal, 0, 1),
      center: () => ({ x: geometry().centerX, y: 0 }),
      children,
    }))
  }
  return asParts(blocks)
}

/**
 * The ring: one wedge per {@link PieSlice} swept clockwise from `startAngle`,
 * with a constant-width `gap` (see {@link wedgePath}). A selected slice swells
 * out while its hole edge stays put, and the rest dims, leaders and labels
 * included. The only path-drawing part of the chart family; labels are real
 * {@link Text} nodes, so no glyph-width guesswork places a caption. Only the
 * sides that carry a leader reserve a gutter, and the ring slides into the rest.
 */
export const PieRing = component2d({
  key: "pieRing",
  state: {
    slices: fresh<PieSlice[]>(() => []),
    ring: Types.custom<RingConfig>(DEFAULT_PIE_CHART_THEME.ring),
    label: Types.custom<LabelConfig>(DEFAULT_PIE_CHART_THEME.label),
    // Not `center`: every node already has one, the anchor its position is measured from.
    centerStyle: Types.custom<CenterConfig>(DEFAULT_PIE_CHART_THEME.center),
    labelMode: Types.custom<PieLabelMode>("percent"),
    labelPlacement: Types.custom<PieLabelPlacement>("leader"),
    /** Sweep `[0, 1]`: the wedges grow clockwise from `startAngle` as it rises. */
    growth: 1,
    /** Fade of leaders and labels, separate from `growth` so they arrive after the sweep. */
    labelReveal: 1,
    /** Per-slice pop `[0, 1]`, owned by the chart so the ring and legend read one signal. */
    pops: fresh<number[]>(() => []),
    /** Opacity everything unselected falls back to while any slice is selected. */
    dimOpacity: DEFAULT_PIE_CHART_THEME.spotlight.dimOpacity,
    /** Empty leaves the hole clear; ignored when there is no hole. */
    centerLabel: "",
    centerCaption: "",
    /** The hole's summary fade, untouched by the entrance: a scene that wants the conclusion on a later beat sets 0 and calls `revealCenter`. */
    centerReveal: 1,
  },
  // A plain node filled its parent; one made of its labels would hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => ringLabels(state),
  // The paints sit past the paint entries: a fill per slice, the wedge outline and shadow, and the leader stroke.
  load: (loader, state) =>
    loadPaints(loader, {
      fills: ringFills(state.slices),
      shadows: [shadowOps.resolve(state.ring.shadow)],
      strokes: [strokeOps.resolve(state.ring.stroke), strokeOps.resolve(state.label.leaderStroke)],
    }),
  commands: {
    /** Wipe the wedges in around the ring (`growth` 0 to 1). */
    sweep: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ growth: ease(t) }))
    },
    /** Fade the leaders and captions up. */
    revealLabels: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ labelReveal: ease(t) }))
    },
    /** Fade the hole's summary up; not part of the entrance, since it is usually the conclusion. */
    revealCenter: (timeline, state) => {
      const ease = frameEase(timeline)
      const from = clamp(state.centerReveal, 0, 1)
      return timeline.animate((t) => ({ centerReveal: from + (1 - from) * ease(t) }))
    },
  },
  render: (ctx, state) => {
    const g = new RingGeometry(state, ctx.size)
    const rOuter = g.outerRadius
    const arcs = rOuter > 0 ? g.arcs : []
    if (arcs.length > 0) {
      const sweep = clamp(state.growth, 0, 1)
      const revealEnd = state.ring.startAngle * (Math.PI / 180) + Math.PI * 2 * sweep
      const hole = g.holeRadius
      const halfGap = Math.max(0, state.ring.gap) / 2

      // One shared frame (the whole ring square, grown slices included) pinned onto
      // every wedge path, so `Graphics2D.path()` doesn't re-centre each wedge on its
      // own bbox and collapse them all onto the origin. It stays symmetric about the
      // node's origin, so path coordinates land exactly in node space, and is grown
      // by the ring's sideways offset rather than moved with it, which would undo
      // the very shift it has to contain.
      const cx = g.centerX
      const half = rOuter + g.maxPop + 1 + Math.abs(cx)
      const centerBounds: [number, number, number, number] = [-half, -half, half, half]
      // Explicit width/height alongside centerBounds: a wedge path's command list
      // carries no implied extent, so a slice filled with an image or a video needs
      // this to size its decode.
      const span = half * 2

      const fills = ringFills(state.slices)
      for (const arc of arcs) {
        // Clipped to the revealed arc, so the ring draws in as one clockwise wipe.
        const a1 = Math.min(arc.a1, revealEnd)
        if (a1 <= arc.a0) continue

        const path = wedgePath(arc.a0, a1, hole, g.anchorRadius(arc.index), halfGap, cx)
        const wedge = new Graphics2D().path(path.toPathState({ centerBounds, width: span, height: span }))
        wedge.shadow(state.ring.shadow)
        wedge.fill(fills[arc.index] ?? [])
        wedge.stroke(state.ring.stroke)
        ctx.draw(wedge.opacity(g.sliceOpacity(arc.index)))
      }

      // One `Graphics2D` per leader: open polylines chained into one command list
      // are combined into a single surface before the stroke, which closes each
      // contour and paints the leaders as thin triangles.
      const reveal = clamp(state.labelReveal, 0, 1)
      if (reveal > 0.001) {
        for (const placement of g.placements()) {
          ctx.draw(
            new Graphics2D()
              .line({ points: placement.leader, radius: ELBOW_RADIUS })
              .stroke(state.label.leaderStroke)
              .opacity(reveal * g.sliceOpacity(placement.index))
          )
        }
      }
    }
    ctx.children()
  },
})

export type PieRing = NodeOf<typeof PieRing>

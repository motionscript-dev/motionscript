import {
  Graphics2D,
  PathBuilder,
  Rect,
  Text,
  Types,
  component2d,
  fillOps,
  shadowOps,
  strokeOps,
  textOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  type Node2D,
  type Node2DProps,
  type TextStyle,
  type Vector2,
} from "@motionscript/sdk"

import { asParts, fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { clampUnit, formatPercent } from "../kit/shared"
import {
  DEFAULT_PIE_CHART_THEME,
  pieArcs,
  relaxLabels,
  ringPoint,
  type CenterConfig,
  type LabelConfig,
  type PieArc,
  type PieLabelMode,
  type PieLabelPlacement,
  type PieSlice,
  type RingConfig,
} from "./shared"

export interface PieRingProps extends Node2DProps {
  /** One entry per slice: its `category`, `value` and `fill`. */
  slices: PieSlice[]
  /** Ring geometry and paint — gap, hole, start angle, selection growth. */
  ring: RingConfig
  /** How the labels are set, and the leader lines that point at them. */
  label: LabelConfig
  /**
   * How the hole's summary is set.
   *
   * Named `centerStyle` rather than `center` because every node already has a
   * `center` — the anchor its position is measured from.
   */
  centerStyle: CenterConfig
  /** What the labels say, or `"none"` to drop them entirely. */
  labelMode: PieLabelMode
  /** Where the labels sit: inside their wedge, outside on a leader, or nowhere. */
  labelPlacement: PieLabelPlacement
  /**
   * Sweep of the ring in `[0, 1]`: 0 draws nothing, 1 the full circle. The
   * wedges grow around clockwise from the ring's `startAngle` as this rises.
   */
  growth: number
  /**
   * Fade of the leader lines and labels in `[0, 1]`, held separate from
   * {@link growth} so they arrive *after* the ring has swept in.
   */
  labelReveal: number
  /**
   * How far each slice is currently pushed out of the ring, `0`–`1` per index.
   * Owned by the chart, so the ring and the legend read one signal.
   */
  pops: number[]
  /** Opacity everything *unselected* falls back to while any slice is selected. */
  dimOpacity: number
  /**
   * Text set in the middle of the ring's hole — the largest uninterrupted area
   * the chart owns, and on a donut otherwise empty. A one-line summary there
   * routinely does more work than the whole ring around it. Empty (the default)
   * leaves the hole clear; ignored when there is no hole.
   */
  centerLabel: string
  /** Smaller second line under {@link centerLabel}. Empty (the default) drops it. */
  centerCaption: string
  /**
   * Fade of the hole's summary in `[0, 1]`. Its own signal, untouched by the
   * ring's entrance — a hole label is usually a *conclusion*, so a scene that
   * wants it to land on a later beat sets this to 0 and calls
   * `PieChart.revealCenter` when it gets there.
   */
  centerReveal: number
}

/** Vertical breathing room between one label block and the next, in px. */
const LABEL_GAP = 12
/** Breathing room past the outermost label, so it never touches the node's edge, in px. */
const LABEL_PAD = 14
/** Rough width of one glyph as a fraction of the font size, for gutter sizing. */
const GLYPH_RATIO = 0.62
/** Gap between a wedge's outer edge and where its leader lifts off, in px. */
const LEADER_LIFTOFF = 6
/** How far past the ring's outer edge a leader runs before it elbows, in px. */
const LEADER_LENGTH = 34
/** Horizontal run from the elbow to the label, in px. */
const LABEL_STUB = 26
/** Gap between a leader's end and the label text it points at, in px. */
const TEXT_INSET = 8
/**
 * Floor on the elbow's horizontal distance from the ring's axis, as a fraction
 * of the leader radius — so a label pushed clear above (or below) the ring still
 * elbows out sideways rather than running straight down the 12 o'clock line.
 */
const MIN_ELBOW = 0.18
/** Segments used to tessellate a full turn of arc; a wedge takes its share. */
const ARC_STEPS = 240
/** Rounding applied to the leader's elbow, in px. */
const ELBOW_RADIUS = 8
/** Side padding used when nothing is leadered out — no gutter to reserve. */
const BARE_PAD = 2
/** An inside label's caption size, as a fraction of its leading line. */
const INSIDE_CAPTION_RATIO = 0.44
/**
 * Where an inside label sits on a **solid pie** (no hole to split the band
 * with), as a fraction of the wedge's radius — far enough out that the label
 * clears the point every wedge converges on.
 */
const PIE_LABEL_RADIUS = 0.62
/** Fraction of the hole's diameter its summary is allowed to run to. */
const CENTER_LABEL_FIT = 0.78
/** Fraction of the room inside a wedge that its label is allowed to run to. */
const INSIDE_LABEL_FIT = 0.9
/** Below this, a wedge's bisector counts as axis-aligned and that term stops binding. */
const AXIS_EPSILON = 1e-3
/** Fallback type size when a theme style leaves it unset or on autofit. */
const FALLBACK_SIZE = 26

/** A style's numeric size, guarding the autofit and unset cases. */
function sizeOf(style: TextStyle, fallback = FALLBACK_SIZE): number {
  const size = style.fontSize
  return typeof size === "number" ? size : fallback
}

/** Where one slice's label sits and the polyline that points at it. */
interface LabelPlacement {
  /** Index of the slice. */
  index: number
  /** Which side of the ring the label sits on: +1 right, −1 left. */
  side: 1 | -1
  /** Leader polyline: wedge edge → elbow → label. */
  leader: Vector2[]
  /** Point the label's inner edge is pinned to. */
  text: Vector2
}

/**
 * A ring-band wedge over `a0`→`a1` (radians, clockwise from 12 o'clock) spanning
 * `rInner`→`rOuter`, centred on `cx`. Ring wedges trace the outer arc, step in,
 * and trace the inner arc back; full pie wedges (`rInner <= 0`) close through the
 * centre.
 *
 * `halfGap` is **half the gap to the neighbouring slice, in px**, shaved off both
 * ends of the wedge. It's converted to an angle *per radius* (`halfGap / r` — a
 * wider angle near the hole than out at the rim), which is what keeps the channel
 * between two slices the same width all the way across the band. A fixed angular
 * gap instead reads as a thin pizza slice: right at the rim, pinched shut at the
 * hole. The inset is capped at the wedge's own half-span so a sliver of a slice
 * narrows to nothing rather than turning inside out.
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
  /** Angular inset at radius `r` that puts the wedge's edge `halfGap` px off the divide. */
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
    // Solid pie wedge: the sides converge on the centre, so only the outer rim
    // carries the gap.
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
  // Back along the inner arc — its own (wider) inset makes each side edge a
  // straight chord sitting `halfGap` px off the divide at both ends.
  for (let i = steps; i >= 0; i--) {
    const p = arcTo(rInner, i)
    path.lineTo(p.x, p.y)
  }
  path.close()
  return path
}

/** What the ring's geometry reads off its entries. */
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

/**
 * The ring's geometry for one box: every radius, gutter and label position,
 * derived from the entries and the size the ring was laid out at, and asked
 * afresh wherever it is read — the drawing, and the labels' bound positions
 * and sizes alike, so the two cannot disagree.
 */
export class RingGeometry {
  constructor(
    private readonly s: RingState,
    private readonly box: { readonly width: number; readonly height: number }
  ) { }

  /** The drawn slices' angular spans, re-read every frame so a value tween re-cuts them. */
  get arcs(): PieArc[] {
    return pieArcs(this.s.slices, this.s.ring.startAngle)
  }

  /** Whether any slice is labelled on a leader — the only thing that costs a gutter. */
  get hasLeaderLabels(): boolean {
    return this.s.labelPlacement === "leader" && this.s.labelMode !== "none" && this.arcs.length > 0
  }

  // ---- Label sizing ------------------------------------------------------

  /**
   * How wide a horizontal label centred in slice `arc`'s band can run before it
   * leaves the wedge, in px.
   *
   * Two things bound it, and which one binds depends entirely on where the wedge
   * sits. Stepping sideways from the label's centre moves you *radially* by
   * `dx·sin(mid)` and *tangentially* by `dx·cos(mid)`, so a wedge at 3 o'clock is
   * limited by the band's thickness (its label runs straight across the band)
   * while a wedge at 12 o'clock is limited by its own arc (its label runs along
   * the band, which is much roomier). Taking the smaller of the two is what stops
   * a label overflowing the ring on one chart and being pointlessly shrunk on the
   * next.
   *
   * Measured off the *unpopped* radius, so a slice growing out of the ring
   * doesn't resize its own text mid-animation.
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
    // The caption is set at a fraction of the leading line, except when it *is*
    // the leading line.
    const caption = mode === "category" ? category : mode === "both" ? category * INSIDE_CAPTION_RATIO : 0
    return Math.max(1, percent, caption)
  }

  /**
   * Font size of an inside label's leading line: what the theme asked for,
   * shrunk if that wouldn't fit inside its wedge. **One size across every inside
   * label** — the smallest any of them needs — because labels at mismatched
   * sizes read as a mistake rather than as emphasis.
   *
   * So the theme's `insideStyle.fontSize` is an upper bound, not a promise: ask
   * for the size the chart wants and the ring keeps it legal.
   */
  get insideFont(): number {
    let size = sizeOf(this.s.label.insideStyle, FALLBACK_SIZE * 1.9)
    for (const arc of this.arcs) {
      const fits = (this.insideRoom(arc) * INSIDE_LABEL_FIT) / (this.insideGlyphs(arc) * GLYPH_RATIO)
      size = Math.min(size, fits)
    }
    return Math.max(1, size)
  }

  /**
   * Font size of the hole's summary: the configured size, capped so it still
   * fits across the hole. The cap matters because the hole's radius derives from
   * the box, so a chart that reflows smaller would otherwise push its summary out
   * through the ring.
   */
  get centerFont(): number {
    const { centerStyle, centerLabel, centerCaption } = this.s
    const wanted = sizeOf(centerStyle.labelStyle, 46)
    const hole = this.holeRadius
    if (hole <= 0) return wanted
    const captionRatio = sizeOf(centerStyle.captionStyle, 22) / Math.max(1, wanted)
    // Both lines have to clear the hole, and the caption is set at a fraction of
    // this size — so what binds is whichever is wider once drawn, not whichever
    // has more characters.
    const glyphs = Math.max(1, centerLabel.length, centerCaption.length * captionRatio)
    return Math.min(wanted, (hole * 2 * CENTER_LABEL_FIT) / (glyphs * GLYPH_RATIO))
  }

  // ---- Ring geometry, all derived from the box ---------------------------

  /** Rim radius of a fully selected slice as a multiple of the ring's, clamped sane. */
  get growFactor(): number {
    return Math.max(1, Math.min(1.6, this.s.ring.selectedGrow))
  }

  /** How far past the ring's rim a fully selected slice reaches, in px. */
  get maxPop(): number {
    return this.outerRadius * (this.growFactor - 1)
  }

  /** Height of one **leader** label block, in px — the unit those columns are spaced by. */
  get labelRowHeight(): number {
    // Inside labels are stacked in the band, not in a column beside the ring, so
    // they cost no vertical reserve.
    if (!this.hasLeaderLabels) return 0
    const caption = sizeOf(this.s.label.textStyle) * 1.25
    const percent = sizeOf(this.s.label.percentStyle) * 1.25
    if (this.s.labelMode === "both") return caption + percent + 2
    return this.s.labelMode === "category" ? caption : percent
  }

  /** Widest line, in glyphs, that a leader label for slice `index` can run to. */
  captionGlyphs(index: number): number {
    const mode = this.s.labelMode
    // "100%" is the widest a percentage gets; captions are their own length.
    const percent = mode === "percent" || mode === "both" ? 4 : 0
    const category = mode === "category" || mode === "both" ? (this.s.slices[index]?.category.length ?? 0) : 0
    return Math.max(percent, category)
  }

  /**
   * Horizontal room reserved on each side for the leaders and their labels, in
   * px — measured **per side**, from the slices that actually leader out that
   * way. A ring whose labels are all inside reserves nothing and draws bigger.
   *
   * Excludes the ring's own selection-growth allowance, which scales with the
   * radius and so is divided out in {@link outerRadius} instead.
   */
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

  /**
   * How far the ring's centre sits from the node's, in px. Zero while the
   * gutters match; when the labels all fall one way it slides the ring into the
   * empty half so the ring-plus-labels group stays centred in the box instead of
   * the ring sitting dead centre with a bald patch beside it.
   */
  get centerX(): number {
    const { left, right } = this.labelGutters
    return (left - right) / 2
  }

  /**
   * Radius of the ring's outer edge, fitted to whatever the label gutters leave.
   * A fully selected slice reaches `radius × growFactor`, so the room has to
   * cover that — hence the divisor, which keeps even the grown slice inside the
   * box (and holds the ring the same size whether or not anything is selected).
   */
  get outerRadius(): number {
    const { left, right } = this.labelGutters
    const room = Math.min((this.box.width - left - right) / 2, this.box.height / 2 - this.labelRowHeight - 4)
    return Math.max(0, room / this.growFactor)
  }

  /** Radius of the hole in the middle: a fraction of the outer radius, or explicit px. */
  get holeRadius(): number {
    const configured = this.s.ring.holeRadius
    if (configured <= 0) return 0
    const px = configured < 1 ? configured * this.outerRadius : configured
    return Math.min(px, this.outerRadius * 0.95)
  }

  /** Radius of the circle every leader elbows on, clear of even a popped-out slice. */
  get elbowRadius(): number {
    return this.outerRadius + this.maxPop + LEADER_LENGTH
  }

  /** How far slice `index` is currently pushed out, in `[0, 1]`. */
  popOf(index: number): number {
    return clampUnit(this.s.pops[index] ?? 0)
  }

  /** Radius of slice `index`'s outer edge, its selection growth included. */
  anchorRadius(index: number): number {
    return this.outerRadius + this.maxPop * this.popOf(index)
  }

  /**
   * Radius an inside label sits at on slice `index`: halfway across the band on a
   * donut, and further out than halfway on a solid pie, where "halfway" would
   * crowd the point every wedge converges on. Rides the slice's own pop, so an
   * inside label travels out with the wedge it belongs to.
   */
  bandMidRadius(index: number): number {
    const rim = this.anchorRadius(index)
    const hole = this.holeRadius
    return hole > 0 ? (hole + rim) / 2 : rim * PIE_LABEL_RADIUS
  }

  /** The point slice `index`'s inside label is centred on. */
  insideAnchor(index: number): Vector2 {
    const arc = this.arcs.find((a) => a.index === index)
    if (arc === undefined) return { x: this.centerX, y: 0 }
    const point = ringPoint(this.bandMidRadius(index), arc.mid)
    return { x: point.x + this.centerX, y: point.y }
  }

  /**
   * How selected the ring is overall, in `[0, 1]` — the most-grown slice. Rides
   * the same tween the pops do, so the dim below arrives with the growth rather
   * than needing an animation of its own.
   */
  get selectionStrength(): number {
    let strongest = 0
    for (let i = 0; i < this.s.slices.length; i++) strongest = Math.max(strongest, this.popOf(i))
    return strongest
  }

  /**
   * Opacity slice `index` (and its leader and label) is drawn at: full while
   * nothing is selected, falling toward `dimOpacity` in proportion to how
   * selected the *rest* of the ring is. A slice that's selected itself stays at
   * full — the two factors cancel.
   */
  sliceOpacity(index: number): number {
    const focus = this.selectionStrength
    if (focus <= 0) return 1
    return 1 - (1 - clampUnit(this.s.dimOpacity)) * focus * (1 - this.popOf(index))
  }

  /** Slice `index`'s share of the ring as its label reads it, off the live values. */
  percentText(index: number): string {
    const arc = this.arcs.find((a) => a.index === index)
    return formatPercent(arc?.fraction ?? 0)
  }

  // ---- Label placement ---------------------------------------------------

  /**
   * Where every leader label sits and how its leader gets there. Labels are split
   * into a right and a left column by their slice's bisector, each column is
   * spread so nothing overlaps (and nothing leaves the box), and each leader is
   * then built as wedge edge → elbow → label. The elbow rides the leader circle at
   * the label's *settled* y, which keeps the final run horizontal and the whole
   * polyline outside the ring however far the label was nudged.
   */
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
      // x² + y² = radius² for x keeps it *on* that circle (never inside the
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

  /** This frame's placement for slice `index`, or `undefined` if it isn't leadered. */
  placementFor(index: number): LabelPlacement | undefined {
    return this.placements().find((placement) => placement.index === index)
  }
}

/** Which side a leader off bisector `mid` runs to: +1 right, −1 left. */
function sideOf(mid: number): 1 | -1 {
  return Math.sin(mid) >= 0 ? 1 : -1
}

const NO_BOX = { width: 0, height: 0 }

/**
 * Each slice's fill, resolved once per paint rather than every frame: the slices
 * are bound to the chart's rows and palette, so a theme tween hands over new
 * paint and the drawing must see it, but a frame that moves nothing must not
 * re-resolve. Keyed by the paint itself, so it is shared and needs no node.
 */
const resolvedFills = new WeakMap<object, FillResolved[]>()

function resolvedFill(fill: Fill): FillResolved[] {
  if (typeof fill !== "object" || fill === null) return fillOps.resolve(fill)
  let resolved = resolvedFills.get(fill)
  if (resolved === undefined) resolvedFills.set(fill, resolved = fillOps.resolve(fill))
  return resolved
}

/** Each slice's fill, resolved. */
export function ringFills(slices: readonly PieSlice[]): FillResolved[][] {
  return slices.map((slice) => resolvedFill(slice.fill))
}

/**
 * The labels a ring was built with: one per *drawn* slice (a zero-valued slice
 * gets no wedge, so no label either), in whichever of the two forms the chart
 * asked for, then the hole's summary. Both are real Text stacked in a hug
 * vertical flow — the difference is only what they are pinned to and which line
 * leads. The point each is pinned to stays reactive and follows the ring as the
 * box resizes or its slice pops out; only the choice of form, which depends on
 * entries alone, is settled here.
 */
function ringLabels(s: RingState & { readonly labelReveal: number; readonly centerReveal: number }) {
  const blocks: Node2D[] = []
  // A label block's parent is the ring: its box is what the ring was laid out at.
  const geometry = () => new RingGeometry(s, (blocks[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? NO_BOX)

  const label = (arc: PieArc): Node2D => {
    // Fades in with the ring's labels, then dims along with its own slice
    // whenever another slice takes the focus.
    const opacity = () => clampUnit(s.labelReveal) * geometry().sliceOpacity(arc.index)
    const wantsCategory = s.labelMode === "both" || s.labelMode === "category"
    const wantsPercent = s.labelMode === "both" || s.labelMode === "percent"

    if (s.labelPlacement === "inside") {
      // The number leads and the caption sits under it: inside a wedge the
      // reader already knows *which* wedge they are looking at, so the magnitude
      // is what the label is for. Both sizes are bound rather than read once —
      // the fitted size derives from the ring's radius, which isn't known until
      // the node has been laid out.
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
      // Exactly one of these is set; `undefined` anchors are ignored.
      centerLeft: side > 0 ? at : undefined,
      centerRight: side > 0 ? undefined : at,
      children,
    })
  }

  if (s.labelPlacement !== "none" && s.labelMode !== "none") {
    for (const arc of pieArcs(s.slices, s.ring.startAngle)) blocks.push(label(arc))
  }

  // The hole's summary, pinned to the ring's centre so it tracks the sideways
  // shift a one-sided label column puts on the ring.
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
      opacity: () => clampUnit(s.centerReveal),
      center: () => ({ x: geometry().centerX, y: 0 }),
      children,
    }))
  }
  return asParts(blocks)
}

/**
 * The ring itself: one wedge per {@link PieSlice}, sized by its share of the
 * total, swept clockwise from the theme's `startAngle` with a `gap` of clear
 * space between neighbours — a *constant-width* channel, the same at the hole as
 * at the rim (see {@link wedgePath}). A **selected** slice reaches further out
 * while its hole edge stays put — so it reads as that band swelling out of the
 * ring rather than breaking off it — and the rest of the ring dims behind it,
 * leaders and labels included.
 *
 * This is the only part of the chart family that draws a path: the wedges are
 * filled {@link PathBuilder} polygons approximating each arc, and the leaders are
 * stroked polylines — both in the node's centred, y-up space, so neither depends
 * on SVG arc-sweep conventions. The **labels are real {@link Text} nodes**
 * (stacked in a hug vertical flow and pinned by their inner edge), so no
 * glyph-width guesswork decides where a caption starts.
 *
 * ### Label placement
 * Each label sits either **inside** its wedge or **outside** on a leader.
 *
 * An inside label is centred on its slice's band and leads with the number, the
 * caption set small underneath — inside a wedge the reader already knows which
 * slice they're on, so the magnitude is the thing being read. It costs no gutter
 * and no eye round-trip, so a ring labelled that way draws considerably bigger in
 * the same box.
 *
 * A leader label sits outside on the end of a polyline that lifts off its wedge,
 * elbows, and runs horizontally into the text. Labels are split into a left and a
 * right column by which way their slice's bisector points, and each column is
 * de-conflicted independently (see {@link relaxLabels}): a label takes the spot
 * nearest its wedge that still clears its neighbour, and the column is squeezed
 * to fit the node's height rather than spilling out of it. The elbow then rides on
 * a circle just outside the ring **at the label's settled y**, so the run into the
 * text is always horizontal and a nudged label never drags its leader back across
 * the ring.
 *
 * Only the sides that actually carry a leader reserve a gutter, and the ring's
 * centre slides into whatever the other side left over — so a ring whose slices
 * all leader one way doesn't leave a bald patch on the other.
 */
export const PieRing = component2d({
  key: "pieRing",
  state: {
    slices: fresh<PieSlice[]>(() => []),
    ring: Types.custom<RingConfig>(DEFAULT_PIE_CHART_THEME.ring),
    label: Types.custom<LabelConfig>(DEFAULT_PIE_CHART_THEME.label),
    centerStyle: Types.custom<CenterConfig>(DEFAULT_PIE_CHART_THEME.center),
    labelMode: Types.custom<PieLabelMode>("percent"),
    labelPlacement: Types.custom<PieLabelPlacement>("leader"),
    growth: 1,
    labelReveal: 1,
    pops: fresh<number[]>(() => []),
    dimOpacity: DEFAULT_PIE_CHART_THEME.spotlight.dimOpacity,
    centerLabel: "",
    centerCaption: "",
    centerReveal: 1,
  },
  // A plain node filled its parent; one made of its labels would hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => ringLabels(state),
  // The ring's paints live nowhere a paint entry would look: one fill per slice,
  // the wedge outline and drop shadow of `ring`, and the leader line's own stroke.
  load: (loader, state) =>
    loadPaints(loader, {
      fills: ringFills(state.slices),
      shadows: [shadowOps.resolve(state.ring.shadow)],
      strokes: [strokeOps.resolve(state.ring.stroke), strokeOps.resolve(state.label.leaderStroke)],
    }),
  commands: {
    /**
     * Tween `growth` `0 → 1`, wiping the wedges in around the ring. No priming
     * to 0 first — the value at `t` is a function of `t`, so a repeat call
     * re-sweeps by definition rather than by having reset something.
     */
    sweep: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ growth: ease(t) }))
    },
    /** Tween `labelReveal` `0 → 1`, fading the leaders and captions up. */
    revealLabels: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ labelReveal: ease(t) }))
    },
    /**
     * Fade the hole's summary up. Deliberately not part of the ring's entrance: a
     * hole label is usually the chart's conclusion, so the scene decides when it
     * lands.
     */
    revealCenter: (timeline, state) => {
      const ease = frameEase(timeline)
      const from = clampUnit(state.centerReveal)
      return timeline.animate((t) => ({ centerReveal: from + (1 - from) * ease(t) }))
    },
  },
  render: (ctx, state) => {
    const g = new RingGeometry(state, ctx.size)
    const rOuter = g.outerRadius
    const arcs = rOuter > 0 ? g.arcs : []
    if (arcs.length > 0) {
      const sweep = clampUnit(state.growth)
      const revealEnd = state.ring.startAngle * (Math.PI / 180) + Math.PI * 2 * sweep
      const hole = g.holeRadius
      const halfGap = Math.max(0, state.ring.gap) / 2

      // One shared frame (the whole ring square, grown slices included) pinned onto
      // every wedge path, so `Graphics2D.path()` doesn't re-centre each wedge on its
      // own bbox and collapse them all onto the origin. It stays symmetric about the
      // *node's* origin — so path coordinates land exactly in node space — and is
      // grown by the ring's sideways offset rather than moved with it, which would
      // undo the very shift it has to contain.
      const cx = g.centerX
      const half = rOuter + g.maxPop + 1 + Math.abs(cx)
      const centerBounds: [number, number, number, number] = [-half, -half, half, half]
      // Explicit width/height alongside centerBounds: a wedge path's command list
      // carries no implied extent, so a slice filled with an image or a video needs
      // this to size its decode.
      const span = half * 2

      const fills = ringFills(state.slices)
      for (const arc of arcs) {
        // Clip the wedge to the growth-revealed arc; skip it until the sweep
        // reaches it, so the ring draws in as one clockwise wipe.
        const a1 = Math.min(arc.a1, revealEnd)
        if (a1 <= arc.a0) continue

        const path = wedgePath(arc.a0, a1, hole, g.anchorRadius(arc.index), halfGap, cx)
        const wedge = new Graphics2D().path(path.toPathState({ centerBounds, width: span, height: span }))
        wedge.shadow(state.ring.shadow)
        wedge.fill(fills[arc.index] ?? [])
        wedge.stroke(state.ring.stroke)
        ctx.draw(wedge.opacity(g.sliceOpacity(arc.index)))
      }

      // Leaders. Each polyline gets its own `Graphics2D`: several open polylines
      // chained into one command list are combined into a single surface before the
      // stroke, which closes each contour back on itself and paints the leaders as
      // thin triangles.
      const reveal = clampUnit(state.labelReveal)
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

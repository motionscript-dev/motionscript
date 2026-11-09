import { Graphics2D, type Fill, type FillResolved } from "@motionscript/sdk"

import type { EnvelopeBar } from "./envelope"

/**
 * Geometry and paint shared by the two waveform nodes.
 *
 * They draw the same object — a row of bars whose heights are loudness — and
 * differ only in what decides the heights: the whole file for one, a window
 * around the playhead for the other. Everything about *how a row of bars is
 * laid out and painted* is therefore common, and lives here so the two cannot
 * drift into looking like different components.
 */

/** How a bar is grown out of its baseline. */
export const WAVEFORM_ALIGNMENTS = ["center", "bottom"] as const
export type WaveformAlignment = (typeof WAVEFORM_ALIGNMENTS)[number]

/** What the bars are shaped like. */
export const WAVEFORM_STYLES = ["bars", "line", "blocks"] as const
export type WaveformStyle = (typeof WAVEFORM_STYLES)[number]

/**
 * The colours voices are drawn in when nobody has assigned any.
 *
 * Eight hues that can be told apart at a glance, handed out by voice index. They
 * are literals rather than looked up, because a scene has to build in a
 * headless render with no database in scope; a host that names its voices
 * supplies its own colours instead.
 */
export const VOICE_PALETTE = [
  "#6366f1",
  "#14b8a6",
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#3b82f6",
  "#f97316",
  "#a855f7",
] as const

/** The colour a voice takes, wrapping past the end of the palette. */
export function voiceColor(index: number): string {
  return VOICE_PALETTE[
    ((index % VOICE_PALETTE.length) + VOICE_PALETTE.length) %
      VOICE_PALETTE.length
  ]
}

/**
 * Where one bar sits and how tall it came out: its top-left corner and size, in
 * the node's own pixels with **y pointing down** from the middle of the box.
 * {@link paintBars} turns that into the centred, y-up rect the renderer draws.
 */
export interface BarBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Lays a row of bars out across a box.
 *
 * The gap is stated as a *fraction of the pitch* rather than in pixels, and
 * that is the one decision here worth stating out loud: the bar count is a
 * control, so a gap in pixels would silently become a solid block at 200 bars
 * and a picket fence at 20. As a fraction, the row keeps the same rhythm at
 * every density — which is what lets the count be a slider anyone can drag.
 *
 * A bar is never thinner than a hairline and never shorter than one either: a
 * silent passage has to read as "audio, and nothing here" rather than as a hole
 * in the drawing.
 */
export function layOutBars(
  bars: readonly EnvelopeBar[],
  options: {
    width: number
    height: number
    gap: number
    align: WaveformAlignment
    /** Multiplies every magnitude before it is clamped back into 0…1. */
    gain: number
    /** Fraction of the box a silent bar still occupies. */
    floor: number
  }
): BarBox[] {
  const { width, height, gap, align, gain, floor } = options
  const count = bars.length
  if (count === 0 || width <= 0 || height <= 0) return []

  const pitch = width / count
  const barWidth = Math.max(1, pitch * (1 - clamp01(gap)))
  // The tallest a bar may be. Centre-aligned bars grow both ways from the
  // middle, so the *half* is what a magnitude of 1 fills.
  const full = align === "center" ? height / 2 : height

  const out: BarBox[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const magnitude = clamp01(bars[i].magnitude * gain)
    const reach = Math.max(full * clamp01(floor), full * magnitude)
    const x = -width / 2 + pitch * i + (pitch - barWidth) / 2

    // A hairline minimum, taken before the position so the bar stays inside the
    // box: a silent bar 1px tall that kept the position of a zero-height one
    // would hang half a pixel (centred) or a whole pixel (bottom) outside it.
    const h = Math.max(1, align === "center" ? reach * 2 : reach)
    out[i] =
      align === "center"
        ? { x, y: -h / 2, width: barWidth, height: h }
        : { x, y: height / 2 - h, width: barWidth, height: h }
  }
  return out
}

/**
 * Draws a run of bars in one paint.
 *
 * Batched by colour by the caller, and this is why: every `Graphics2D` handed to
 * `ctx.draw` is a surface the renderer composites, so a bar apiece would be a
 * thousand surfaces a frame. Chaining the rects of one colour into a single
 * `Graphics2D` before filling makes it one — and, as a bonus, a gradient fill
 * maps across the whole run rather than restarting inside every bar, which is
 * the behaviour anyone reaching for a gradient here actually wants.
 */
export function paintBars(
  boxes: readonly BarBox[],
  fill: Fill,
  radius: number
): Graphics2D | null {
  if (boxes.length === 0) return null
  if ((fill as FillResolved[]).length === 0) return null

  const graphics = new Graphics2D()
  for (const box of boxes) {
    graphics.rect({
      x: box.x + box.width / 2,
      // The box is stated y-down and the rect is drawn y-up. A centred bar is
      // symmetric about the middle, so only a bottom-aligned one shows the flip.
      y: -(box.y + box.height / 2),
      width: box.width,
      height: box.height,
      // Never rounder than the bar is wide, or a thin bar becomes a lozenge
      // whose ends taper away to nothing.
      cornerRadius: Math.min(radius, box.width / 2, box.height / 2),
    })
  }
  return graphics.fill(fill)
}

/**
 * Groups bars by the paint they take, preserving order within each group.
 *
 * The seam that makes {@link paintBars} worth batching: a diarized waveform has
 * as many colours as it has voices, not as many as it has bars, so a
 * conversation of two people is two draws however long it runs.
 */
export function groupByPaint<K>(
  boxes: readonly BarBox[],
  keyOf: (index: number) => K
): Map<K, BarBox[]> {
  const groups = new Map<K, BarBox[]>()
  for (let i = 0; i < boxes.length; i++) {
    const key = keyOf(i)
    const run = groups.get(key)
    if (run) run.push(boxes[i])
    else groups.set(key, [boxes[i]])
  }
  return groups
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The {@link groupByPaint} key one bar of a live visualiser takes.
 *
 * Filtered to one voice, every bar is that voice regardless of `byVoice` or
 * whose turn the bucket originally belonged to. That second part is the one
 * worth spelling out: {@link forSpeaker} silences a bar by zeroing its
 * magnitude but leaves `speaker` exactly as it was, so a bar sitting in the
 * middle of a *different* voice's turn is still stamped with that voice's
 * index — grouping by `byVoice`'s usual per-bar key would paint those silent
 * stretches in whoever used to be talking there, in flickers too short to
 * read as anything but noise. Forcing every bar under the filtered voice's own
 * key is the true picture instead: the node is drawing exactly one person, on
 * or off, never anyone else's colour.
 */
export function livePaintKey(
  barSpeaker: number,
  byVoice: boolean,
  filteredVoice: number | null
): string {
  if (filteredVoice !== null) return `voice:${filteredVoice}`
  return byVoice ? `voice:${barSpeaker}` : "all"
}

import { Graphics2D, clamp, type Fill, type FillResolved } from "@motionscript/sdk"

import type { EnvelopeBar } from "./envelope"

/** How a bar is grown out of its baseline. */
export const WAVEFORM_ALIGNMENTS = ["center", "bottom"] as const
export type WaveformAlignment = (typeof WAVEFORM_ALIGNMENTS)[number]

export const WAVEFORM_STYLES = ["bars", "line", "blocks"] as const
export type WaveformStyle = (typeof WAVEFORM_STYLES)[number]

/** Eight distinct hues handed out by voice index. Literals, because a scene builds headless with no database in scope; a host that names its voices supplies its own. */
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

/** A bar's top-left corner and size in the node's pixels, with y pointing down from the middle of the box; {@link paintBars} turns it into the centred y-up rect. */
export interface BarBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Lays a row of bars across a box. The gap is a fraction of the pitch, not px:
 * the bar count is a control, and a px gap would become a solid block at 200
 * bars and a picket fence at 20. A bar is never thinner or shorter than a
 * hairline, so a silent passage reads as audio with nothing in it, not a hole.
 */
export function layOutBars(
  bars: readonly EnvelopeBar[],
  options: {
    width: number
    height: number
    gap: number
    align: WaveformAlignment
    gain: number
    /** Fraction of the box a silent bar still occupies. */
    floor: number
  }
): BarBox[] {
  const { width, height, gap, align, gain, floor } = options
  const count = bars.length
  if (count === 0 || width <= 0 || height <= 0) return []

  const pitch = width / count
  const barWidth = Math.max(1, pitch * (1 - clamp(gap, 0, 1)))
  // Centre-aligned bars grow both ways, so half the height is what a magnitude of 1 fills.
  const full = align === "center" ? height / 2 : height

  const out: BarBox[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const magnitude = clamp(bars[i].magnitude * gain, 0, 1)
    const reach = Math.max(full * clamp(floor, 0, 1), full * magnitude)
    const x = -width / 2 + pitch * i + (pitch - barWidth) / 2

    // The hairline minimum is taken before the position, or a 1px bar placed as if zero-height would hang outside the box.
    const h = Math.max(1, align === "center" ? reach * 2 : reach)
    out[i] =
      align === "center"
        ? { x, y: -h / 2, width: barWidth, height: h }
        : { x, y: height / 2 - h, width: barWidth, height: h }
  }
  return out
}

/**
 * Draws a run of bars in one paint. Callers batch by colour: every `Graphics2D`
 * handed to `ctx.draw` is a surface the renderer composites, so a bar apiece
 * would be a thousand surfaces a frame. One `Graphics2D` per run also maps a
 * gradient across the whole run instead of restarting inside every bar.
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
      // The box is y-down and the rect y-up; only a bottom-aligned bar shows the flip.
      y: -(box.y + box.height / 2),
      width: box.width,
      height: box.height,
      // A thin bar rounder than it is wide becomes a lozenge.
      cornerRadius: Math.min(radius, box.width / 2, box.height / 2),
    })
  }
  return graphics.fill(fill)
}

/** Groups bars by the paint they take, in order within each group: a diarized waveform has as many colours as voices, so two people is two draws however long it runs. */
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

/**
 * The colour of a `voice:N` group key, or `fallback` for a bad index. Always a
 * colour string, never one of the node's fills: a voice is identified by hue, so
 * a gradient or image would defeat the point, and it keeps these paints from
 * declaring assets.
 */
export function voiceFill(key: string, voiceColors: readonly string[], fallback: Fill): Fill {
  const voice = Number(key.slice("voice:".length))
  if (!Number.isFinite(voice) || voice < 0) return fallback
  return voiceColors[voice] ?? voiceColor(voice)
}

/**
 * The {@link groupByPaint} key of one live bar. Filtered to a voice, every bar
 * takes that voice's key: {@link forSpeaker} zeroes a bar's magnitude but leaves
 * its `speaker`, so the usual per-bar key would paint the silenced stretches in
 * whoever used to talk there, in flickers too short to read as anything but noise.
 */
export function livePaintKey(
  barSpeaker: number,
  byVoice: boolean,
  filteredVoice: number | null
): string {
  if (filteredVoice !== null) return `voice:${filteredVoice}`
  return byVoice ? `voice:${barSpeaker}` : "all"
}

import { clamp, type Size2D } from "@motionscript/sdk"

import type { Slot } from "./slots"

/**
 * What an item does on its way in (or out): grow from nothing, fade, fly out of
 * the grid's centre, rise into place, flip up, or spin in.
 */
export const REVEAL_STYLES = ["scale", "fade", "center", "rise", "flip", "spin"] as const
export type RevealStyle = (typeof REVEAL_STYLES)[number]

/** What a wave does to each item as it passes. */
export const WAVE_STYLES = ["scale", "lift", "fade", "spin"] as const
export type WaveStyle = (typeof WAVE_STYLES)[number]

/** `1` shown and `0` gone, past `1` under an overshooting ease; absent means every item is shown. */
export interface RevealState {
  style: RevealStyle
  values: readonly number[]
}

/** Each item's share of the wave passing through it, `0` at rest and `1` at the crest. */
export interface WaveState {
  style: WaveStyle
  /** How big the crest is — a share of the item's size, opacity or a turn, by style. */
  amount: number
  values: readonly number[]
}

/** Each item's emphasis: `1` the focus, `-1` pushed back, `0` untouched. */
export interface FocusState {
  /** How far the others fade, `0..1`. */
  dim: number
  /** How much the focus grows, as a share of its size; the others shrink by half that. */
  grow: number
  values: readonly number[]
}

/** Layer item `i`'s reveal, wave and focus onto its slot, in place. */
export function applyItemEffects(
  s: Slot,
  i: number,
  size: Size2D,
  reveal: RevealState | null | undefined,
  wave: WaveState | null | undefined,
  focus: FocusState | null | undefined,
): void {
  if (reveal) applyReveal(s, reveal.style, reveal.values[i] ?? 1, size)
  if (wave) applyWave(s, wave, wave.values[i] ?? 0, size)
  if (focus) applyFocus(s, focus, focus.values[i] ?? 0)
}

function applyReveal(s: Slot, style: RevealStyle, v: number, size: Size2D): void {
  if (v === 1) return
  const shown = clamp(v, 0, 1)
  switch (style) {
    case "fade":
      s.opacity *= shown
      break
    case "center":
      s.x *= v
      s.y *= v
      s.depth *= v
      s.opacity *= clamp(v * 4, 0, 1)
      break
    case "rise":
      s.y -= (1 - v) * Math.max(40, size.height)
      s.opacity *= shown
      break
    case "flip":
      s.rotationX += (1 - v) * 90
      break
    case "spin":
      s.rotation -= (1 - v) * 180
      s.scale *= Math.max(0, v)
      break
    default:
      s.scale *= Math.max(0, v)
  }
}

function applyWave(s: Slot, wave: WaveState, w: number, size: Size2D): void {
  if (w === 0) return
  switch (wave.style) {
    case "lift":
      s.y += wave.amount * w * Math.max(40, size.height)
      break
    case "fade":
      s.opacity *= clamp(1 - wave.amount * w, 0, 1)
      break
    case "spin":
      s.rotation += wave.amount * w * 360
      break
    default:
      s.scale *= 1 + wave.amount * w
  }
}

function applyFocus(s: Slot, focus: FocusState, f: number): void {
  if (f === 0) return
  if (f > 0) {
    s.scale *= 1 + focus.grow * f
    return
  }
  s.opacity *= clamp(1 - focus.dim * -f, 0, 1)
  s.scale *= Math.max(0, 1 + focus.grow * 0.5 * f)
}

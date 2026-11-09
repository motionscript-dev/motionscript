---
"@motionscript/core": patch
---

Fixes in colour parsing, paint and effect tweens, paths, hugging wrapped layout and text font sizes.

- `hsl()`, `lch()` and `oklch()` convert a hue given in `deg`, `grad`, `rad` or `turn` to degrees, where `hsl(0.5turn 100% 50%)` read as 0.5 degrees. A negative `hsl()` hue wraps. The legacy `rgba(255, 0, 0, 50%)` reads a percentage alpha as 0.5, like the slash form. A malformed colour (`rgb(255)`, `hsl(0)`, `#zzz`, an unknown unit) is now one outcome: the "Unsupported color format" warning and opaque black, where some threw a bare `TypeError` and others went black without a word.
- Tweening an image or video fill from one `fit` (or raw `matrix`) to another switches at the midpoint and ends on the destination's, where it ended on the source's.
- Tweening a gradient between different stop counts or positions resamples both onto the union of their stops, so it ends on the destination gradient (the fractal-noise colour ramp too). Tweening a `shader` effect between two programs switches the program at the midpoint, where it kept the source's program with the destination's uniforms.
- An effect's `clip` option survives a tween and is compared for equality for every effect (`lerpEffect` carries the shared option keys), and `Effects.magnify` and `Effects.glass` honour `clip`, which they ignored.
- A `Path` centres on the tight box it hugs, where a curved path was centred on its control-point bounds and drew off-centre in its own layout box. `pathOps.cubics` leaves out a lone `M`, so a morph from an empty path to `"M5 5"` no longer throws. `pathOps.anchors` and `pathOps.cubics` hand out copies of their points, so editing the result cannot move the cached path. `anchorBounds` ignores the self-loop of a closed one-anchor subpath, which is never drawn.
- A hugging row or column with `wrap` measures a main-axis `fill` item as the unwrapped run does, where it reserved the whole available extent for it.
- Tweening a text `fontSize` between `'autofit'` and a number switches at the midpoint (`textOps.lerpFontSize`), where it wrote `autofitNaN`. A `RichText` ignores an `'autofit'` size from a default text style or theme preset, where it measured a `NaN` height.

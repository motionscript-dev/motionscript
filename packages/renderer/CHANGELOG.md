# @motionscript/renderer

## 0.1.1-alpha.4

### Patch Changes

- d67777c: A shape with a drop shadow, tipped in perspective until part of it nears the eye, no longer fails the frame with "Invalid CommandBuffer". The shadow's blur was measured at the shape's largest magnification (up to 1000×), which grew its layer past the GPU's texture limit. A tilted shape's drop shadow, and a tilted group's `dropShadow` filter, now take their blur and offset from where the shape is seen. No blur, filter or effect layer reaches further past the visible area than a texture can hold.

## 0.1.1-alpha.3

## 0.1.1-alpha.2

## 0.1.1-alpha.1

### Patch Changes

- 1810e8a: **Breaking:** the charts are rebuilt around one `style` entry, and the kit gains a radar and a radial chart.

  - **One look entry.** Every chart's `theme` (and its `DEFAULT_*_THEME`, `resolve*Theme`, `lerp*Theme`) is gone, along with `showLegend` and the bar chart's `showValues`. Each chart has `style: Types.style("chart", …)` instead, with fields grouped as colours (`palette`, `foreground`, `muted`, `background`), text (`fontFamily`, `fontSize`, `fontWeight`), grid (`horizontalGrid`, `verticalGrid` and `axisStroke` on a line or bar chart, `gridStroke` and `spokeStroke` on a radar, all strokes, so weight, colour, dash and caps come with them and an empty one draws nothing), marks, labels and legend (`legend`: bottom, top, right or none; `swatch`: square, circle or line). A chart takes only the fields it draws, and one style dresses any chart. `CHART_STYLE_PRESETS` (midnight, paper, ember, neon, ocean, sunset, pastel, mono) are partial looks to spread in; `to({ style })` tweens a restyle.
  - **Line and area are one chart.** `lineChart` draws curves `smooth` (monotone, never overshooting), `linear` or `step`, optional dots, and `style.area` of `none`, `solid` or `gradient` under each line. `stack` is `none`, `stacked` or `percent`. Up to twelve categorical or dated samples each get a tick.
  - **Bars.** `barChart` takes `orientation` (`vertical` or `horizontal`) and `stack` (`none`, `stacked` or `percent`; replaces `stacked`). Negative values grow from zero, only a stack's outer end is rounded, and `style.values` puts figures at the `end` of a bar or `inside` it.
  - **Pie.** `style.innerRadius` makes a donut; `sliceGap`, `sliceRadius` and `labelPlacement` (`inside`, `outside`, `none`) are style fields.
  - **New: `radarChart`.** One spoke per row, one polygon per series, a `polygon` or `circle` grid, with `enter` and the series commands.
  - **A line is a stroke, an area is a fill.** A radial's `track` is a fill (empty for none). There is no grid width, dash, axis-line, spoke or track switch, and no `gridColor`. A series' `label` is optional: the legend shows `label || field`.
  - **New: `radialChart`.** One ring per row, swept by `value / max` over `style.sweep` degrees from `style.startAngle`, with tracks, round caps, ring labels, a centre summary, `enter`, `selectRing`, `clearSelection` and `revealCenter`.
  - **The kit** draws no plot border by default, puts each legend swatch before its caption, and moves `HorizontalAxis`, the polar helpers (`kit/polar`) and `PieLegend` behind the kit barrel, so a copied chart reaches only the kit. Removed from `./kit`: `ChartBorder`, `CHART_PALETTE`, `DEFAULT_PLOT_AREA`, `PlotAreaConfig`, `DEFAULT_SERIES_COLORS` (use `CHART_PALETTE_DEFAULT`), `DEFAULT_SERIES_STROKES`, `DEFAULT_SERIES_FILLS`, `LegendTheme`, and the theme helpers `resolveAxisConfig`, `lerpAxisConfig`, `resolvePlotArea`, `lerpPlotArea`, `resolveLegendConfig`, `lerpLegendConfig`, `resolveSeriesStrokes`, `lerpSeriesStrokes`, `resolveSeriesFills`, `lerpSeriesFills`, `resolveSeriesStroke` and `resolveSeriesFill` (a chart's colours come from `seriesFill`/`paletteFill` over its style).

  The renderer's path and paint cache keys no longer collide for shapes mirrored through the origin, which drew two symmetric grid rules as one.

  Migration: nothing converts a stored chart. A document row's `theme`, `showLegend`, `showValues` and `stacked` are dropped on open and the chart draws in the default style; a host with stored charts rewrites them: `theme` → a `style` partial (series colours to `palette`, text colours to `foreground`/`muted`), `showLegend: false` → `style.legend: "none"`, `showValues: true` → `style.values: "end"`, `stacked: true` → `stack: "stacked"`, `gridColor`/`gridWidth`/`gridDashed` → `horizontalGrid`/`verticalGrid` (or `gridStroke` on a radar), `grid: "vertical"` → `verticalGrid` on and `horizontalGrid: []`, `axisLine` → `axisStroke`, `spokes: false` → `spokeStroke: []`, a radial's `track: false` → `track: []`, and a pie's `labelPlacement` → `style.labelPlacement` (`leader` is now `outside`).

- 9024e08: 3D depth is reversed Z, and a perspective camera whose `far` is derived gets an infinite far plane, so thin parts a few thousandths apart (a plate on a face, lettering on a token, beams inside a slab) no longer stripe through each other at a distance. A material's `polygonOffset` now applies (it was dropped). The 3D scene stream is version 4.

## 0.1.1-alpha.0

### Patch Changes

- 6b89575: The renderer's prewarm now also builds the drawing pipelines for the canvas format, so their shader compile overlaps a host's start-up instead of delaying its first frame.
- e279864: A 3D scene's surface and image textures stay their own across frames. A frame's image ids are given out in the order they are met, so when a scene's set of textures changed size (a token appearing, a plane entering) the scene's id moved on and its old id became a surface, while the renderer kept the old scene and drew it into that surface: a texture showed a picture of the whole scene, and sampling the target being drawn raised a WebGPU validation error. The renderer now drops a scene whose id becomes something else, and binds every image and surface a scene uses to the current frame's id on every sync.
- e9db554: An asset is downloaded and decoded once while it is loading, however many ask for it: the weights of one font family share its files (each weight used to fetch the whole family), two draws of one image or video share one decode, and every session, still and export on a page shares one request per source (`loadAssetBytes`, which the audio mix now goes through as well). A load that fails is asked for again next time.
- 7cd4e53: A Text with a Write On reveal (`start`/`end` short of the whole string) or styled `runs` drew nothing at all: the renderer ignored the text's pieces while core left their painting to them. Each piece now draws with its own fill and stroke, the unrevealed characters held in place but clear, so a Write On types the text on character by character.
- Updated dependencies [3630b74]
- Updated dependencies [1c43a37]
- Updated dependencies [e279864]
  - @motionscript/core@0.1.1-alpha.0

## 0.1.0

### Patch Changes

- d2241c3: Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
- 2026625: Plain rects and ellipses (a solid fill without a shadow, or a solid, undashed stroke round a rect or a circle) now draw as the renderer's own shapes instead of as paths: a scene of many small moving shapes renders over twice as fast. Their antialiased edges come out marginally different (a few levels on edge pixels, nothing visible at normal size); interiors and axis-aligned edges are unchanged.

## 0.1.0-alpha.10

### Patch Changes

- d2241c3: Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
- 2026625: Plain rects and ellipses (a solid fill without a shadow, or a solid, undashed stroke round a rect or a circle) now draw as the renderer's own shapes instead of as paths: a scene of many small moving shapes renders over twice as fast. Their antialiased edges come out marginally different (a few levels on edge pixels, nothing visible at normal size); interiors and axis-aligned edges are unchanged.

## 0.1.0-alpha.9

## 0.1.0-alpha.8

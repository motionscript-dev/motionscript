# @motionscript/renderer

## 1.0.0

### Patch Changes

- Updated dependencies [b05007b]
  - @motionscript/core@1.0.0

## 0.6.0

### Patch Changes

- 5c1a616: Video fills play. While playing, the renderer decoded no video frames at all, so a video showed the frame it was paused on (or nothing) for the whole play; pausing then decoded every frame the play had asked for at once, each with a decoder of its own starting from the previous key frame, which could freeze the page. Each video is now read off one forward decode stream: consecutive frames cost one decode each (a 720p clip with a key frame every five seconds exports about 3.5 times faster), a step back or a jump past a key frame opens a new stream there, and while playing a few frames ahead of the playhead stay decoded. Pausing settles the frame left on screen.

- 46cd4a0: A wrapped `parallax` layer shows no faint line where its copies meet. The renderer paints a tiled child (`paintTiled`) by drawing it once into a surface sized to whole pixels and filling the box with that surface repeating, so no two antialiased edges blend at a seam.

## 0.5.2

### Patch Changes

- fac631e: The renderer no longer fills GPU memory during playback. A 3D map taken from a surface that redraws every frame (a textured globe, for one) is rebuilt into the same texture instead of a new one each frame, and every texture and buffer the renderer replaces or forgets (3D maps, a 3D scene's targets and grown buffers, a removed 3D scene, evicted distance fields, readbacks, a grown clip atlas) is destroyed at once. In the browser, a dropped texture is only freed when its JS object is garbage-collected, so a long play could grow VRAM by gigabytes until the GPU process died and the device was lost ("A valid external Instance reference no longer exists").

## 0.5.1

## 0.5.0

### Patch Changes

- 48b5239: The WebGPU renderer draws extrusions. Core's new `evaluateExtrude` turns an `extrude` geometry into vertex buffers the way three's `ExtrudeGeometry` shapes it: the outline in the XY plane, a contour inside another a hole, curves flattened into `segments` steps, walls creased at sharp corners and smooth round curves, and an optional bevel rounding both rims. The renderer writes that buffer and sends it once while it stays the same. An extrusion also has bounds now, so an editor can box it.
- 750861c: A video the host holds no bytes for is read in ranges as its frames are asked for, instead of being downloaded whole before the first frame: `createWgpuRenderer` takes `localBytes` (the host's bytes or `null`, never the network), which `@motionscript/browser` points at its asset byte source. `isWgpuSupported` asks for an adapter once per page. Still renderers and screenshots encode `webp` as well as `png` and `jpeg`.

## 0.4.1-alpha.1

### Patch Changes

- 750861c: A video the host holds no bytes for is read in ranges as its frames are asked for, instead of being downloaded whole before the first frame: `createWgpuRenderer` takes `localBytes` (the host's bytes or `null`, never the network), which `@motionscript/browser` points at its asset byte source. `isWgpuSupported` asks for an adapter once per page. Still renderers and screenshots encode `webp` as well as `png` and `jpeg`.

## 0.4.1-alpha.0

### Patch Changes

- 48b5239: The WebGPU renderer draws extrusions. Core's new `evaluateExtrude` turns an `extrude` geometry into vertex buffers the way three's `ExtrudeGeometry` shapes it: the outline in the XY plane, a contour inside another a hole, curves flattened into `segments` steps, walls creased at sharp corners and smooth round curves, and an optional bevel rounding both rims. The renderer writes that buffer and sends it once while it stays the same. An extrusion also has bounds now, so an editor can box it.
- Updated dependencies [48b5239]
- Updated dependencies [48b5239]
- Updated dependencies [eb66dc5]
- Updated dependencies [321ceb0]
  - @motionscript/core@0.4.1-alpha.0

## 0.4.0

## 0.4.0-alpha.0

## 0.3.0

## 0.2.0

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

- 5edc8b5: - **A conic gradient's `startAngle` rotates it.** The seam (the first stop) sits `startAngle` degrees clockwise from the box's three o'clock and the ramp runs a full turn from there. It used to stay at three o'clock, with the angles before `startAngle` clamped to the first stop and the ramp squeezed into what was left of the turn.
- 9024e08: 3D depth is reversed Z, and a perspective camera whose `far` is derived gets an infinite far plane, so thin parts a few thousandths apart (a plate on a face, lettering on a token, beams inside a slab) no longer stripe through each other at a distance. A material's `polygonOffset` now applies (it was dropped). The 3D scene stream is version 4.
- 6b89575: The renderer's prewarm now also builds the drawing pipelines for the canvas format, so their shader compile overlaps a host's start-up instead of delaying its first frame.
- e279864: A 3D scene's surface and image textures stay their own across frames. A frame's image ids are given out in the order they are met, so when a scene's set of textures changed size (a token appearing, a plane entering) the scene's id moved on and its old id became a surface, while the renderer kept the old scene and drew it into that surface: a texture showed a picture of the whole scene, and sampling the target being drawn raised a WebGPU validation error. The renderer now drops a scene whose id becomes something else, and binds every image and surface a scene uses to the current frame's id on every sync.
- e9db554: An asset is downloaded and decoded once while it is loading, however many ask for it: the weights of one font family share its files (each weight used to fetch the whole family), two draws of one image or video share one decode, and every session, still and export on a page shares one request per source (`loadAssetBytes`, which the audio mix now goes through as well). A load that fails is asked for again next time.
- e0283cc: - **Large, detailed paths scale smoothly.** A `scaleTo` on a map of tens of thousands of points keeps its outlines: one made only of lines is built once for every scale, a curved one built for a larger scale also serves smaller ones, and reaching a new power of two of scale builds only the bands the shader reads. In a 120k-point test map, CPU time per scaling frame went from 42 ms to under 1 ms.
  - **Thin strokes keep their authored width** unless they run round the renderer's own rect or ellipse, or along horizontal and vertical lines only. Those still sit on whole device pixels; any other stroke glides while scaling, where it used to step between 1 and 2 px. A stroke thinner than a device pixel fades with its coverage, where it used to draw 1 px wide.
  - When the geometry cache is full it evicts the least recently used outlines, where it used to drop everything and rebuild the frame.
  - `stats()` reports `banded`, the band sets built in the last frame.
- 7cd4e53: A Text with a Write On reveal (`start`/`end` short of the whole string) or styled `runs` drew nothing at all: the renderer ignored the text's pieces while core left their painting to them. Each piece now draws with its own fill and stroke, the unrevealed characters held in place but clear, so a Write On types the text on character by character.
- 0b752d6: - **A 3D texture's `anisotropy` is drawn**: above 1 the sampler filters anisotropically, rounded up to 4x, 8x or 16x (the most WebGPU allows), so a texture seen at a glancing angle stays sharp instead of blurring. It needs linear filters; a `nearest` texture ignores it. It was accepted and never applied before.
- d67777c: A shape with a drop shadow, tipped in perspective until part of it nears the eye, no longer fails the frame with "Invalid CommandBuffer". The shadow's blur was measured at the shape's largest magnification (up to 1000×), which grew its layer past the GPU's texture limit. A tilted shape's drop shadow, and a tilted group's `dropShadow` filter, now take their blur and offset from where the shape is seen. No blur, filter or effect layer reaches further past the visible area than a texture can hold.

## 0.1.1-alpha.5

### Patch Changes

- 5edc8b5: - **A conic gradient's `startAngle` rotates it.** The seam (the first stop) sits `startAngle` degrees clockwise from the box's three o'clock and the ramp runs a full turn from there. It used to stay at three o'clock, with the angles before `startAngle` clamped to the first stop and the ramp squeezed into what was left of the turn.
- e0283cc: - **Large, detailed paths scale smoothly.** A `scaleTo` on a map of tens of thousands of points keeps its outlines: one made only of lines is built once for every scale, a curved one built for a larger scale also serves smaller ones, and reaching a new power of two of scale builds only the bands the shader reads. In a 120k-point test map, CPU time per scaling frame went from 42 ms to under 1 ms.
  - **Thin strokes keep their authored width** unless they run round the renderer's own rect or ellipse, or along horizontal and vertical lines only. Those still sit on whole device pixels; any other stroke glides while scaling, where it used to step between 1 and 2 px. A stroke thinner than a device pixel fades with its coverage, where it used to draw 1 px wide.
  - When the geometry cache is full it evicts the least recently used outlines, where it used to drop everything and rebuild the frame.
  - `stats()` reports `banded`, the band sets built in the last frame.
- 0b752d6: - **A 3D texture's `anisotropy` is drawn**: above 1 the sampler filters anisotropically, rounded up to 4x, 8x or 16x (the most WebGPU allows), so a texture seen at a glancing angle stays sharp instead of blurring. It needs linear filters; a `nearest` texture ignores it. It was accepted and never applied before.

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

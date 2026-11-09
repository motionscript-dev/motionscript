# A web-first Rust/wgpu renderer for Motion Script

The engine's renderer. `@motionscript/browser` builds it in, and every surface
(a session's preview, stills and exports) draws through it. This document
holds the design and how each part was built: the 2D core, the text engine
(`ms-text`), images and video, effects and fills, 3D and the engine adapter.

Goal: fast, small, smooth rendering of Motion Script scenes in the browser
and the Electron app, with clean exports. Web only: wgpu compiled to WASM on
the browser's WebGPU backend. No GL, no native targets.

TypeScript stays the authoring and evaluation language. `core` evaluates a
frame (timeline, expressions, layout, component `render`) and hands the
renderer data. Rust is the renderer, not the engine.

---

## 1. Phase plan

| Phase | Scope | Deliverable | Main risk |
|---|---|---|---|
| **0 Foundations** | Retained-scene protocol, backend adapter | A document renders through wgpu; the protocol covers every `GraphicsOp` kind | Protocol shaped by the prototype instead of by core's real op lists |
| **1 2D core** | SDF primitives, paths, paints, strokes/dashes, clips, opacity layers, blend modes, render graph, pooled atlas offscreens, Rgba16Float, dithering | `ms-renderer` draws every non-text `Graphics2D` op | Path anti-aliasing quality on thin strokes |
| **2 Text, images, video** | Shaping and measurement, glyph outlines, variable `wght`, rich runs, text on path, caret/selection, images, WebCodecs video | `measureText`/`layoutTextBlock` served from Rust; text, image and video nodes draw | Measurement, which core's layout depends on |
| **3 Effects and fills** | Port ~45 effects and ~15 fills by priority; WGSL contract for custom shaders; async pipeline compile; in-editor validation | Effect/fill registry in WGSL; a host's shader editor compiles WGSL | User shaders are WGSL only, with no translator (by decision) |
| **4 3D** | Small PBR forward renderer over `core/src/render3d` descriptors, same device | Canvas3D and `Tex.surface` zero-copy | Tone mapping, shadows and env maps (render3d follows three's conventions) |
| **5 Integration** | Worker + OffscreenCanvas, state-keyed render cache, frame-range export, legacy sRGB mode | The engine's only renderer | Size and frame-time budgets |

Out of scope (later): native/server targets, moving the tree, layout or the
evaluator into Rust, compiling commands to tracks, a plugin ABI.

---

## 2. Pass count (2026-10-31)

On tile-based GPUs pass count, not shader cost, dominates. On a generated
scene of 96 dashboard cards (1,973 nodes: gradients, rrect shadows, clips,
paths, dashes, layer opacity, advanced blends, blur and drop-shadow filters)
at 1080p:

1. **First working version: 64 ms/frame.** The executor broke the main pass
   for every layer and every advanced blend: 371 passes, each loading and
   storing a full-screen Rgba16Float attachment.
2. **Render-graph order: 14 ms.** Layers render before their parent's pass, so
   a hardware-blendable composite (normal, plus, screen) draws inside the
   parent pass. Advanced blends no longer read the framebuffer. The renderer
   **re-renders the backdrop region** from the retained ops (culled by op
   bounds) into a small texture. Output is identical, and the main pass never
   breaks.
3. **Atlas batching by nesting level: 1.9 ms, 13 passes.** All layers of the
   same nesting level share atlas pages. Each level costs one backdrop pass,
   one content pass per page and one pass per blur step, however many layers
   it has.

The render graph is the Phase 1 deliverable that matters most.

---

## 3. Phase 0 — Foundations

### 3.1 Retained-scene protocol

TypeScript owns the document; Rust owns a mirror of what it needs to draw.

- **Stable node ids.** Small dense integers assigned by TS (with a free list),
  used directly as the slot index in every Rust column. No hash lookups on the
  hot path. The prototype's ids are the document's node ids.
- **Typed property columns.** One `Vec` per property (`transform`, `size`,
  `radii`, `fill`, `stroke`, `shadows`, `opacity`, `blend`, `clip`, `filter`,
  `path`, …) in `scene.rs`. A delta touches one column entry.
- **Deltas written into WASM memory.** The renderer exposes a word buffer
  (`delta_buffer(minWords)` returns a pointer into linear memory). TS writes
  `opcode, payload…` records straight into it through `Uint32Array`/
  `Float32Array` views, then calls `apply(words)`. One JS→WASM call per flush,
  no serialization, no intermediate arrays. Views are refreshed when memory
  grows (`protocol.ts` handles detachment). A 96-card animated frame is about
  3.3k words (13 KB).
- **Deduplicated tables.** Paints (solid/linear/radial with stops), paths
  (verbs + points) and dash patterns are interned on the TS side (identity
  first, then structural key) and defined once (`DEF_PAINT`, `DEF_PATH`,
  `DEF_DASH`). Nodes refer to them by id. Effects join this table in Phase 3
  (an effect id plus a uniform block).
- **What the real adapter adds.** Core's `Graphics2D` op lists are richer than
  the prototype's node kinds: shape unions painted together, `cut`, inline
  masks, per-group effects. The plan is to map each component render's op list
  to a *subtree* of retained nodes keyed by `(component node id, op index)`, so
  a re-render diffs into deltas instead of rebuilding. Because `render(ctx,
  state)` is a pure function of state (only four places read `ctx.time`), the
  adapter caches the produced subtree by a state hash. An unchanged state
  sends no deltas at all, and the Rust side's frame build is skipped when
  `scene.revision` is unchanged (already in the prototype).

Op set (prototype, `protocol.rs`): `CREATE, DESTROY, CHILDREN, TRANSFORM,
SIZE, RADII, FILL, STROKE, SHADOWS, OPACITY, BLEND, CLIP, FILTER, PATH,
DEF_PAINT, DEF_PATH, DEF_DASH, FREE_PATH, ROOT, VIEWPORT`. Missing for the
real thing: `TEXT_*` (Phase 2), `IMAGE`/`VIDEO` (Phase 2), `EFFECTS` (Phase 3),
`MASK`, `CUT`/union semantics, `FREE_PAINT` with refcounts.

### 3.2 Backend adapter

`web/src/backend-wgpu.ts` is the seam: `init, resize, sync(doc), render,
waitGpu, readPixels, stats, destroy`. `sync` consumes the document's dirty
masks and writes only what changed. In the engine, `WgpuRenderContext` (§8.0)
is the `RenderContext2D` that records into the document instead of drawing.

---

## 4. Phase 1 — 2D core

All of this exists in the prototype unless marked *(todo)*. Status
2026-10-31: **Phase 1 is done.** Every non-text `Graphics2D` capability is
in. There's no MSAA and no stencil. What's left are optional performance
levers (§4.5).

### 4.1 Frame build (CPU, `frame.rs`)

Two passes over the retained tree per changed frame:

1. **measure**: world transforms top-down, device AABBs bottom-up (stroke,
   shadow and filter reach included, clips intersected).
2. **emit**: cull against the current cull rect (viewport ∩ clip AABBs, pushed
   outward by blur reach inside filtered layers). Decide layers, then append
   instances and ops to the current target's op list. Each op carries device
   bounds for region replay.

Layer rules: a group needs a layer for opacity < 1 (unless it holds exactly
one single-paint leaf, where the opacity folds into the paint alpha), a
non-normal blend, or a filter. A leaf with a non-normal blend is isolated in a
layer, so the shape blends as a unit. Leaf opacity multiplies each paint's
alpha.

Cost today: 0.2 ms for 2k nodes.

**Reuse of unchanged subtrees** (2026-11-02). `protocol::apply` keeps parent
pointers and a per-node subtree revision (a change marks the node and its
ancestors). Paint/path/dash *re*definitions, root and viewport changes, font
registration, a geometry arena reset and `invalidate()` flush everything; a
node listed by two parents over its life flushes on any change under it.
- *measure* returns a node's stored bounds when its subtree is unchanged and
  its parent transform is bit-identical to the last measure.
- *emit*: a group unchanged and unmoved since the previous build records what
  it emits (prims, its ops in the entry target, its own targets, layers,
  clips). While the subtree, world transform, cull rect and alpha stay the
  same, later builds replay the record with indices relocated (prims, ops,
  targets, layers, clip refs, backdrop prefixes) instead of walking it.
  Records sit at the frontier between changed and unchanged parts, so a
  scene where a few nodes move reuses the rest. A record seals the prim run
  at its start and the replay re-merges it, so the op stream is the one a
  full build makes. Subtrees with effects are never recorded (not all their
  inputs are tracked per node).
- *upload*: a replayed record placed at the same prim index, with the same
  clip relocation as in the previous build, is already on the GPU, so only
  the other ranges are written. A frame rendered again without a rebuild
  uploads no prims.

Measured: 1,536 cards with 1 in 16 animated, 13.1 → 7.8 ms CPU (build 1.1 ms,
94% of prims reused and not re-uploaded). When every card moves (every
world transform changes) nothing is reused.

### 4.2 Primitives and paths (`prim.wgsl`, `paths.rs`)

- **Instanced SDF primitives**: one quad per instance, no vertex buffer; the
  instance (112 bytes) is read from a storage buffer by `instance_index`.
  Kinds: rect/rrect (per-corner radii), ellipse, their strokes (outer minus
  inner coverage, so a 0-radius rect keeps miter corners), and rrect gaussian
  shadows (closed-form, after Evan Wallace, with spread). Coverage is analytic
  (`fwidth` of the local position), so these are AA without help from MSAA.
- **Paths have analytic coverage.** Every path draw becomes a *filled
  outline*: fills, strokes and dashes alike. Strokes and dashes turn into
  outlines through kurbo (joins, caps, miter limit, dash phase). The outline is
  flattened in local space into line segments, grouped into horizontal bands
  that overlap by just over one device pixel. A path draws as one quad over its
  bounds. The fragment shader takes the segments of the pixel's band and
  computes the exact signed area of the pixel footprint (`fwidth` box) covered
  by the outline, then applies non-zero or even-odd. Result: 256-level edges
  under any transform, with no tessellation. An animated transform reuses the
  cached outline. Cache key = path id + version (or compound hash), style, and
  a zoom bucket (log2 of device scale) that picks the flattening tolerance and
  band margin.
  - The per-segment integral splits at the ramp ends and averages the linear
    pieces. An antiderivative form lost precision on near-vertical segments
    (several percent of leaked coverage on the GPU); a CPU port of the shader
    in `coverage_test.rs` guards it.
  - Band count: ~8 segments per band, bands at least four margins tall,
    segment copies capped at 8× (2026-11-02; was ≤ 32 bands). A full-screen
    stroke of 11k segments (e2e `math-vector-field`) at 4K went 78 → 31 ms.
    What's left is rows: y-bands can't split a row of many shapes across the
    width; that needs x-tiles with a per-tile backdrop winding.
  - Cost: per-pixel work is proportional to segments per band. GPU time on the
    cards scene went from 1.9 to 2.6 ms at 1080p against MSAA'd triangles. That
    buys exact edge quality and drops lyon: WASM went 145 → 127 KB gz before
    booleans.
- **Shape unions and cuts** (`Graphics2D` shapes painted together, `cut`): a
  *compound* node lists members applied in order, each unioned with the
  result so far or cut out of it. Each member is normalised under its own fill
  rule, then combined non-zero with `i_overlay`. That's exact booleans, cached
  by a hash of the members, so they only recompute on change. Fill and stroke
  both use the boolean outline, so a stroked union traces its real outline.
  The cost is +85 KB gz of WASM (now 211 KB gz). The shader also supports a
  second subtracted band set (exact one-level cut without booleans); unused
  for now.
- **Paints**: solid, linear, radial and sweep, with clamp/repeat/mirror/decal
  tiling. Stops sit in a storage buffer and interpolate unpremultiplied in
  sRGB, then convert to the working space. *(Phase 2)* image paints.
- **Batching**: SDF primitives and path quads share one pipeline, so
  consecutive draws of either kind merge into one instanced draw.

### 4.3 Clips and masks

**Clips are coverage masks** (rounded rect or any path, nested). Each clip
gets a region: its device bounds ∩ the cull rect. A first pass renders every
region into an R8 clip atlas (a texture array, one layer per page). Each texel
is the product of the clip shape's analytic coverage and its ancestors',
evaluated at the texel's device position through the inverse of each shape's
transform: one quad per clip, all clips in one instanced draw per layer.
Primitives carry their clip index and multiply by the mask at their device
pixel. Composites do the same, and advanced-blend composites mix back toward
the backdrop. Content inside a layer is not clipped by clips outside it (the
composite is), which avoids squaring clip-edge coverage.

This replaced a stencil + 4x MSAA scheme (`sample_mask` from coverage). It
needed two draws per clip, broke instance runs, and MSAA pages cost ~130 MB.
Removing it cut the 96-card frame from 981 to 714 draws and 1.8 to 1.2 ms of
CPU, and the 31k-node frame from 24 to 9.9 ms.

**Masks**: a group with a mask mode (alpha, luminance, inverted alpha,
inverted luminance) uses its first child as the mask. The mask renders into
its own layer with the content layer's rect, and the composite shader
multiplies it in. With a filter on the same group, the mask applies inside
(an extra layer) and the filter to the masked result. The level scheduler
treats a mask as a dependency of whatever composites the masked layer.

**Shadows**: rrects and circles keep the closed-form shadow. Paths, compounds
and non-circular ellipses render their silhouette into a shadow-only layer,
dilated by the spread (a round-joined stroke of width 2×spread unioned with
the fill). The layer's blurred, tinted, offset copy is composited before the
shape, with the same blur passes as the drop-shadow filter.

### 4.4 Render graph and offscreens (`gpu.rs`)

The frame program is a tree of targets: target 0 is the canvas, and each layer
adds one. Execution by **nesting level** (a layer with no layers inside is
level 0):

1. **Backdrop passes.** For every advanced-blend composite at this level,
   replay the parent target's ops before it, culled to the layer rect, into an
   atlas region. A job whose rect overlaps an earlier advanced composite in the
   same target waits for a later wave, because its replay draws that
   composite.
2. **Content passes.** Every layer of the level, shelf-packed into 2048² atlas
   pages with a 2 px transparent gutter. One MSAA pass per page with a
   per-region viewport, scissor and viewport uniform.
3. **Filter passes.** For blur/drop shadow: 2x downsample steps while σ > 4,
   then horizontal, then vertical. Each step is one pass for all filtered
   layers of the level. The compositor's bilinear sample upsamples.
4. **Canvas.** Its backdrops, then a single pass replaying target 0, with
   composites drawing atlas regions in place (fixed-function blend for
   normal/plus/screen, a shader blend reading the backdrop region for the other
   13 W3C modes).
5. **Blit** to the canvas texture (or an RGBA8 readback texture): sRGB encode
   in linear mode, triangular dither of one 8-bit step.
   Nothing reads the canvas target (backdrops replay its ops), so in legacy
   sRGB mode without dither step 4 draws straight into the 8-bit output
   instead (a second pipeline set per output format) and there is no blit:
   −0.7 ms at 4K. The engine surface runs this way (§8.0).

Offscreens come from a pool keyed by class (MSAA colour, single-sample,
stencil) with best-fit reuse (≤ 4× area waste). Textures are released back
the moment their last reader is recorded and destroyed after 30 idle frames.
MSAA and stencil attachments of the pass that is about to run are released
immediately, since the encoder orders later reuse after the pass.

Working format **Rgba16Float**, single-sample (all coverage is analytic).
Two blending modes:
- **legacy sRGB**: colours stay sRGB-encoded and blend there. This is the
  default, so stored documents keep their look.
- **linear**: colours converted to linear light, blended, and encoded on the
  blit. Better gradients and AA, different look; opt-in.

Rgba16Float stores 0.1 as 0.09998, so a flat colour drawn through an
intermediate target can land one 8-bit step off its authored value.

### 4.5 Risks and decisions for Phase 1

- **Path AA quality: done.** Analytic coverage (above). On a tile of 0.5–2 px
  strokes, total coverage is 3,627 px² against 3,635 expected.
- **Dashes on boolean results** start wherever i_overlay starts its contours,
  so the dash phase of a stroked union follows that contour order. Accepted,
  and documented for template authors.
- **Very large scenes.** At 31k nodes (1,926 layers, 10.9k draws): 3.5 ms of
  frame build, 5 ms of encode. Composite bind groups are cached across frames
  (atlas pages persist). Next levers: instanced composites (one draw per run
  of composites from the same page) and dirty-subtree frame builds.

### 4.5.1 Projective (3×3) transforms (2026-11-02)

The engine's 2.5D space hands a node a Matrix2D with a perspective row
(`state.matrix` g h i), concatenated as a 3×3. Core does the space's
sorting, backface culling and near-plane cut (a local clip polygon), so the
renderer only has to draw through the projective CTM.

- **Doc and protocol.** `Node.transform` is `Mat` (six numbers, the fast
  path) or `Mat3` (plus g h i). `TRANSFORM3` (op 19) carries nine floats and
  is only written when the row isn't 0 0 1. `Scene::transform` is `[f32; 9]`.
- **Frame build.** `mul` composes 3×3s (with an affine fast path), and
  `map_rect` cuts a local rect at w ≥ 1e-3 before projecting, so bounds,
  culls, layer rects and clip rects stay finite. Under perspective the scale
  varies across a shape, so each leaf records the (max, min) Jacobian scale
  over its local bounds. Max drives the flattening zoom bucket and min the
  AA fringe. A projective group's device-space filters take the scale at
  its bounds' centre.
- **Prims.** Instances stay 128 bytes. A 144-byte stride cost ~2% on the
  cards scene, so a projective prim is flagged in `info.x` (bit 8) and
  carries g h i in a slot its kind leaves unused: `rect.xyz` for paths,
  f32 bits in `ext.xyz` for the analytic kinds. Affine prims are
  byte-identical to before. The vertex shader
  emits the homogeneous position (x·w, y·w, 0, w). The rasteriser then
  interpolates `local` perspective-correctly, so coverage and paints are
  evaluated in local space through the inverse map per pixel, and it clips
  each quad where it crosses w = 0. Path bands keep `fwidth(local)`, which is
  already the screen-space derivative. Rrects and ellipses on projective
  prims take the AA width from the distance's screen gradient: the local
  normal through (dpdx, dpdy), since isotropic `fwidth` overblurs
  foreshortened edges. The clip-mask pass inverts the homography per texel
  and uses its Jacobian.
- **Residual.** A projective layer's image filter runs in device space at one
  scale, not in the layer's local space, so a strong blur under a steep tilt
  doesn't foreshorten. Doing it properly means layers in local space
  composited through a homography (executor work).

---

## 5. Phase 2 — Text, images, video

Text is built (`crates/text`, package `ms-text`, 2026-10-31), and so are
images and video (§5.6).

### 5.1 The contract core depends on

Core asks the renderer two questions about text, and its flow layout and
caret model are built on the answers. ms-text answers both
(`web/src/engine/text.ts`), with the same engine that draws the glyphs.

**`measureText(text, fontSize, fontFamily, fontWeight = 400, letterSpacing = 0,
fontStyle = 'normal') → { width, height }`** (`MeasureContext2D`).
- One unwrapped run, centred, `heightMultiplier` 1. `width` is the paragraph's
  longest line (trailing whitespace excluded), `height` its height (with a
  multiplier of 1 that's `round(fontSize)`). Empty text is 0 × 0.
- Readers: `measureGlyphs` in `components/builtins/text/text-layout.ts`
  (intrinsic width per hard line, styled runs summed per line, plus its own
  word-by-word wrap prediction in `countWrappedLines`/`wrappedLineSizes`),
  `measureRich` (per span per hard line), and `factory/views.ts`. Core
  computes heights itself as `fontSize × lineHeight` per line. It reads only
  the width for layout, so width is what must hold.

**`layoutTextBlock(state: Partial<TextState>) → TextBlockLayout | null`**
(`TextBlockSource`, `render/text-layout.ts`).
- `{ lines: { start, end, top, bottom, carets[] }[], width, height }`.
- `start`/`end` are UTF-16 offsets (JS string indices). A soft-wrapped line
  keeps its trailing spaces; a hard break belongs to neither line. An
  empty line after a trailing `\n` is its own line.
- `top`/`bottom` are the line box (baseline − ascent, baseline + descent),
  block-local: origin at the block's centre, y down. The paragraph is shifted
  by `(−layoutWidth / 2, −height / 2 + verticalOffset)`, where
  `verticalOffset` is `(height − boxHeight) / 2` for `top`,
  `(boxHeight − height) / 2` for `bottom`, 0 otherwise or without a box.
- `carets` has `end − start + 1` x positions: the leading edge of each
  character's tight rect, then the trailing edge of the last one. An empty
  line's single caret is the line's aligned left edge.
- `width` is the longest line, `height` the sum of line boxes.
- `null` for text on a path and for segments with a transform. Empty text
  lays out a stand-in `"M"` and keeps one zero-width slot of its height.
- Readers: `runtime/text-geometry.ts` (`nodeTextLayout`, `caretOffsetAt`,
  `caretRangeQuads`), which lift it into viewport space for the editor.

**State fields that drive shaping** (`TextState`, `RichTextState`,
`TextSegment`):

| Field | Meaning in layout |
|---|---|
| `text` | Already cased by core (`textCase` never reaches the renderer). |
| `fontFamily` | Face lookup in the registered fonts (the `loadFont` alias). |
| `fontWeight` | Picks the nearest face (CSS matching) **and** sets the `wght` axis of a variable face. |
| `fontStyle` | Face matching only (no synthetic slant). |
| `fontSize` | px; `'autofit'` probes an unwrapped layout at 100 px and scales to the box (`min(w/probeW, h/probeH)`); with `wrap`, stops at `minFontSize` and wraps instead. |
| `letterSpacing` | px added after every cluster, the last one included. |
| `lineHeight` | 0 = the font's own ascent + descent; otherwise each run's ascent and descent are rescaled to sum to `lineHeight × size`. `RichText` defaults to 1.2, `Text` to 0. |
| `textAlign` | left/right/center/justify/start/end against the layout width (LTR only, so start = left). |
| `wrap`, `width` | Wrap at `width` when `wrap && width > 0`. Unwrapped, the layout width is `max(ceil(maxIntrinsic) + 1, width)`, so alignment anchors inside the box. |
| `height`, `verticalAlign` | Only the vertical shift above. |
| `segments` / `spans` | Rich runs: `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `letterSpacing` per run, one paragraph. |
| `path` | Text on a path (§5.4). |

Not shaping inputs: fill, stroke, opacity, the segment transform,
`textDecoration` (the renderer draws the rect from the face's
underline/strikeout metrics, which ms-text exposes), `variant` and the
reveal window (core resolves both into segments).

**Line layout rules** (`crates/text/src/layout.rs`):
- Shaping with HarfBuzz at a 16.16 font scale. Adjacent runs with the same
  face, size and weight are shaped together, so kerning crosses them.
- Greedy wrapping at UAX #14 opportunities. Trailing whitespace hangs past
  the width and isn't part of the line width. A word wider than the line
  breaks between clusters.
- Line box: the tallest ascent and descent on the line, height **rounded to
  whole pixels**, with the rounding put above the baseline
  (`baseline = lineTop + round(a + d) − d`).
- Justify spreads the slack over whitespace patches, on every line but the
  last of each paragraph. The longest-line width is taken before justify.
- Variable fonts: advances follow FreeType's arithmetic, which runs `avar`
  and `HVAR` in 16.16 and rounds the varied advance to whole font units.
  HarfBuzz and read-fonts normalize to 2.14, which flips the rounding near a
  half unit (Inter "g" at `wght` 650: 545.5013 vs 545.4996 units, so 546 vs
  545). `crates/text/src/varied.rs` redoes FreeType's arithmetic, so advances
  hold at any weight, not only at named instances.

`cargo test -p ms-text` (`crates/text/tests/parity.rs`) holds layout,
measurement and outlines to recorded reference numbers
(`tests/oracle.json`, for the 33 cases in `cases.json`: the engine's text e2e
scenes restated as paragraphs, plus edge cases), so stored documents keep
laying out the same.

### 5.2 Stack choice

Three stacks were tried on those 33 cases: `parley` 0.12, `cosmic-text` 0.19,
and harfrust 0.15 + read-fonts 0.46 + unicode-linebreak with our own line
breaker. parley doesn't break inside an over-long word and cosmic-text drops
the empty line after a trailing `\n`; both justify differently, both use
2.14 variation coordinates (§5.1), and neither rounds line boxes as §5.1
does, so caret `top`/`bottom` would drift a fraction of a pixel per line.
Using either would mean reimplementing the line breaker on top of it anyway.

**Choice: harfrust + read-fonts + unicode-linebreak with our own line
breaker.** It's the only option that meets §5.1, it's as fast as parley
(0.42 ms native for the 33 cases), and it has the fewest dependencies (no ICU
data, no fontique/fontdb, no swash). read-fonts' font model also gives
outlines, metrics and variation instances, so skrifa isn't needed. Its size
is no better than the others: harfrust is ~420 KB of raw code (every OpenType
shaper plus AAT), read-fonts ~390 KB (the font model reaches CFF, Type 1 and
color glyph code through dynamic dispatch). The optimization level of the
three text crates trades size for speed; full API with wasm-bindgen glue,
WASM layout time for all 33 cases:

| `opt-level` | raw | gzip -9 | layout, 33 cases |
|---|---:|---:|---:|
| 3 | 1.19 MB | 427 KB | 0.59 ms |
| **"s" (chosen)** | 1.03 MB | **374 KB** | 0.83 ms |
| "z" | 0.98 MB | 356 KB | 1.30 ms |

"s" is set per package in the workspace `Cargo.toml`. It costs 0.24 ms
across 33 paragraphs.

Ways to cut size later, if the 1.5 MB gz Phase 5 budget gets tight: a
read-fonts feature to drop Type 1/CFF/COLR from the model (upstream), or
harfrust without AAT.

### 5.3 `ms-text` API

Rust, no wgpu, wasm32 and native. `TextEngine` holds the font store and a
reusable layouter.

- **Fonts.** `register_font(bytes, family) → FontId` reads weight, slant and
  the `wght` range from the font. `fonts.set_family_fallbacks(family, &[FontId])`
  and `set_default_fallbacks(&[FontId])` cover characters the matched face
  lacks. `fonts.match_face(family, weight, slant)` does CSS weight matching.
  `fonts.metrics(id, weight)` gives ascent, descent, leading and the
  underline/strikeout position and thickness, at a weight.
- **Layout.** `layout(&Paragraph) → ParagraphLayout`. A `Paragraph` is
  rich runs `{ text, style: { family, size, weight, slant, letter_spacing } }`
  plus `line_height`, `align`, `max_width` and `box_width`. The result has
  `layout_width`, `width`, `height`, `max_intrinsic`, lines
  `{ start, end, top, bottom, baseline, ascent, descent, left, width, carets }`
  and glyph runs `{ line, run, font, size, wght, glyphs: { id, x, y, advance,
  cluster } }`, in paragraph space (top-left origin, y down). A glyph run is
  one face, size and weight from one source run: one draw with one paint.
- **Core's contract.** `measure_text(text, size, family, weight,
  letter_spacing, slant) → (w, h)` and
  `text_block_layout(&TextBlockState) → Option<TextBlockLayout>`, which
  includes autofit (`resolve_shaping`), `verticalAlign` and the empty-text
  probe. `resolved_paragraph(&state)` is the paragraph to draw, and
  `block_shift(&layout, box_height, valign)` moves paragraph space to
  block-local space.
- **Outlines.** `fonts.glyph_path(font, glyph, size, weight) → GlyphPath { verbs,
  points }`: verbs `0 move, 1 line, 2 quad, 3 cubic, 4 close`, points `[f32; 2]`
  in px, y down, pen origin on the baseline. That's `OP_DEF_PATH`'s encoding,
  so a glyph can be a cached path drawn at each glyph's position. Unhinted
  and drawn in font units then scaled.
- **Text on a path.** `place_on_path(&layout, &Polyline, align) →
  Vec<PlacedGlyph { id, x, y, angle, half_advance, run }>`, with
  `matrix()` = `translate(x, y) · rotate(angle) · translate(−half_advance, 0)`.
  Unwrapped left-aligned shaping, offset by alignment against the path
  length, each glyph centred at the arc length of its advance midpoint,
  raised by its baseline offset, and dropped past either end. `Polyline`
  measures a flattened path's contours end to end, like core's `PathSampler`.
  The caller collapses whitespace around newlines.
- **WASM.** Feature `wasm` adds a wasm-bindgen `MsText` class with flat
  `Float32Array` results (`crates/text/src/wasm.rs`), built by
  `scripts/build-wasm-text.sh` into `web/pkg-text`.

Indices in the output are UTF-16 offsets, so they line up with JS strings.

Not covered yet:
- **Bidi / RTL.** Not modelled, as in core's caret model (v1 is LTR).
  Shaping is LTR only.
- **Complex scripts and emoji.** harfrust shapes them, but no case covers
  them, and line breaking is UAX #14 only (no dictionary breaking for
  Thai/CJK).
- **Fallback.** The e2e harness registers no fallback faces, so a missing
  glyph is `.notdef`; ms-text's fallback lists are untested.
- **Italic faces.** The e2e harness registers only upright Inter, so an
  italic run shapes upright. Registering an italic face works (matching
  prefers it), but no case covers it.

### 5.4 Glyph rendering (built 2026-11-01)

ms-text is a dependency of the renderer crate, so text is part of the
retained scene:

- **Protocol.** `OP_TEXT` carries a node's `TextBlockState` (runs with family,
  size, weight, slant and letter spacing; align, vertical align, wrap, width,
  height, line height). Strings travel as length-prefixed UTF-8 packed into
  words. Fonts come in through `register_font(bytes, family)` on the renderer.
  `measure_text` and `text_block_layout(node)` answer core's two questions
  from the same engine.
- **Layout** runs in the frame builder and is cached per node by state
  revision (`resolved_paragraph` → `layout` → `block_shift`). A text node's
  local space is block-local (centred, as core draws text).
- **Glyphs are paths.** Each glyph's outline (`glyph_path` at its size and
  `wght`) goes through the analytic-coverage pipeline and is cached per
  (font, glyph, size, weight, zoom bucket). Each glyph is one instance placed
  by a translation, so a whole paragraph is one instanced draw alongside
  other shapes. Stroked text strokes each glyph outline with kurbo. Shadows
  use the shadow-layer path, with silhouette = glyph fills plus a 2×spread
  stroke.
- **Paint space.** Paths carry an offset (`radii.xy`) added before paint
  evaluation, so a gradient fill spans the whole block, not each run.
- **Placement.** Glyphs sit exactly where layout puts them, with no pixel
  snapping, so slowly moving or scaling text glides instead of stepping a
  pixel at a time.
- **Decorations**: underline and line-through are one rect per glyph run,
  from the font's metrics with trailing whitespace excluded, painted with the
  run's paint.
- **Text on a path**: `place_on_path` (one unwrapped line, newlines as
  spaces), with each glyph drawn at its placement matrix. The path is
  flattened by kurbo and re-placed when the path's version changes.
- **Autofit**: `fontSize: "autofit"` with `minFontSize` runs through ms-text's
  `resolve_shaping` (§5.1).

Outlines are exact and unhinted, as Figma and motion tools draw them (§5.7).

### 5.5 Integration notes

- The main-thread instance answers `measureText`/`layoutTextBlock`
  synchronously (§8). Font bytes are registered on both instances, keyed by
  the same ids.
- ms-text layouts are plain values, so shaped paragraphs can be cached by a
  key of text plus every shaping input on the TS or Rust side.
- `layoutTextBlock` is uncached: an editor asks for one node at a time.

### 5.6 Images and video (built 2026-11-01)

Images are **paints**: any shape, path, compound or glyph can be filled with
an image or a video frame.

- **Paint**: kind 4 carries a local → normalized-uv matrix and the image id.
  The TS side (`computeImageMatrix`, `adapter/geometry/image-matrix.ts`)
  resolves the fill's fit mode into that matrix: fill = cover centred, fit =
  contain centred and decal, stretch, tile = natural size, repeating. The
  shader samples with `textureSampleGrad`, using derivatives taken in uniform
  control flow, so mip selection works inside the paint switch. Values are
  stored premultiplied and handed back straight. Clamp, mirror and decal are
  applied to uv; repeat is done by the sampler, so tiles wrap without seams.
- **Upload**: `upload_image(id, source, mipmaps)` takes an `ImageBitmap`,
  `VideoFrame`, image or video element, or canvas. It's a GPU copy
  (`copyExternalImageToTexture`, no readback) into an Rgba8Unorm texture,
  plus a box-filtered mip chain for stills. Video frames re-upload into the
  same texture and have no mip chain.
- **Batching**: a draw run carries the image its paint samples (group(1) of
  the shape pipeline). Runs split where the image changes; everything else
  batches as before.
- **Video colour**: Chrome's WebGPU external-image copy also converts the
  BT.709 transfer curve to sRGB, which lifts darks and mids by up to 10/255.
  Canvas 2D and players apply the YUV matrix only (checked against a by-hand
  BT.709 limited-range conversion of the decoded NV12 planes: canvas 2D
  within ±1, the WebGPU copy up to +10). So frames go through a GPU-backed 2D
  canvas first, still with no readback. Revisit with `importExternalTexture`
  plus an explicit conversion in Phase 5.

### 5.7 Decision: exact, unhinted text (2026-11-01)

Text is drawn with exact coverage, not hinted. That's how Figma and
motion/video tools draw text: unhinted outlines, so glyphs look the same at
every zoom, scale and sub-pixel position, and animated text doesn't shimmer
or step. Small static text is softer than hinted text: stems aren't snapped
to the pixel grid and small light-on-dark text gets no coverage boost. A
crisper hinted mode for tiny static UI text could be added later as an
option, never the default for exports.

## 6. Phase 3 — Effects and fills (design)

- **One WGSL contract** for fills and effects, a header in front of the
  author's code (as built, §6.3).
- **Porting order** by use in templates and e2e. Blur, shadow and glow first
  (the filter path exists), then colour adjustments, then distortion/noise
  families, then the rest. Each port is files of its own
  (docs-effects-porting.md), so effects can be ported in parallel.
- **WGSL only** (decision 2026-11-02, `packages/renderer/docs/why.md#user-shaders-are-wgsl-sksl-loads-but-does-not-draw`): user shaders
  are written in WGSL against the contract below, with no translator from
  another language. A shader stored with `language: "sksl"` draws nothing and
  gets a `shader` render issue telling the author to port it to WGSL (§6.3).

### 6.1 Procedural fills (built, 2026-11-02)

The engine's five procedural fills are **paint kinds 5–9** in `prim.wgsl`
(`procedural()`), so they draw in the same batch as every other shape, on
rects, ellipses, paths and text alike:

| kind | fill | how it draws |
|---|---|---|
| 5 | dotGrid | analytic dots; feather = one device px in local px (from derivatives) |
| 6 | grid | analytic lines |
| 7 | stripe | analytic gap×gap tile texels, bilinear repeat, rotated; the tile is filtered **unpremultiplied** then premultiplied, so colour and alpha both interpolate (half coverage → ¼ colour plus a faint dark fringe) |
| 8 | noise | a gap×gap tile from an integer hash in u32 wrap arithmetic, nearest repeat |
| 9 | fractalNoise | value/simplex/ridged/worley, ≤8 octaves, ≤8 stops; basis and octaves as uniforms |

Parameters ride in the paint's stop slots as raw vec4s (fractal noise's colour
ramp follows them). The TS doc takes the core-resolved fill object
(`{ kind: "procedural", fill, box }`) and `backend-wgpu.ts` packs its
uniforms. Adding the code to the uber-shader did not measurably slow ordinary
shapes.

The **shader fill** (a user shader) is paint kind 10 (§6.3).

### 6.2 Backdrop effects (built, 2026-11-02)

`mode: "backdrop"` effects on a leaf (rect, ellipse, path, compound): what
lies beneath the shape goes through the effects and is composited back
through the shape's silhouette, before the shape draws. No framebuffer read:
a **backdrop layer** (`Layer::backdrop`) replays its parent's ops before it —
the advanced-blend backdrop mechanism — over the shape's bounds grown by the
effects' reach, then runs its effect chain like any layer and composites
through a clip whose primitive is the shape's own fill geometry. Over the
canvas the replay starts from the clear colour. Its level is one above
whatever its replayed ops composite.

Effects carry `flags` bit 1 (backdrop) and bit 2 (filter surface). With
filters present, each lens (shader effect) reads the **raw** backdrop and
paints over the filtered one: one layer per lens sharing the filter layer's
prefix. Without filters, lenses chain. Magnify is backdrop only. A backdrop
filter measures in the node's full device scale, as a foreground filter does.

**Groups and text** (2026-11-02). The silhouette is a shape's fill outline or
a **group's clip** (rounded rect or path); a group without a clip has none.
**Text has none either**, so a backdrop effect on text is a no-op. The
group's backdrop layer is emitted before the group's own layer, as for a
leaf.

**Glass** (2026-11-02, `glass.wgsl`, both the 7-tap dispersive and the plain
variant; backdrop only). It needs a new render input, the node outline's
**inside distance field**: `field(p)` (device px to the outline, 0 outside)
and `max_distance()` in the effect header, asked for by the packer's
`field: true` (effect flags bit 3), bound at effect binding 6. Frost is the
existing `blurred()` input (sampled clamped).

The field is built on the CPU (`field.rs`): control-point bounds padded by 2,
2× raster below 400k device px, coarser above 1.5M, Felzenszwalb–Huttenlocher
transform, σ·Φ⁻¹ edge refinement, medial-axis softening, half-float upload
(R16Float, bilinear, decal), LRU of 16 keyed by outline and the linear part
of the matrix to five decimals, so a moving node reuses its field. The raster
is exact-area AA (font-rs accumulation). Chosen over jump flooding on the
GPU, which quantises the edge to the pixel grid and needs a different
refinement for glass's normals and `maxDistance`; the cost is ≈23 ms native
for a 4K 360×240 tile, once per outline and scale/rotation.

A **rounded rect or circle** (a rect node, a group's rounded clip, or a path that
traces one, as a drawing API's `roundRect` arrives) under a matrix that keeps
shapes (rotation, uniform scale, the y-up mirror) skips the raster, transform
and edge refinement (2026-11-03): its inside distance is exact in closed form,
which those steps approximate, and only the softening runs. A glass panel that
grows or springs misses the cache every frame; Glass UI's 1000 px button went
from 26 ms to about 8 ms a frame in the browser, the fields within 0.1–0.4 px
on average of the long way (`shape_fields_match_the_long_way`).

### 6.3 User shaders (WGSL, built 2026-11-02)

**The contract.** What the author's code sees (`user_shader.rs` holds the
real header; `WGSL_PRELUDE` in `engine/shader-preview.ts` is the version an
editor shows):

```wgsl
// fills
struct FillIn { uv: vec2f, local: vec2f, size: vec2f, time: f32, scale: f32 }
fn sample_texture(uv: vec2f) -> vec4f   // the fill's first texture, premultiplied
fn fill(in: FillIn) -> vec4f            // the author's: premultiplied, no opacity
// effects
struct EffectIn { uv: vec2f, px: vec2f, local: vec2f, size: vec2f, time: f32, scale: f32, node: vec2f, node_size: vec2f }
fn sample_src(uv: vec2f) -> vec4f       // the input at box uv (clamped)
fn sample_src_px(px: vec2f) -> vec4f    // the same at device px
fn effect(in: EffectIn) -> vec4f        // the author's: premultiplied
// both
var<uniform> u: Params;                 // the author's own `struct Params`
```

`uv`/`local`/`size` are the fill box or the node's box (logical px), `px`
device px, `time` the node's elapsed seconds, `scale` device px per logical
px. An effect's box is the node's upright device bounds; `node`/`node_size`
are the node's own box (`Layer::node_frame`, the inverse transform), which
turns and scales with it. An effect's input is the node's layer, or the backdrop in backdrop mode;
its output replaces the input unless the effect has a `blendMode`. `reach`
(logical px) grows the layer the effect reads and writes.

**Assembly** (`user_shader.rs`). The author's code goes last, after the
header and the renderer's own code: for a fill all of `prim.wgsl`, whose
`user_paint` stub (paint kind 10) is replaced by a bridge that builds `FillIn`
and calls `fill()`; for an effect the built-in effect header plus a bridge
from its `effect(p)` entry to the author's `effect(in)`. Every module-scope
name in the renderer's code is renamed `ms_<name>` by a token pass, so an
author's `cov`, `value_noise` or `src` can't collide. `struct Params { ms_unused: f32 }`
stands in when the author declares none.

**Validation and reflection.** naga (`wgsl-in`, `opt-level = "s"`; it adds
0.33 MB gz, 0.74 → 1.06 MB) parses and validates the whole module; spans in
the author's part map to 1-based line and column in their source, anything
else is reported at line 0. Reflection finds `u` and lays out each `Params`
member (offset, scalar kind, components, elements and stride, so `vec3f`
padding, matrices and `array<vec4f, N>` pack right). `Params` ≤ 512 bytes:
one uniform arena slot. `validate_shader` (free function) and
`Renderer::shader_add` return the same JSON report.

**Loop budget (2026-11-06).** An endless loop would hang the GPU until the
driver resets the device, and the device is shared by every surface on the
page. After validation the token pass opens every `loop`, `for` and `while`
body in the author's code with `if ms_loop_spent >= 16384u { break; }
ms_loop_spent += 1u;` (same line, so line numbers hold), against one
`var<private>` counter: per invocation and shared by every loop and helper,
so nested loops add up rather than multiply (`LOOP_BUDGET`). WGSL treats a
private variable as non-uniform, so the guarded module (what the GPU
compiles, and `wgsl` in the report) opens with
`diagnostic(off, derivative_uniformity);`; the author's unguarded code is the
one naga reports diagnostics on, and the guarded one is validated again. A
browser compile, or its pipelines, that takes over 10 s fails the program
(`user-shaders.ts`), so an export's wait on shaders is bounded too.

**Compile** (`web/src/user-shaders.ts`). One `UserShaders` per device keeps
programs by scope and source (LRU of 64). `shader_add` validates and creates
the wgpu module; then, asynchronously, the browser compiles the same WGSL
(`getCompilationInfo()`: its messages are kept for the editor, an error fails
the program) and the pipelines with `createRenderPipelineAsync` from
descriptors mirroring gpu.rs's, after which `shader_build` creates wgpu's own
pipelines from the same descriptors — served from the browser's pipeline
cache — and the program draws from the next frame. A frame never waits:
until then a fill's prims are skipped and an effect's layer passes through.
`whenShadersReady()` settles once nothing is compiling; the engine surface
registers it with the storage adapter's `warmPendingDecodes`, so
`renderSettled` (export, settled seeks) draws again once compiles finish.

**Drawing.** A fill is paint kind 10 (geom = box, color = time, texture,
program; its stops carry the `Params` words). `PaintTable::images` gives each
user paint its own batch key (`USER_FILL | paint`), so a run of its prims is
drawn on its own with the program's pipeline (work format, plus one per
direct output format), its texture at group(1) and its `Params` pushed into
the uniform arena at group(2). Because the fill lives in the shape pipeline it
draws on rects, ellipses, paths, strokes, shadows and text alike. An effect is
`OP_EFFECTS` index `USER_EFFECT + program` (gpu.rs): the effect executor runs
it like a built-in, its params being the blend (+1) and then the `Params`
words, bound at group(1).

**Other languages.** A fill or effect stored with `language: "sksl"` (the
value an old document's migration stamps) is never compiled: the fill draws
nothing, the effect is skipped, and the surface reports a `shader` render
issue asking for a WGSL port (`SKSL_FILL`/`SKSL_EFFECT` in `user-shaders.ts`).

**Checks.** The e2e shader scenes (`fill-shader-custom`,
`effect-shader-custom`, `effect-shader-named`, `effect-shader-backdrop`, and
the shader fills on a stroke and a shadow in `stroke-media-fill` and
`shadow-media-fill`) are WGSL. `cargo test user_shader` covers assembly, name
isolation, reflection and diagnostic positions.

## 7. Phase 4 — 3D (design)

A small forward renderer over `core/src/render3d` descriptors, in the same
`wgpu::Device`: metallic-roughness PBR, one shadowed directional light plus
punctual lights, image-based lighting from a prefiltered environment, ACES or
AgX tone mapping by three's formulas, MSAA. Canvas3D renders to a texture
that the 2D graph composites directly. `Tex.surface` (2D content as a 3D
texture) is a 2D layer region bound as a material input. Both are zero-copy.

### 7.1 3D in the 2D renderer (started 2026-11-02)

`crates/render3d` (`ms-render3d`, docs-3d-renderer.md) is a dependency of the
2D renderer and draws on its device. A 3D scene is an **image asset**, painted
as a fill: `set_scene3d(id, width, height, words)` takes the word stream
`web/src/r3d/encode.ts` writes from core's `Scene3D`, and the GPU keeps one
`Renderer3D` per scene that draws straight into image `id`'s texture
(premultiplied RGBA8, the image store's format) before the frame's 2D passes,
and only again when the scene changes. Any shape then samples it with an
ordinary image paint (`fit: "stretch"` over the shape's box, rendered at the
box's device size, as the canvas3d fill does). No copies, no second context.

**Textures and `Tex.surface`.** The encoder's texture requests are answered
by the adapter: a data texture as pixels (`scene3d_pixels`), an image or a
surface as a binding to an image-store id (`scene3d_bind`). A bound image
becomes a 3D map on the GPU — unpremultiplied (three's maps are straight
alpha), mip chain box-filtered through an sRGB view for colour maps (linear
light, as WebGL's generateMipmap and render3d's uploads) — handed over with
`set_texture_view`, and rebuilt only when the image's generation changes.
A **surface** is an image asset whose content is a detached 2D subtree
(`set_surface(id, root, w, h)`, pixel ratio 1 as the engine's default): the
frame builder builds that subtree as its own frame (`build_subtree`) and the
GPU renders it into the image before the 3D scenes, when its content changed:
the protocol keeps a second, content revision per subtree (`content_rev`)
that moves only when the words of a node's ops differ from its last batch's
(or a definition is redefined, or a font arrives), so a host that rewrites
every node every frame (the engine adapter) leaves an unchanged surface
alone; an image the subtree paints with that changed redraws it too. Order
per frame: surfaces → 3D maps → 3D scenes → 2D.
Surfaces are also ordinary images for 2D image paints.

**Retained 3D (2026-11-02).** Core rebuilds the `Scene3D` every frame, and
an animated scene used to be re-encoded whole, including its geometry, and
re-hashed on the GPU side. The stream is now version 3: geometry is a def sent
once (fixed shapes keyed by their words, buffers and parametric surfaces by
their reconciler-style slot and `revision`, a surface whose revision held not
evaluated at all), draws refer to it by id, and the renderer keeps the defs a
frame refers to (docs-3d-renderer.md, Retained geometry). With the surfaces'
content revision above, an animated 3D math scene (math-surface-plot) went
from 3.0 to 1.2 ms of CPU per frame; per-scene numbers are in
docs-3d-renderer.md.

Not yet: maps from translucent images go through the 2D store's
premultiplied 8-bit texels (exact for opaque images).

## 8. Phase 5 — Integration (design)

### 8.0 Engine adapter (2026-11-02)

The engine's scenes draw through core's render path into this renderer.
Pieces, all under `web/src/adapter/`:

- **`WgpuRenderContext extends CanvasRenderContext2D`** (`context.ts`, core's
  base for every backend): a canvas state machine over a retained `Doc`.
  `begin`/`end` open and close a group (save/restore); `transform`
  concatenates translate(x + pivot)·rotate·scale·translate(−pivot) (or
  `matrix`) into the node's group, opens an isolated group for a non
  pass-through blend, and otherwise multiplies opacity into a world alpha that
  every leaf takes (pass-through, as the engine's `worldAlpha`). The root is
  scale(pixelRatio)·translate(centre), cleared black.
- **Shapes**: each shape's geometry (`geometry/`: rect, ellipse, line,
  polygon and polygram, path) emits an SVG path string, which `shapes.ts`
  parses into `PathData` (`svg-path.ts`) and turns by the shape's own
  rotation and scale.
- **Paint** (`paint.ts`): core `Fill`/`Stroke`/`Shadow` to the doc's paints
  (solid, gradients, images, procedural fills, canvas3d as a 3D scene asset).
- **Text**: text and rich-text ops to the doc's `TextSpec` (fonts registered
  with ms-text from the same files the engine loads).
- **Driver** (`driver.ts`): a frame drawn from core's `StateEvaluator`,
  `AssetManager` and `renderSettled` around this context.

The context records a new doc every frame, so every node is re-sent; keyed
reuse by node id + op index (the engine's shape-cache key) would send only
what changed.

**In the engine.** `web/src/engine/` is the package's library entry
(`pnpm build` → `dist/`). `createWgpuRenderer({ wasmUrl?, loadBytes? })`
returns the `WgpuRenderer` that `@motionscript/browser` builds in; hosts call
browser's `createBrowserEngine()`, and every session, still and export draws
here. The entry also exports `isWgpuSupported`, `onWgpuEvent`,
`ShaderPreview`, `validateShader` and `WGSL_PRELUDE`. It adds a storage
adapter (bitmaps, mediabunny video frames, font bytes), the surface knobs a
host sets (`view`, `frame`, `clipToFrame`, `frameBackground`, asynchronous
mount) and ms-text measurement from the same WASM (`MsText`). The surface
runs sRGB without dither, so the canvas pass draws straight into a
premultiplied canvas.

**One device per page (2026-11-03).** Every surface (each session, still and
export) used to request its own adapter and device and build its ~75
pipelines: about 100 ms warm, more cold, before its first frame. `gpu.rs` now
keeps one `SharedDevice` and, per output format, one `Core` (layouts, samplers,
pipelines); a surface creates and configures only its canvas. `createWgpuRenderer`
starts the device (`Renderer.prewarm`) without waiting for it, so it comes up
while the host loads fonts and builds its document; a dropped renderer destroys its
own buffers and textures, since the device outlives it. Warm mount 138 → 34–45 ms.

**Faults (2026-11-06).** With one device, a fault is every surface's.
`engine/faults.ts` watches each device a surface mounts on: its `lost` promise
forgets the device (`Renderer.forget_device`, gpu.rs `forget_shared_device`,
generation-checked so wgpu's own late callback leaves a successor alone) and
remounts every live surface, which rebuilds the format's `Core`, fonts and user
programs and presents the last doc; its `uncapturederror` becomes a `gpu`
issue. Each surface queues the fault for `takeRenderIssues()`, and the export
and still loops throw `RenderBackendError` on a `device-lost` or `crashed`
one, so an export never encodes frames drawn on a dead device; a surface
still remounting holds a settled frame through the storage adapter's
settler. A panic (`panic = "abort"`) reaches the host through a hook
(`set_panic_listener`) before the trap: the instance is never called again
(a `RefCell` may be held), surfaces halt and report `crashed`.

**Adapter coverage (2026-11-02).** Beyond plain shapes, the adapter draws:

- *Booleans and cuts*: outlines drawn between `beginBoolean`/`endBoolean` (in
  the space at `beginBoolean`) become one compound's members, folded with the
  op (compound members carry union / cut / intersect / exclude, combined by
  i_overlay); nested groups fold into the outer one. A Graphics2D `cut` and a
  `Clip` with cuts are compounds too (a clip with a cut clips as an alpha
  mask). Two or more shapes stroke as one figure (`unionStrokeShape`): the
  compound union when all are closed and whole, else their contours together
  aligned against the union; fills merge with every shape wound alike.
- *Strokes*: `startCap`/`endCap` planned per end (`stroke-ends.ts`: the
  stroker's cap masked off the end, the end's own cap or marker added from
  `geometry/markers.ts`' polygons); dashes fitted per path and contour (the
  pattern stretched to fit), cut into open contours where the band needs it.
- *Text strokes*: an outside (inside) band under the glyphs' alpha eroded
  (dilated) by one device px, a seam bridge — two composite mask modes; a
  partly aligned band is one stroke with the surplus erased past its shorter
  reach. Rich text draws every fill layer and every distinct stroke.
- *Media*: video `echo` (the tap stack), `posterizeTime` (core's timestamp),
  preset `intensity` < 1 (the ungraded fill over the graded one at 1 − t);
  an SVG rasterized again at the size it is drawn (storage upgrades).
- *Graphics2D*: group rotation/scale about the union's pivot, `effects`
  segments, inline masks with `apply` (the left-out paints drawn after the
  masked group), shadow `spread` on non-solid and inset shadows (rects and
  ellipses, via their spread outlines), backdrop effects with no clip of
  their own (bounded by the viewport).
- *Motion blur*: resolved against the node's velocity
  (`geometry/motion-blur.ts`, `resolveMotionBlur`) and drawn as the
  directional blur its continuous smear is.

Still not drawn: shaders stored with `language: "sksl"` (§6.3),
`rasterize()` (no caller left: `Tex.surface` records into a detached
subtree), motion blur with an off-centre shutter or more than 32 samples.
Known renderer issues: sibling path leaves sharing a paint are sometimes not
drawn (half the grid in `math-vector-arrow`, `math-plane-transform`), and a
leaf's opacity folds into what its effects read.

- **Worker + OffscreenCanvas**: the renderer moves to a worker
  (`transferControlToOffscreen`). The delta buffer becomes a `SharedArrayBuffer`
  ring when cross-origin isolation is available, and `postMessage` of a
  transferable `ArrayBuffer` otherwise. Measurement calls (`measureText`)
  need a synchronous answer on the main thread, so the shaping engine also
  runs in the main-thread WASM instance (it's small, and font bytes are
  shared).
- **State-keyed render cache**: component render results cached by state hash
  (see 3.1), plus GPU-side retention of static layers. A layer whose subtree
  revision didn't change keeps its atlas region across frames. That's the
  next big win after the render graph. Build-side reuse is in (§4.1); with it
  the encode dominates partly animated frames: ~10.8k draws, per-layer
  composites, uniform writes and `CommandEncoder.finish` cost ~7 ms of the
  7.8 ms frame above. Retained layer contents would remove most of that for
  static layers.
- **Frame-range export** (docs-export.md): each segment renders
  `frames: FrameRange` via `stateAt(frame)` (prime one frame before the
  segment for motion-blur velocity), encodes with WebCodecs/mediabunny, and
  segments are joined by `concatVideoSegments`. The canvas texture feeds
  `VideoFrame` without readback.
- **Legacy sRGB mode** stays the default until templates are re-baselined in
  linear mode.
- **Budgets**: WASM ≤ 1.5 MB gz with text, p95 frame time ≤ 8 ms on
  production presets at 1080p and ≤ 16 ms at 4K on the reference Mac.

---

## 9. Repo map

```
crates/renderer/src/
  lib.rs        wasm-bindgen API: create, delta_buffer, apply, render, read_pixels, wait_gpu, stats, shader_*, validate_shader
  user_shader.rs  user WGSL: assembly, name prefixing, naga validation, Params reflection (§6.3)
  protocol.rs   delta opcodes and decoder
  scene.rs      typed columns, paint table
  paths.rs      path store, outline cache (kurbo strokes/dashes, i_overlay booleans, bands)
  coverage_test.rs  CPU port of the shader's path coverage (native tests)
  frame.rs      measure/emit: instances, per-target op lists, layers
  field.rs      inside distance field of a node outline, for glass (§6.2)
  gpu.rs        shared device, pipelines, pool, render-graph executor (levels, atlas pages, backdrops, blur)
  layout_parity_test.rs  holds user-shaders.ts' USER_LAYOUTS equal to gpu.rs's bind group layouts
  fxhash.rs     hasher for the per-frame cache maps
  shaders/      prim.wgsl (SDF + analytic path coverage + clip), composite.wgsl (composite, masks, 16 blend modes, blur, blit)
  effects/      built-in effect passes (<type>.wgsl, _header.wgsl; gen/ accessors), docs-effects-porting.md
crates/text/src/   (ms-text, no wgpu)
  font.rs       font registry, CSS face matching, fallback lists, wght instances, metrics
  shape.rs      harfrust shaping at a 16.16 scale
  varied.rs     FreeType-precision variable advances (avar/HVAR in 16.16)
  layout.rs     line breaking, line boxes, alignment, carets (§5.1)
  block.rs      core's measureText / layoutTextBlock contract, autofit
  outline.rs    glyph outlines in the renderer's path verb encoding
  on_path.rs    text on a path (glyph transforms from arc length)
  wasm.rs       wasm-bindgen API (feature "wasm")
crates/text/tests/  parity.rs + cases.json + oracle.json (recorded reference numbers)
crates/render3d/   ms-render3d (docs-3d-renderer.md)
web/src/
  engine/       the library entry: createWgpuRenderer, surface, storage, text (ms-text), faults (§8.0), shader-preview (ShaderPreview, validateShader, WGSL_PRELUDE)
  adapter/      WgpuRenderContext (context.ts), paints, shapes, stroke ends, path measure, SVG paths, shader-params (uniforms against Params), driver
  adapter/geometry/  shape outlines as SVG paths (rect, ellipse, line, polygon + polygram, path), end markers, computeImageMatrix, resolveMotionBlur
  backend-wgpu.ts  the doc into deltas: interning, sync, render
  doc.ts        the retained document model the renderer draws
  protocol.ts   delta writer into WASM memory
  user-shaders.ts  user WGSL programs per device: async compile, Params packing (§6.3); USER_LAYOUTS (held to gpu.rs by layout_parity_test.rs)
  effects/      built-in effect ports (<type>.ts, _port.ts, _pack.ts)
  r3d/encode.ts  core's Scene3D into ms-render3d's word stream
  shaders-page.ts  the shader preview page (web/shaders.html, pnpm dev)
scripts/        build-wasm.sh, build-wasm-text.sh, build-wasm-r3d.sh, wasm-env.sh, validate-wgsl.mjs, gen-effect-params.mjs + effect-params.test.mjs, check-package.mjs, third-party-notices.*
```

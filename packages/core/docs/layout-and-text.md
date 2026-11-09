# Layout and text

Two things live here: `flowOps`, the layout engine every 2D node runs on its children (`packages/core/src/layout/`), and core's half of text: style inheritance, measurement inputs, the declared-font and manifest contract (`attributes/text/`, `components/builtins/text/`, `render/descriptors/text.ts`, `render/text-defaults.ts`, `assets/`). Shaping, glyph drawing and font registration belong to the renderer and platform packages. How a node calls layout, and default sizes, are in [scene-graph.md](scene-graph.md); the other layout attributes (`alignmentOps`, `insetsOps`, `sizeInputOps`) are in `attributes/layout/`.

## Model

### `flowOps`

Plain data in, boxes out; nothing is retained and no argument is written. A node keeps its own measure between passes. Methods: `measure` (each item's size and the extent a hugging container wraps), `place` (each item's box), `arrange` (both, inside a padded box, for anything a node lays out itself in `renderSelf`), `reusable`, `contentBox`/`size` (a container's own sizing), `collapsedRun` (diagnostic), plus the `flow` prop's `resolve` (identity) and `lerp`. A `Node2D` is a `LayoutItem` as it stands, so no adapter is allocated per child.

| `flow` | Measured by | Placed by |
|---|---|---|
| `freeform` (default) | every item against the whole content box; hug is the per-axis max | `align * max(0, inner - size) / 2`: slack clamps at 0, so an oversized item stays centred |
| `horizontal`, `vertical` | `measureRun`, or `measureWrap` when `wrap` | `placeRun`: from the `align` fraction of the leftover space; a run is **not** clamped, so a long centred run spills evenly on both sides |
| `grid` | `columns` equal tracks across the width; rows content-sized, or equal shares when the height is bounded | `placeGrid`: each item gets its whole cell (`align` and the item's size are ignored) |

Settings (`FlowSettings`, which a shape node satisfies as it stands): `flow`, `gap` (`number | "auto"`), `wrap`, `crossGap` (undefined follows `gap`; the grid's row gap), `columns` (`max(1, round(columns))`), `align`, `padding`. Item fields: `width`/`height` (`SizeInput`), `flex` (default 1; negative or non-finite becomes 1; `0` takes no free space), `gapScale` (0 to 1; unwrapped runs only), `column`/`row` (1-based; both must be set to pin), `colSpan` (clamped to `columns`), `rowSpan`.

| Item size input | Item without its own `measure` | Container axis |
|---|---|---|
| number | that number | that number |
| `"fill"` | the constraint's max, else 0 | the constraint's max, else 0 |
| `"hug"` | 0 | measures against the max; sized to content plus padding |

An item with a `measure` method replaces this table; missing fields count as 0.

Output boxes are `{ x, y, width, height }` with `(x, y)` the box centre relative to the content box's centre (`place`) or the outer box's (`arrange`), **y up**. `FlowMeasure.cells` for a grid are in reading order (top-left, y down). `arrange` shifts boxes by the padding inset into outer-centre space.

`flow` mid-tween is a blend object `{ from, to, t }` stored in the prop itself, so a seek that restores the prop restores the blend. `lerp` returns the destination at `t >= 1` or when both modes match; a `from` or `to` that is itself a blend counts as the mode it was heading to.

### Text style and the cascade

`TextStyle` (`attributes/text/types.ts`) has ten keys (`TEXT_STYLE_KEYS`): seven shaping keys (`TEXT_SHAPING_KEYS`: `fontFamily`, `fontSize` (number or `'autofit'`), `fontWeight`, `fontStyle`, `letterSpacing`, `lineHeight`, `textAlign`) and three paints (`fill`, `stroke`, `shadow`) that only a node can inherit. The text components' face defaults (`Typeface`, `components/modules/text-style.ts`): size 48, weight 400, style `normal`, letter spacing 0, line height 1.2 (a multiplier), align `center`, `minFontSize` 12. `fontFamily` has **no default**.

| Channel | Precedence, highest first |
|---|---|
| Node (`Text`, `RichText`, `NumberNode`) | the author's prop, the node's `variant` preset, the nearest enclosing `DefaultTextStyle`, the theme's `default` typography preset, the declared default |
| Drawn op (`text`/`richText` in a `Graphics2D`) | the op's own value, its `variant` preset, the enclosing scope (`pushTextStyle`), the theme `default` preset; no declared default, and `fill`/`stroke`/`shadow` are never filled |
| Last rung of both | `requireFontFamily` falls back to the host family (`setHostTextFamily`, from `@motionscript/core/component`), else throws |

`Typeface.inherit` and `provide` (`components/modules/text-style.ts`) write the node channel: an entry the author left unset takes the nearest `DefaultTextStyle`'s; `applyGraphicsTextDefaults` (`render/text-defaults.ts`) writes the drawn channel; `textOps` (`attributes/text/ops.ts`) holds the shared pieces (`preset`, `mergeStyle`, `lerpStyle`, `flatten` for span trees, `applyCase`).

### Measuring text

A text component measures through `TextLayout.measure` (`components/modules/text-layout.ts`, over `components/builtins/text/text-layout.ts`), which takes a `MeasureContext2D` (`render/measure-context.ts`), whose one method `measureText(text, fontSize, family, weight?, letterSpacing?, style?)` shapes one unwrapped line and returns its advance width and line-box height; text nodes read only the width. Heights come from `fontSize * lineHeight`. `fontSize: 'autofit'` measures at 16 and the renderer fits to the box; a node with a reveal window or runs shapes at `AUTOFIT_PROBE_SIZE` (100) with no fit. Default sizes: `Text` and `NumberNode` hug; `Text` with `'autofit'` fills both axes, with `wrap` fills the width and hugs the height; `RichText` always hugs.

A caret model (`render/text-layout.ts`) lets a host draw a caret over rendered glyphs: `TextBlockLayout` lines carry `n + 1` caret x positions for `n` characters, in block-local pixels (origin at the block's centre, y down). A measurer that cannot shape answers `null` (`asTextBlockSource`).

### Fonts

A text node declares each font it draws through `assets.font(family, weight)` in `declareAssets`: `Text` its own family and every styled piece's, `RichText` every run's. A font declaration gates layout, so text is not measured against a fallback face; the key, window, manifest and `DecodePolicy` rules are in [assets.md](assets.md). `AssetManifest.font` has one `FontMeta { fontFamily, fontWeight, src, sizeBytes }` per file, so an italic or other weight of a family is another entry with the same `fontFamily`. The engine never looks up a system font.

## Invariants and traps

- **Unknown `flow` strings are not rejected.** Anything outside `FlowMode` is measured and placed as a **vertical** run. An unknown named `align` throws `Unknown alignment value` from `place`/`arrange`.
- **`flow` and `reusable`.** A container may measure in one box and be laid out in another; it must re-measure when `flowOps.reusable(measure, inner)` is false (relative tolerance 1e-6 per axis, or the hugged extent on a hugging axis), or its items are arranged for the wrong box.
- **`fill` on a hugging main axis has nothing to fill.** The item measures intrinsically (a bare `fill` leaf collapses to 0) in both `measureRun` and `measureWrap`, so `wrap` on or off gives the same hug size. A hugging main axis never wraps. In a wrapped run `fill` is not divided: that item measures to the whole main axis and takes a line to itself; cross-axis `fill` stretches to its own line only.
- **`gapScale` drives animated insert/remove**: a run reserves `gap * max(0, sum(gapScale) - 1)`, so a collapsing item gives back exactly one gap wherever it sits. It is ignored in a wrapped run (all 1), where an animated insert slides instead.
- **`gap: "auto"` reserves 0 while measuring** (the hug extent excludes gaps), then spreads each line's free space evenly between that line's items; in a grid it is 0.
- **Grid placement is unvalidated.** `column` alone is ignored (the item auto-flows); values below 1 or past `columns` produce cells outside the box; `colSpan` has no lower bound; `NaN` columns give `NaN` boxes. A grid never hugs its width: its hug width is the content box's.
- **A hidden child has no cell and no gap** (`flowChildren()` drops it) and keeps its last `layoutBounds`.
- **`start`/`end` on a glyph node are a character-reveal window, not an outline trim**, rounded to whole characters of the recased string; `start > end` hides everything, and a node with a `path` ignores the window.
- **Run and caret offsets index the typed string.** `applyCase` preserves length (a character whose case mapping adds characters keeps its own form) so offsets never shift. `runs` and `spans` are not animatable; a `to` target an array prop has no tween for is ignored. `textOps.lerp` is a typing animation: the common prefix and suffix hold while the differing middle shrinks then grows, in UTF-16 units, so a mid frame can split a surrogate pair.
- **The node cascade is a snapshot.** `applyTextDefaults` runs once in `resolveContext` (first attach): a later change to a `DefaultTextStyle` prop or a node's `variant` does not restyle a bound node. The drawn channel reads live values each frame.
- **`variant` typography is process-wide.** `setTheme` fills one registry on `globalThis` ([attributes.md](attributes.md)); a `ThemeProvider`'s `theme` bag is not consulted for typography. An unknown `variant` is ignored; unknown enum values (`textCase`, `textAlign`, `verticalAlign`) fall back silently.
- **No family, no glyphs.** With no family from any rung and no host family, measure and draw both throw `Text ... has no fontFamily` from `requireFontFamily`. A text with no fill paints nothing (the default `fill` is empty). The host family is not a prop and is not declared by any node: it is resolved at draw time.
- **A drawn `text` op's `lineHeight` defaults to 0, a node's to 1.2.** `withTextDescriptor` (`render/descriptors/text.ts`) fills `lineHeight ?? 0` when no rung of the drawn channel states one, so a custom node drawing raw text should state it or rely on a `DefaultTextStyle` or the theme `default` preset.
- **Wrapped height is an estimate.** `countWrappedLines` breaks greedily at whitespace and counts a word wider than the box as one line; the renderer breaks inside it, so the two can disagree. `RichText.measure` counts no wrapping at all.
- **`RichText` paints less than its props suggest.** It records one `richText` op of spans, `lineHeight`, `textAlign` and the layout size; the node's `shadow`, `start`, `end` never reach the renderer, and its `fill`/`stroke` act only as the base the spans inherit.
- **Text on a path is one line.** `wrap`, newlines, `runs`, `textDecoration` and `verticalAlign` are ignored; the node measures as the path's box (`pathOps.size`).
- **Number formatting is a pattern grammar, never `Intl`.** `formatNumber` (`components/builtins/text/number-format.ts`) uses spreadsheet patterns (`#,##0.00`, `0.#%`, quoted literals); the named formats are patterns too. The same project renders the same string on every machine, so a locale cannot reflow a layout.

## Where to look

- `layout/ops.ts` (the contract), `flex.ts`, `grid.ts`, `freeform.ts`, `item.ts`, `types.ts`; `components/trees/2d/node2d.ts` (`layoutChildren`, `measure`).
- `components/builtins/text/text.ts`; `components/modules/text-style.ts`, `text-layout.ts`; `components/builtins/text/text-layout.ts` (`measureGlyphs`, `textSegments`), `number-format.ts`; `components/builtins/text/text-defaults.ts` (host family); `assets/scope.ts` (`font`).
- Tests: `layout/tests/` (`flow-ops.test.ts`, `flex.test.ts`, `grid.test.ts`), `components/builtins/text/tests/`, `attributes/text/tests/`, `assets/tests/scope.test.ts`.

# Paint attributes and path geometry

An attribute is a prop type with its own value grammar: a fill, a stroke, a shadow, an effect chain, a colour, corner radius or style, a path. Each is implemented once, as an **ops value** in `packages/core/src/attributes/shape/` (`fill/`, `stroke/`, `shadow/`, `effects/`, `filters/`, `corners/`, `shaders/`, `path/`). Nodes, renderers, hosts and kits consume the ops value and never re-derive its maths ([glossary](../../../ARCHITECTURE.md#glossary)). Layout attributes (`flowOps`, `alignmentOps`, `insetsOps`, `sizeInputOps`) are in [layout-and-text.md](layout-and-text.md); node props that use these attributes are in [scene-graph.md](scene-graph.md).

## Model

An ops value is an `AttributeOps<Input, Resolved>` (`attributes/shared/operators.ts`): `resolve(value, previous?)` turns loose author input into the strict stored form, `lerp(from, to, t)` interpolates two stored forms, plus attribute-specific helpers. A component's `Types` entries (`components/factory/types.ts`) bake the pair into a prop, so `set`, `to`, `save`/`restore` and `() => ...` bindings all go through the same two functions: a component declares a second fill with `Types.fill()`, not by copying a mapper. The tree bases' own props use the same pairs (`attributes/properties/typed.ts`).

| Attribute | Ops value | Stored form | Entry |
|---|---|---|---|
| fill | `fillOps` (`fill/registry.ts`) | `FillResolved[]`, painted first to last | `Types.fill` |
| stroke, shadow | `strokeOps`, `shadowOps` | `StrokeResolved[]`, `ShadowResolved[]` | `Types.stroke`, `Types.shadow` |
| effects | `effectsOps` (`effects/chain.ts`) | `NodeEffect[]` | `Types.effects` |
| colour | `colorOps` (`fill/lerp.ts`) | `[r, g, b, a]`, each 0 to 1 | `Types.color` |
| corners | `cornerRadiusOps`, `cornerStyleOps` | four-corner objects | `Types.cornerRadius`, `Types.cornerStyle` |
| path data | `pathOps` (`path/ops.ts`) | `PathData` as written | `Types.path` (no mapper; `lerp` is the morph) |
| palette | `fillOps` per entry | `FillResolved[][]`, cycled by index | `Types.palette` (tweened pairwise, the longer side's tail held) |
| style | each field's own pair | a flat object of resolved fields | `Types.style` (see below) |

`@motionscript/core/sdk` (and so `@motionscript/sdk`) re-exports the ops values and resolvers (`resolveFill`, `resolveStroke`, `resolveShadow`, `resolveCorners`, `parseColor`) and the `Fills`, `Effects`, `Adjustments` builders, but not `effectsOps`.

### Styles

`Types.style(family, groups, { presets })` (`components/factory/style.ts`) is a component's whole look as one entry: fields written in groups (`{ colors: { palette, foreground }, text: { fontSize } }`), read flat (`state.style.palette`), so field keys are unique across groups. A set lays a partial over the previous value and drops keys no field declares, which lets one preset or one saved style dress every component of the `family` (a pie's `innerRadius` is ignored by a line chart). A tween goes field by field: the field's own lerp, numbers lerp, anything else (a font, an enum, an `animatable: false` field) steps at the midpoint. `describe()` reports the entry as `kind: "style"` with its `family`, `presets` and `properties`, each field's editor plus its `group` and `default`, so a host can draw a style editor and save looks without knowing the component.

### Units and spaces

| Quantity | Convention |
|---|---|
| Stored colour | gamma-encoded sRGB `[r, g, b, a]`, not linear light (hex and `rgb()` are divided by 255; lab, lch, oklab and oklch are converted and gamma-encoded) |
| Gradient `start`/`end`/`center`, image `anchor` | normalised box: `(0, 0)` at the shape's centre, `+-1` at its edges, **y up** |
| Effect `center` options | normalised unit: `(0, 0)` to `(1, 1)` across the layer |
| Pixels | logical px; device scale and camera zoom are the renderer's. Shadow `offset` and `dropShadow.offsetY` are y up |
| Angles | degrees everywhere, including hsl hue |
| Stroke `align` | `-1` inside (the default), `0` centred, `1` outside; strings `inside`/`center`/`outside` resolve to those |
| Fill `space` | `local` (the shape's bounds, default), `parent`, `global` (the viewport); carried by `resolveFill` for every kind |

### Fills

`FILLS` (`fill/registry.ts`) is a closed table of 13 kinds: `solid`, `linear-gradient`, `radial-gradient`, `conic-gradient`, `noise`, `fractalNoise`, `stripe`, `dotGrid`, `grid`, `shader`, `image`, `video`, `canvas3D`. A host cannot register a kind. `resolveFill` is the one coercion point: a string becomes `solid`, a bare `Scene3D` becomes `canvas3D`, an object goes to the kind named by `type`. `Fills`/`FillChain` and `Effects`/`EffectChain` are immutable builders: each method returns a new chain.

Interpolating two fill lists pairs layers by index. Same kind and same `blend`, or a solid against a gradient, or two gradients of different kinds, interpolate in place (the solid or the other gradient is first coerced to the destination's kind). Anything else, including the same kind with different `blend`, **cross-fades**: the outgoing layer fades out beneath the incoming one. A layer present on one side fades through opacity 0 and stays in the list at opacity 0, so a list never shrinks. Discrete fields (`src`, `fit`, `matrix`, `loop`, `playing`, `shader.source`, `canvas3D.scene`) switch at 0.5; gradient stop lists with different positions are resampled onto the union of positions.

### Effects

`EFFECTS` is a closed table of 41 kinds (`effectTypes()` lists them), built from one **spec** per kind (`defineEffect` in `effects/spec.ts`, declared in `effects/implementations/<kind>.ts`): its parameters by stored field name, each with a kind (`number`, `color`, `vec2`, `enum`, `boolean`, `axis`, `text`, or a custom one), a default, a range, a unit and inspector hints, plus the behaviour that stays code (`surface`, `resolve`, `declare`, a custom `lerp`). The effect's type (`EffectFields`), its builder's options (`EffectOptionsOf`) and defaults (`buildEffect`), and its `lerp`/`equals` (`effectDataOf`, per kind unless a parameter or the spec overrides it) are derived from it; `describeEffect(type)` / `effectDescriptors()` hand a host the same spec as plain JSON (`EffectDescriptor`) to build its inspector from, and the renderers bind their uniforms to its parameter names. Every effect carries `mode` (`foreground`, or `backdrop`, which samples what is already painted beneath the node; `magnify` and `glass` default to backdrop) and `clip` (confine to the node's alpha). `EffectData.surface` is `filter` (composes as an image filter beside its neighbours) or `shader` (needs the content snapshotted and resampled); it is a function of the type and `mode` only, never of a numeric field. Colour options are stored as authored and parsed at use, so a theme alias follows `setTheme`. The media adjustment chains (`Adjustments`, `VideoAdjustments`) reuse effect implementations through `filters/registry.ts`; `posterizeTime` and `echo` are video-only and do not compose into the pixel filter.

### Shaders

A shader pack (`shaders/pack.ts`) has `scope: 'fill'` or `'effect'`, a `source` (at most `MAX_SHADER_SOURCE` = 64,000 characters) in a `language` (`shaders/language.ts`: `'wgsl'`, the only one, stamped when absent; `normalizeShaderPack` refuses any other), and `properties` (at most `MAX_SHADER_PROPERTIES` = 64) that map a typed value onto named uniforms; a WGSL fill pack may name `textures`. The builders stamp `language: 'wgsl'` on the `shader` fill and effect, and `isWgslShader` reads it (absent is WGSL). A stored fill or effect may still say `'sksl'`, the retired value format-2 migration stamps on an SkSL shader from an old document (`document/migrate.ts`): the effect spec's `language` options list it, nothing produces it, and the renderer draws nothing for it and reports a `shader` issue. A WGSL fill or effect also resolves with `contract`, the version of the WGSL contract it is written against (`WGSL_CONTRACT`, stamped when absent by `shaderFill.resolve` and `shaderEffect.resolve`; `shaderContractOf` reads it), so a renderer can report a shader written for a newer contract than it implements. In WGSL the uniforms are the members of the source's `struct Params` (the renderer reflects their types and layout), a fill reads its box from `in: FillIn` and an effect its input through `sample_src`; the contract is `packages/renderer/DESIGN.md` §6.3. A shader that is not WGSL draws nothing and is reported through `RenderContext.takeRenderIssues()`, which the playback controller turns into render errors ([why](../../renderer/docs/why.md#user-shaders-are-wgsl-sksl-loads-but-does-not-draw)). `Fills.shader` rejects an effect pack and `Effects.shader` rejects a fill pack, each naming the other builder. Uniforms are bound by name from a record (`normalizeUniforms` also accepts the positional `[{ name, value }]` form). `source` is the compile-cache key, so a tween snaps or holds it and never interpolates it. A shader effect's optional `reach` (px) is how far past the node's box it may draw or read. A foreground effect's output replaces its input unless a `blendMode` is given.

### Colours and the theme registry

`parseColor` accepts CSS names, `#rgb[a]`, `#rrggbb[aa]`, `rgb()`, `hsl()`, `lab()`, `lch()`, `oklab()`, `oklch()` and a `name/N` opacity suffix (percent, no `(` in the string). Theme colours resolve before CSS names. `setTheme` replaces the colour and typography registries, which live on `globalThis` (`__msThemeMap`, `__msTypographyMap`) so that separately bundled copies of core share one; the session applies the project theme before it measures or paints.

### Path geometry

`pathOps` is one object for every path operation. The pipeline: `PathData` (string or `PathCommand[]`) `--commands-->` `PathCommand[]` `--contours-->` `PathContour[]` (absolute, typed segments; the closing edge is not stored). `bounds`, `size`, `length`, `sampler`, `dash` and `trim` read contours and keep arcs as arcs. `cubics`, `plan`/`sample` (morph) and `anchors` flatten to cubics and are lossy for arcs. The editable form is `VectorPath` (`PathAnchor`: a point plus absolute in/out handles, `null` meaning none).

| Space | Origin, y | Used by |
|---|---|---|
| Face value | wherever the numbers put it, y down | a `d` string as written; `Path` draws and hugs it as is |
| Unit box | node centre, y down, `x`,`y` in -0.5..0.5 (`UNIT_PATH_BOX`) | `PathShape` (document key `path`); a resize is an ordinary `width`/`height` write |
| Renderer local | node centre, y up | `Graphics2D`; reach it with `anchorCommands(path, (p) => ({ x: p.x * w, y: -p.y * h }))` |

## Invariants and traps

- **`resolve` is idempotent.** A resolved value passed back through `resolve` is equal, so a node's read-back prop can be assigned straight back. Neither function mutates an argument; `lerp` returns `from` itself when `from === to`.
- **A partial write falls back to `previous[i]`, then the default** (stroke, shadow, corners). An unset `dash` keeps the previous dash; `[]` is the explicit empty pattern, and a tween from no dash pads with 0.
- **Only `fillOps.lerp` clamps `t` to [0, 1].** Stroke, shadow, effects and corners extrapolate, so an overshooting ease can give a negative weight or radius.
- **Lists of different length do not tween the same way.** A fill fades in or out (see above). A stroke, shadow or effect present on one side only is copied unchanged: it appears at once and a source-only one is never removed. Different effect types switch at 0.5; `shadow.inner` switches at 1; stroke `cap`/`join` and `cornerStyle` switch at 0.5.
- **Only the builders default an effect.** `resolveEffect` migrates a stored effect and never fills a missing field, so a raw literal `{ type: 'blur' }` reaches `lerp` with `radius` undefined and gives `NaN`, and `{ type: 'vignette' }` throws from `parseColor`. A raw fill literal is defaulted by `fillOps.resolve`. An unknown fill `type` throws at resolve; an unknown effect type passes through, snaps at 0.5, and reports surface `filter`.
- **An effect entry's `resolve` must return its input by identity when it rewrites nothing**, and `resolveChainEffects` returns a chain's own list when nothing changed: it runs on every write of `effects`, and `effectsOps.lerp` short-circuits on `from === to`.
- **Shadows have no `opacity`**; the alpha lives in the fill colour (`'black/40'`). `spread` is honoured by the renderer for ellipses and rectangles only.
- **Stroke padding is the max, not the sum.** `Paint.inset` adds `max(weight * (1 - align) / 2)` over strokes to all four sides, so children sit inside the stroke.
- **Corner input precedence**: any per-corner key wins, else `top`/`bottom`, else `left`/`right`, else the fallback for every corner. A non-number, non-object input throws a raw `TypeError`.
- **`parseColor` returns a shared tuple for CSS and theme names.** Do not mutate a resolved colour; hex and functional forms return fresh arrays. A malformed colour logs a warning on every call and is opaque black. `setTheme` is process-wide: concurrent sessions with different themes contend.
- **Uniform mistakes never throw.** A non-finite or non-numeric uniform warns once (`[shader] ...`) and is dropped; a uniform and a `struct Params` member that disagree are a `params` render issue; a structural pack mistake throws. `i32`/`u32` members work. A fill source returns **premultiplied** RGBA and must not apply the layer's `opacity` (the paint already carries it).
- **Path memos assume immutability.** `contours` memoises 32 entries (a string by value, an array by reference); `lerp` caches one plan keyed by `(from, to)` identity. Never edit a `PathCommand[]` in place after passing it in. A tweened path hands a fresh array every frame, so it misses the contour memo and ages out of it.
- **`pathOps` validates nothing and never throws on a string.** A scanner stops at the first unreadable token and keeps the complete commands before it. `lerp` returns `from` at `t <= 0` and `to` at `t >= 1`; between, `M`/`C`/`Z` only. `SAMPLE_STEPS` (50) is shared by `length`, `sampler`, `dash` and `trim`; `fromAnchors` keeps 5 decimals. SVG arc `sweep` and tangents follow y down.

## Where to look

- `attributes/shape/fill/registry.ts`, `chain.ts`, `coerce.ts`, `implementations/`; `effects/spec.ts`, `registry.ts`, `chain.ts`, `effect-data.ts`; `shaders/pack.ts`, `language.ts`, `uniforms.ts`; `path/ops.ts`, `walk.ts`, `morph.ts`, `anchors.ts`.
- Tests: `attributes/shape/*/tests/` (`fill/tests/cross-fade.test.ts`, `effects/tests/neutral.test.ts` requires each registered effect to have a no-op parameter set or a recorded reason it has none, `effects/tests/spec.test.ts` replays builder output, `lerp` and `equals` recorded from the hand-written versions (`tests/fixtures/`), `path/tests/morph-plan-cache.test.ts`), `attributes/shape/shaders/tests/uniforms.test.ts`.

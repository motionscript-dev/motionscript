# Porting an effect to WGSL

Each engine effect (core's spec in `packages/core/src/attributes/shape/effects/implementations/`)
becomes **two new files**, both named after core's effect `type`, plus one
generated one:

- `web/src/effects/<type>.ts`, the port: a `definePort` (`_pack.ts`) naming
  the pass's parameters, and how each is computed from the authored effect.
- `crates/renderer/src/effects/<type>.wgsl`, the pass, reading them by name.
- `crates/renderer/src/effects/gen/<type>.wgsl`, the accessors, written by
  `node scripts/gen-effect-params.mjs` from the port. Never edit it.

All three are discovered automatically (`crates/renderer/build.rs` prepends
the accessors to the pass, `import.meta.glob` in `web/src/effects/_port.ts`).
**Do not edit shared files** (`_header.wgsl`, `_port.ts`, `_pack.ts`,
`gpu.rs`, `frame.rs`, `backend-wgpu.ts`). If a helper is missing, write it in your effect's
own file. If the infrastructure itself can't express an effect, stop and
report what's missing instead of changing it.

Worked examples: `vignette` (shader lens), `grayscale` (filter-path colour
matrix), `glow` (prefilter + blurred input + blend).

## The WGSL side

Write `fn effect(p: vec2f) -> vec4f`. `p` is the output pixel's **device**
position; return premultiplied RGBA. Declare how the input is sampled:

```wgsl
const TILE_CLAMP: bool = false;     // true: clamp at the input's edge; false: transparent past it
const FILTER_NEAREST: bool = false; // true: nearest instead of bilinear
```

The header (`_header.wgsl`, prepended) gives:

| Need | WGSL |
|---|---|
| the input | `src(coord)`; `src_with(coord, clamp, nearest)` to override |
| a blurred copy of the input | `blurred(coord)`, fed by the packer's `blur` |
| the box (device px) | `box_center()`, `box_half()`, `box_size()`, `box_origin()` |
| device px per logical px | `u.scale` |
| time | `u.time` (0 for now; pass time as a param if you need it) |
| uniforms | `param_<name>()` per port parameter (snake_case); an array parameter is `param_<name>(i)` with its offset in `PARAM_<NAME>` |
| a baked texture (LUT, noise, atlas) | `aux_texel(texel, nearest)`, size in `u.aux_size` |
| the outline's inside distance | `field(p)` (device px inside the outline), `max_distance()`; packer sets `field: true` (backdrop only) |
| a 4×5 colour matrix | `color_matrix(c, PARAM_MATRIX)`: a 20-float array parameter |
| a blend of two colours | `blend_mode(mode, src, dst)` (index list in the header) |

Optionally define `fn prefilter(p: vec2f) -> vec4f`. It runs before the blur
that feeds `blurred()` (glow's threshold and dilate, bloom's threshold).

WGSL traps:
- Reserved words (`pass`, `target`, `module`, `type`, …) can't be names.
- Loops need runtime-safe bounds: cap them.
- Never use derivative-based sampling (`textureSample`); `src()` is explicit-LOD.

## The TS side

```ts
import { Effects, type XEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<XEffect, { sigma: number }>({
    type: "x",
    surface: "shader",   // core's surface for this effect: "shader" or "filter"
    params: {
        amount: "param",                                    // core's `amount`, by its kind
        color: "param",                                     // a colour: straight RGBA (vec4f)
        dir: { type: "vec2f", uses: ["angle"], value: (e) => [Math.cos(r(e)), Math.sin(r(e))] },
        sigma: { type: "f32", uses: ["radius"], value: (_e, c) => c.sigma },
    },
    uses: ["seed"],                                       // read only here (reach, a no-op, an atlas)
    prepare: (e) => (e.amount <= 0 ? null : { sigma: e.radius / 2 }),  // null = no-op
    extras: (_e, c) => ({ reach: 3 * c.sigma }),
    cases: () => [Effects.x().list[0], Effects.x({ … }).list[0]],
});
```

- **`"param"`** binds core's spec parameter of the same name, encoded by
  its kind: a number as is, a boolean as 0/1, an enum as its index in the
  spec's `options`, a colour as straight RGBA, a point or axis as a vec2. A
  derived field names its WGSL type (`f32`, `vec2f`, `vec3f`, `vec4f`, or
  `{ array: n, of }`) and the spec parameters it reads in `uses`.
- Fields are laid out in declaration order; more than 64 floats throws.
- After editing a port, run `node scripts/gen-effect-params.mjs`, then
  `node --test scripts/effect-params.test.mjs`: the accessors are current,
  the pass reads every field by name and nothing by position, every spec
  parameter reaches the pass or the packer, and every core effect has a port.
- **`prepare` returns null where the effect is a no-op** (the node paints
  untouched).
- **Keep px options in logical px**, and multiply by `u.scale` in WGSL where
  device px are needed. `u.scale` is right on both surfaces.
- **`extras`** returns everything but the parameters:
- **`reach`** (logical px): how far the effect can draw past its input
  (blur radius, offsets, outline width). The layer grows by it.
- **`blur`**: `[sigmaAlongAngle, sigmaAcross, angleRadians]` in logical px,
  for effects that read `blurred()`.
- **`aux`**: RGBA8 pixels for a baked texture, with a cache key.
- **Cases**: 2–4 per effect built with core's `Effects` builder, covering
  the options that change the code path (modes, tints, axes), not just
  values.
- **Filter-path effects** (`surface: "filter"`: blur, bloom, streak,
  directionalBlur, chromaticAberration, colour matrices) are a pass too, plus
  `blur` and `prefilter` where they blur.

## Verify

```bash
pnpm build:wasm
node scripts/gen-effect-params.mjs && node --test scripts/effect-params.test.mjs
```

Then render the effect's e2e scenes through `packages/e2e` (its README) and
look at the frames. A WGSL error in a pass fails when the renderer builds its
pipelines: a WebGPU validation error in the console and a `gpu` render issue.

## Out of scope for now

- `motionBlur` (needs velocity; the adapter draws it as a directional blur).
- `shader` (user effects, DESIGN.md §6.3).

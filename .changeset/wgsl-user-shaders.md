---
"@motionscript/core": minor
---

Shader fills and shader effects are written in WGSL.

A shader pack, a `shader` fill and a `shader` effect carry `language: 'wgsl'`. A WGSL fill defines `fn fill(in: FillIn) -> vec4f`, an effect `fn effect(in: EffectIn) -> vec4f` reading its input with `sample_src`; uniforms are the members of the source's `struct Params`. A shader effect takes an optional `reach` (px it may draw or read past the node's box), and a WGSL effect's output replaces its input unless a `blendMode` is given. A WGSL fill pack may name `textures`.

A shader the renderer cannot run draws nothing and is reported through the new `CanvasRenderContext2D.takeRenderIssues()`, which the playback controller records as render errors (`buildErrors`, `onRenderError`).

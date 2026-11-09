---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

**Breaking:** SkSL is removed; WGSL is the only shader language. `ShaderLanguage` is `"wgsl"` only, and a shader with no `language` is WGSL: its source is no longer inspected.

- Removed from `@motionscript/core`: `inferShaderLanguage`, `shaderLanguageOf` (use `isWgslShader`), `describeUniforms`, `writeUniforms`, `coordsMatrix`, `parseShaderChildren`, the `UniformReflect`, `UniformSlot`, `UniformBounds`, `ShaderChildDecl`, `ShaderFillCoords` and `SkSLEffect` types, `skslEffect`, `EffectChain.sksl` and `AdjustmentChain.sksl` (use `Effects.shader` / `Adjustments.shader`), and the `backend-fallback` `RenderIssueKind`.
- Renamed in `@motionscript/core` and `@motionscript/sdk`: `SkSLUniformRecord` is `ShaderUniformRecord`, `SkSLUniform` is `ShaderUniform`, `SkSLUniformValue` is `ShaderUniformValue`. Removed from `@motionscript/sdk`: `ShaderFillCoords`.
- The shader fill, its pack and `Fills.shader` lose `coords`; `Fills.shader` and `Effects.shader` lose the `language` option and stamp `language: "wgsl"`. A foreground shader effect no longer defaults to `blendMode: "screen"`: its output replaces the layer unless a `blendMode` is given.
- The effect key `sksl` is no longer an alias of `shader`. `normalizeShaderPack` (and so `Registry.addShader`) throws for a pack whose `language` is not WGSL.
- Uniform warnings are prefixed `[shader]` rather than `[SkSL]`.

Migration: stored documents migrate automatically to format 2 (`DOCUMENT_FORMAT_VERSION`). Every SkSL shader fill, shader effect and shader pack in a clip (an explicit `language: "sksl"`, or no `language` and an SkSL `main` or `uniform` in its source) is stamped `language: "sksl"` with its source kept, an effect stored as `type: "sksl"` becomes `type: "shader"` with its `shader` field moved to `source`, and `coords` is dropped; each is noted in the migration's `changes`. Such a shader draws nothing and is reported as a `shader` render issue until its source is ported to WGSL. Code using the renamed types renames them, and SkSL sources must be ported to WGSL.

/** WGSL, the only language the renderer runs for a custom shader. A fill defines `fn fill(in: FillIn) -> vec4f`, an effect `fn effect(in: EffectIn) -> vec4f`; uniforms are the members of `struct Params`, read as `u.<name>`. */
export type ShaderLanguage = "wgsl";

/** Whether a shader fill, shader effect or shader pack is WGSL: its `language` is absent or `"wgsl"`. */
export function isWgslShader(shader: { language?: string }): boolean {
    return shader.language === undefined || shader.language === "wgsl";
}

/** The version of the WGSL contract a shader is written against (`FillIn` / `EffectIn`, the helpers, uniforms bound to `struct Params` by name; packages/renderer/DESIGN.md §6.3). Bumped only by a change that would draw an existing shader differently. WGSL fills and effects resolve with `contract` stamped when absent, so a stored document says what it was written for. */
export const WGSL_CONTRACT = 1;

/** The contract a shader states, or the current one for a WGSL shader that states none; `undefined` for any other language. */
export function shaderContractOf(shader: { language?: string; contract?: number }): number | undefined {
    if (!isWgslShader(shader)) return undefined;
    return shader.contract ?? WGSL_CONTRACT;
}

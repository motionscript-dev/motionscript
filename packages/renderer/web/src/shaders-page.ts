// The shader lab (shaders.html): ShaderPreview drawing a WGSL fill, a
// foreground and a backdrop effect, and reporting a broken source.

import { ShaderPreview, type ShaderPreviewInput, validateShader } from "./engine/shader-preview";

const FILL = `struct Params { amount: f32, tint: vec3f }
fn fill(in: FillIn) -> vec4f {
    let p = (in.uv - 0.5) * vec2f(in.size.x / in.size.y, 1.0);
    let a = 0.5 + 0.5 * sin(length(p) * 40.0 - in.time * 4.0) * u.amount;
    return vec4f(u.tint * a, a);
}`;
const GLOW = `struct Params { amount: f32 }
fn effect(in: EffectIn) -> vec4f {
    let g = (1.0 - smoothstep(0.0, 0.6, length(in.uv - 0.5))) * u.amount;
    return vec4f(g, g * 0.6, g * 0.9, g);
}`;
const RIPPLE = `struct Params { amount: f32 }
fn effect(in: EffectIn) -> vec4f {
    return sample_src(in.uv + vec2f(sin(in.uv.y * 30.0) * u.amount, 0.0));
}`;
const BROKEN = `fn fill(in: FillIn) -> vec4f {
    return vec4f(in.uv, missing, 1.0);
}`;

const cases: ShaderPreviewInput[] = [
    { scope: "fill", source: FILL, uniforms: { amount: 1, tint: [0.4, 0.7, 1] }, time: 1 },
    { scope: "effect", source: GLOW, uniforms: { amount: 1 }, time: 0, blendMode: "screen", frame: "inset" },
    { scope: "effect", source: RIPPLE, uniforms: { amount: 0.02 }, time: 0, backdrop: true, frame: "inset", reach: 12 },
    { scope: "effect", source: RIPPLE, uniforms: { amount: 0.02 }, time: 0, split: 0.5 },
    { scope: "fill", source: BROKEN, uniforms: {}, time: 0 },
];

async function run() {
    const stage = document.getElementById("stage")!;
    const results: unknown[] = [];
    for (const input of cases) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 400;
        stage.append(canvas);
        const preview = await ShaderPreview.create(canvas);
        const first = preview.draw(input);
        await preview.whenReady();
        const after = preview.draw(input);
        results.push({ scope: input.scope, first: first.state, after: after.state, diagnostics: after.diagnostics });
    }
    results.push({ validate: await validateShader("fill", BROKEN) });
    document.getElementById("out")!.textContent = JSON.stringify(results, null, 2);
    return results;
}

declare global {
    interface Window { shaderLab: Promise<unknown> }
}
window.shaderLab = run();

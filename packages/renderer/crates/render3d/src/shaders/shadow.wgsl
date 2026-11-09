// Depth-only pass for directional and spot shadow maps (three renders the
// same with MeshDepthMaterial; only depth is kept).

struct ShadowPassU {
    view_proj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> shadow_pass: ShadowPassU;

struct ShadowIn {
    @location(0) position: vec3<f32>,
    @location(4) m0: vec4<f32>,
    @location(5) m1: vec4<f32>,
    @location(6) m2: vec4<f32>,
    @location(7) m3: vec4<f32>,
};

@vertex
fn vs_shadow(v: ShadowIn) -> @builtin(position) vec4<f32> {
    let model = mat4x4<f32>(v.m0, v.m1, v.m2, v.m3);
    return shadow_pass.view_proj * model * vec4<f32>(v.position, 1.0);
}

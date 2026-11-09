// One mip level of the transmission target from the level above: a
// fullscreen triangle sampling bilinearly at the destination texel centre,
// which is the 2x2 box filter of generateMipmap for even sizes.

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var src_sampler: sampler;

struct Out {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Out {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var o: Out;
    o.pos = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    o.uv = uv;
    return o;
}

@fragment
fn fs(o: Out) -> @location(0) vec4<f32> {
    return textureSampleLevel(src, src_sampler, o.uv, 0.0);
}

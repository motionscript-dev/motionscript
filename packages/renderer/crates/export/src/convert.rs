//! RGBA8 render target → NV12 (BT.709, limited range) on the GPU, box-filtering
//! a supersampled render down to the output size in the same pass, so only
//! 1.5 bytes per output pixel cross back to the CPU (a quarter of RGBA at 2×
//! supersampling would be 16 bytes).

const WGSL: &str = r#"
struct P { out_w: u32, out_h: u32, ss: u32, y_bytes: u32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> p: P;

fn px(x: u32, y: u32) -> vec3f {
    var acc = vec3f(0.0);
    for (var j = 0u; j < p.ss; j++) {
        for (var i = 0u; i < p.ss; i++) {
            acc += textureLoad(src, vec2u(x * p.ss + i, y * p.ss + j), 0).rgb;
        }
    }
    return acc / f32(p.ss * p.ss);
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn q(v: f32) -> u32 { return u32(clamp(round(v), 0.0, 255.0)); }

// One invocation: a 4×2 block of output pixels (two Y words, one UV word).
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let bx = id.x; let by = id.y;
    if (bx * 4u >= p.out_w || by * 2u >= p.out_h) { return; }
    var uv = 0u;
    var ys = array<u32, 2>(0u, 0u);
    for (var k = 0u; k < 2u; k++) {
        // One chroma sample per 2×2: the mean of its four pixels.
        var c = vec3f(0.0);
        for (var r = 0u; r < 2u; r++) {
            for (var s = 0u; s < 2u; s++) {
                let x = bx * 4u + k * 2u + s;
                let rgb = px(x, by * 2u + r);
                c += rgb;
                ys[r] |= q(16.0 + 219.0 * luma(rgb)) << (8u * (k * 2u + s));
            }
        }
        c *= 0.25;
        let yl = luma(c);
        let cb = q(128.0 + 224.0 * (c.b - yl) / 1.8556);
        let cr = q(128.0 + 224.0 * (c.r - yl) / 1.5748);
        uv |= (cb | (cr << 8u)) << (16u * k);
    }
    let row0 = (by * 2u * p.out_w + bx * 4u) / 4u;
    dst[row0] = ys[0];
    dst[row0 + p.out_w / 4u] = ys[1];
    dst[(p.y_bytes + by * p.out_w + bx * 4u) / 4u] = uv;
}
"#;

pub struct Nv12 {
    pub out_w: u32,
    pub out_h: u32,
    pub frame_bytes: u64,
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    pub buffer: wgpu::Buffer,
}

impl Nv12 {
    /// `out_w` must be a multiple of 4 and `out_h` even; `src` is `ss` times both.
    pub fn new(device: &wgpu::Device, src: &wgpu::TextureView, out_w: u32, out_h: u32, ss: u32) -> Nv12 {
        assert!(out_w % 4 == 0 && out_h % 2 == 0, "NV12 output {out_w}x{out_h} must be a multiple of 4 wide and even high");
        let y_bytes = out_w * out_h;
        let frame_bytes = (y_bytes + y_bytes / 2) as u64;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("nv12"), source: wgpu::ShaderSource::Wgsl(WGSL.into()) });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("nv12"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("nv12"),
            size: frame_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let params: [u32; 4] = [out_w, out_h, ss, y_bytes];
        let uniform = wgpu::util::DeviceExt::create_buffer_init(
            device,
            &wgpu::util::BufferInitDescriptor { label: Some("nv12-params"), contents: bytemuck::cast_slice(&params), usage: wgpu::BufferUsages::UNIFORM },
        );
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("nv12"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(src) },
                wgpu::BindGroupEntry { binding: 1, resource: buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: uniform.as_entire_binding() },
            ],
        });
        Nv12 { out_w, out_h, frame_bytes, pipeline, group, buffer }
    }

    /// Records the conversion, then a copy of the result into `readback`.
    pub fn record(&self, enc: &mut wgpu::CommandEncoder, readback: &wgpu::Buffer) {
        {
            let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("nv12"), timestamp_writes: None });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.group, &[]);
            pass.dispatch_workgroups((self.out_w / 4).div_ceil(8), (self.out_h / 2).div_ceil(8), 1);
        }
        enc.copy_buffer_to_buffer(&self.buffer, 0, readback, 0, self.frame_bytes);
    }
}

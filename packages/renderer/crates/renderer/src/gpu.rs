//! Device, pipelines, the pooled offscreen allocator and the frame executor
//! (the render graph: clip masks, layer levels, atlas pages, backdrops,
//! filters). Everything is single-sample: shapes, paths and clips all carry
//! analytic coverage, so there is no MSAA and no stencil.

use wgpu::util::DeviceExt;

#[cfg(feature = "native")]
#[path = "gpu_native.rs"]
mod native;

use crate::frame::{hardware_blend, DevFilter, Frame, Op};
use crate::paths::GeomCache;
use crate::scene::{GpuPaint, GpuStop, NONE, USER_FILL};
use crate::user_shader::{KIND_EFFECT, KIND_FILL};

/// An effect index at or above this is user program `index - USER_EFFECT`.
pub const USER_EFFECT: u32 = 0x4000_0000;

pub const WORK_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const CLIP_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::R8Unorm;
/// Uniform slot size (dynamic offsets must be 256-aligned; effects need
/// room for 64 parameters).
const SLOT: u64 = 512;
/// Images and video frames: 8-bit, premultiplied, sRGB-encoded values.
const IMAGE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Box-filters one mip level into the next (bilinear sample at the centre of
/// each 2×2 block).
const MIP_WGSL: &str = r#"
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) vi: u32) -> V {
    let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
    var o: V;
    o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv = vec2f(p.x, 1.0 - p.y);
    return o;
}
@fragment fn fs(in: V) -> @location(0) vec4f {
    return textureSampleLevel(src, samp, in.uv, 0.0);
}
// Premultiplied → straight alpha, texel for texel (3D maps are straight, as
// three's textures are).
@fragment fn fs_unpremul(in: V) -> @location(0) vec4f {
    let c = textureLoad(src, vec2i(in.pos.xy), 0);
    return select(vec4f(0.0), vec4f(c.rgb / c.a, c.a), c.a > 0.0);
}
"#;

/// An uploaded image or video frame.
struct GpuImage {
    tex: wgpu::Texture,
    w: u32,
    h: u32,
    mips: u32,
    group: wgpu::BindGroup,
    /// Bumped whenever the pixels change (an upload, a surface render).
    generation: u64,
}

/// An image as a 3D map: straight alpha, a mip chain filtered in linear light
/// for sRGB maps (as `ms-render3d`'s own uploads and WebGL's generateMipmap),
/// built on the GPU from the image store and rebuilt when the image changes.
struct Map3d {
    tex: wgpu::Texture,
    generation: u64,
}

/// A 3D scene's texture `tex` taken from image `image`; `seen` is the map
/// generation last bound.
struct Binding3d {
    tex: u32,
    image: u32,
    srgb: bool,
    seen: u64,
}

// ── pooled textures ──────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum TexClass {
    /// Working colour: the canvas target, atlas pages, blur temps.
    Single,
}

struct PoolTex {
    /// Never reused, so caches can key on it across frames.
    id: u64,
    tex: wgpu::Texture,
    view: wgpu::TextureView,
    w: u32,
    h: u32,
    class: TexClass,
    in_use: bool,
    last_used: u64,
}

#[derive(Default)]
pub struct Pool {
    items: Vec<PoolTex>,
    frame: u64,
    pub created: u32,
    next_id: u64,
    /// Bumped whenever a texture is destroyed; bind groups made before are stale.
    pub generation: u64,
}

fn bucket(v: u32) -> u32 {
    // Coarse size classes so targets of slightly different sizes share textures.
    if v <= 256 { v.div_ceil(64) * 64 } else { v.div_ceil(256) * 256 }
}

impl Pool {
    fn acquire(&mut self, device: &wgpu::Device, w: u32, h: u32, class: TexClass) -> usize {
        self.acquire_fit(device, w, h, class, false)
    }

    fn acquire_fit(&mut self, device: &wgpu::Device, w: u32, h: u32, class: TexClass, exact: bool) -> usize {
        let (bw, bh) = if exact { (w, h) } else { (bucket(w.max(1)), bucket(h.max(1))) };
        let need = bw as u64 * bh as u64;
        // Best fit among free textures that are large enough, with bounded waste.
        let best = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, t)| !t.in_use && t.class == class)
            .filter(|(_, t)| if exact { t.w == bw && t.h == bh } else { t.w >= bw && t.h >= bh })
            .map(|(i, t)| (i, t.w as u64 * t.h as u64))
            .filter(|&(_, area)| area <= need * 4)
            .min_by_key(|&(_, area)| area)
            .map(|(i, _)| i);
        if let Some(i) = best {
            self.items[i].in_use = true;
            self.items[i].last_used = self.frame;
            return i;
        }
        let (format, samples, usage) = match class {
            TexClass::Single => (
                WORK_FORMAT,
                1,
                wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST,
            ),
        };
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("pooled"),
            size: wgpu::Extent3d { width: bw, height: bh, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: samples,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        });
        let view = tex.create_view(&Default::default());
        self.created += 1;
        self.next_id += 1;
        self.items.push(PoolTex { id: self.next_id, tex, view, w: bw, h: bh, class, in_use: true, last_used: self.frame });
        self.items.len() - 1
    }

    fn end_frame(&mut self) {
        self.frame += 1;
        let frame = self.frame;
        let before = self.items.len();
        self.items.retain(|t| {
            let keep = t.in_use || frame - t.last_used < 30;
            if !keep {
                t.tex.destroy();
            }
            keep
        });
        if self.items.len() != before {
            self.generation += 1;
        }
        for t in &mut self.items {
            t.in_use = false;
        }
    }

    pub fn bytes(&self) -> u64 {
        self.items
            .iter()
            .map(|t| {
                let per = match t.class {
                    TexClass::Single => 8,
                };
                t.w as u64 * t.h as u64 * per
            })
            .sum()
    }

    pub fn count(&self) -> usize {
        self.items.len()
    }
}

// ── uniforms ─────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct ViewportU {
    size: [f32; 2],
    origin: [f32; 2],
    /// Where this region starts inside its (atlas) texture.
    offset: [f32; 2],
    _pad: [f32; 2],
    flags: [u32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, Default)]
struct CompU {
    dst: [f32; 4],
    uv: [f32; 4],
    tint: [f32; 4],
    params: [f32; 4],
    back: [f32; 4],
    mask: [f32; 4],
}

/// Uniforms of one effect pass (`EffectU` in effects/_header.wgsl).
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, Default)]
struct EffectU {
    src_rect: [f32; 4],
    src_origin: [f32; 2],
    src_page: [f32; 2],
    dst_off: [f32; 2],
    dst_origin: [f32; 2],
    blur_rect: [f32; 4],
    blur_page: [f32; 2],
    blur_scale: f32,
    clip: f32,
    box_: [f32; 4],
    scale: f32,
    time: f32,
    aux_size: [f32; 2],
    /// The distance field: device origin of texel (0,0), device px per texel,
    /// max distance (0 = none); its size in texels.
    field: [f32; 4],
    field_size: [f32; 2],
    _pad: [f32; 2],
    p: [[f32; 4]; 16],
    node: [[f32; 4]; 2],
}

/// Per-frame uniform arena bound with dynamic offsets. Each value takes as
/// many 256-byte steps as it needs (most take one), but every binding is
/// `SLOT` bytes wide, so the arena keeps `SLOT` bytes past the last offset.
#[derive(Default)]
struct Uniforms {
    bytes: Vec<u8>,
    next: usize,
}

impl Uniforms {
    fn push<T: bytemuck::Pod>(&mut self, v: &T) -> u32 {
        self.push_bytes(bytemuck::bytes_of(v))
    }

    fn push_bytes(&mut self, b: &[u8]) -> u32 {
        let off = self.next;
        if self.bytes.len() < off + SLOT as usize {
            self.bytes.resize(off + SLOT as usize, 0);
        }
        self.bytes[off..off + b.len()].copy_from_slice(b);
        self.next = off + b.len().div_ceil(256) * 256;
        off as u32
    }
}

// ── pipelines ────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Pipelines {
    prim: [wgpu::RenderPipeline; 3],
    clip_mask: wgpu::RenderPipeline,
    mip: wgpu::RenderPipeline,
    mip_srgb: wgpu::RenderPipeline,
    unpremul: wgpu::RenderPipeline,
    comp: [wgpu::RenderPipeline; 3],
    comp_advanced: wgpu::RenderPipeline,
    blur: wgpu::RenderPipeline,
    blit_surface: wgpu::RenderPipeline,
    blit_rgba8: wgpu::RenderPipeline,
    /// The canvas pass drawn straight into an 8-bit output (surface or
    /// readback), by output format: prim ×3, comp ×3, comp-advanced.
    direct: Vec<(wgpu::TextureFormat, [wgpu::RenderPipeline; 7])>,
    /// Per built-in effect: its pass, and its prefilter pass if it has one.
    effects: Vec<(wgpu::RenderPipeline, Option<wgpu::RenderPipeline>)>,
}

fn blend_state(i: usize) -> wgpu::BlendState {
    use wgpu::{BlendComponent as C, BlendFactor as F, BlendOperation as O};
    let over = C { src_factor: F::One, dst_factor: F::OneMinusSrcAlpha, operation: O::Add };
    match i {
        1 => wgpu::BlendState {
            color: C { src_factor: F::One, dst_factor: F::One, operation: O::Add },
            alpha: C { src_factor: F::One, dst_factor: F::One, operation: O::Add },
        },
        2 => wgpu::BlendState {
            color: C { src_factor: F::One, dst_factor: F::OneMinusSrc, operation: O::Add },
            alpha: over,
        },
        _ => wgpu::BlendState { color: over, alpha: over },
    }
}

// ── the GPU ──────────────────────────────────────────────────────────────────

/// The adapter and device every surface on the page draws with. Getting them
/// costs a surface about 100 ms (and its pipelines more, cold), which every
/// session, still and export paid again; `prewarm` starts it before the first
/// surface asks.
#[derive(Clone)]
struct SharedDevice {
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
}

/// What surfaces of one output format share on the shared device.
#[derive(Clone)]
struct Core {
    globals_layout: wgpu::BindGroupLayout,
    comp_layout: wgpu::BindGroupLayout,
    image_layout: wgpu::BindGroupLayout,
    effect_layout: wgpu::BindGroupLayout,
    mip_layout: wgpu::BindGroupLayout,
    user_layout: wgpu::BindGroupLayout,
    user_fill_pl: wgpu::PipelineLayout,
    user_effect_pl: wgpu::PipelineLayout,
    sampler: wgpu::Sampler,
    sampler_nearest: wgpu::Sampler,
    image_sampler: wgpu::Sampler,
    pipes: Pipelines,
    direct_formats: Vec<wgpu::TextureFormat>,
}

thread_local! {
    static SHARED: std::cell::RefCell<Option<SharedDevice>> = const { std::cell::RefCell::new(None) };
    static CORES: std::cell::RefCell<Vec<(wgpu::TextureFormat, Core)>> = const { std::cell::RefCell::new(Vec::new()) };
    /// Moves on each forgotten device, so a late lost callback leaves its successor alone.
    static GENERATION: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// Gets the shared device ready, and the pipelines for the format a canvas
/// surface picks, so the first surface that mounts finds both: compiling the
/// pipelines is most of a first frame's GPU time (about a second, cold).
#[cfg(target_arch = "wasm32")]
pub async fn prewarm() -> Result<(), String> {
    let d = shared_device().await?;
    // Best effort: a surface that finds no core builds its own.
    if let Ok(canvas) = web_sys::OffscreenCanvas::new(1, 1) {
        if let Ok(surface) = d.instance.create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas)) {
            core_for(&d.device, surface_format(&surface.get_capabilities(&d.adapter)));
        }
    }
    Ok(())
}

/// The format a surface draws in; `prewarm` must pick the one `Gpu::new` will.
fn surface_format(caps: &wgpu::SurfaceCapabilities) -> wgpu::TextureFormat {
    caps.formats
        .iter()
        .copied()
        .find(|f| matches!(f, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm))
        .unwrap_or(caps.formats[0])
}

async fn shared_device() -> Result<SharedDevice, String> {
    if let Some(d) = SHARED.with(|s| s.borrow().clone()) {
        return Ok(d);
    }
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    // Native (the export sidecar, feature `native`): DX12/Vulkan/Metal.
    desc.backends = if cfg!(target_arch = "wasm32") { wgpu::Backends::BROWSER_WEBGPU } else { wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY) };
    let instance = wgpu::Instance::new(desc);
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        })
        .await
        .map_err(|e| format!("adapter: {e}"))?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("ms-renderer"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default().using_resolution(adapter.limits()),
            ..Default::default()
        })
        .await
        .map_err(|e| format!("device: {e}"))?;
    // A lost device (a driver reset, the GPU process restarting) is dropped,
    // so the next surface to mount asks for a new one.
    let generation = GENERATION.with(|g| g.get());
    device.set_device_lost_callback(move |_, _| {
        // Only if it is still the shared one: a host may have moved on already.
        if GENERATION.with(|g| g.get()) == generation {
            forget_shared_device();
        }
    });
    let d = SharedDevice { instance, adapter, device, queue };
    // Two surfaces that mounted together may both have asked; the first stays.
    Ok(SHARED.with(|s| s.borrow_mut().get_or_insert(d).clone()))
}

/// Forgets the shared device and every format's pipelines.
pub fn forget_shared_device() {
    GENERATION.with(|g| g.set(g.get().wrapping_add(1)));
    SHARED.with(|s| *s.borrow_mut() = None);
    CORES.with(|c| c.borrow_mut().clear());
}

fn core_for(device: &wgpu::Device, format: wgpu::TextureFormat) -> Core {
    if let Some(c) = CORES.with(|c| c.borrow().iter().find(|e| e.0 == format).map(|e| e.1.clone())) {
        return c;
    }
    let c = build_core(device, format);
    CORES.with(|cs| cs.borrow_mut().push((format, c.clone())));
    c
}

fn build_core(device: &wgpu::Device, format: wgpu::TextureFormat) -> Core {
    let vis = wgpu::ShaderStages::VERTEX_FRAGMENT;
    let ro_storage = wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Storage { read_only: true },
        has_dynamic_offset: false,
        min_binding_size: None,
    };
    let dyn_uniform = wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Uniform,
        has_dynamic_offset: true,
        min_binding_size: None,
    };
    let globals_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("globals"),
        entries: &[
            wgpu::BindGroupLayoutEntry { binding: 0, visibility: vis, ty: dyn_uniform, count: None },
            wgpu::BindGroupLayoutEntry { binding: 1, visibility: vis, ty: ro_storage, count: None },
            wgpu::BindGroupLayoutEntry { binding: 2, visibility: vis, ty: ro_storage, count: None },
            wgpu::BindGroupLayoutEntry { binding: 3, visibility: vis, ty: ro_storage, count: None },
            wgpu::BindGroupLayoutEntry { binding: 4, visibility: vis, ty: ro_storage, count: None },
            wgpu::BindGroupLayoutEntry { binding: 5, visibility: vis, ty: ro_storage, count: None },
            wgpu::BindGroupLayoutEntry {
                binding: 6,
                visibility: vis,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2Array,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry { binding: 7, visibility: vis, ty: ro_storage, count: None },
        ],
    });
    let tex_entry = |binding| wgpu::BindGroupLayoutEntry {
        binding,
        visibility: vis,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    };
    let comp_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("composite"),
        entries: &[
            tex_entry(0),
            tex_entry(1),
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry { binding: 3, visibility: vis, ty: dyn_uniform, count: None },
            tex_entry(4),
        ],
    });

    let prim_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("prim"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shaders/prim.wgsl").into()),
    });
    let comp_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("composite"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shaders/composite.wgsl").into()),
    });
    // group(1) of the shape pipeline: the image an image paint samples.
    let image_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("image"),
        entries: &[
            tex_entry(0),
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    });
    let prim_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("prim"),
        bind_group_layouts: &[Some(&globals_layout), Some(&image_layout)],
        immediate_size: 0,
    });
    let comp_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("composite"),
        bind_group_layouts: &[Some(&globals_layout), Some(&comp_layout)],
        immediate_size: 0,
    });

    let ms = wgpu::MultisampleState { count: 1, mask: !0, alpha_to_coverage_enabled: false };
    let ms1 = ms;
    let prim_state = wgpu::PrimitiveState { cull_mode: None, ..Default::default() };

    let make = |label: &str,
                layout: &wgpu::PipelineLayout,
                module: &wgpu::ShaderModule,
                vs: &str,
                fs: &str,
                buffers: &[Option<wgpu::VertexBufferLayout>],
                target: wgpu::ColorTargetState,
                ds: Option<wgpu::DepthStencilState>,
                msaa: wgpu::MultisampleState| {
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(layout),
            vertex: wgpu::VertexState {
                module,
                entry_point: Some(vs),
                compilation_options: Default::default(),
                buffers,
            },
            primitive: prim_state,
            depth_stencil: ds,
            multisample: msaa,
            fragment: Some(wgpu::FragmentState {
                module,
                entry_point: Some(fs),
                compilation_options: Default::default(),
                targets: &[Some(target)],
            }),
            multiview_mask: None,
            cache: None,
        })
    };
    let work_target = |b: Option<wgpu::BlendState>| wgpu::ColorTargetState {
        format: WORK_FORMAT,
        blend: b,
        write_mask: wgpu::ColorWrites::ALL,
    };

    let prim = [0, 1, 2].map(|i| {
        make("prim", &prim_layout, &prim_mod, "vs_quad", "fs_prim", &[], work_target(Some(blend_state(i))), None, ms)
    });
    let clip_mask = make(
        "clip-mask", &prim_layout, &prim_mod, "vs_clipmask", "fs_clipmask", &[],
        wgpu::ColorTargetState { format: CLIP_FORMAT, blend: None, write_mask: wgpu::ColorWrites::ALL }, None, ms,
    );
    let comp = [0, 1, 2].map(|i| {
        make("comp", &comp_pl, &comp_mod, "vs_comp", "fs_comp", &[], work_target(Some(blend_state(i))), None, ms)
    });
    let comp_advanced = make("comp-adv", &comp_pl, &comp_mod, "vs_comp", "fs_comp_advanced", &[], work_target(None), None, ms);
    let blur = make("blur", &comp_pl, &comp_mod, "vs_full", "fs_blur", &[], work_target(None), None, ms1);
    let out_target = |f| wgpu::ColorTargetState { format: f, blend: None, write_mask: wgpu::ColorWrites::ALL };
    let blit_surface = make("blit", &comp_pl, &comp_mod, "vs_full", "fs_blit", &[], out_target(format), None, ms1);
    let blit_rgba8 = make("blit-rgba8", &comp_pl, &comp_mod, "vs_full", "fs_blit", &[], out_target(wgpu::TextureFormat::Rgba8Unorm), None, ms1);
    let mut direct_formats = vec![format];
    if format != wgpu::TextureFormat::Rgba8Unorm {
        direct_formats.push(wgpu::TextureFormat::Rgba8Unorm);
    }
    let direct: Vec<(wgpu::TextureFormat, [wgpu::RenderPipeline; 7])> = direct_formats
        .into_iter()
        .filter(|f| matches!(f, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm))
        .map(|f| {
            let t = |b: Option<wgpu::BlendState>| wgpu::ColorTargetState { format: f, blend: b, write_mask: wgpu::ColorWrites::ALL };
            let set = [
                make("prim-direct", &prim_layout, &prim_mod, "vs_quad", "fs_prim", &[], t(Some(blend_state(0))), None, ms),
                make("prim-direct", &prim_layout, &prim_mod, "vs_quad", "fs_prim", &[], t(Some(blend_state(1))), None, ms),
                make("prim-direct", &prim_layout, &prim_mod, "vs_quad", "fs_prim", &[], t(Some(blend_state(2))), None, ms),
                make("comp-direct", &comp_pl, &comp_mod, "vs_comp", "fs_comp", &[], t(Some(blend_state(0))), None, ms),
                make("comp-direct", &comp_pl, &comp_mod, "vs_comp", "fs_comp", &[], t(Some(blend_state(1))), None, ms),
                make("comp-direct", &comp_pl, &comp_mod, "vs_comp", "fs_comp", &[], t(Some(blend_state(2))), None, ms),
                make("comp-adv-direct", &comp_pl, &comp_mod, "vs_comp", "fs_comp_advanced", &[], t(None), None, ms),
            ];
            (f, set)
        })
        .collect();

    let image_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("image-trilinear"),
        // Repeat in hardware so tiled images wrap seamlessly across tile
        // edges; clamp, mirror and decal are applied to uv in the shader.
        address_mode_u: wgpu::AddressMode::Repeat,
        address_mode_v: wgpu::AddressMode::Repeat,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::MipmapFilterMode::Linear,
        ..Default::default()
    });
    let mip_mod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("mip"),
        source: wgpu::ShaderSource::Wgsl(MIP_WGSL.into()),
    });
    let mip_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("mip"),
        entries: &[
            tex_entry(0),
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    });
    let mip_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("mip"),
        bind_group_layouts: &[Some(&mip_layout)],
        immediate_size: 0,
    });
    let mip = make("mip", &mip_pl, &mip_mod, "vs", "fs", &[], out_target(IMAGE_FORMAT), None, ms1);
    let mip_srgb = make("mip-srgb", &mip_pl, &mip_mod, "vs", "fs", &[], out_target(wgpu::TextureFormat::Rgba8UnormSrgb), None, ms1);
    let unpremul = make("unpremul", &mip_pl, &mip_mod, "vs", "fs_unpremul", &[], out_target(IMAGE_FORMAT), None, ms1);
    let effect_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("effect"),
        entries: &[
            tex_entry(0),
            tex_entry(1),
            tex_entry(2),
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry { binding: 5, visibility: vis, ty: dyn_uniform, count: None },
            tex_entry(6),
        ],
    });
    let effect_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("effect"),
        bind_group_layouts: &[Some(&effect_layout)],
        immediate_size: 0,
    });
    let direct_formats: Vec<wgpu::TextureFormat> = direct.iter().map(|d| d.0).collect();
    let user_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("user-params"),
        entries: &[wgpu::BindGroupLayoutEntry { binding: 0, visibility: vis, ty: dyn_uniform, count: None }],
    });
    let user_fill_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("user-fill"),
        bind_group_layouts: &[Some(&globals_layout), Some(&image_layout), Some(&user_layout)],
        immediate_size: 0,
    });
    let user_effect_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("user-effect"),
        bind_group_layouts: &[Some(&effect_layout), Some(&user_layout)],
        immediate_size: 0,
    });

    let effects: Vec<_> = crate::effects::EFFECTS
        .iter()
        .map(|(name, body)| {
            let (src, prefilter) = crate::effects::module(body);
            let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(name),
                source: wgpu::ShaderSource::Wgsl(src.into()),
            });
            let main = make(name, &effect_pl, &module, "vs_effect", "fs_effect", &[], work_target(None), None, ms1);
            let pre = prefilter
                .then(|| make(name, &effect_pl, &module, "vs_effect", "fs_prefilter", &[], work_target(None), None, ms1));
            (main, pre)
        })
        .collect();
    let sampler_nearest = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("nearest-clamp"),
        ..Default::default()
    });
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("linear-clamp"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    Core {
        globals_layout,
        comp_layout,
        image_layout,
        effect_layout,
        mip_layout,
        user_layout,
        user_fill_pl,
        user_effect_pl,
        sampler,
        sampler_nearest,
        image_sampler,
        pipes: Pipelines { effects, prim, clip_mask, mip, mip_srgb, unpremul, comp, comp_advanced, blur, blit_surface, blit_rgba8, direct },
        direct_formats,
    }
}

pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    /// None for an offscreen renderer (native export), which draws into a
    /// view it is handed and only reads `config` for its size and format.
    pub surface: Option<wgpu::Surface<'static>>,
    config: wgpu::SurfaceConfiguration,
    globals_layout: wgpu::BindGroupLayout,
    comp_layout: wgpu::BindGroupLayout,
    pipes: Pipelines,
    sampler: wgpu::Sampler,
    dummy: wgpu::TextureView,
    prim_buf: wgpu::Buffer,
    paint_buf: wgpu::Buffer,
    stop_buf: wgpu::Buffer,
    uniform_buf: wgpu::Buffer,
    globals_bg: wgpu::BindGroup,
    /// Same buffers with a dummy clip atlas, for the pass that writes the atlas.
    globals_noclip: wgpu::BindGroup,
    clip_buf: wgpu::Buffer,
    clip_atlas: ClipAtlas,
    dummy_array: wgpu::TextureView,
    seg_buf: wgpu::Buffer,
    band_buf: wgpu::Buffer,
    pub pool: Pool,
    /// Composite bind groups by (source, backdrop, mask) texture ids.
    comp_groups: crate::fxhash::FxHashMap<(u64, u64, u64), wgpu::BindGroup>,
    comp_groups_gen: (u64, u64),
    pub linear: bool,
    pub dither: bool,
    image_layout: wgpu::BindGroupLayout,
    effect_layout: wgpu::BindGroupLayout,
    sampler_nearest: wgpu::Sampler,
    /// Effect bind groups by (input, blurred, extra, field) texture ids.
    effect_groups: crate::fxhash::FxHashMap<(u64, u64, u64, u64), wgpu::BindGroup>,
    /// Distance-field textures by field id, with the render they were last used in.
    fields: std::collections::HashMap<u64, (wgpu::TextureView, u64)>,
    renders: u64,
    mip_layout: wgpu::BindGroupLayout,
    image_sampler: wgpu::Sampler,
    images: Vec<Option<GpuImage>>,
    /// 3D scenes drawn into image textures (by image id), on this device.
    scenes3d: std::collections::HashMap<u32, ms_render3d::Renderer3D>,
    /// Scenes changed since they were last drawn.
    dirty3d: Vec<u32>,
    /// Per scene, the textures it takes from images (and surfaces).
    bindings3d: std::collections::HashMap<u32, Vec<Binding3d>>,
    /// 3D maps by (image, sRGB).
    maps3d: std::collections::HashMap<(u32, bool), Map3d>,
    /// Bound when a draw run samples no image.
    no_image: wgpu::BindGroup,
    pub adapter_info: String,
    pub last_passes: u32,
    pub last_draws: u32,
    /// `Frame::build_id` of the prims in `prim_buf` (0 = unknown).
    prim_owner: u64,
    /// User (WGSL) programs by id, on this device (user_shader.rs).
    user: Vec<Option<UserProgram>>,
    /// group(2) of a user fill, group(1) of a user effect: its `Params`.
    user_layout: wgpu::BindGroupLayout,
    user_fill_pl: wgpu::PipelineLayout,
    user_effect_pl: wgpu::PipelineLayout,
    /// The uniform arena bound as `Params` (rebuilt with the arena).
    user_group: Option<wgpu::BindGroup>,
    /// Output formats of `Pipelines::direct`, in order.
    direct_formats: Vec<wgpu::TextureFormat>,
}

/// A user program: its module, and once built its pipelines (an effect: the
/// pass; a fill: the shape pass into the work format, then one per direct
/// output format). Until then its draws are skipped.
struct UserProgram {
    kind: u32,
    module: wgpu::ShaderModule,
    pipes: Vec<wgpu::RenderPipeline>,
}

fn storage(device: &wgpu::Device, label: &str, size: u64, usage: wgpu::BufferUsages) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: size.max(256),
        usage: usage | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

impl Drop for Gpu {
    fn drop(&mut self) {
        for b in [&self.prim_buf, &self.paint_buf, &self.stop_buf, &self.uniform_buf, &self.seg_buf, &self.band_buf, &self.clip_buf] {
            b.destroy();
        }
        for t in &self.pool.items {
            t.tex.destroy();
        }
        for img in self.images.iter().flatten() {
            img.tex.destroy();
        }
        self.clip_atlas._tex.destroy();
    }
}

impl Gpu {
    pub async fn new(target: wgpu::SurfaceTarget<'static>, width: u32, height: u32) -> Result<Gpu, String> {
        Self::create(Some(target), width, height).await
    }

    /// A renderer with no surface, drawing in RGBA8 into views it is handed.
    #[cfg(feature = "native")]
    pub async fn new_offscreen(width: u32, height: u32) -> Result<Gpu, String> {
        Self::create(None, width, height).await
    }

    async fn create(target: Option<wgpu::SurfaceTarget<'static>>, width: u32, height: u32) -> Result<Gpu, String> {
        let SharedDevice { instance, adapter, device, queue } = shared_device().await?;
        let surface = target.map(|t| instance.create_surface(t).map_err(|e| format!("surface: {e}"))).transpose()?;
        let info = adapter.get_info();

        let format = surface.as_ref().map_or(wgpu::TextureFormat::Rgba8Unorm, |s| surface_format(&s.get_capabilities(&adapter)));
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: Default::default(),
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            // Premultiplied, so a clear left transparent shows the page behind
            // the canvas (a host's panel around the frame). Every WebGPU canvas
            // supports it, though wgpu's capabilities list only Opaque.
            alpha_mode: wgpu::CompositeAlphaMode::PreMultiplied,
            view_formats: vec![],
        };
        if let Some(s) = &surface {
            s.configure(&device, &config);
        }

        let Core { globals_layout, comp_layout, image_layout, effect_layout, mip_layout, user_layout, user_fill_pl, user_effect_pl, sampler, sampler_nearest, image_sampler, pipes, direct_formats } = core_for(&device, format);
        let dummy = device
            .create_texture_with_data(
                &queue,
                &wgpu::TextureDescriptor {
                    label: Some("dummy"),
                    size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::util::TextureDataOrder::LayerMajor,
                &[0, 0, 0, 0],
            )
            .create_view(&Default::default());

        let s = wgpu::BufferUsages::STORAGE;
        let prim_buf = storage(&device, "prims", 1 << 20, s);
        let paint_buf = storage(&device, "paints", 1 << 14, s);
        let stop_buf = storage(&device, "stops", 1 << 14, s);
        let uniform_buf = storage(&device, "uniforms", SLOT * 1024, wgpu::BufferUsages::UNIFORM);
        let seg_buf = storage(&device, "segments", 1 << 20, s);
        let band_buf = storage(&device, "bands", 1 << 20, s);
        let clip_buf = storage(&device, "clips", 1 << 14, s);
        let clip_atlas = ClipAtlas::new(&device, 2048, 1);
        let dummy_array = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("dummy-clip"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: CLIP_FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
            .create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
        let globals_bg = Self::make_globals(
            &device, &globals_layout, &uniform_buf, &prim_buf, &paint_buf, &stop_buf, &seg_buf, &band_buf,
            &clip_atlas.array_view, &clip_buf,
        );
        let globals_noclip = Self::make_globals(
            &device, &globals_layout, &uniform_buf, &prim_buf, &paint_buf, &stop_buf, &seg_buf, &band_buf,
            &dummy_array, &clip_buf,
        );

        let no_image = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("no-image"),
            layout: &image_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&dummy) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&image_sampler) },
            ],
        });
        Ok(Gpu {
            device,
            queue,
            surface,
            config,
            globals_layout,
            comp_layout,
            pipes,
            sampler,
            dummy,
            prim_buf,
            paint_buf,
            stop_buf,
            uniform_buf,
            globals_bg,
            globals_noclip,
            clip_buf,
            clip_atlas,
            dummy_array,
            seg_buf,
            band_buf,
            pool: Pool::default(),
            comp_groups: Default::default(),
            comp_groups_gen: (0, 0),
            linear: false,
            dither: true,
            no_image,
            image_layout,
            effect_layout,
            sampler_nearest,
            effect_groups: Default::default(),
            fields: Default::default(),
            renders: 0,
            mip_layout,
            image_sampler,
            images: Vec::new(),
            scenes3d: Default::default(),
            dirty3d: Vec::new(),
            bindings3d: Default::default(),
            maps3d: Default::default(),
            adapter_info: format!("{} ({:?})", info.name, info.backend),
            last_passes: 0,
            prim_owner: 0,
            last_draws: 0,
            user: Vec::new(),
            user_layout,
            user_fill_pl,
            user_effect_pl,
            user_group: None,
            direct_formats,
        })
    }

    /// Adds user program `id` (a validated module, see user_shader.rs). Its
    /// draws are skipped until `user_build`.
    pub fn user_add(&mut self, id: u32, kind: u32, wgsl: &str) {
        let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(if kind == KIND_FILL { "user-fill" } else { "user-effect" }),
            source: wgpu::ShaderSource::Wgsl(wgsl.into()),
        });
        let i = id as usize;
        if self.user.len() <= i {
            self.user.resize_with(i + 1, || None);
        }
        self.user[i] = Some(UserProgram { kind, module, pipes: Vec::new() });
    }

    /// Creates program `id`'s pipelines (after the browser compiled them
    /// asynchronously from the same descriptors, so this hits its cache).
    pub fn user_build(&mut self, id: u32) {
        let Some(Some(p)) = self.user.get(id as usize) else { return };
        if !p.pipes.is_empty() {
            return;
        }
        let make = |layout: &wgpu::PipelineLayout, vs: &str, fs: &str, format: wgpu::TextureFormat, blend: Option<wgpu::BlendState>| {
            self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("user"),
                layout: Some(layout),
                vertex: wgpu::VertexState { module: &p.module, entry_point: Some(vs), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
                depth_stencil: None,
                multisample: wgpu::MultisampleState { count: 1, mask: !0, alpha_to_coverage_enabled: false },
                fragment: Some(wgpu::FragmentState {
                    module: &p.module,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let pipes = if p.kind == KIND_FILL {
            std::iter::once(WORK_FORMAT)
                .chain(self.direct_formats.iter().copied())
                .map(|f| make(&self.user_fill_pl, "ms_vs_quad", "ms_fs_prim", f, Some(blend_state(0))))
                .collect()
        } else {
            vec![make(&self.user_effect_pl, "ms_vs_effect", "ms_fs_effect", WORK_FORMAT, None)]
        };
        if let Some(Some(p)) = self.user.get_mut(id as usize) {
            p.pipes = pipes;
        }
    }

    pub fn user_remove(&mut self, id: u32) {
        if let Some(p) = self.user.get_mut(id as usize) {
            *p = None;
        }
    }

    /// The output formats of a user program's pipelines, in pipeline order.
    pub fn user_formats(&self, kind: u32) -> Vec<wgpu::TextureFormat> {
        if kind == KIND_FILL {
            std::iter::once(WORK_FORMAT).chain(self.direct_formats.iter().copied()).collect()
        } else {
            vec![WORK_FORMAT]
        }
    }

    fn user_pipe(&self, id: u32, kind: u32, k: usize) -> Option<&wgpu::RenderPipeline> {
        let p = self.user.get(id as usize)?.as_ref()?;
        (p.kind == kind).then(|| p.pipes.get(k)).flatten()
    }

    /// Whether effect `index` (built-in or user) can run this frame.
    fn effect_ready(&self, index: u32) -> bool {
        if index >= USER_EFFECT {
            return self.user_pipe(index - USER_EFFECT, KIND_EFFECT, 0).is_some();
        }
        (index as usize) < self.pipes.effects.len()
    }

    fn has_prefilter(&self, index: u32) -> bool {
        index < USER_EFFECT && self.pipes.effects[index as usize].1.is_some()
    }

    fn user_group(&mut self) -> wgpu::BindGroup {
        if let Some(g) = &self.user_group {
            return g.clone();
        }
        let g = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("user-params"),
            layout: &self.user_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &self.uniform_buf, offset: 0, size: wgpu::BufferSize::new(SLOT) }),
            }],
        });
        self.user_group = Some(g.clone());
        g
    }

    #[allow(clippy::too_many_arguments)]
    fn make_globals(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        uniform: &wgpu::Buffer,
        prims: &wgpu::Buffer,
        paints: &wgpu::Buffer,
        stops: &wgpu::Buffer,
        segs: &wgpu::Buffer,
        bands: &wgpu::Buffer,
        clip_atlas: &wgpu::TextureView,
        clips: &wgpu::Buffer,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globals"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: uniform,
                        offset: 0,
                        size: wgpu::BufferSize::new(SLOT),
                    }),
                },
                wgpu::BindGroupEntry { binding: 1, resource: prims.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: paints.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: stops.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: segs.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 5, resource: bands.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 6, resource: wgpu::BindingResource::TextureView(clip_atlas) },
                wgpu::BindGroupEntry { binding: 7, resource: clips.as_entire_binding() },
            ],
        })
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        self.config.width = w.max(1);
        self.config.height = h.max(1);
        if let Some(s) = &self.surface {
            s.configure(&self.device, &self.config);
        }
    }

    pub fn size(&self) -> (u32, u32) {
        (self.config.width, self.config.height)
    }

    /// Grows a buffer (recreating it) when `need` bytes do not fit.
    fn grow(&mut self, which: u8, need: u64) -> bool {
        let (buf, label, usage) = match which {
            0 => (&mut self.prim_buf, "prims", wgpu::BufferUsages::STORAGE),
            1 => (&mut self.paint_buf, "paints", wgpu::BufferUsages::STORAGE),
            2 => (&mut self.stop_buf, "stops", wgpu::BufferUsages::STORAGE),
            3 => (&mut self.uniform_buf, "uniforms", wgpu::BufferUsages::UNIFORM),
            6 => (&mut self.clip_buf, "clips", wgpu::BufferUsages::STORAGE),
            4 => (&mut self.seg_buf, "segments", wgpu::BufferUsages::STORAGE),
            _ => (&mut self.band_buf, "bands", wgpu::BufferUsages::STORAGE),
        };
        if buf.size() >= need {
            return false;
        }
        let size = need.next_power_of_two();
        buf.destroy();
        *buf = storage(&self.device, label, size, usage);
        true
    }

    pub fn upload_paints(&mut self, paints: &[GpuPaint], stops: &[GpuStop]) {
        let a = self.grow(1, std::mem::size_of_val(paints) as u64);
        let b = self.grow(2, std::mem::size_of_val(stops) as u64);
        self.queue.write_buffer(&self.paint_buf, 0, bytemuck::cast_slice(paints));
        self.queue.write_buffer(&self.stop_buf, 0, bytemuck::cast_slice(stops));
        if a || b {
            self.rebuild_globals();
        }
    }

    /// Uploads the frame's distance fields not yet on the GPU (R16Float, as
    /// the engine's half-float image) and drops those unused for a while.
    fn upload_fields(&mut self, frame: &Frame) {
        self.renders += 1;
        let now = self.renders;
        for f in &frame.fields {
            if let Some(e) = self.fields.get_mut(&f.id) {
                e.1 = now;
                continue;
            }
            let size = wgpu::Extent3d { width: f.w, height: f.h, depth_or_array_layers: 1 };
            let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("distance-field"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R16Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                bytemuck::cast_slice(&f.texels),
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(f.w * 2), rows_per_image: Some(f.h) },
                size,
            );
            self.fields.insert(f.id, (tex.create_view(&Default::default()), now));
        }
        let before = self.fields.len();
        self.fields.retain(|_, e| now - e.1 < 120);
        if self.fields.len() != before {
            self.effect_groups.clear();
        }
    }

    fn rebuild_globals(&mut self) {
        self.comp_groups.clear();
        self.effect_groups.clear();
        self.user_group = None;
        let make = |clip: &wgpu::TextureView| {
            Self::make_globals(
                &self.device,
                &self.globals_layout,
                &self.uniform_buf,
                &self.prim_buf,
                &self.paint_buf,
                &self.stop_buf,
                &self.seg_buf,
                &self.band_buf,
                clip,
                &self.clip_buf,
            )
        };
        self.globals_bg = make(&self.clip_atlas.array_view);
        self.globals_noclip = make(&self.dummy_array);
    }

    fn upload_geometry(&mut self, geom: &mut GeomCache) {
        let sbytes = (geom.segs.len().max(1) * 16) as u64;
        let bbytes = (geom.bands.len().max(1) * 4) as u64;
        let grew = self.grow(4, sbytes) | self.grow(5, bbytes);
        let full = geom.reset || grew;
        let (s0, b0) = if full { (0, 0) } else { (geom.uploaded_segs, geom.uploaded_bands) };
        if geom.segs.len() > s0 {
            self.queue.write_buffer(&self.seg_buf, (s0 * 16) as u64, bytemuck::cast_slice(&geom.segs[s0..]));
        }
        if geom.bands.len() > b0 {
            self.queue.write_buffer(&self.band_buf, (b0 * 4) as u64, bytemuck::cast_slice(&geom.bands[b0..]));
        }
        geom.uploaded_segs = geom.segs.len();
        geom.uploaded_bands = geom.bands.len();
        geom.reset = false;
        if grew {
            self.rebuild_globals();
        }
    }

    /// Uploads (or replaces) image `id` from a browser image source with a
    /// GPU copy (no readback). Video frames reuse their texture when the size
    /// is unchanged; `mipmaps` builds a mip chain for minified sampling.
    #[cfg(target_arch = "wasm32")]
    pub fn upload_image(&mut self, id: u32, source: wgpu::ExternalImageSource, w: u32, h: u32, mipmaps: bool) {
        let mips = if mipmaps { 32 - w.max(h).max(1).leading_zeros() } else { 1 };
        self.ensure_image(id, w, h, mips);
        self.upload_external(id, source, w, h);
    }

    /// A 3D scene as image `id`, `w`×`h` px: drawn by `ms-render3d` straight
    /// into the image texture on this device before the next frame's 2D
    /// passes, and only again when the scene changes.
    pub fn set_scene3d(&mut self, id: u32, w: u32, h: u32, scene: ms_render3d::Scene) {
        self.ensure_image(id, w, h, 1);
        let renderer = self
            .scenes3d
            .entry(id)
            .or_insert_with(|| ms_render3d::Renderer3D::with_shared(&ms_render3d::Shared3D::get(&self.device, &self.queue), IMAGE_FORMAT));
        renderer.set_scene(scene);
        if !self.dirty3d.contains(&id) {
            self.dirty3d.push(id);
        }
    }

    /// How many times image `id`'s content has changed (0 when it has none).
    pub fn image_generation(&self, id: u32) -> u64 {
        self.images.get(id as usize).and_then(|i| i.as_ref()).map_or(0, |i| i.generation)
    }

    pub fn scene3d_skipped(&self, id: u32) -> Vec<String> {
        self.scenes3d.get(&id).map(|r| r.scene().skipped.iter().map(|s| s.to_string()).collect()).unwrap_or_default()
    }

    /// Scene `scene`'s texture `tex` is image `image` (an uploaded image or a
    /// surface), converted to a 3D map on the GPU.
    pub fn scene3d_bind(&mut self, scene: u32, tex: u32, image: u32, srgb: bool) {
        let list = self.bindings3d.entry(scene).or_default();
        // The host binds again every frame; the same binding keeps its map and draws nothing new.
        if list.iter().any(|b| b.tex == tex && b.image == image && b.srgb == srgb) {
            return;
        }
        list.retain(|b| b.tex != tex);
        list.push(Binding3d { tex, image, srgb, seen: 0 });
    }

    /// Scene `scene`'s texture `tex` from straight RGBA8 rows (a data texture).
    pub fn scene3d_pixels(&mut self, scene: u32, tex: u32, rgba: &[u8], w: u32, h: u32, srgb: bool) {
        if let Some(r) = self.scenes3d.get_mut(&scene) {
            r.upload_texture(tex, rgba, w, h, srgb);
            if !self.dirty3d.contains(&scene) {
                self.dirty3d.push(scene);
            }
        }
    }

    /// Brings every bound map up to date with its image and rebinds the
    /// scenes whose maps changed (they redraw).
    pub fn refresh_maps3d(&mut self) {
        if self.bindings3d.is_empty() {
            return;
        }
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("maps3d") });
        let mut built = false;
        let scenes: Vec<u32> = self.bindings3d.keys().copied().collect();
        for scene in scenes {
            let n = self.bindings3d[&scene].len();
            for k in 0..n {
                let (image, srgb, tex, seen) = {
                    let b = &self.bindings3d[&scene][k];
                    (b.image, b.srgb, b.tex, b.seen)
                };
                let Some(Some(img)) = self.images.get(image as usize) else { continue };
                let generation = img.generation;
                if generation == 0 {
                    continue;
                }
                let fresh = matches!(self.maps3d.get(&(image, srgb)), Some(m) if m.generation == generation);
                if !fresh {
                    let tex = self.build_map3d(&mut enc, image, srgb);
                    self.maps3d.insert((image, srgb), Map3d { tex, generation });
                    built = true;
                }
                if seen != generation {
                    let format = if srgb { wgpu::TextureFormat::Rgba8UnormSrgb } else { IMAGE_FORMAT };
                    let view = self.maps3d[&(image, srgb)].tex.create_view(&wgpu::TextureViewDescriptor {
                        format: Some(format),
                        ..Default::default()
                    });
                    if let Some(r) = self.scenes3d.get_mut(&scene) {
                        r.set_texture_view(tex, view);
                    }
                    self.bindings3d.get_mut(&scene).unwrap()[k].seen = generation;
                    if !self.dirty3d.contains(&scene) {
                        self.dirty3d.push(scene);
                    }
                }
            }
        }
        if built {
            self.queue.submit([enc.finish()]);
        }
    }

    /// Image `image` as a straight-alpha map with a full mip chain, each level
    /// box-filtered from the one above (through an sRGB view for sRGB maps, so
    /// the average is taken in linear light).
    fn build_map3d(&self, enc: &mut wgpu::CommandEncoder, image: u32, srgb: bool) -> wgpu::Texture {
        let img = self.images[image as usize].as_ref().unwrap();
        let mips = 32 - img.w.max(img.h).max(1).leading_zeros();
        let tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("map3d"),
            size: wgpu::Extent3d { width: img.w.max(1), height: img.h.max(1), depth_or_array_layers: 1 },
            mip_level_count: mips,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: IMAGE_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[wgpu::TextureFormat::Rgba8UnormSrgb],
        });
        let format = if srgb { wgpu::TextureFormat::Rgba8UnormSrgb } else { IMAGE_FORMAT };
        let level = |t: &wgpu::Texture, l: u32, f: wgpu::TextureFormat| {
            t.create_view(&wgpu::TextureViewDescriptor {
                format: Some(f),
                base_mip_level: l,
                mip_level_count: Some(1),
                ..Default::default()
            })
        };
        let src0 = level(&img.tex, 0, IMAGE_FORMAT);
        let mut step = |src: &wgpu::TextureView, dst: &wgpu::TextureView, pipe: &wgpu::RenderPipeline| {
            let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("map3d"),
                layout: &self.mip_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(src) },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                ],
            });
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("map3d"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: dst,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(pipe);
            pass.set_bind_group(0, &group, &[]);
            pass.draw(0..3, 0..1);
        };
        step(&src0, &level(&tex, 0, IMAGE_FORMAT), &self.pipes.unpremul);
        let pipe = if srgb { &self.pipes.mip_srgb } else { &self.pipes.mip };
        for l in 1..mips {
            step(&level(&tex, l - 1, format), &level(&tex, l, format), pipe);
        }
        tex
    }

    /// Draws the 3D scenes (and maps) that changed into their images.
    pub fn prepare3d(&mut self) {
        self.refresh_maps3d();
        self.draw_scenes3d();
    }

    pub fn draw_scenes3d(&mut self) {
        if self.dirty3d.is_empty() {
            return;
        }
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("scenes3d") });
        for id in std::mem::take(&mut self.dirty3d) {
            let (Some(Some(img)), Some(renderer)) = (self.images.get(id as usize), self.scenes3d.get_mut(&id)) else {
                continue;
            };
            let view = img.tex.create_view(&Default::default());
            renderer.render(&mut enc, &view, img.w, img.h);
            self.images[id as usize].as_mut().unwrap().generation += 1;
        }
        self.queue.submit([enc.finish()]);
    }

    /// Image `id`'s texture and bind group, (re)made when its size or mip
    /// count changes.
    fn ensure_image(&mut self, id: u32, w: u32, h: u32, mips: u32) {
        let i = id as usize;
        if self.images.len() <= i {
            self.images.resize_with(i + 1, || None);
        }
        let reuse = matches!(&self.images[i], Some(img) if img.w == w && img.h == h && img.mips == mips);
        if !reuse {
            if let Some(old) = self.images[i].take() {
                old.tex.destroy();
            }
            let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("image"),
                size: wgpu::Extent3d { width: w.max(1), height: h.max(1), depth_or_array_layers: 1 },
                mip_level_count: mips,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: IMAGE_FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("image"),
                layout: &self.image_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&tex.create_view(&Default::default())),
                    },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.image_sampler) },
                ],
            });
            self.images[i] = Some(GpuImage { tex, w, h, mips, group, generation: 0 });
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn upload_external(&mut self, id: u32, source: wgpu::ExternalImageSource, w: u32, h: u32) {
        self.images[id as usize].as_mut().unwrap().generation += 1;
        let img = self.images[id as usize].as_ref().unwrap();
        self.queue.copy_external_image_to_texture(
            &wgpu::CopyExternalImageSourceInfo { source, origin: wgpu::Origin2d::ZERO, flip_y: false },
            wgpu::CopyExternalImageDestInfo {
                texture: &img.tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
                color_space: wgpu::PredefinedColorSpace::Srgb,
                premultiplied_alpha: true,
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.build_mips(id);
    }

    /// Fills image `id`'s mip levels below 0 from level 0.
    fn build_mips(&mut self, id: u32) {
        let img = self.images[id as usize].as_ref().unwrap();
        if img.mips > 1 {
            let mut enc = self.device.create_command_encoder(&Default::default());
            for level in 1..img.mips {
                let src = img.tex.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: level - 1,
                    mip_level_count: Some(1),
                    ..Default::default()
                });
                let dst = img.tex.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: level,
                    mip_level_count: Some(1),
                    ..Default::default()
                });
                let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("mip"),
                    layout: &self.mip_layout,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                    ],
                });
                let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("mip"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &dst,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&self.pipes.mip);
                pass.set_bind_group(0, &group, &[]);
                pass.draw(0..3, 0..1);
            }
            self.queue.submit([enc.finish()]);
        }
    }

    /// Image `id` is no longer a 3D scene: its renderer and bindings go, or
    /// it would go on drawing the scene into whatever the id holds now.
    pub fn drop_scene3d(&mut self, id: u32) {
        self.scenes3d.remove(&id);
        self.dirty3d.retain(|&d| d != id);
        self.bindings3d.remove(&id);
    }

    pub fn free_image(&mut self, id: u32) {
        self.drop_scene3d(id);
        self.maps3d.retain(|(i, _), _| *i != id);
        if let Some(slot) = self.images.get_mut(id as usize)
            && let Some(img) = slot.take()
        {
            img.tex.destroy();
        }
    }

    /// Packs the frame's clip regions into the clip atlas, uploads the clip
    /// table and returns, per atlas layer, the clips drawn into it.
    fn upload_clips(&mut self, frame: &Frame) -> Vec<Vec<u32>> {
        let sizes: Vec<[u32; 2]> = frame
            .clips
            .iter()
            .map(|c| [(c.rect[2] - c.rect[0]).max(1) as u32, (c.rect[3] - c.rect[1]).max(1) as u32])
            .collect();
        let max_dim = self.device.limits().max_texture_dimension_2d;
        let (place, pages) = pack(&sizes, max_dim);
        let dim = pages.iter().map(|p| p[0].max(p[1])).max().unwrap_or(1).max(PAGE).min(max_dim);
        let layers = pages.len().max(1) as u32;
        let mut rebuild = false;
        if self.clip_atlas.dim < dim || self.clip_atlas.layers < layers {
            let d = dim.max(self.clip_atlas.dim);
            let l = layers.max(self.clip_atlas.layers);
            self.clip_atlas = ClipAtlas::new(&self.device, d, l);
            rebuild = true;
        }
        let table: Vec<ClipGpu> = frame
            .clips
            .iter()
            .enumerate()
            .map(|(i, c)| ClipGpu {
                region: [c.rect[0] as f32, c.rect[1] as f32, c.rect[2] as f32, c.rect[3] as f32],
                atlas: [place[i].1 as f32, place[i].2 as f32, place[i].0 as f32, 0.0],
                link: [c.prim, c.parent, 0, 0],
            })
            .collect();
        rebuild |= self.grow(6, (table.len().max(1) * std::mem::size_of::<ClipGpu>()) as u64);
        if !table.is_empty() {
            self.queue.write_buffer(&self.clip_buf, 0, bytemuck::cast_slice(&table));
        }
        if rebuild {
            self.rebuild_globals();
        }
        let mut per_page = vec![Vec::new(); pages.len()];
        for (i, p) in place.iter().enumerate() {
            per_page[p.0].push(i as u32);
        }
        per_page
    }

    /// Records and submits one frame. `out` is the final colour view (canvas or
    /// readback texture) and `rgba8` selects the matching blit pipeline.
    pub fn render(
        &mut self,
        frame: &Frame,
        geom: &mut GeomCache,
        out: &wgpu::TextureView,
        rgba8: bool,
        clear: [f32; 4],
        extra: Option<Box<dyn FnOnce(&mut wgpu::CommandEncoder)>>,
    ) {
        self.prepare3d();
        let (w, h) = self.size();
        self.render_sized(frame, geom, out, w, h, rgba8, clear, extra);
    }

    /// A 2D subtree's frame into image `id` (a `Tex.surface` source), whose
    /// 3D maps then rebuild.
    pub fn render_surface(&mut self, frame: &Frame, geom: &mut GeomCache, id: u32) {
        let Some(Some(img)) = self.images.get(id as usize) else { return };
        let (w, h) = (img.w, img.h);
        let view = img.tex.create_view(&Default::default());
        self.render_sized(frame, geom, &view, w, h, true, [0.0; 4], None);
        self.images[id as usize].as_mut().unwrap().generation += 1;
    }

    /// Image `id` sized `w`×`h`, for a surface to render into.
    pub fn ensure_surface(&mut self, id: u32, w: u32, h: u32) {
        self.ensure_image(id, w, h, 1);
    }

    /// Writes the frame's prims, skipping what the buffer already holds: all
    /// of them when this frame was uploaded last, else the ranges the builder
    /// placed exactly as in the build uploaded last.
    fn upload_prims(&mut self, frame: &Frame, grew: bool) {
        let owner = std::mem::replace(&mut self.prim_owner, frame.build_id);
        if frame.prims.is_empty() || (!grew && owner == frame.build_id) {
            return;
        }
        let bytes: &[u8] = bytemuck::cast_slice(&frame.prims);
        let size = std::mem::size_of::<crate::frame::Prim>();
        if grew || frame.prev_build_id == 0 || owner != frame.prev_build_id || frame.clean.is_empty() {
            self.queue.write_buffer(&self.prim_buf, 0, bytes);
            return;
        }
        // Gaps between clean ranges; short clean ranges are rewritten rather
        // than split the write.
        let mut from = 0usize;
        for r in &frame.clean {
            let (a, b) = (r[0] as usize, r[1] as usize);
            if b - a < 64 {
                continue;
            }
            if a > from {
                self.queue.write_buffer(&self.prim_buf, (from * size) as u64, &bytes[from * size..a * size]);
            }
            from = b;
        }
        if from < frame.prims.len() {
            self.queue.write_buffer(&self.prim_buf, (from * size) as u64, &bytes[from * size..]);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn render_sized(
        &mut self,
        frame: &Frame,
        geom: &mut GeomCache,
        out: &wgpu::TextureView,
        w: u32,
        h: u32,
        rgba8: bool,
        clear: [f32; 4],
        extra: Option<Box<dyn FnOnce(&mut wgpu::CommandEncoder)>>,
    ) {
        self.upload_fields(frame);
        let pbytes = (frame.prims.len().max(1) * std::mem::size_of::<crate::frame::Prim>()) as u64;
        // First guess at uniform slots; `run` may need more (see the retry).
        let slots = 16 + frame.layers.len() as u64 * 16;
        let grew_prims = self.grow(0, pbytes);
        let grew = grew_prims | self.grow(3, slots * SLOT);
        if grew {
            self.rebuild_globals();
        }
        self.upload_prims(frame, grew_prims);
        self.upload_geometry(geom);
        let clip_pages = self.upload_clips(frame);

        let flags = [self.linear as u32, self.dither as u32, 0, 0];
        let (mut enc, uniforms, passes, draws) = loop {
            let enc = self.device.create_command_encoder(&Default::default());
            let mut ex = Exec {
                gpu: &mut *self,
                enc,
                pass: None,
                ready: Vec::new(),
                comp_cache: Vec::new(),
                cur_vp: 0,
                uniforms: Uniforms::default(),
                flags,
                passes: 0,
                draws: 0,
                cur_pipe: usize::MAX,
                cur_image: u32::MAX - 1,
                direct: None,
            };
            ex.clip_masks(frame, &clip_pages);
            ex.run(frame, w, h, clear, out, rgba8);
            let Exec { enc, uniforms, passes, draws, .. } = ex;
            // Backdrop replays make the slot count data-dependent: if the arena
            // outgrew the buffer, grow it and record the frame again.
            if uniforms.bytes.len() as u64 > self.uniform_buf.size() {
                drop(enc);
                self.grow(3, uniforms.bytes.len() as u64 * 2);
                self.rebuild_globals();
                self.pool.end_frame();
                continue;
            }
            break (enc, uniforms, passes, draws);
        };
        if let Some(f) = extra {
            f(&mut enc);
        }
        self.queue.write_buffer(&self.uniform_buf, 0, &uniforms.bytes);
        self.queue.submit([enc.finish()]);
        self.pool.end_frame();
        self.last_passes = passes;
        self.last_draws = draws;
    }
}

// ── clip atlas ───────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct ClipGpu {
    region: [f32; 4],
    /// atlas texel x, y, layer
    atlas: [f32; 4],
    /// clip prim, parent (index + 1)
    link: [u32; 4],
}

/// R8 coverage masks of the frame's clips, one array layer per atlas page.
struct ClipAtlas {
    dim: u32,
    layers: u32,
    array_view: wgpu::TextureView,
    layer_views: Vec<wgpu::TextureView>,
    _tex: wgpu::Texture,
}

impl ClipAtlas {
    fn new(device: &wgpu::Device, dim: u32, layers: u32) -> ClipAtlas {
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("clip-atlas"),
            size: wgpu::Extent3d { width: dim, height: dim, depth_or_array_layers: layers.max(1) },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: CLIP_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let array_view = tex.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let layer_views = (0..layers.max(1))
            .map(|l| {
                tex.create_view(&wgpu::TextureViewDescriptor {
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: l,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        ClipAtlas { dim, layers: layers.max(1), array_view, layer_views, _tex: tex }
    }
}

// ── executor ─────────────────────────────────────────────────────────────────
//
// The render graph. Layers are grouped by nesting level (a layer with no
// layers inside is level 0; one that composites level-k layers is k+1). Each
// level is drawn in a handful of passes regardless of how many layers it has:
//
//   1. backdrop passes  — for advanced blends, re-render the region of the
//                         parent's ops under the layer (no framebuffer read)
//   2. content passes   — every layer of the level, shelf-packed into atlas pages
//   3. filter passes    — one pass per blur step for all filtered layers
//
// then the canvas target gets its own backdrops and a single pass that draws
// everything else, composites included.

/// A rectangle inside a single-sample working texture (an atlas page).
#[derive(Clone, Copy, Debug)]
struct Region {
    tex: usize,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

/// A finished layer waiting to be composited.
#[derive(Clone, Copy)]
struct Ready {
    src: Region,
    shadow: Option<(Region, f32, f32, [f32; 4])>,
    /// Backdrop for an advanced blend and the device origin it starts at.
    backdrop: Option<(Region, [f32; 2])>,
}

struct Exec<'g> {
    gpu: &'g mut Gpu,
    enc: wgpu::CommandEncoder,
    pass: Option<wgpu::RenderPass<'static>>,
    ready: Vec<Option<Ready>>,
    /// Composite uniform slot + bind group per layer, made on first use.
    comp_cache: Vec<Option<(u32, wgpu::BindGroup, usize)>>,
    cur_vp: u32,
    uniforms: Uniforms,
    flags: [u32; 4],
    passes: u32,
    draws: u32,
    cur_pipe: usize,
    /// Image bound at group(1) for shape draws (`u32::MAX - 1` = unknown).
    cur_image: u32,
    /// Set while the canvas pass draws straight into the output: which
    /// `Pipelines::direct` set to use.
    direct: Option<usize>,
}

/// A target's ops bucketed by the grid cells their bounds touch, for
/// replaying just the ops under a rect.
struct OpGrid {
    origin: [i32; 2],
    cols: i32,
    rows: i32,
    /// Per cell, its range of `items`.
    starts: Vec<u32>,
    items: Vec<u32>,
}

impl OpGrid {
    const CELL: i32 = 128;
    const MAX_CELLS: i32 = 64;

    fn new(bounds: &[[f32; 4]]) -> OpGrid {
        let mut ext = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
        for b in bounds {
            if b[0] < b[2] && b[1] < b[3] {
                ext = [ext[0].min(b[0].floor() as i32), ext[1].min(b[1].floor() as i32), ext[2].max(b[2].ceil() as i32), ext[3].max(b[3].ceil() as i32)];
            }
        }
        if ext[0] >= ext[2] {
            ext = [0, 0, 1, 1];
        }
        let cols = ((ext[2] - ext[0] + Self::CELL - 1) / Self::CELL).clamp(1, Self::MAX_CELLS);
        let rows = ((ext[3] - ext[1] + Self::CELL - 1) / Self::CELL).clamp(1, Self::MAX_CELLS);
        let mut g = OpGrid { origin: [ext[0], ext[1]], cols, rows, starts: vec![0; (cols * rows + 1) as usize], items: Vec::new() };
        // Two passes: count per cell, then fill.
        for b in bounds {
            if let Some((c0, r0, c1, r1)) = g.cells(*b) {
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        g.starts[(r * cols + c + 1) as usize] += 1;
                    }
                }
            }
        }
        for i in 1..g.starts.len() {
            g.starts[i] += g.starts[i - 1];
        }
        g.items = vec![0; *g.starts.last().unwrap() as usize];
        let mut fill = g.starts.clone();
        for (k, b) in bounds.iter().enumerate() {
            if let Some((c0, r0, c1, r1)) = g.cells(*b) {
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        let cell = (r * cols + c) as usize;
                        g.items[fill[cell] as usize] = k as u32;
                        fill[cell] += 1;
                    }
                }
            }
        }
        g
    }

    /// Cells (inclusive column/row range) a rect touches; cells past the edge
    /// clamp to the border ones (the grid spans the ops' extent, but a capped
    /// cell count makes border cells cover the rest).
    fn cells(&self, b: [f32; 4]) -> Option<(i32, i32, i32, i32)> {
        if !(b[0] < b[2] && b[1] < b[3]) {
            return None;
        }
        let c = |v: f32, o: i32, n: i32| ((v.floor() as i64 - o as i64).div_euclid(Self::CELL as i64)).clamp(0, n as i64 - 1) as i32;
        Some((c(b[0], self.origin[0], self.cols), c(b[1], self.origin[1], self.rows), c(b[2], self.origin[0], self.cols), c(b[3], self.origin[1], self.rows)))
    }

    /// Sorted, deduplicated indices below `prefix` of ops whose cells touch `r`.
    fn query(&self, r: [i32; 4], prefix: u32, out: &mut Vec<u32>) {
        out.clear();
        let Some((c0, r0, c1, r1)) = self.cells([r[0] as f32, r[1] as f32, r[2] as f32, r[3] as f32]) else { return };
        for row in r0..=r1 {
            for col in c0..=c1 {
                let cell = (row * self.cols + col) as usize;
                out.extend(self.items[self.starts[cell] as usize..self.starts[cell + 1] as usize].iter().copied().filter(|&k| k < prefix));
            }
        }
        out.sort_unstable();
        out.dedup();
    }
}

const PIPE_PRIM: usize = 0;
const PIPE_COMP: usize = 8;
const PIPE_COMP_ADV: usize = 11;

/// Gap kept transparent around every packed region, so bilinear samples at a
/// region's edge (offset drop shadows) never pick up a neighbour.
const GUTTER: u32 = 2;
const PAGE: u32 = 2048;

/// Shelf packing. Returns, per item, (page index, x, y) and the page sizes.
fn pack(sizes: &[[u32; 2]], max_dim: u32) -> (Vec<(usize, u32, u32)>, Vec<[u32; 2]>) {
    let mut order: Vec<usize> = (0..sizes.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(sizes[i][1]));
    let mut out = vec![(0usize, 0u32, 0u32); sizes.len()];
    let mut pages: Vec<[u32; 2]> = Vec::new();
    let limit = PAGE.min(max_dim);
    let mut shelf_page: Option<usize> = None;
    let (mut x, mut y, mut shelf) = (0u32, 0u32, 0u32);
    for i in order {
        let w = sizes[i][0] + GUTTER * 2;
        let h = sizes[i][1] + GUTTER * 2;
        if w > limit || h > limit {
            // Too big to share: a page of its own.
            pages.push([w.min(max_dim), h.min(max_dim)]);
            out[i] = (pages.len() - 1, GUTTER, GUTTER);
            continue;
        }
        if shelf_page.is_some() && x + w > limit {
            x = 0;
            y += shelf;
            shelf = 0;
        }
        if shelf_page.is_none() || y + h > limit {
            pages.push([0, 0]);
            shelf_page = Some(pages.len() - 1);
            (x, y, shelf) = (0, 0, 0);
        }
        let p = shelf_page.unwrap();
        out[i] = (p, x + GUTTER, y + GUTTER);
        x += w;
        shelf = shelf.max(h);
        pages[p][0] = pages[p][0].max(x);
        pages[p][1] = pages[p][1].max(y + shelf);
    }
    (out, pages)
}

impl Exec<'_> {
    fn tex_size(&self, tex: usize) -> [f32; 2] {
        [self.gpu.pool.items[tex].w as f32, self.gpu.pool.items[tex].h as f32]
    }

    fn end_pass(&mut self) {
        self.pass = None;
        self.cur_pipe = usize::MAX;
    }

    /// Opens a pass drawing into `tex` (a page or the canvas target).
    fn begin_pass(&mut self, tex: usize, clear: wgpu::Color) {
        let pool = &self.gpu.pool;
        let pass = self.enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("draw"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &pool.items[tex].view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(clear), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        self.pass = Some(pass.forget_lifetime());
        self.passes += 1;
        self.cur_image = u32::MAX - 1;
    }

    /// Renders every clip region's mask (its shape times its ancestors') into
    /// the clip atlas, one pass per layer, before anything samples it.
    fn clip_masks(&mut self, frame: &Frame, pages: &[Vec<u32>]) {
        if frame.clips.is_empty() {
            return;
        }
        let dim = self.gpu.clip_atlas.dim as f32;
        let vp = self.uniforms.push(&ViewportU {
            size: [dim, dim],
            origin: [0.0, 0.0],
            offset: [0.0, 0.0],
            _pad: [0.0; 2],
            flags: self.flags,
        });
        for (layer, clips) in pages.iter().enumerate() {
            let mut pass = self
                .enc
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("clip-mask"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.gpu.clip_atlas.layer_views[layer],
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                })
                .forget_lifetime();
            self.passes += 1;
            pass.set_pipeline(&self.gpu.pipes.clip_mask);
            pass.set_bind_group(0, &self.gpu.globals_noclip, &[vp]);
            pass.set_bind_group(1, &self.gpu.no_image, &[]);
            // Instances are clip indices; draw runs of consecutive ones.
            let mut k = 0;
            while k < clips.len() {
                let start = clips[k];
                let mut end = start + 1;
                k += 1;
                while k < clips.len() && clips[k] == end {
                    end += 1;
                    k += 1;
                }
                pass.draw(0..6, start..end);
                self.draws += 1;
            }
        }
    }

    /// Points the open pass at `r`, drawing device area starting at `origin`.
    fn begin_region(&mut self, r: Region, origin: [f32; 2]) {
        let vp = self.uniforms.push(&ViewportU {
            size: [r.w as f32, r.h as f32],
            origin,
            offset: [r.x as f32, r.y as f32],
            _pad: [0.0; 2],
            flags: self.flags,
        });
        self.cur_vp = vp;
        let pass = self.pass.as_mut().unwrap();
        pass.set_viewport(r.x as f32, r.y as f32, r.w as f32, r.h as f32, 0.0, 1.0);
        pass.set_scissor_rect(r.x, r.y, r.w, r.h);
        pass.set_bind_group(0, &self.gpu.globals_bg, &[vp]);
    }

    fn set_pipe(&mut self, id: usize) {
        if self.cur_pipe == id {
            return;
        }
        self.cur_pipe = id;
        let p = &self.gpu.pipes;
        if let Some(d) = self.direct {
            let set = &p.direct[d].1;
            let pipe = match id {
                0..=2 => &set[id],
                8..=10 => &set[3 + id - 8],
                _ => &set[6],
            };
            self.pass.as_mut().unwrap().set_pipeline(pipe);
            return;
        }
        let pipe = match id {
            0..=2 => &p.prim[id],
            8..=10 => &p.comp[id - 8],
            _ => &p.comp_advanced,
        };
        self.pass.as_mut().unwrap().set_pipeline(pipe);
    }

    fn comp_bind_group(&self, src: &wgpu::TextureView, back: &wgpu::TextureView) -> wgpu::BindGroup {
        self.comp_bind_group3(src, back, &self.gpu.dummy)
    }

    /// Bind group for pool textures (`usize::MAX` = none), cached across
    /// frames: atlas pages persist, so a handful of groups serve every layer.
    fn comp_group(&mut self, src: usize, back: usize, mask: usize) -> wgpu::BindGroup {
        let generation = (self.gpu.pool.generation, 0);
        if self.gpu.comp_groups_gen != generation {
            self.gpu.comp_groups.clear();
            self.gpu.comp_groups_gen = generation;
        }
        let id = |i: usize| if i == usize::MAX { 0 } else { self.gpu.pool.items[i].id };
        let key = (id(src), id(back), id(mask));
        if let Some(g) = self.gpu.comp_groups.get(&key) {
            return g.clone();
        }
        let view = |i: usize| if i == usize::MAX { &self.gpu.dummy } else { &self.gpu.pool.items[i].view };
        let g = self.comp_bind_group3(view(src), view(back), view(mask));
        self.gpu.comp_groups.insert(key, g.clone());
        g
    }

    fn comp_bind_group3(&self, src: &wgpu::TextureView, back: &wgpu::TextureView, mask: &wgpu::TextureView) -> wgpu::BindGroup {
        self.gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("comp"),
            layout: &self.gpu.comp_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(src) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(back) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.gpu.sampler) },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &self.gpu.uniform_buf,
                        offset: 0,
                        size: wgpu::BufferSize::new(SLOT),
                    }),
                },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(mask) },
            ],
        })
    }

    fn alloc_pages(&mut self, pages: &[[u32; 2]]) -> Vec<usize> {
        let dev = self.gpu.device.clone();
        pages.iter().map(|p| self.gpu.pool.acquire(&dev, p[0].max(1), p[1].max(1), TexClass::Single)).collect()
    }

    fn run(&mut self, frame: &Frame, w: u32, h: u32, clear: [f32; 4], out: &wgpu::TextureView, rgba8: bool) {
        let c = wgpu::Color { r: clear[0] as f64, g: clear[1] as f64, b: clear[2] as f64, a: clear[3] as f64 };
        let bg = if self.flags[0] == 1 {
            let lin = |v: f64| if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) };
            wgpu::Color { r: lin(c.r) * c.a, g: lin(c.g) * c.a, b: lin(c.b) * c.a, a: c.a }
        } else {
            wgpu::Color { r: c.r * c.a, g: c.g * c.a, b: c.b * c.a, a: c.a }
        };
        let n = frame.layers.len();
        self.ready = vec![None; n];
        self.comp_cache = (0..n).map(|_| None).collect();

        // Nesting level of every layer.
        let mut level = vec![u32::MAX; n];
        fn level_of(frame: &Frame, l: usize, memo: &mut [u32]) -> u32 {
            if memo[l] != u32::MAX {
                return memo[l];
            }
            let layer = &frame.layers[l];
            // A backdrop layer replays its parent's ops before it, so whatever
            // those composite must be finished first.
            let ops = if layer.backdrop {
                &frame.targets[layer.parent as usize].ops[..layer.prefix as usize]
            } else {
                &frame.targets[layer.target as usize].ops[..]
            };
            let mut lv = 0;
            for op in ops {
                if let Op::Composite(c) = *op {
                    lv = lv.max(level_of(frame, c as usize, memo) + 1);
                    if let Some((m, _)) = frame.layers[c as usize].mask {
                        lv = lv.max(level_of(frame, m as usize, memo) + 1);
                    }
                }
            }
            memo[l] = lv;
            lv
        }
        for l in 0..n {
            level_of(frame, l, &mut level);
        }
        let max_level = level.iter().copied().max().map(|m| m as i64).unwrap_or(-1);

        for k in 0..=max_level {
            let layers: Vec<u32> = (0..n as u32).filter(|&l| level[l as usize] as i64 == k).collect();
            let targets: Vec<usize> = layers.iter().map(|&l| frame.layers[l as usize].target as usize).collect();
            self.backdrops(frame, &targets, wgpu::Color::TRANSPARENT);
            self.contents(frame, &layers, bg);
            self.effects(frame, &layers);
            self.filters(frame, &layers);
        }

        // The canvas: its backdrops, then one pass.
        self.backdrops(frame, &[0], bg);
        // Nothing reads the canvas target (backdrops replay its ops into their
        // own regions), so it only needs the working texture for what the
        // blit does: linear → sRGB encode and dither. Without either, draw
        // straight into the output in its 8-bit format; that
        // saves a full-size half-float target and a full-screen pass.
        let out_format = if rgba8 { wgpu::TextureFormat::Rgba8Unorm } else { self.gpu.config.format };
        let direct = if self.flags[0] == 0 && self.flags[1] == 0 {
            self.gpu.pipes.direct.iter().position(|(f, _)| *f == out_format)
        } else {
            None
        };
        if let Some(d) = direct {
            let pass = self.enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("canvas-direct"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: out,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(bg), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            self.pass = Some(pass.forget_lifetime());
            self.passes += 1;
            self.cur_image = u32::MAX - 1;
            self.cur_pipe = usize::MAX;
            self.direct = Some(d);
            self.begin_region(Region { tex: usize::MAX, x: 0, y: 0, w, h }, [0.0, 0.0]);
            self.replay(frame, 0, 0..frame.targets[0].ops.len(), None);
            self.end_pass();
            self.direct = None;
            return;
        }
        let dev = self.gpu.device.clone();
        let main = self.gpu.pool.acquire(&dev, w, h, TexClass::Single);
        self.begin_pass(main, bg);
        self.begin_region(Region { tex: main, x: 0, y: 0, w, h }, [0.0, 0.0]);
        let main_vp = self.cur_vp;
        self.replay(frame, 0, 0..frame.targets[0].ops.len(), None);
        self.end_pass();

        // Final blit: working texture → canvas/readback, sRGB encode + dither.
        let blit_u = self.uniforms.push(&CompU::default());
        let bgp = self.comp_bind_group(&self.gpu.pool.items[main].view, &self.gpu.dummy);
        {
            let mut pass = self.enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("blit"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: out,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(if rgba8 { &self.gpu.pipes.blit_rgba8 } else { &self.gpu.pipes.blit_surface });
            pass.set_bind_group(0, &self.gpu.globals_bg, &[main_vp]);
            pass.set_bind_group(1, &bgp, &[blit_u]);
            pass.draw(0..3, 0..1);
        }
        self.passes += 1;
        // Every page goes back to the pool at end of frame (Pool::end_frame).
    }

    /// Backdrops for every advanced composite in `targets`. Jobs whose region
    /// overlaps an earlier advanced composite in the same target wait for a
    /// later wave, because their replay draws that composite.
    fn backdrops(&mut self, frame: &Frame, targets: &[usize], clear: wgpu::Color) {
        struct Job {
            target: usize,
            layer: u32,
            wave: u32,
        }
        let mut jobs: Vec<Job> = Vec::new();
        for &t in targets {
            let first = jobs.len();
            for op in &frame.targets[t].ops {
                let Op::Composite(l) = *op else { continue };
                let layer = &frame.layers[l as usize];
                if hardware_blend(layer.blend).is_some() {
                    continue;
                }
                let r = layer.rect;
                let wave = jobs[first..]
                    .iter()
                    .filter(|j| {
                        let o = frame.layers[j.layer as usize].rect;
                        o[0] < r[2] && o[2] > r[0] && o[1] < r[3] && o[3] > r[1]
                    })
                    .map(|j| j.wave + 1)
                    .max()
                    .unwrap_or(0);
                jobs.push(Job { target: t, layer: l, wave });
            }
        }
        if jobs.is_empty() {
            return;
        }
        // Each job replays the ops under its rect. Many jobs over a long op
        // list (a board full of blended cards) would rescan it per job, so
        // index the ops by grid cell once per target.
        let mut grids: Vec<(usize, OpGrid)> = Vec::new();
        for &t in targets {
            if jobs.iter().filter(|j| j.target == t).count() >= 8 && !grids.iter().any(|g| g.0 == t) {
                grids.push((t, OpGrid::new(&frame.targets[t].bounds)));
            }
        }
        let mut list: Vec<u32> = Vec::new();
        let max_wave = jobs.iter().map(|j| j.wave).max().unwrap();
        for wave in 0..=max_wave {
            let these: Vec<&Job> = jobs.iter().filter(|j| j.wave == wave).collect();
            let sizes: Vec<[u32; 2]> = these
                .iter()
                .map(|j| {
                    let r = frame.layers[j.layer as usize].rect;
                    [(r[2] - r[0]).max(1) as u32, (r[3] - r[1]).max(1) as u32]
                })
                .collect();
            let (place, pages) = pack(&sizes, self.gpu.device.limits().max_texture_dimension_2d);
            let texs = self.alloc_pages(&pages);
            for (p, &tex) in texs.iter().enumerate() {
                self.begin_pass(tex, clear);
                for (i, j) in these.iter().enumerate() {
                    if place[i].0 != p {
                        continue;
                    }
                    let layer = frame.layers[j.layer as usize];
                    let r = layer.rect;
                    let region = Region { tex, x: place[i].1, y: place[i].2, w: sizes[i][0], h: sizes[i][1] };
                    let origin = [r[0] as f32, r[1] as f32];
                    self.begin_region(region, origin);
                    if let Some((_, grid)) = grids.iter().find(|g| g.0 == j.target) {
                        grid.query(r, layer.prefix, &mut list);
                        self.replay_ops(frame, j.target, &list, Some(r));
                    } else {
                        self.replay(frame, j.target, 0..layer.prefix as usize, Some(r));
                    }
                    if let Some(rd) = self.ready[j.layer as usize].as_mut() {
                        rd.backdrop = Some((region, origin));
                    }
                }
                self.end_pass();
            }
        }
    }

    /// Draws the content of every layer in `layers` into shared atlas pages.
    /// Backdrop layers over the canvas start from its clear colour.
    fn contents(&mut self, frame: &Frame, layers: &[u32], bg: wgpu::Color) {
        let (canvas, rest): (Vec<u32>, Vec<u32>) =
            layers.iter().copied().partition(|&l| frame.layers[l as usize].backdrop && frame.layers[l as usize].parent == 0);
        self.contents_with(frame, &rest, wgpu::Color::TRANSPARENT);
        self.contents_with(frame, &canvas, bg);
    }

    fn contents_with(&mut self, frame: &Frame, layers: &[u32], clear: wgpu::Color) {
        if layers.is_empty() {
            return;
        }
        let sizes: Vec<[u32; 2]> = layers
            .iter()
            .map(|&l| {
                let r = frame.layers[l as usize].rect;
                [(r[2] - r[0]).max(1) as u32, (r[3] - r[1]).max(1) as u32]
            })
            .collect();
        let (place, pages) = pack(&sizes, self.gpu.device.limits().max_texture_dimension_2d);
        let texs = self.alloc_pages(&pages);
        for (p, &tex) in texs.iter().enumerate() {
            self.begin_pass(tex, clear);
            for (i, &l) in layers.iter().enumerate() {
                if place[i].0 != p {
                    continue;
                }
                let layer = frame.layers[l as usize];
                let region = Region { tex, x: place[i].1, y: place[i].2, w: sizes[i][0], h: sizes[i][1] };
                self.begin_region(region, [layer.rect[0] as f32, layer.rect[1] as f32]);
                if layer.backdrop {
                    self.replay(frame, layer.parent as usize, 0..layer.prefix as usize, Some(layer.rect));
                } else {
                    let t = layer.target as usize;
                    self.replay(frame, t, 0..frame.targets[t].ops.len(), None);
                }
                // Keep a backdrop that was attached before the content existed.
                let backdrop = self.ready[l as usize].and_then(|r| r.backdrop);
                self.ready[l as usize] = Some(Ready { src: region, shadow: None, backdrop });
            }
            self.end_pass();
        }
    }

    /// Node effect chains for a level. Step j of every layer runs together:
    /// prefilter passes, then the blur that feeds `blurred()`, then the
    /// effect passes, each batched into shared pages (one pass per page).
    fn effects(&mut self, frame: &Frame, layers: &[u32]) {
        let max_len = layers.iter().map(|&l| frame.layers[l as usize].effects.1).max().unwrap_or(0);
        for step in 0..max_len {
            // (layer, effect index into frame.effects, current input region)
            let mut items: Vec<(u32, usize, Region)> = Vec::new();
            for &l in layers {
                let layer = &frame.layers[l as usize];
                if step >= layer.effects.1 {
                    continue;
                }
                let Some(r) = self.ready[l as usize] else { continue };
                let e = (layer.effects.0 + step) as usize;
                // A user effect still compiling is skipped (the layer passes through).
                if self.gpu.effect_ready(frame.effects[e].index) {
                    items.push((l, e, r.src));
                }
            }
            if items.is_empty() {
                continue;
            }
            // Prefilters, then blurs (of the prefiltered image, else the input).
            let mut feed: Vec<Option<Region>> = vec![None; items.len()];
            let pre: Vec<usize> = (0..items.len()).filter(|&k| self.gpu.has_prefilter(frame.effects[items[k].1].index)).collect();
            if !pre.is_empty() {
                let outs = self.effect_batch(frame, &items, &pre, &vec![None; items.len()], true);
                for (k, r) in pre.iter().zip(outs) {
                    feed[*k] = Some(r);
                }
            }
            let mut blurred: Vec<Option<(Region, f32)>> = vec![None; items.len()];
            for k in 0..items.len() {
                let b = frame.effects[items[k].1].blur;
                if b[0] <= 0.0 && b[1] <= 0.0 {
                    continue;
                }
                let input = feed[k].unwrap_or(items[k].2);
                blurred[k] = Some(self.blur_oriented(input, b[0], b[1], b[2]));
            }
            let all: Vec<usize> = (0..items.len()).collect();
            let outs = self.effect_batch(frame, &items, &all, &blurred, false);
            for (k, r) in outs.into_iter().enumerate() {
                if let Some(rd) = self.ready[items[k].0 as usize].as_mut() {
                    rd.src = r;
                }
            }
        }
    }

    /// Blurs a region with sigma `sa` along `angle` and `sb` across it
    /// (device px). Isotropic blurs run downsampled like the blur filter.
    /// Returns the region and device px per texel.
    fn blur_oriented(&mut self, src: Region, sa: f32, sb: f32, angle: f32) -> (Region, f32) {
        let iso = sa.min(sb);
        let mut steps = 0u32;
        if iso > 0.0 {
            while iso / (1u32 << steps) as f32 > 4.0 && steps < 3 {
                steps += 1;
            }
        }
        let mut cur = src;
        for _ in 0..steps {
            self.blur_batch(&mut [(&mut cur, 0.0, [0.0, 0.0])], &[0], true);
        }
        let f = (1u32 << steps) as f32;
        let (sn, cs) = angle.sin_cos();
        if sa > 0.0 {
            self.blur_batch(&mut [(&mut cur, sa / f, [cs, sn])], &[0], false);
        }
        if sb > 0.0 {
            self.blur_batch(&mut [(&mut cur, sb / f, [-sn, cs])], &[0], false);
        }
        (cur, f)
    }

    fn effect_group(&mut self, src: usize, blur: usize, aux: Option<&wgpu::TextureView>, aux_id: u64, field: u64) -> wgpu::BindGroup {
        let id = |i: usize| if i == usize::MAX { 0 } else { self.gpu.pool.items[i].id };
        let key = (id(src), id(blur), aux_id, field);
        if let Some(g) = self.gpu.effect_groups.get(&key) {
            return g.clone();
        }
        let view = |i: usize| if i == usize::MAX { &self.gpu.dummy } else { &self.gpu.pool.items[i].view };
        let g = self.gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("effect"),
            layout: &self.gpu.effect_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view(src)) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view(blur)) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(aux.unwrap_or(&self.gpu.dummy)) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.gpu.sampler) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(&self.gpu.sampler_nearest) },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &self.gpu.uniform_buf,
                        offset: 0,
                        size: wgpu::BufferSize::new(SLOT),
                    }),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: wgpu::BindingResource::TextureView(self.gpu.fields.get(&field).map(|f| &f.0).unwrap_or(&self.gpu.dummy)),
                },
            ],
        });
        self.gpu.effect_groups.insert(key, g.clone());
        g
    }

    /// One effect (or prefilter) pass for the selected items, outputs packed
    /// into fresh pages at the input's size.
    fn effect_batch(
        &mut self,
        frame: &Frame,
        items: &[(u32, usize, Region)],
        sel: &[usize],
        blurred: &[Option<(Region, f32)>],
        prefilter: bool,
    ) -> Vec<Region> {
        let sizes: Vec<[u32; 2]> = sel.iter().map(|&k| [items[k].2.w, items[k].2.h]).collect();
        let (place, pages) = pack(&sizes, self.gpu.device.limits().max_texture_dimension_2d);
        let texs = self.alloc_pages(&pages);
        let mut outs = vec![Region { tex: 0, x: 0, y: 0, w: 0, h: 0 }; sel.len()];
        for (p, &tex) in texs.iter().enumerate() {
            let mut pass = self
                .enc
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(if prefilter { "effect-prefilter" } else { "effect" }),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.gpu.pool.items[tex].view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                })
                .forget_lifetime();
            self.passes += 1;
            for (j, &k) in sel.iter().enumerate() {
                if place[j].0 != p {
                    continue;
                }
                let (l, e, src) = items[k];
                let layer = frame.layers[l as usize];
                let eff = &frame.effects[e];
                let dst = Region { tex, x: place[j].1, y: place[j].2, w: sizes[j][0], h: sizes[j][1] };
                let origin = [layer.rect[0] as f32, layer.rect[1] as f32];
                let sp = self.tex_size(src.tex);
                let mut u = EffectU {
                    src_rect: [src.x as f32, src.y as f32, src.w as f32, src.h as f32],
                    src_origin: origin,
                    src_page: sp,
                    dst_off: [dst.x as f32, dst.y as f32],
                    dst_origin: origin,
                    blur_scale: 1.0,
                    clip: if !prefilter && eff.flags & 1 == 1 { 1.0 } else { 0.0 },
                    box_: layer.effect_box,
                    node: [
                        [layer.node_frame[0], layer.node_frame[1], layer.node_frame[2], layer.node_frame[3]],
                        [layer.node_frame[4], layer.node_frame[5], layer.node_frame[6], layer.node_frame[7]],
                    ],
                    scale: eff.scale,
                    time: eff.time,
                    ..Default::default()
                };
                let mut blur_tex = usize::MAX;
                if let Some((b, f)) = blurred[k] {
                    u.blur_rect = [b.x as f32, b.y as f32, b.w as f32, b.h as f32];
                    u.blur_page = self.tex_size(b.tex);
                    u.blur_scale = f;
                    blur_tex = b.tex;
                }
                // A user effect's params are its blend (+1, 0 = replace), then
                // its `Params` bytes, bound at group(1).
                let user = eff.index >= USER_EFFECT;
                let own = if user { eff.params.len().min(1) } else { eff.params.len() };
                // The packer refuses more (`MAX_PARAMS`, web/src/effects/_pack.ts).
                debug_assert!(own <= crate::effects::PARAMS, "effect packed {own} params");
                for (i, v) in eff.params[..own].iter().take(crate::effects::PARAMS).enumerate() {
                    u.p[i / 4][i % 4] = *v;
                }
                let user_off = user.then(|| self.uniforms.push_bytes(bytemuck::cast_slice(&padded(&eff.params[own..]))));
                let aux = self.gpu.images.get(eff.aux as usize).and_then(|i| i.as_ref());
                if let Some(a) = aux {
                    u.aux_size = [a.w as f32, a.h as f32];
                }
                let aux_view = aux.map(|a| a.tex.create_view(&Default::default()));
                let aux_id = if aux.is_some() { 1u64 << 63 | eff.aux as u64 } else { 0 };
                let mut field_id = 0;
                if let Some(f) = frame.fields.get(eff.field as usize) {
                    u.field = [eff.field_origin[0], eff.field_origin[1], f.texel, f.max_distance];
                    u.field_size = [f.w as f32, f.h as f32];
                    field_id = f.id;
                }
                let off = self.uniforms.push(&u);
                let bg = self.effect_group(src.tex, blur_tex, aux_view.as_ref(), aux_id, field_id);
                if let Some(off) = user_off {
                    let ug = self.gpu.user_group();
                    pass.set_bind_group(1, &ug, &[off]);
                    pass.set_pipeline(self.gpu.user_pipe(eff.index - USER_EFFECT, KIND_EFFECT, 0).unwrap());
                } else {
                    let (main, pre) = &self.gpu.pipes.effects[eff.index as usize];
                    pass.set_pipeline(if prefilter { pre.as_ref().unwrap() } else { main });
                }
                pass.set_viewport(dst.x as f32, dst.y as f32, dst.w as f32, dst.h as f32, 0.0, 1.0);
                pass.set_scissor_rect(dst.x, dst.y, dst.w, dst.h);
                pass.set_bind_group(0, &bg, &[off]);
                pass.draw(0..3, 0..1);
                self.draws += 1;
                outs[j] = dst;
            }
        }
        outs
    }

    /// Blur and drop-shadow filters for a level, one pass per step.
    fn filters(&mut self, frame: &Frame, layers: &[u32]) {
        struct Chain {
            layer: u32,
            sigma: f32,
            steps: u32,
            cur: Region,
        }
        let mut chains: Vec<Chain> = Vec::new();
        for &l in layers {
            let sigma = match frame.layers[l as usize].filter {
                DevFilter::None => continue,
                DevFilter::Blur { sigma } | DevFilter::DropShadow { sigma, .. } | DevFilter::Shadow { sigma, .. } => sigma,
            };
            let Some(r) = self.ready[l as usize] else { continue };
            // Large sigmas run at reduced resolution; each halving halves sigma
            // and the compositor's bilinear sample upsamples.
            let mut steps = 0;
            while sigma / (1u32 << steps) as f32 > 4.0 && steps < 3 {
                steps += 1;
            }
            chains.push(Chain { layer: l, sigma, steps, cur: r.src });
        }
        if chains.is_empty() {
            return;
        }
        let max_steps = chains.iter().map(|c| c.steps).max().unwrap();
        for step in 0..max_steps {
            let idx: Vec<usize> = (0..chains.len()).filter(|&i| chains[i].steps > step).collect();
            self.blur_batch(&mut chains.iter_mut().map(|c| (&mut c.cur, 0.0, [0.0, 0.0])).collect::<Vec<_>>(), &idx, true);
        }
        let all: Vec<usize> = (0..chains.len()).collect();
        for dir in [[1.0, 0.0], [0.0, 1.0]] {
            let mut items: Vec<(&mut Region, f32, [f32; 2])> = chains
                .iter_mut()
                .map(|c| {
                    let s = c.sigma / (1u32 << c.steps) as f32;
                    (&mut c.cur, s, dir)
                })
                .collect();
            self.blur_batch(&mut items, &all, false);
        }
        for c in chains {
            let l = c.layer as usize;
            let Some(r) = self.ready[l].as_mut() else { continue };
            match frame.layers[l].filter {
                DevFilter::Blur { .. } => r.src = c.cur,
                DevFilter::DropShadow { dx, dy, color, .. } | DevFilter::Shadow { dx, dy, color, .. } => {
                    r.shadow = Some((c.cur, dx, dy, color))
                }
                DevFilter::None => {}
            }
        }
    }

    /// One blur step (or 2x downsample) for the selected items, packed into
    /// fresh pages; each item's region is replaced by its output.
    fn blur_batch(&mut self, items: &mut [(&mut Region, f32, [f32; 2])], sel: &[usize], downsample: bool) {
        if sel.is_empty() {
            return;
        }
        let sizes: Vec<[u32; 2]> = sel
            .iter()
            .map(|&i| {
                let r = &items[i].0;
                if downsample { [r.w.div_ceil(2).max(1), r.h.div_ceil(2).max(1)] } else { [r.w, r.h] }
            })
            .collect();
        let (place, pages) = pack(&sizes, self.gpu.device.limits().max_texture_dimension_2d);
        let texs = self.alloc_pages(&pages);
        for (p, &tex) in texs.iter().enumerate() {
            let mut pass = self
                .enc
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("blur"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.gpu.pool.items[tex].view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                })
                .forget_lifetime();
            self.passes += 1;
            pass.set_pipeline(&self.gpu.pipes.blur);
            for (k, &i) in sel.iter().enumerate() {
                if place[k].0 != p {
                    continue;
                }
                let src = *items[i].0;
                let (mut sigma, mut dir) = (items[i].1, items[i].2);
                // Past 32 taps a side, space the taps out (bilinear fills in
                // between) instead of truncating the kernel.
                let stride = ((3.0 * sigma) / 32.0).ceil().max(1.0);
                dir = [dir[0] * stride, dir[1] * stride];
                sigma /= stride;
                let dst = Region { tex, x: place[k].1, y: place[k].2, w: sizes[k][0], h: sizes[k][1] };
                let st = self.tex_size(src.tex);
                let radius = if downsample { 0.0 } else { (3.0 * sigma).ceil().min(32.0) };
                let u = self.uniforms.push(&CompU {
                    dst: [if downsample { 2.0 } else { 1.0 }, 0.0, src.w as f32, src.h as f32],
                    uv: [dir[0], dir[1], sigma.max(1e-3), radius],
                    tint: [st[0], st[1], 0.0, 0.0],
                    params: [0.0; 4],
                    back: [dst.x as f32, dst.y as f32, src.x as f32, src.y as f32],
                    mask: [0.0; 4],
                });
                let bg = self.comp_group(src.tex, usize::MAX, usize::MAX);
                pass.set_viewport(dst.x as f32, dst.y as f32, dst.w as f32, dst.h as f32, 0.0, 1.0);
                pass.set_scissor_rect(dst.x, dst.y, dst.w, dst.h);
                pass.set_bind_group(0, &self.gpu.globals_bg, &[self.cur_vp]);
                pass.set_bind_group(1, &bg, &[u]);
                pass.draw(0..3, 0..1);
                self.draws += 1;
                *items[i].0 = dst;
            }
        }
    }

    /// Replays `range` of a target's ops into the current region. With `cull`,
    /// ops whose bounds miss it are skipped.
    fn replay(&mut self, frame: &Frame, tidx: usize, range: std::ops::Range<usize>, cull: Option<[i32; 4]>) {
        for k in range {
            self.replay_op(frame, tidx, k, cull);
        }
    }

    /// `replay` over a sorted subset of the target's ops.
    fn replay_ops(&mut self, frame: &Frame, tidx: usize, list: &[u32], cull: Option<[i32; 4]>) {
        for &k in list {
            self.replay_op(frame, tidx, k as usize, cull);
        }
    }

    fn replay_op(&mut self, frame: &Frame, tidx: usize, k: usize, cull: Option<[i32; 4]>) {
        let ops = &frame.targets[tidx];
        {
            if let Some(c) = cull {
                let b = ops.bounds[k];
                if b[0] >= c[2] as f32 || b[2] <= c[0] as f32 || b[1] >= c[3] as f32 || b[3] <= c[1] as f32 {
                    return;
                }
            }
            match ops.ops[k] {
                Op::Prims { start, count, image } if image != NONE && image & USER_FILL != 0 => {
                    self.user_fill(frame, image & !USER_FILL, start, count);
                }
                Op::Prims { start, count, image } => {
                    self.set_pipe(PIPE_PRIM);
                    if self.cur_image != image {
                        let group = self
                            .gpu
                            .images
                            .get(image as usize)
                            .and_then(|i| i.as_ref())
                            .map(|i| &i.group)
                            .unwrap_or(&self.gpu.no_image);
                        self.pass.as_mut().unwrap().set_bind_group(1, group, &[]);
                        self.cur_image = image;
                    }
                    self.pass.as_mut().unwrap().draw(0..6, start..start + count);
                    self.draws += 1;
                }
                Op::Composite(l) => self.draw_layer(frame, l),
            }
        }
    }

    /// Prims painted by user fill `paint`: its own pipeline, texture and
    /// `Params`. Skipped while the program compiles (or if it failed).
    fn user_fill(&mut self, frame: &Frame, paint: u32, start: u32, count: u32) {
        let Some(Some(up)) = frame.user_paints.get(paint as usize) else { return };
        let k = self.direct.map(|d| d + 1).unwrap_or(0);
        if self.gpu.user_pipe(up.program, KIND_FILL, k).is_none() {
            return;
        }
        let off = self.uniforms.push_bytes(bytemuck::cast_slice(&padded(&up.params)));
        let ug = self.gpu.user_group();
        let image = self.gpu.images.get(up.texture as usize).and_then(|i| i.as_ref()).map(|i| i.group.clone());
        let pass = self.pass.as_mut().unwrap();
        pass.set_pipeline(self.gpu.user_pipe(up.program, KIND_FILL, k).unwrap());
        pass.set_bind_group(1, image.as_ref().unwrap_or(&self.gpu.no_image), &[]);
        pass.set_bind_group(2, &ug, &[off]);
        pass.draw(0..6, start..start + count);
        self.draws += 1;
        self.cur_pipe = usize::MAX;
        self.cur_image = u32::MAX - 1;
    }

    fn draw_layer(&mut self, frame: &Frame, l: u32) {
        let layer = frame.layers[l as usize];
        let Some(r) = self.ready[l as usize] else { return };
        let rect = [layer.rect[0] as f32, layer.rect[1] as f32, layer.rect[2] as f32, layer.rect[3] as f32];
        if let Some((b, dx, dy, color)) = r.shadow {
            let dst = [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy];
            self.composite(b, dst, layer.opacity, 0, Some(color), None, None, layer.clip, None);
        }
        if matches!(layer.filter, DevFilter::Shadow { .. }) {
            return;
        }
        let mask = layer.mask.and_then(|(ml, mode)| self.ready[ml as usize].map(|m| (m.src, mode)));
        self.composite(r.src, rect, layer.opacity, layer.blend, None, r.backdrop, mask, layer.clip, Some(l));
    }

    /// Draws region `src` over device rect `dst` in the open pass. Advanced
    /// blends read `backdrop`, which holds exactly what the target contains
    /// under `dst` at this point.
    #[allow(clippy::too_many_arguments)]
    fn composite(
        &mut self,
        src: Region,
        dst: [f32; 4],
        opacity: f32,
        blend: u8,
        tint: Option<[f32; 4]>,
        backdrop: Option<(Region, [f32; 2])>,
        mask: Option<(Region, u8)>,
        clip: u32,
        cache: Option<u32>,
    ) {
        let pipe = match (hardware_blend(blend), backdrop) {
            (Some(hw), _) => PIPE_COMP + hw,
            (None, Some(_)) => PIPE_COMP_ADV,
            (None, None) => return,
        };
        let cached = cache.and_then(|l| self.comp_cache[l as usize].as_ref().map(|(o, b, _)| (*o, b.clone())));
        let (off, bg) = match cached {
            Some(c) => c,
            None => {
                let ts = self.tex_size(src.tex);
                let uv = [
                    src.x as f32 / ts[0],
                    src.y as f32 / ts[1],
                    (src.x + src.w) as f32 / ts[0],
                    (src.y + src.h) as f32 / ts[1],
                ];
                // Texel of the backdrop = device position − back.xy.
                // back.xy: texel of the backdrop = device − back.xy; back.z: clip.
                let back = backdrop
                    .map(|(r, o)| [o[0] - r.x as f32, o[1] - r.y as f32, clip as f32, 0.0])
                    .unwrap_or([0.0, 0.0, clip as f32, 0.0]);
                // A mask region has the layer's rect, so it maps with the same corners.
                let mask_uv = mask
                    .map(|(r, _)| {
                        let ms = self.tex_size(r.tex);
                        [r.x as f32 / ms[0], r.y as f32 / ms[1], (r.x + r.w) as f32 / ms[0], (r.y + r.h) as f32 / ms[1]]
                    })
                    .unwrap_or([0.0; 4]);
                let off = self.uniforms.push(&CompU {
                    dst,
                    uv,
                    tint: tint.unwrap_or([0.0; 4]),
                    params: [opacity, blend as f32, tint.is_some() as u32 as f32, mask.map(|m| m.1 as f32).unwrap_or(0.0)],
                    back,
                    mask: mask_uv,
                });
                let bg = self.comp_group(
                    src.tex,
                    backdrop.map(|(r, _)| r.tex).unwrap_or(usize::MAX),
                    mask.map(|(r, _)| r.tex).unwrap_or(usize::MAX),
                );
                if let Some(l) = cache {
                    self.comp_cache[l as usize] = Some((off, bg.clone(), src.tex));
                }
                (off, bg)
            }
        };
        self.set_pipe(pipe);
        self.cur_image = u32::MAX - 1;
        let pass = self.pass.as_mut().unwrap();
        pass.set_bind_group(1, &bg, &[off]);
        pass.draw(0..6, 0..1);
        self.draws += 1;
    }
}

/// A `Params` block: at least 16 bytes, so a binding is never empty.
fn padded(params: &[f32]) -> Vec<f32> {
    let mut v = params.to_vec();
    v.resize(v.len().max(4).div_ceil(4) * 4, 0.0);
    v.truncate((SLOT / 4) as usize);
    v
}

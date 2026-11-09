//! The GPU side: [`Renderer3D`] draws a decoded [`Scene`] into a caller's
//! texture view on a caller's device. It owns its pipelines, geometry cache,
//! MSAA and depth targets and shadow maps, never a surface, so the 2D render
//! graph can hand it a pooled offscreen (Canvas3D) or a material-input
//! texture (Tex.surface) on the same device.
//!
//! What three.js does that this mirrors:
//! camera clip planes and shadow frustums sized from the scene bounds, the
//! default camera, opaque front-to-back then transparent back-to-front
//! sorting with `renderOrder`, double-sided transparent drawn back faces
//! first, `NormalBlending` only when transparent, `depthWrite = !blends`,
//! material groups for material arrays, and a transparent clear (the 2D
//! fill under the scene is the background).

use crate::dfg::DFG_LUT;
use crate::geometry::{self, Group, MeshData};
use crate::scene::*;
use bytemuck::{Pod, Zeroable};
use glam::{Mat3, Mat4, Vec3, Vec4};
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, Weak};

pub const SAMPLE_COUNT: u32 = 4;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const MAX_LIGHTS: usize = 16;
const MAX_SHADOWS: usize = 4;
/// Shadow-map array layers: a point light takes six (its cube faces).
const MAX_SHADOW_LAYERS: usize = MAX_SHADOWS * 6;

/// Cube faces of a point shadow (+X -X +Y -Y +Z -Z): forward and up. The
/// shader picks the face and projects with the same basis (`cube_face`), so
/// no cube-map orientation convention is involved.
const CUBE_FACES: [(Vec3, Vec3); 6] = [
    (Vec3::X, Vec3::Y),
    (Vec3::NEG_X, Vec3::Y),
    (Vec3::Y, Vec3::Z),
    (Vec3::NEG_Y, Vec3::Z),
    (Vec3::Z, Vec3::Y),
    (Vec3::NEG_Z, Vec3::Y),
];
const UNIFORM_STRIDE: u64 = 256;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
struct LightU {
    info: [f32; 4],
    color: [f32; 4],
    ground: [f32; 4],
    position: [f32; 4],
    direction: [f32; 4],
    params: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
struct ShadowU {
    matrix: [[f32; 4]; 4],
    params: [f32; 4],
    /// kind (0 2D map, 1 point cube), near, far, first array layer.
    extra: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct FrameU {
    view: [[f32; 4]; 4],
    proj: [[f32; 4]; 4],
    camera: [f32; 4],
    camera_dir: [f32; 4],
    ambient: [f32; 4],
    env: [f32; 4],
    fog: [f32; 4],
    fog_params: [f32; 4],
    tone: [f32; 4],
    viewport: [f32; 4],
    /// Transmission target width, height, present; w = 1 for linear output
    /// (the transmission pre-pass: no tone mapping, no sRGB encode).
    trans: [f32; 4],
    lights: [LightU; MAX_LIGHTS],
    shadows: [ShadowU; MAX_SHADOWS],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct DrawU {
    color: [f32; 4],
    emissive: [f32; 4],
    pbr: [f32; 4],
    flags: [u32; 4],
    /// Phong specular (linear rgb), shininess.
    spec: [f32; 4],
    /// The map's uv transform, two rows of a 3x2.
    map0: [f32; 4],
    map1: [f32; 4],
    /// Physical: clearcoat, clearcoat roughness, transmission, thickness.
    layer0: [f32; 4],
    /// ior, attenuation distance (-1 infinite), dashSize, gapSize.
    layer1: [f32; 4],
    /// Attenuation colour (linear), dash scale.
    layer2: [f32; 4],
}

/// Per instance: model matrix, normal matrix (3 columns), colour.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct InstanceU {
    model: [[f32; 4]; 4],
    normal: [[f32; 4]; 3],
    color: [f32; 4],
}

const F_VERTEX_COLORS: u32 = 1;
const F_FLAT: u32 = 2;
const F_TONE_MAPPED: u32 = 4;
const F_RECEIVE_SHADOW: u32 = 8;
const F_FOG: u32 = 16;
const F_INSTANCE_COLOR: u32 = 32;
const F_OPAQUE: u32 = 64;
const F_BILLBOARD: u32 = 128;
const F_FLIP_SIDED: u32 = 256;
const F_DOUBLE_SIDED: u32 = 512;
const F_SIZE_ATTENUATION: u32 = 1024;
const F_POINTS: u32 = 2048;
const F_MAP: u32 = 4096;
const F_MAP_FLIP_Y: u32 = 8192;
const F_DASHED: u32 = 16384;
const F_GRADIENT: u32 = 32768;
const F_GRADIENT_FLIP_Y: u32 = 65536;

/// How a geometry's index buffer is built: triangles, or one of the line
/// expansions (all drawn as line lists).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Mode {
    Tri,
    Wire,
    LineStrip,
    LineSegments,
    LineLoop,
    /// Each vertex expanded to a quad (`gl_PointSize` squares).
    Points,
}

impl Mode {
    fn lines(self) -> bool {
        !matches!(self, Mode::Tri | Mode::Points)
    }
}

struct GpuGeom {
    vbuf: wgpu::Buffer,
    cbuf: wgpu::Buffer,
    ibuf: wgpu::Buffer,
    count: u32,
    groups: Vec<Group>,
    has_color: bool,
    bounds: Option<(Vec3, Vec3)>,
    sphere: (Vec3, f32),
    used: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct PipeKey {
    lines: bool,
    /// 0 none, 1 back, 2 front.
    cull: u8,
    cw: bool,
    /// 0 none, 1 normal, 2 additive, 3 subtractive, 4 multiply.
    blend: u8,
    depth_write: bool,
    depth_test: bool,
    background: bool,
    /// Drawn into the transmission target (half float) instead of the output format.
    hdr: bool,
}

struct Item {
    /// The map and gradient map ((texture id, sampler key), WHITE when absent).
    maps: MapKey,
    geom: u64,
    pipe: PipeKey,
    uniform: u32,
    first_instance: u32,
    instances: u32,
    range: (u32, u32),
    z: f32,
    render_order: f32,
    order: u32,
}

struct ShadowCaster {
    geom: u64,
    cull: u8,
    cw: bool,
    first_instance: u32,
    instances: u32,
    range: (u32, u32),
}

/// Counters for the page's readout.
#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub draws: u32,
    pub instances: u32,
    pub triangles: u64,
    pub shadow_maps: u32,
    pub geometries: u32,
    pub pipelines: u32,
}

/// The opaque scene three renders for transmissive materials: an MSAA
/// half-float target, resolved into a mipmapped texture (three's
/// `transmissionRenderTarget`, sampled with roughness-based lods).
struct TransmissionTarget {
    w: u32,
    h: u32,
    msaa: wgpu::TextureView,
    view: wgpu::TextureView,
    mips: Vec<wgpu::TextureView>,
    /// Bind groups sampling level `i` (to draw level `i + 1`).
    blits: Vec<wgpu::BindGroup>,
}

const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// GPU state every [`Renderer3D`] on one device can share: shader modules,
/// bind group and pipeline layouts, pipelines (per target format), the DFG
/// LUT and samplers. [`Shared3D::get`] returns the device's live one, so
/// renderers built with [`Renderer3D::with_shared`] compile each pipeline
/// once; it is freed with the last renderer that holds it.
pub struct Shared3D {
    device: wgpu::Device,
    queue: wgpu::Queue,
    module: wgpu::ShaderModule,
    shadow_module: wgpu::ShaderModule,
    frame_layout: wgpu::BindGroupLayout,
    draw_layout: wgpu::BindGroupLayout,
    shadow_layout: wgpu::BindGroupLayout,
    map_layout: wgpu::BindGroupLayout,
    mip_layout: wgpu::BindGroupLayout,
    pipe_layout: wgpu::PipelineLayout,
    shadow_pipe_layout: wgpu::PipelineLayout,
    mip_pipeline: wgpu::RenderPipeline,
    dfg_view: wgpu::TextureView,
    sampler: wgpu::Sampler,
    shadow_sampler: wgpu::Sampler,
    /// Trilinear, clamped: the transmission target's sampler.
    mip_sampler: wgpu::Sampler,
    white: wgpu::TextureView,
    pipelines: Mutex<HashMap<(PipeKey, wgpu::TextureFormat), wgpu::RenderPipeline>>,
    shadow_pipelines: Mutex<HashMap<(u8, bool), wgpu::RenderPipeline>>,
    samplers: Mutex<HashMap<u8, wgpu::Sampler>>,
}

thread_local! {
    static SHARED: RefCell<Vec<Weak<Shared3D>>> = const { RefCell::new(Vec::new()) };
}

pub struct Renderer3D {
    shared: Arc<Shared3D>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    format: wgpu::TextureFormat,
    /// Handles cloned from the shared caches, so passes borrow without locking.
    pipelines: HashMap<PipeKey, wgpu::RenderPipeline>,
    shadow_pipelines: HashMap<(u8, bool), wgpu::RenderPipeline>,
    textures: HashMap<u32, wgpu::TextureView>,
    map_groups: HashMap<MapKey, wgpu::BindGroup>,
    frame_buf: wgpu::Buffer,
    /// The frame uniforms of the transmission pre-pass (linear output, no tone mapping).
    trans_frame_buf: wgpu::Buffer,
    draw_buf: wgpu::Buffer,
    draw_cap: u64,
    inst_buf: wgpu::Buffer,
    inst_cap: u64,
    shadow_pass_buf: wgpu::Buffer,
    /// The shadow-map array: its texture, array view, layers, size and per-layer views.
    shadow_tex: Option<(wgpu::Texture, wgpu::TextureView, u32, u32, Vec<wgpu::TextureView>)>,
    frame_group: Option<wgpu::BindGroup>,
    trans_frame_group: Option<wgpu::BindGroup>,
    draw_group: wgpu::BindGroup,
    shadow_group: wgpu::BindGroup,
    targets: Option<(u32, u32, wgpu::TextureView, wgpu::TextureView)>,
    transmission: Option<TransmissionTarget>,
    geoms: HashMap<u64, GpuGeom>,
    /// Geometry the last frame stopped drawing, whose buffers a geometry of the
    /// same sizes takes over (an animated surface is a new def every frame).
    spare: Vec<GpuGeom>,
    /// Geometry defs by id (stream v3): immutable, kept while a frame refers to them.
    defs: HashMap<u32, GeometryDesc>,
    frame_no: u64,
    scene: Scene,
    pub stats: Stats,
}

/// A material's textures: (id, sampler key) of the `map` and of the toon
/// `gradientMap`; `WHITE` stands in for either.
type MapKey = ((u32, u8), (u32, u8));
const WHITE: (u32, u8) = (u32::MAX, 0);

fn mat(m: Mat4) -> [[f32; 4]; 4] {
    m.to_cols_array_2d()
}

fn v4(v: Vec3, w: f32) -> [f32; 4] {
    [v.x, v.y, v.z, w]
}

fn buffer(device: &wgpu::Device, label: &str, size: u64, usage: wgpu::BufferUsages) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size, usage, mapped_at_creation: false })
}

fn init_buffer(device: &wgpu::Device, queue: &wgpu::Queue, label: &str, data: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
    let b = buffer(device, label, padded_size(data), usage | wgpu::BufferUsages::COPY_DST);
    fill_buffer(queue, &b, data);
    b
}

fn padded_size(data: &[u8]) -> u64 {
    (data.len() as u64).max(4).div_ceil(4) * 4
}

fn fill_buffer(queue: &wgpu::Queue, b: &wgpu::Buffer, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    if data.len() % 4 == 0 {
        queue.write_buffer(b, 0, data);
    } else {
        let mut padded = data.to_vec();
        padded.resize(padded_size(data) as usize, 0);
        queue.write_buffer(b, 0, &padded);
    }
}

fn make_dyn_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, buf: &wgpu::Buffer, label: &str, size: u64) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: buf, offset: 0, size: wgpu::BufferSize::new(size) }),
        }],
    })
}

fn texture_entry(binding: u32, visibility: wgpu::ShaderStages, sample_type: wgpu::TextureSampleType, dim: wgpu::TextureViewDimension) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Texture { sample_type, view_dimension: dim, multisampled: false },
        count: None,
    }
}

fn sampler_entry(binding: u32, visibility: wgpu::ShaderStages, ty: wgpu::SamplerBindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility, ty: wgpu::BindingType::Sampler(ty), count: None }
}

impl Shared3D {
    /// The shared resources of `device`: the one a live renderer already
    /// holds, or a new one (kept only as long as some renderer holds it).
    #[allow(clippy::arc_with_non_send_sync)]
    pub fn get(device: &wgpu::Device, queue: &wgpu::Queue) -> Arc<Shared3D> {
        SHARED.with(|list| {
            let mut list = list.borrow_mut();
            list.retain(|w| w.strong_count() > 0);
            if let Some(s) = list.iter().filter_map(Weak::upgrade).find(|s| s.device == *device) {
                return s;
            }
            let s = Arc::new(Shared3D::new(device, queue));
            list.push(Arc::downgrade(&s));
            s
        })
    }

    fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Shared3D {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("r3d-mesh"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/mesh.wgsl").into()),
        });
        let shadow_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("r3d-shadow"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/shadow.wgsl").into()),
        });
        let mip_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("r3d-mip"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/mip.wgsl").into()),
        });
        let vf = wgpu::ShaderStages::VERTEX_FRAGMENT;
        let fs = wgpu::ShaderStages::FRAGMENT;
        let float = wgpu::TextureSampleType::Float { filterable: true };
        let d2 = wgpu::TextureViewDimension::D2;
        let uniform = |binding, visibility, dynamic| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: dynamic, min_binding_size: None },
            count: None,
        };
        let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("r3d-frame"),
            entries: &[
                uniform(0, vf, false),
                texture_entry(1, vf, float, d2),
                sampler_entry(2, vf, wgpu::SamplerBindingType::Filtering),
                texture_entry(3, vf, wgpu::TextureSampleType::Depth, wgpu::TextureViewDimension::D2Array),
                sampler_entry(4, vf, wgpu::SamplerBindingType::Comparison),
                texture_entry(5, fs, float, d2),
                sampler_entry(6, fs, wgpu::SamplerBindingType::Filtering),
            ],
        });
        let draw_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("r3d-draw"),
            entries: &[uniform(0, vf, true)],
        });
        let shadow_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("r3d-shadow"),
            entries: &[uniform(0, wgpu::ShaderStages::VERTEX, true)],
        });
        let map_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("r3d-map"),
            entries: &[
                texture_entry(0, fs, float, d2),
                sampler_entry(1, fs, wgpu::SamplerBindingType::Filtering),
                texture_entry(2, fs, float, d2),
                sampler_entry(3, fs, wgpu::SamplerBindingType::Filtering),
            ],
        });
        let mip_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("r3d-mip"),
            entries: &[texture_entry(0, fs, float, d2), sampler_entry(1, fs, wgpu::SamplerBindingType::Filtering)],
        });
        let pipe_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("r3d"),
            bind_group_layouts: &[Some(&frame_layout), Some(&draw_layout), Some(&map_layout)],
            immediate_size: 0,
        });
        let shadow_pipe_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("r3d-shadow"),
            bind_group_layouts: &[Some(&shadow_layout)],
            immediate_size: 0,
        });
        let mip_pipe_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("r3d-mip"),
            bind_group_layouts: &[Some(&mip_layout)],
            immediate_size: 0,
        });
        let mip_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("r3d-mip"),
            layout: Some(&mip_pipe_layout),
            vertex: wgpu::VertexState { module: &mip_module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &mip_module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: HDR_FORMAT, blend: None, write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });

        let dfg = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("r3d-dfg"),
            size: wgpu::Extent3d { width: 16, height: 16, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rg16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &dfg, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            bytemuck::cast_slice(&DFG_LUT),
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(16 * 4), rows_per_image: Some(16) },
            wgpu::Extent3d { width: 16, height: 16, depth_or_array_layers: 1 },
        );
        let linear = |label, mipmap: bool| {
            device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some(label),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                mipmap_filter: if mipmap { wgpu::MipmapFilterMode::Linear } else { wgpu::MipmapFilterMode::Nearest },
                ..Default::default()
            })
        };
        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("r3d-shadow-cmp"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });
        Shared3D {
            device: device.clone(),
            queue: queue.clone(),
            module,
            shadow_module,
            frame_layout,
            draw_layout,
            shadow_layout,
            map_layout,
            mip_layout,
            pipe_layout,
            shadow_pipe_layout,
            mip_pipeline,
            dfg_view: dfg.create_view(&Default::default()),
            sampler: linear("r3d-linear", false),
            shadow_sampler,
            mip_sampler: linear("r3d-trilinear", true),
            white: upload_rgba(device, queue, &[255; 4], 1, 1, false, false),
            pipelines: Mutex::new(HashMap::new()),
            shadow_pipelines: Mutex::new(HashMap::new()),
            samplers: Mutex::new(HashMap::new()),
        }
    }

    fn sampler(&self, key: u8) -> wgpu::Sampler {
        let mut samplers = self.samplers.lock().unwrap();
        samplers
            .entry(key)
            .or_insert_with(|| {
                let wrap = |w: u8| match w {
                    1 => wgpu::AddressMode::Repeat,
                    2 => wgpu::AddressMode::MirrorRepeat,
                    _ => wgpu::AddressMode::ClampToEdge,
                };
                let filter = |nearest: bool| if nearest { wgpu::FilterMode::Nearest } else { wgpu::FilterMode::Linear };
                self.device.create_sampler(&wgpu::SamplerDescriptor {
                    label: Some("r3d-map"),
                    address_mode_u: wrap(key & 3),
                    address_mode_v: wrap((key >> 2) & 3),
                    mag_filter: filter(key & 16 != 0),
                    // three: minFilter "nearest" is NearestFilter (no mips),
                    // else LinearMipmapLinearFilter.
                    min_filter: filter(key & 32 != 0),
                    mipmap_filter: if key & 32 != 0 { wgpu::MipmapFilterMode::Nearest } else { wgpu::MipmapFilterMode::Linear },
                    lod_max_clamp: if key & 32 != 0 { 0.0 } else { 32.0 },
                    ..Default::default()
                })
            })
            .clone()
    }
}

impl Renderer3D {
    /// `format` is the target views' format; output is three's canvas
    /// content: sRGB-encoded, premultiplied by coverage (blending happens on
    /// encoded values, as in three), so use a UNORM (not `*Srgb`) format.
    /// Builds its own [`Shared3D`] (or reuses the device's live one).
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, format: wgpu::TextureFormat) -> Renderer3D {
        Renderer3D::with_shared(&Shared3D::get(device, queue), format)
    }

    /// A renderer on `shared`'s device that compiles nothing it already has:
    /// one per 3D scene, all drawing with the same pipelines.
    pub fn with_shared(shared: &Arc<Shared3D>, format: wgpu::TextureFormat) -> Renderer3D {
        let device = &shared.device;
        let frame_size = std::mem::size_of::<FrameU>() as u64;
        let frame_buf = buffer(device, "r3d-frame", frame_size, wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
        let trans_frame_buf = buffer(device, "r3d-frame-trans", frame_size, wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
        let draw_cap = 64 * UNIFORM_STRIDE;
        let draw_buf = buffer(device, "r3d-draws", draw_cap, wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
        let inst_cap = 256 * std::mem::size_of::<InstanceU>() as u64;
        let inst_buf = buffer(device, "r3d-instances", inst_cap, wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST);
        let shadow_pass_buf = buffer(
            device,
            "r3d-shadow-pass",
            MAX_SHADOW_LAYERS as u64 * UNIFORM_STRIDE,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let draw_group = make_dyn_group(device, &shared.draw_layout, &draw_buf, "r3d-draw", std::mem::size_of::<DrawU>() as u64);
        let shadow_group = make_dyn_group(device, &shared.shadow_layout, &shadow_pass_buf, "r3d-shadow", 64);
        let mut textures = HashMap::new();
        textures.insert(WHITE.0, shared.white.clone());
        Renderer3D {
            shared: shared.clone(),
            device: device.clone(),
            queue: shared.queue.clone(),
            format,
            pipelines: HashMap::new(),
            shadow_pipelines: HashMap::new(),
            textures,
            map_groups: HashMap::new(),
            frame_buf,
            trans_frame_buf,
            draw_buf,
            draw_cap,
            inst_buf,
            inst_cap,
            shadow_pass_buf,
            shadow_tex: None,
            frame_group: None,
            trans_frame_group: None,
            draw_group,
            shadow_group,
            targets: None,
            transmission: None,
            geoms: HashMap::new(),
            spare: Vec::new(),
            defs: HashMap::new(),
            frame_no: 0,
            scene: Scene::default(),
            stats: Stats::default(),
        }
    }

    /// Uploads straight-alpha RGBA8 rows (first row at v = 0) as texture `id`,
    /// with a full mip chain filtered as WebGL's `generateMipmap` does (in
    /// linear light for sRGB). `srgb` decodes on sampling, as three's
    /// `SRGBColorSpace` textures do. The test entry's path; the 2D graph uses
    /// [`set_texture_view`](Self::set_texture_view).
    pub fn upload_texture(&mut self, id: u32, rgba: &[u8], width: u32, height: u32, srgb: bool) {
        let view = upload_rgba(&self.device, &self.queue, rgba, width, height, srgb, true);
        self.set_texture_view(id, view);
    }

    /// Binds a caller-owned view (an image, or a 2D layer region for
    /// `Tex.surface`) as texture `id`: the zero-copy seam. An sRGB map wants
    /// an `*Srgb` view so sampling decodes, and a mip chain if its sampler
    /// minifies with mipmaps.
    pub fn set_texture_view(&mut self, id: u32, view: wgpu::TextureView) {
        self.textures.insert(id, view);
        self.map_groups.retain(|(a, b), _| a.0 != id && b.0 != id);
    }

    pub fn remove_texture(&mut self, id: u32) {
        if id == WHITE.0 {
            return;
        }
        self.textures.remove(&id);
        self.map_groups.retain(|(a, b), _| a.0 != id && b.0 != id);
    }

    fn sampler_key(m: &MapDesc) -> u8 {
        m.wrap_s | (m.wrap_t << 2) | ((m.mag_nearest as u8) << 4) | ((m.min_nearest as u8) << 5)
    }

    fn map_group(&mut self, key: MapKey) {
        if self.map_groups.contains_key(&key) {
            return;
        }
        let (Some(map), Some(grad)) = (self.textures.get(&key.0.0), self.textures.get(&key.1.0)) else { return };
        let (ms, gs) = (self.shared.sampler(key.0.1), self.shared.sampler(key.1.1));
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("r3d-map"),
            layout: &self.shared.map_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(map) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&ms) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(grad) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&gs) },
            ],
        });
        self.map_groups.insert(key, group);
    }

    /// Replaces the scene drawn by the next [`render`](Self::render), taking
    /// its geometry defs and dropping the defs it no longer refers to.
    pub fn set_scene(&mut self, mut scene: Scene) {
        self.defs.extend(scene.geometry_defs.drain(..));
        let live: std::collections::HashSet<u32> = scene.geometry_refs.iter().copied().collect();
        self.defs.retain(|id, _| live.contains(id));
        self.scene = scene;
    }

    pub fn scene(&self) -> &Scene {
        &self.scene
    }

    // ─── Geometry ────────────────────────────────────────────────────────────

    fn geometry_key(desc: &GeometryDesc, mode: Mode) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        mode.hash(&mut h);
        Self::hash_geometry(desc, &mut h);
        h.finish()
    }

    fn hash_geometry(desc: &GeometryDesc, h: &mut std::collections::hash_map::DefaultHasher) {
        let f = |h: &mut std::collections::hash_map::DefaultHasher, v: f32| v.to_bits().hash(h);
        let seg = |h: &mut std::collections::hash_map::DefaultHasher, s: &geometry::Segments| match s {
            geometry::Segments::Unset => 0u32.hash(h),
            geometry::Segments::Scalar(v) => {
                1u32.hash(h);
                v.to_bits().hash(h)
            }
            geometry::Segments::Tuple(t) => {
                2u32.hash(h);
                t.iter().for_each(|v| v.to_bits().hash(h))
            }
        };

        match desc {
            GeometryDesc::Box { w, h: hh, d, seg: s } => {
                0u8.hash(h);
                [*w, *hh, *d].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Sphere { radius, seg: s, start, sweep, lat_start, lat_sweep } => {
                1u8.hash(h);
                [*radius, *start, *sweep, *lat_start, *lat_sweep].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Plane { w, h: hh, seg: s } => {
                2u8.hash(h);
                [*w, *hh].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Cylinder { top, bottom, height, seg: s, capped, start, sweep } => {
                3u8.hash(h);
                [*top, *bottom, *height, *start, *sweep].iter().for_each(|v| f(h, *v));
                capped.hash(h);
                seg(h, s);
            }
            GeometryDesc::Torus { radius, tube, seg: s, start, sweep } => {
                5u8.hash(h);
                [*radius, *tube, *start, *sweep].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::TorusKnot { radius, tube, seg: s, p, q } => {
                6u8.hash(h);
                [*radius, *tube, *p, *q].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Circle { radius, seg: s, start, sweep } => {
                7u8.hash(h);
                [*radius, *start, *sweep].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Ring { outer, inner, seg: s, start, sweep } => {
                8u8.hash(h);
                [*outer, *inner, *start, *sweep].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Buffer(b) => {
                9u8.hash(h);
                b.positions.iter().for_each(|v| f(h, *v));
                for arr in [&b.normals, &b.uvs, &b.colors] {
                    match arr {
                        Some(a) => {
                            a.len().hash(h);
                            a.iter().for_each(|v| f(h, *v));
                        }
                        None => usize::MAX.hash(h),
                    }
                }
                b.indices.hash(h);
                b.compute_normals.hash(h);
            }
            GeometryDesc::SpriteQuad => 10u8.hash(h),
            GeometryDesc::Ref(id) => {
                17u8.hash(h);
                id.hash(h);
            }
            GeometryDesc::Unsupported(t) => t.hash(h),
            GeometryDesc::Capsule { radius, height, seg: s } => {
                11u8.hash(h);
                [*radius, *height].iter().for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Polyhedron { shape, radius, detail } => {
                12u8.hash(h);
                shape.hash(h);
                [*radius, *detail].iter().for_each(|v| f(h, *v));
            }
            GeometryDesc::Lathe { points, seg: s, start, sweep } => {
                13u8.hash(h);
                points.iter().flatten().chain([start, sweep]).for_each(|v| f(h, *v));
                seg(h, s);
            }
            GeometryDesc::Tube { points, closed, radius, seg: s } => {
                14u8.hash(h);
                points.iter().flatten().chain([radius]).for_each(|v| f(h, *v));
                closed.hash(h);
                seg(h, s);
            }
            GeometryDesc::Edges { source, threshold } => {
                15u8.hash(h);
                f(h, *threshold);
                Self::hash_geometry(source, h);
            }
            GeometryDesc::Wireframe { source } => {
                16u8.hash(h);
                Self::hash_geometry(source, h);
            }
        }
    }

    fn build_mesh(desc: &GeometryDesc) -> MeshData {
        let rad = |d: f32| d.to_radians();
        let tau = std::f32::consts::TAU;
        match desc {
            GeometryDesc::Box { w, h, d, seg } => {
                let s = seg.of(&[1.0, 1.0, 1.0]);
                geometry::box_geometry(*w, *h, *d, s[0], s[1], s[2])
            }
            GeometryDesc::Sphere { radius, seg, start, sweep, lat_start, lat_sweep } => {
                let s = seg.of(&[32.0, 16.0]);
                geometry::sphere(*radius, s[0], s[1], rad(*start), rad(*sweep), rad(*lat_start), rad(*lat_sweep))
            }
            GeometryDesc::Plane { w, h, seg } => {
                let s = seg.of(&[1.0, 1.0]);
                geometry::plane(*w, *h, s[0], s[1])
            }
            GeometryDesc::Cylinder { top, bottom, height, seg, capped, start, sweep } => {
                let s = seg.of(&[32.0, 1.0]);
                geometry::cylinder(*top, *bottom, *height, s[0], s[1], !capped, rad(*start), rad(*sweep))
            }
            GeometryDesc::Torus { radius, tube, seg, start, sweep } => {
                let s = seg.of(&[16.0, 48.0]);
                let mut m = geometry::torus(*radius, *tube, s[0], s[1], rad(*sweep), 0.0, tau);
                if *start != 0.0 {
                    let q = glam::Quat::from_rotation_z(rad(*start));
                    for p in m.positions.iter_mut() {
                        *p = (q * Vec3::from(*p)).to_array();
                    }
                    for n in m.normals.iter_mut() {
                        *n = (q * Vec3::from(*n)).normalize_or_zero().to_array();
                    }
                }
                m
            }
            GeometryDesc::TorusKnot { radius, tube, seg, p, q } => {
                let s = seg.of(&[64.0, 8.0]);
                geometry::torus_knot(*radius, *tube, s[0], s[1], *p, *q)
            }
            GeometryDesc::Circle { radius, seg, start, sweep } => {
                let s = seg.of(&[32.0]);
                geometry::circle(*radius, s[0], rad(*start), rad(*sweep))
            }
            GeometryDesc::Ring { outer, inner, seg, start, sweep } => {
                let s = seg.of(&[32.0, 1.0]);
                geometry::ring(*inner, *outer, s[0], s[1], rad(*start), rad(*sweep))
            }
            GeometryDesc::Buffer(b) => {
                let n = b.positions.len() / 3;
                let mut m = MeshData {
                    positions: b.positions.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect(),
                    uvs: match &b.uvs {
                        Some(u) => u.chunks_exact(2).map(|c| [c[0], c[1]]).collect(),
                        None => vec![[0.0; 2]; n],
                    },
                    colors: b.colors.as_ref().map(|c| c.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect()),
                    indices: b.indices.clone(),
                    ..Default::default()
                };
                match &b.normals {
                    Some(nn) => m.normals = nn.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect(),
                    None if b.compute_normals => m.compute_normals(),
                    None => m.normals = vec![[0.0; 3]; n],
                }
                m
            }
            GeometryDesc::SpriteQuad => MeshData {
                positions: vec![[-0.5, -0.5, 0.0], [0.5, -0.5, 0.0], [0.5, 0.5, 0.0], [-0.5, 0.5, 0.0]],
                normals: vec![[0.0, 0.0, 1.0]; 4],
                uvs: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
                indices: Some(vec![0, 1, 2, 0, 2, 3]),
                ..Default::default()
            },
            GeometryDesc::Capsule { radius, height, seg } => {
                let s = seg.of(&[16.0, 8.0]);
                geometry::capsule(*radius, *height, s[1], s[0])
            }
            GeometryDesc::Polyhedron { shape, radius, detail } => geometry::polyhedron(*shape, *radius, *detail),
            GeometryDesc::Lathe { points, seg, start, sweep } => {
                let s = seg.of(&[12.0]);
                geometry::lathe(points, s[0], rad(*start), rad(*sweep))
            }
            GeometryDesc::Tube { points, closed, radius, seg } => {
                let s = seg.of(&[64.0, 8.0]);
                geometry::tube(points, *closed, s[0], *radius, s[1])
            }
            GeometryDesc::Edges { source, threshold } => geometry::edges(&Self::build_mesh(source), *threshold),
            GeometryDesc::Wireframe { source } => geometry::wireframe(&Self::build_mesh(source)),
            GeometryDesc::Unsupported(_) | GeometryDesc::Ref(_) => MeshData::default(),
        }
    }

    fn line_indices(m: &MeshData, mode: Mode) -> Vec<u32> {
        let seq: Vec<u32> = m.indices.clone().unwrap_or_else(|| (0..m.vertex_count()).collect());
        let mut out = Vec::new();
        match mode {
            Mode::Wire => return m.wireframe_indices(),
            Mode::LineSegments => out = seq.chunks_exact(2).flatten().copied().collect(),
            Mode::LineStrip | Mode::LineLoop => {
                for w in seq.windows(2) {
                    out.extend_from_slice(&[w[0], w[1]]);
                }
                if mode == Mode::LineLoop && seq.len() > 1 {
                    out.extend_from_slice(&[seq[seq.len() - 1], seq[0]]);
                }
            }
            Mode::Tri | Mode::Points => {}
        }
        out
    }

    /// three's `computeLineDistances` (non-indexed only, as there), stored in
    /// the normal's x: lines are unlit. Cumulative along the vertices for a
    /// strip or loop, per pair for segments.
    fn line_distances(m: &mut MeshData, mode: Mode) {
        if m.indices.is_some() {
            return;
        }
        let p = |i: usize| glam::DVec3::new(m.positions[i][0] as f64, m.positions[i][1] as f64, m.positions[i][2] as f64);
        let n = m.positions.len();
        let mut d = vec![0f64; n];
        if mode == Mode::LineSegments {
            let mut i = 0;
            while i + 1 < n {
                d[i] = if i == 0 { 0.0 } else { d[i - 1] };
                d[i + 1] = d[i] + p(i).distance(p(i + 1));
                i += 2;
            }
        } else {
            for i in 1..n {
                d[i] = d[i - 1] + p(i - 1).distance(p(i));
            }
        }
        m.normals.resize(n, [0.0; 3]);
        for (nm, v) in m.normals.iter_mut().zip(d) {
            *nm = [v as f32, 0.0, 0.0];
        }
    }

    /// Points as quads: four copies of each vertex with the corner in `uv`.
    fn point_quads(m: &MeshData) -> MeshData {
        let seq: Vec<u32> = m.indices.clone().unwrap_or_else(|| (0..m.vertex_count()).collect());
        let mut out = MeshData { colors: m.colors.as_ref().map(|_| Vec::new()), ..Default::default() };
        let mut ix = Vec::with_capacity(seq.len() * 6);
        for (k, &i) in seq.iter().enumerate() {
            let i = i as usize;
            let Some(p) = m.positions.get(i) else { continue };
            for corner in [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] {
                out.positions.push(*p);
                out.normals.push([0.0, 0.0, 1.0]);
                out.uvs.push(corner);
                if let (Some(dst), Some(src)) = (out.colors.as_mut(), m.colors.as_ref()) {
                    dst.push(src.get(i).copied().unwrap_or([1.0; 3]));
                }
            }
            let b = (k * 4) as u32;
            ix.extend_from_slice(&[b, b + 1, b + 2, b, b + 2, b + 3]);
        }
        out.indices = Some(ix);
        out
    }

    fn ensure_geometry(&mut self, desc: &GeometryDesc, mode: Mode) -> u64 {
        // A def is keyed by its id alone (its content never changes); one
        // that never arrived draws nothing under a key of its own.
        let def = match desc {
            GeometryDesc::Ref(id) => self.defs.get(id),
            _ => None,
        };
        let key = match (desc, def) {
            (GeometryDesc::Ref(id), None) => Self::geometry_key(&GeometryDesc::Unsupported(u32::MAX - *id), mode),
            _ => Self::geometry_key(desc, mode),
        };
        if let Some(g) = self.geoms.get_mut(&key) {
            g.used = self.frame_no;
            return key;
        }
        let mut m = Self::build_mesh(def.unwrap_or(desc));
        if mode == Mode::Points {
            m = Self::point_quads(&m);
        }
        if matches!(mode, Mode::LineStrip | Mode::LineLoop | Mode::LineSegments) {
            Self::line_distances(&mut m, mode);
        }
        let mut verts: Vec<f32> = Vec::with_capacity(m.positions.len() * 8);
        for i in 0..m.positions.len() {
            verts.extend_from_slice(&m.positions[i]);
            verts.extend_from_slice(m.normals.get(i).unwrap_or(&[0.0; 3]));
            verts.extend_from_slice(m.uvs.get(i).unwrap_or(&[0.0; 2]));
        }
        let colors: Vec<f32> = match &m.colors {
            Some(c) => c.iter().flatten().copied().collect(),
            None => vec![1.0; m.positions.len() * 3],
        };
        let (indices, groups) = if mode.lines() {
            (Self::line_indices(&m, mode), Vec::new())
        } else {
            (m.indices.clone().unwrap_or_else(|| (0..m.vertex_count()).collect()), m.groups.clone())
        };
        let (vdata, cdata, idata): (&[u8], &[u8], &[u8]) =
            (bytemuck::cast_slice(&verts), bytemuck::cast_slice(&colors), bytemuck::cast_slice(&indices));
        let sizes = (padded_size(vdata), padded_size(cdata), padded_size(idata));
        let (vbuf, cbuf, ibuf) = match self.spare.iter().position(|g| (g.vbuf.size(), g.cbuf.size(), g.ibuf.size()) == sizes) {
            Some(i) => {
                let g = self.spare.swap_remove(i);
                fill_buffer(&self.queue, &g.vbuf, vdata);
                fill_buffer(&self.queue, &g.cbuf, cdata);
                fill_buffer(&self.queue, &g.ibuf, idata);
                (g.vbuf, g.cbuf, g.ibuf)
            }
            None => {
                let dev = &self.device;
                (
                    init_buffer(dev, &self.queue, "r3d-vertices", vdata, wgpu::BufferUsages::VERTEX),
                    init_buffer(dev, &self.queue, "r3d-colors", cdata, wgpu::BufferUsages::VERTEX),
                    init_buffer(dev, &self.queue, "r3d-indices", idata, wgpu::BufferUsages::INDEX),
                )
            }
        };
        let g = GpuGeom {
            vbuf,
            cbuf,
            ibuf,
            count: indices.len() as u32,
            groups,
            has_color: m.colors.is_some(),
            bounds: m.bounds(),
            sphere: m.bounding_sphere(),
            used: self.frame_no,
        };
        self.geoms.insert(key, g);
        key
    }

    // ─── Pipelines ───────────────────────────────────────────────────────────

    fn pipeline(&mut self, key: PipeKey) {
        if !self.pipelines.contains_key(&key) {
            let format = if key.hdr { HDR_FORMAT } else { self.format };
            let p = self.shared.pipeline(key, format);
            self.pipelines.insert(key, p);
        }
    }

    fn vertex_layouts() -> [Option<wgpu::VertexBufferLayout<'static>>; 3] {
        const GEOM: [wgpu::VertexAttribute; 3] = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2];
        const COLOR: [wgpu::VertexAttribute; 1] = wgpu::vertex_attr_array![3 => Float32x3];
        const INST: [wgpu::VertexAttribute; 8] = wgpu::vertex_attr_array![
            4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4,
            8 => Float32x4, 9 => Float32x4, 10 => Float32x4, 11 => Float32x4
        ];
        [
            Some(wgpu::VertexBufferLayout { array_stride: 32, step_mode: wgpu::VertexStepMode::Vertex, attributes: &GEOM }),
            Some(wgpu::VertexBufferLayout { array_stride: 12, step_mode: wgpu::VertexStepMode::Vertex, attributes: &COLOR }),
            Some(wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<InstanceU>() as u64,
                step_mode: wgpu::VertexStepMode::Instance,
                attributes: &INST,
            }),
        ]
    }

    fn blend_state(blend: u8) -> Option<wgpu::BlendState> {
        use wgpu::{BlendComponent as C, BlendFactor as F, BlendOperation as Op};
        let c = |s, d| C { src_factor: s, dst_factor: d, operation: Op::Add };
        match blend {
            // three: blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)
            1 => Some(wgpu::BlendState { color: c(F::SrcAlpha, F::OneMinusSrcAlpha), alpha: c(F::One, F::OneMinusSrcAlpha) }),
            2 => Some(wgpu::BlendState { color: c(F::SrcAlpha, F::One), alpha: c(F::SrcAlpha, F::One) }),
            3 => Some(wgpu::BlendState { color: c(F::Zero, F::OneMinusSrc), alpha: c(F::Zero, F::One) }),
            4 => Some(wgpu::BlendState { color: c(F::Zero, F::Src), alpha: c(F::Zero, F::SrcAlpha) }),
            _ => None,
        }
    }

    // ─── Targets ─────────────────────────────────────────────────────────────

    fn ensure_targets(&mut self, w: u32, h: u32) {
        if matches!(&self.targets, Some((tw, th, _, _)) if *tw == w && *th == h) {
            return;
        }
        let make = |format, label| {
            self.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: SAMPLE_COUNT,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let color = make(self.format, "r3d-msaa");
        let depth = make(DEPTH_FORMAT, "r3d-depth");
        self.targets = Some((w, h, color, depth));
    }

    fn ensure_shadow_maps(&mut self, layers: u32, size: u32) {
        let layers = layers.max(1);
        let size = size.max(1);
        if matches!(&self.shadow_tex, Some((_, _, l, s, _)) if *l == layers && *s == size) {
            return;
        }
        if let Some((t, ..)) = self.shadow_tex.take() {
            t.destroy();
        }
        let tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("r3d-shadow-maps"),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: layers },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = tex.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let layer_views = (0..layers)
            .map(|k| {
                tex.create_view(&wgpu::TextureViewDescriptor {
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: k,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        self.shadow_tex = Some((tex, view, layers, size, layer_views));
        self.frame_group = None;
        self.trans_frame_group = None;
    }

    /// The main pass's frame group (samples the transmission target, when
    /// there is one) and the transmission pre-pass's (white in its place: a
    /// pass can't sample what it renders into).
    fn ensure_frame_groups(&mut self) {
        if self.frame_group.is_some() && self.trans_frame_group.is_some() {
            return;
        }
        let sh = &self.shared;
        let shadow_view = &self.shadow_tex.as_ref().unwrap().1;
        let make = |buf: &wgpu::Buffer, trans: &wgpu::TextureView| {
            self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("r3d-frame"),
                layout: &sh.frame_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&sh.dfg_view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&sh.sampler) },
                    wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(shadow_view) },
                    wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(&sh.shadow_sampler) },
                    wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(trans) },
                    wgpu::BindGroupEntry { binding: 6, resource: wgpu::BindingResource::Sampler(&sh.mip_sampler) },
                ],
            })
        };
        let trans = self.transmission.as_ref().map(|t| &t.view).unwrap_or(&sh.white);
        self.frame_group = Some(make(&self.frame_buf, trans));
        self.trans_frame_group = Some(make(&self.trans_frame_buf, &sh.white));
    }

    /// three's transmission render target at the viewport size: 4x MSAA,
    /// half float, resolved into a full mip chain.
    fn ensure_transmission(&mut self, w: u32, h: u32) {
        if matches!(&self.transmission, Some(t) if t.w == w && t.h == h) {
            return;
        }
        let levels = 32 - w.max(h).leading_zeros();
        let tex = |samples, levels, usage| {
            self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("r3d-transmission"),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: levels,
                sample_count: samples,
                dimension: wgpu::TextureDimension::D2,
                format: HDR_FORMAT,
                usage,
                view_formats: &[],
            })
        };
        let msaa = tex(SAMPLE_COUNT, 1, wgpu::TextureUsages::RENDER_ATTACHMENT).create_view(&Default::default());
        let resolved = tex(1, levels, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING);
        let mips: Vec<wgpu::TextureView> = (0..levels)
            .map(|l| {
                resolved.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: l,
                    mip_level_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let sh = &self.shared;
        let blits = mips[..mips.len() - 1]
            .iter()
            .map(|src| {
                self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("r3d-mip"),
                    layout: &sh.mip_layout,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(src) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sh.sampler) },
                    ],
                })
            })
            .collect();
        self.transmission = Some(TransmissionTarget { w, h, msaa, view: resolved.create_view(&Default::default()), mips, blits });
        self.frame_group = None;
    }

    // ─── Frame ───────────────────────────────────────────────────────────────

    /// Records the scene into `encoder`: shadow passes, then one MSAA pass
    /// resolved into `target` (a `width` x `height` view of the format given
    /// to [`new`](Self::new)). Buffer uploads go through the queue now, so
    /// submit `encoder` before the next `render`.
    pub fn render(&mut self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        self.frame_no += 1;
        self.ensure_targets(width, height);
        let scene = std::mem::take(&mut self.scene);
        let mut stats = Stats::default();

        // Geometry first: the bounds frame the camera and the shadow frustums.
        struct Resolved {
            draw: usize,
            geom: u64,
            instances: Vec<Mat4>,
        }
        let mut resolved = Vec::with_capacity(scene.draws.len());
        let mut bounds: Option<(Vec3, Vec3)> = None;
        for (i, d) in scene.draws.iter().enumerate() {
            let mode = match d.kind {
                DrawKind::Points => Mode::Points,
                DrawKind::Line(0) => Mode::LineStrip,
                DrawKind::Line(1) => Mode::LineSegments,
                DrawKind::Line(_) => Mode::LineLoop,
                DrawKind::Sprite => Mode::Tri,
                DrawKind::Mesh => {
                    if d.materials.first().is_some_and(|m| m.wireframe) {
                        Mode::Wire
                    } else {
                        Mode::Tri
                    }
                }
            };
            let geom = self.ensure_geometry(&d.geometry, mode);
            let instances: Vec<Mat4> =
                if d.instances.is_empty() { vec![d.world] } else { d.instances.iter().map(|l| d.world * *l).collect() };
            if let Some((lo, hi)) = self.geoms[&geom].bounds {
                for m in &instances {
                    for c in 0..8 {
                        let p = Vec3::new(
                            if c & 1 == 0 { lo.x } else { hi.x },
                            if c & 2 == 0 { lo.y } else { hi.y },
                            if c & 4 == 0 { lo.z } else { hi.z },
                        );
                        let w = m.transform_point3(p);
                        bounds = Some(match bounds {
                            Some((a, b)) => (a.min(w), b.max(w)),
                            None => (w, w),
                        });
                    }
                }
            }
            resolved.push(Resolved { draw: i, geom, instances });
        }
        let span = bounds.map(|(a, b)| {
            let s = b - a;
            s.x.max(s.y).max(s.z)
        });

        // Camera (handlers/camera.ts).
        let aspect = width as f32 / height as f32;
        let (cam_world, proj, ortho) = match &scene.camera {
            None => {
                let eye = Vec3::new(0.0, 0.0, 5.0);
                let world = Mat4::from_rotation_translation(look_rotation(eye, Vec3::ZERO, Vec3::Y), eye);
                (world, Mat4::perspective_rh(50f32.to_radians(), aspect, 0.1, 1000.0), false)
            }
            Some(c) => {
                let (near, far) = if !c.near.is_nan() && !c.far.is_nan() {
                    (c.near, c.far)
                } else {
                    let span = span.unwrap_or(10.0);
                    let distance = if c.distance.is_nan() { span.max(1.0) * 2.0 } else { c.distance };
                    let reach = span.max(distance).max(1.0);
                    (
                        if c.near.is_nan() { (reach / 1000.0).max(0.01) } else { c.near },
                        if c.far.is_nan() { reach * 10.0 } else { c.far },
                    )
                };
                match c.kind {
                    CameraKind::Perspective => {
                        let fov = 2.0 * ((c.fov.to_radians() * 0.5).tan() / c.zoom).atan();
                        (c.world, Mat4::perspective_rh(fov, aspect, near, far), false)
                    }
                    CameraKind::Orthographic => {
                        let hh = c.frustum_height / 2.0 / c.zoom;
                        let hw = c.frustum_height / 2.0 * aspect / c.zoom;
                        (c.world, Mat4::orthographic_rh(-hw, hw, -hh, hh, near, far), true)
                    }
                }
            }
        };
        let view = cam_world.inverse();
        let view_proj = proj * view;

        // Lights and shadow cameras (handlers/light.ts).
        let settings = &scene.settings;
        let mut lights = [LightU::default(); MAX_LIGHTS];
        let mut shadows = [ShadowU::default(); MAX_SHADOWS];
        // One view-projection per shadow-map layer.
        let mut shadow_view_projs: Vec<Mat4> = Vec::new();
        let mut n_shadows = 0usize;
        let mut ambient = Vec3::ZERO;
        let mut n_lights = 0usize;
        let map_size = settings.shadow_map_size;
        for l in &scene.lights {
            if l.kind == LightKind::Ambient {
                ambient += l.color;
                continue;
            }
            if n_lights >= MAX_LIGHTS {
                continue;
            }
            let mut u = LightU::default();
            let to_light = (l.position - l.target).normalize_or_zero();
            let mut slot = -1.0;
            match l.kind {
                LightKind::Hemisphere => {
                    u.info[0] = 1.0;
                    u.position = v4(l.position.normalize_or_zero(), 0.0);
                    u.ground = v4(l.ground, 0.0);
                }
                LightKind::Directional => {
                    u.info[0] = 2.0;
                    u.position = v4(to_light, 0.0);
                }
                LightKind::Point | LightKind::Spot => {
                    u.info[0] = if l.kind == LightKind::Point { 3.0 } else { 4.0 };
                    u.position = v4(l.position, 1.0);
                    u.direction = v4(to_light, 0.0);
                    u.params = [l.distance, l.decay, l.angle.cos(), (l.angle * (1.0 - l.penumbra)).cos()];
                }
                LightKind::Area => {
                    // RectAreaLight: centre and half extents (world space).
                    u.info[0] = 5.0;
                    u.position = v4(l.position, 1.0);
                    u.direction = v4(l.half_width, 0.0);
                    u.ground = v4(l.half_height, 0.0);
                }
                _ => {}
            }
            if settings.shadows
                && let Some(sh) = l.shadow
                && matches!(l.kind, LightKind::Directional | LightKind::Spot | LightKind::Point)
                && n_shadows < MAX_SHADOWS
            {
                let extent = if sh.extent.is_nan() { span.map(|s| (s * 0.75).max(1.0)).unwrap_or(10.0) } else { sh.extent };
                let near = (extent * 0.05).max(0.05);
                let far = (extent * 8.0).max(near + 1.0);
                let sfar = if l.kind != LightKind::Directional && l.distance > 0.0 { l.distance } else { far };
                let layer = shadow_view_projs.len() as f32;
                let matrix: Mat4;
                if l.kind == LightKind::Point {
                    // PointLightShadow: six 90-degree faces around the light.
                    let proj = Mat4::perspective_rh(std::f32::consts::FRAC_PI_2, 1.0, near, sfar);
                    // The shader reads the light position from the translation.
                    matrix = Mat4::from_translation(l.position);
                    for (f, up) in CUBE_FACES {
                        shadow_view_projs.push(proj * Mat4::look_to_rh(l.position, f, up));
                    }
                } else {
                    let sproj = if l.kind == LightKind::Directional {
                        Mat4::orthographic_rh(-extent, extent, -extent, extent, near, far)
                    } else {
                        Mat4::perspective_rh(2.0 * l.angle, 1.0, near, sfar)
                    };
                    let sworld = Mat4::from_rotation_translation(look_rotation(l.position, l.target, Vec3::Y), l.position);
                    let svp = sproj * sworld.inverse();
                    let bias_m = Mat4::from_cols(
                        Vec4::new(0.5, 0.0, 0.0, 0.0),
                        Vec4::new(0.0, -0.5, 0.0, 0.0),
                        Vec4::new(0.0, 0.0, 1.0, 0.0),
                        Vec4::new(0.5, 0.5, 0.0, 1.0),
                    );
                    matrix = bias_m * svp;
                    shadow_view_projs.push(svp);
                }
                shadows[n_shadows] = ShadowU {
                    matrix: mat(matrix),
                    params: [-(sfar - near) / (map_size as f32 * 512.0), extent * 0.01, 1.0 + sh.softness * 8.0, map_size as f32],
                    extra: [if l.kind == LightKind::Point { 1.0 } else { 0.0 }, near, sfar, layer],
                };
                slot = n_shadows as f32;
                n_shadows += 1;
            }
            u.info[1] = slot;
            u.color = v4(l.color, 0.0);
            lights[n_lights] = u;
            n_lights += 1;
        }
        self.ensure_shadow_maps(shadow_view_projs.len() as u32, if shadow_view_projs.is_empty() { 1 } else { map_size });

        let env = settings.environment.unwrap_or(Vec3::ZERO);
        let frame = FrameU {
            view: mat(view),
            proj: mat(proj),
            camera: v4(cam_world.w_axis.truncate(), if ortho { 1.0 } else { 0.0 }),
            camera_dir: v4(cam_world.z_axis.truncate().normalize_or_zero(), 0.0),
            ambient: v4(ambient, 0.0),
            env: v4(env, if settings.environment.is_some() { 1.0 } else { 0.0 }),
            fog: v4(settings.fog_color, settings.fog as f32),
            fog_params: [settings.fog_near, settings.fog_far, settings.fog_density, 0.0],
            tone: [settings.tone as u32 as f32, settings.exposure, if settings.shadows { 1.0 } else { 0.0 }, n_lights as f32],
            viewport: [width as f32, height as f32, 1.0 / width as f32, 1.0 / height as f32],
            trans: [width as f32, height as f32, 0.0, 0.0],
            lights,
            shadows,
        };
        let mut frame = frame;

        // Draw items, instance data and per-draw uniforms.
        let mut instances: Vec<InstanceU> = Vec::new();
        let mut uniforms: Vec<DrawU> = Vec::new();
        let mut opaque: Vec<Item> = Vec::new();
        let mut transparent: Vec<Item> = Vec::new();
        // three's transmissive list: drawn after the opaque pass rendered
        // into the transmission target, before transparent.
        let mut transmissive: Vec<Item> = Vec::new();
        let mut casters: Vec<ShadowCaster> = Vec::new();

        if settings.env_background && settings.environment.is_some() {
            uniforms.push(DrawU {
                color: [0.0; 4],
                emissive: [0.0; 4],
                pbr: [0.0; 4],
                flags: [4, F_TONE_MAPPED | F_OPAQUE, 0, 0],
                spec: [0.0; 4],
                map0: [0.0; 4],
                map1: [0.0; 4],
                layer0: [0.0; 4],
                layer1: [0.0; 4],
                layer2: [0.0; 4],
            });
            opaque.push(Item {
                maps: (WHITE, WHITE),
                geom: 0,
                pipe: PipeKey { lines: false, cull: 0, cw: false, blend: 0, depth_write: false, depth_test: false, background: true, hdr: false },
                uniform: 0,
                first_instance: 0,
                instances: 0,
                range: (0, 3),
                z: f32::NEG_INFINITY,
                render_order: f32::NEG_INFINITY,
                order: 0,
            });
        }

        for r in &resolved {
            let d = &scene.draws[r.draw];
            let g = &self.geoms[&r.geom];
            let first = instances.len() as u32;
            let colored = !d.instance_colors.is_empty();
            for (k, m) in r.instances.iter().enumerate() {
                let nm = Mat3::from_mat4(*m).inverse().transpose();
                let c = d.instance_colors.get(k).copied().unwrap_or(Vec3::ONE);
                instances.push(InstanceU {
                    model: mat(*m),
                    normal: [v4(nm.x_axis, 0.0), v4(nm.y_axis, 0.0), v4(nm.z_axis, 0.0)],
                    color: v4(c, 1.0),
                });
            }
            let n_inst = r.instances.len() as u32;
            stats.instances += n_inst;
            let center = d.world.transform_point3(g.sphere.0);
            let clip = view_proj * center.extend(1.0);
            let z = if clip.w != 0.0 { clip.z / clip.w } else { 0.0 };
            let cw = Mat3::from_mat4(d.world).determinant() < 0.0;
            let lines = matches!(d.kind, DrawKind::Line(_)) || d.materials.first().is_some_and(|m| m.wireframe);

            // (material, index range): a material array draws by groups.
            let mut parts: Vec<(usize, (u32, u32))> = Vec::new();
            if d.material_array && !lines {
                for grp in &g.groups {
                    if (grp.material as usize) < d.materials.len() {
                        parts.push((grp.material as usize, (grp.start, grp.count.min(g.count.saturating_sub(grp.start)))));
                    }
                }
            } else if !d.materials.is_empty() {
                parts.push((0, (0, g.count)));
            }

            for (mi, range) in parts {
                let m = &d.materials[mi];
                if !m.visible || range.1 == 0 {
                    continue;
                }
                let kind = match m.kind {
                    MaterialKind::Standard => 1,
                    MaterialKind::Normal => 2,
                    MaterialKind::Shadow => 3,
                    MaterialKind::Phong => 5,
                    MaterialKind::Toon => 6,
                    MaterialKind::Depth => 7,
                    _ => 0,
                };
                let blend = match (m.blend, m.transparent) {
                    (Blend::None, _) => 0,
                    (Blend::Normal, false) => 0,
                    (Blend::Normal, true) => 1,
                    (Blend::Additive, _) => 2,
                    (Blend::Subtractive, _) => 3,
                    (Blend::Multiply, _) => 4,
                };
                let mut flags = 0;
                if m.vertex_colors && g.has_color {
                    flags |= F_VERTEX_COLORS;
                }
                if m.flat && kind != 0 && kind != 3 {
                    flags |= F_FLAT;
                }
                if m.tone_mapped {
                    flags |= F_TONE_MAPPED;
                }
                if d.receive_shadow {
                    flags |= F_RECEIVE_SHADOW;
                }
                if m.fog && m.kind != MaterialKind::Normal {
                    flags |= F_FOG;
                }
                if colored {
                    flags |= F_INSTANCE_COLOR;
                }
                if !m.transparent && m.blend == Blend::Normal {
                    flags |= F_OPAQUE;
                }
                if d.kind == DrawKind::Sprite {
                    flags |= F_BILLBOARD;
                }
                if d.kind == DrawKind::Points {
                    flags |= F_POINTS;
                }
                // A map whose texture the host hasn't provided draws untextured
                // (three draws nothing until the image decodes; ours keeps the colour).
                let map = match &m.map {
                    Some(md) if d.kind != DrawKind::Points && self.textures.contains_key(&md.texture) => {
                        flags |= F_MAP;
                        if md.flip_y {
                            flags |= F_MAP_FLIP_Y;
                        }
                        Some((md.texture, Self::sampler_key(md), md.transform))
                    }
                    _ => None,
                };
                if m.size_attenuation {
                    flags |= F_SIZE_ATTENUATION;
                }
                if m.dash.is_some() && lines {
                    flags |= F_DASHED;
                }
                let grad = match &m.gradient_map {
                    Some(gm) if self.textures.contains_key(&gm.texture) => {
                        flags |= F_GRADIENT;
                        if gm.flip_y {
                            flags |= F_GRADIENT_FLIP_Y;
                        }
                        (gm.texture, Self::sampler_key(gm))
                    }
                    _ => WHITE,
                };
                let dash = m.dash.unwrap_or([0.0; 3]);
                let sides: &[(Side, u32)] = match (m.side, m.transparent && !lines) {
                    (Side::Both, true) => &[(Side::Back, F_DOUBLE_SIDED), (Side::Front, F_DOUBLE_SIDED)],
                    (Side::Both, false) => &[(Side::Both, F_DOUBLE_SIDED)],
                    (Side::Back, _) => &[(Side::Back, F_FLIP_SIDED)],
                    (Side::Front, _) => &[(Side::Front, 0)],
                };
                for (side, side_flag) in sides {
                    let uniform = uniforms.len() as u32;
                    uniforms.push(DrawU {
                        color: v4(m.color, m.opacity),
                        emissive: v4(m.emissive, m.env_intensity),
                        pbr: [m.roughness, m.metalness, m.alpha_test, m.size],
                        flags: [kind, flags | side_flag, 0, 0],
                        spec: v4(m.specular, m.shininess),
                        map0: map.map(|(_, _, t)| [t[0], t[1], t[2], 0.0]).unwrap_or([1.0, 0.0, 0.0, 0.0]),
                        map1: map.map(|(_, _, t)| [t[3], t[4], t[5], 0.0]).unwrap_or([0.0, 1.0, 0.0, 0.0]),
                        layer0: [m.clearcoat, m.clearcoat_roughness, m.transmission, m.thickness],
                        layer1: [
                            m.ior,
                            if m.attenuation_distance.is_finite() { m.attenuation_distance } else { -1.0 },
                            dash[0],
                            dash[1],
                        ],
                        layer2: v4(m.attenuation_color, dash[2]),
                    });
                    let cull = if lines {
                        0
                    } else {
                        match side {
                            Side::Front => 1,
                            Side::Back => 2,
                            Side::Both => 0,
                        }
                    };
                    let item = Item {
                        maps: (map.map(|(t, k, _)| (t, k)).unwrap_or(WHITE), grad),
                        geom: r.geom,
                        pipe: PipeKey {
                            lines,
                            cull,
                            cw,
                            blend,
                            depth_write: m.depth_write,
                            depth_test: m.depth_test,
                            background: false,
                            hdr: false,
                        },
                        uniform,
                        first_instance: first,
                        instances: n_inst,
                        range,
                        z,
                        render_order: d.render_order,
                        order: d.order,
                    };
                    stats.draws += 1;
                    if !lines {
                        stats.triangles += (range.1 / 3) as u64 * n_inst as u64;
                    }
                    if m.transmission > 0.0 {
                        transmissive.push(item)
                    } else if m.transparent {
                        transparent.push(item)
                    } else {
                        opaque.push(item)
                    }
                }
                if d.cast_shadow && !lines && d.kind == DrawKind::Mesh && !shadow_view_projs.is_empty() {
                    // three renders the opposite side into the shadow map.
                    let cull = match m.side {
                        Side::Front => 2,
                        Side::Back => 1,
                        Side::Both => 0,
                    };
                    casters.push(ShadowCaster { geom: r.geom, cull, cw, first_instance: first, instances: n_inst, range });
                }
            }
        }
        let cmp = |a: &f32, b: &f32| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal);
        opaque.sort_by(|a, b| cmp(&a.render_order, &b.render_order).then(cmp(&a.z, &b.z)).then(a.order.cmp(&b.order)));
        let back_to_front = |a: &Item, b: &Item| cmp(&a.render_order, &b.render_order).then(cmp(&b.z, &a.z)).then(a.order.cmp(&b.order));
        transparent.sort_by(back_to_front);
        transmissive.sort_by(back_to_front);
        let has_transmission = !transmissive.is_empty();
        if has_transmission {
            self.ensure_transmission(width, height);
            frame.trans[2] = 1.0;
            // The pre-pass: three sets NoToneMapping and renders into a
            // linear (working colour space) target.
            let mut tf = frame;
            tf.tone[0] = 0.0;
            tf.trans[3] = 1.0;
            self.queue.write_buffer(&self.trans_frame_buf, 0, bytemuck::bytes_of(&tf));
        }
        self.queue.write_buffer(&self.frame_buf, 0, bytemuck::bytes_of(&frame));

        // Uploads.
        let draw_bytes = uniforms.len().max(1) as u64 * UNIFORM_STRIDE;
        if draw_bytes > self.draw_cap {
            self.draw_cap = draw_bytes.next_power_of_two();
            self.draw_buf = buffer(&self.device, "r3d-draws", self.draw_cap, wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
            self.draw_group =
                make_dyn_group(&self.device, &self.shared.draw_layout, &self.draw_buf, "r3d-draw", std::mem::size_of::<DrawU>() as u64);
        }
        let mut staged = vec![0u8; draw_bytes as usize];
        for (i, u) in uniforms.iter().enumerate() {
            let o = i * UNIFORM_STRIDE as usize;
            staged[o..o + std::mem::size_of::<DrawU>()].copy_from_slice(bytemuck::bytes_of(u));
        }
        self.queue.write_buffer(&self.draw_buf, 0, &staged);
        let inst_bytes = (instances.len().max(1) * std::mem::size_of::<InstanceU>()) as u64;
        if inst_bytes > self.inst_cap {
            self.inst_cap = inst_bytes.next_power_of_two();
            self.inst_buf =
                buffer(&self.device, "r3d-instances", self.inst_cap, wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST);
        }
        if !instances.is_empty() {
            self.queue.write_buffer(&self.inst_buf, 0, bytemuck::cast_slice(&instances));
        }
        let mut svp_bytes = vec![0u8; MAX_SHADOW_LAYERS * UNIFORM_STRIDE as usize];
        for (i, m) in shadow_view_projs.iter().enumerate() {
            let o = i * UNIFORM_STRIDE as usize;
            svp_bytes[o..o + 64].copy_from_slice(bytemuck::cast_slice(&m.to_cols_array()));
        }
        self.queue.write_buffer(&self.shadow_pass_buf, 0, &svp_bytes);

        // Pipelines and bind groups are created before the passes borrow them.
        for it in opaque.iter().chain(transmissive.iter()).chain(transparent.iter()) {
            self.pipeline(it.pipe);
            self.map_group(it.maps);
        }
        if has_transmission {
            for it in &opaque {
                self.pipeline(PipeKey { hdr: true, ..it.pipe });
            }
        }
        for c in &casters {
            if !self.shadow_pipelines.contains_key(&(c.cull, c.cw)) {
                let p = self.shared.shadow_pipeline(c.cull, c.cw);
                self.shadow_pipelines.insert((c.cull, c.cw), p);
            }
        }
        self.ensure_frame_groups();

        // Shadow passes.
        if let Some((_, _, _, _, layer_views)) = &self.shadow_tex {
            for (k, view) in layer_views.iter().enumerate().take(shadow_view_projs.len()) {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("r3d-shadow"),
                    color_attachments: &[],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view,
                        depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_bind_group(0, &self.shadow_group, &[(k as u64 * UNIFORM_STRIDE) as u32]);
                pass.set_vertex_buffer(1, self.inst_buf.slice(..));
                for c in &casters {
                    let g = &self.geoms[&c.geom];
                    pass.set_pipeline(&self.shadow_pipelines[&(c.cull, c.cw)]);
                    pass.set_vertex_buffer(0, g.vbuf.slice(..));
                    pass.set_index_buffer(g.ibuf.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(c.range.0..c.range.0 + c.range.1, 0, c.first_instance..c.first_instance + c.instances);
                }
                stats.shadow_maps += 1;
            }
        }

        let (_, _, color, depth) = self.targets.as_ref().unwrap();
        let draw_items = |pass: &mut wgpu::RenderPass, items: &[&Item], hdr: bool| {
            for it in items {
                pass.set_pipeline(&self.pipelines[&PipeKey { hdr, ..it.pipe }]);
                pass.set_bind_group(2, &self.map_groups[&it.maps], &[]);
                pass.set_bind_group(1, &self.draw_group, &[(it.uniform as u64 * UNIFORM_STRIDE) as u32]);
                if it.pipe.background {
                    pass.draw(0..3, 0..1);
                    continue;
                }
                let g = &self.geoms[&it.geom];
                pass.set_vertex_buffer(0, g.vbuf.slice(..));
                pass.set_vertex_buffer(1, g.cbuf.slice(..));
                pass.set_index_buffer(g.ibuf.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(it.range.0..it.range.0 + it.range.1, 0, it.first_instance..it.first_instance + it.instances);
            }
        };

        // Transmission pre-pass (renderTransmissionPass): the opaque list into
        // the half-float target, cleared to white at half alpha (three's
        // stand-in for a transparent clear, premultiplied), then its mips.
        if has_transmission {
            let t = self.transmission.as_ref().unwrap();
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("r3d-transmission"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &t.msaa,
                        depth_slice: None,
                        resolve_target: Some(&t.mips[0]),
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.5, g: 0.5, b: 0.5, a: 0.5 }),
                            store: wgpu::StoreOp::Discard,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: depth,
                        depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_bind_group(0, self.trans_frame_group.as_ref().unwrap(), &[]);
                pass.set_vertex_buffer(2, self.inst_buf.slice(..));
                draw_items(&mut pass, &opaque.iter().collect::<Vec<_>>(), true);
            }
            for (level, src) in t.blits.iter().enumerate() {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("r3d-mip"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &t.mips[level + 1],
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&self.shared.mip_pipeline);
                pass.set_bind_group(0, src, &[]);
                pass.draw(0..3, 0..1);
            }
        }

        // Main pass.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("r3d-main"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: color,
                    depth_slice: None,
                    resolve_target: Some(target),
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Discard },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, self.frame_group.as_ref().unwrap(), &[]);
            pass.set_vertex_buffer(2, self.inst_buf.slice(..));
            let items: Vec<&Item> = opaque.iter().chain(transmissive.iter()).chain(transparent.iter()).collect();
            draw_items(&mut pass, &items, false);
        }

        // Sweep geometry nothing drew this frame (the reconciler's sweep); it
        // stays spare for one frame.
        for g in self.spare.drain(..) {
            g.vbuf.destroy();
            g.cbuf.destroy();
            g.ibuf.destroy();
        }
        let frame_no = self.frame_no;
        let swept: Vec<u64> = self.geoms.iter().filter(|(_, g)| g.used != frame_no).map(|(k, _)| *k).collect();
        for k in swept {
            let g = self.geoms.remove(&k).unwrap();
            self.spare.push(g);
        }
        stats.geometries = self.geoms.len() as u32;
        stats.pipelines = (self.pipelines.len() + self.shadow_pipelines.len()) as u32;
        self.stats = stats;
        self.scene = scene;
    }
}

impl Shared3D {
    fn pipeline(&self, key: PipeKey, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        let mut cache = self.pipelines.lock().unwrap();
        cache.entry((key, format)).or_insert_with(|| self.make_pipeline(key, format)).clone()
    }

    fn shadow_pipeline(&self, cull: u8, cw: bool) -> wgpu::RenderPipeline {
        let mut cache = self.shadow_pipelines.lock().unwrap();
        cache.entry((cull, cw)).or_insert_with(|| self.make_shadow_pipeline(cull, cw)).clone()
    }

    fn make_pipeline(&self, key: PipeKey, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        let layouts = Renderer3D::vertex_layouts();
        let buffers: &[Option<wgpu::VertexBufferLayout>] = if key.background { &[] } else { &layouts };
        self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("r3d-mesh"),
            layout: Some(&self.pipe_layout),
            vertex: wgpu::VertexState {
                module: &self.module,
                entry_point: Some(if key.background { "vs_background" } else { "vs_main" }),
                compilation_options: Default::default(),
                buffers,
            },
            primitive: wgpu::PrimitiveState {
                topology: if key.lines { wgpu::PrimitiveTopology::LineList } else { wgpu::PrimitiveTopology::TriangleList },
                front_face: if key.cw { wgpu::FrontFace::Cw } else { wgpu::FrontFace::Ccw },
                cull_mode: match key.cull {
                    1 => Some(wgpu::Face::Back),
                    2 => Some(wgpu::Face::Front),
                    _ => None,
                },
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(key.depth_write),
                depth_compare: Some(if key.depth_test { wgpu::CompareFunction::LessEqual } else { wgpu::CompareFunction::Always }),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState { count: SAMPLE_COUNT, mask: !0, alpha_to_coverage_enabled: false },
            fragment: Some(wgpu::FragmentState {
                module: &self.module,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Renderer3D::blend_state(key.blend),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        })
    }

    fn make_shadow_pipeline(&self, cull: u8, cw: bool) -> wgpu::RenderPipeline {
        {
            const GEOM: [wgpu::VertexAttribute; 1] = wgpu::vertex_attr_array![0 => Float32x3];
            const INST: [wgpu::VertexAttribute; 4] =
                wgpu::vertex_attr_array![4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4];
            self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("r3d-shadow"),
                layout: Some(&self.shadow_pipe_layout),
                vertex: wgpu::VertexState {
                    module: &self.shadow_module,
                    entry_point: Some("vs_shadow"),
                    compilation_options: Default::default(),
                    buffers: &[
                        Some(wgpu::VertexBufferLayout { array_stride: 32, step_mode: wgpu::VertexStepMode::Vertex, attributes: &GEOM }),
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<InstanceU>() as u64,
                            step_mode: wgpu::VertexStepMode::Instance,
                            attributes: &INST,
                        }),
                    ],
                },
                primitive: wgpu::PrimitiveState {
                    front_face: if cw { wgpu::FrontFace::Cw } else { wgpu::FrontFace::Ccw },
                    cull_mode: match cull {
                        1 => Some(wgpu::Face::Back),
                        2 => Some(wgpu::Face::Front),
                        _ => None,
                    },
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH_FORMAT,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::LessEqual),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                fragment: None,
                multiview_mask: None,
                cache: None,
            })
        }
    }

}

/// Creates an RGBA8 texture from straight-alpha rows, with a box-filtered mip
/// chain when `mips` (in linear light when `srgb`, like WebGL's
/// `generateMipmap` on an sRGB texture).
fn upload_rgba(device: &wgpu::Device, queue: &wgpu::Queue, rgba: &[u8], w: u32, h: u32, srgb: bool, mips: bool) -> wgpu::TextureView {
    let (w, h) = (w.max(1), h.max(1));
    let levels = if mips { 32 - w.max(h).leading_zeros() } else { 1 };
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("r3d-texture"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: if srgb { wgpu::TextureFormat::Rgba8UnormSrgb } else { wgpu::TextureFormat::Rgba8Unorm },
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let to_lin = |c: u8| if srgb { srgb_to_linear(c as f32 / 255.0) } else { c as f32 / 255.0 };
    let to_byte = |v: f32| {
        let v = v.clamp(0.0, 1.0);
        let e = if srgb { if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 } } else { v };
        (e * 255.0 + 0.5) as u8
    };
    let mut level: Vec<u8> = rgba[..(w * h * 4) as usize].to_vec();
    let (mut lw, mut lh) = (w, h);
    for mip in 0..levels {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: mip, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &level,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(lw * 4), rows_per_image: Some(lh) },
            wgpu::Extent3d { width: lw, height: lh, depth_or_array_layers: 1 },
        );
        if mip + 1 == levels {
            break;
        }
        let (nw, nh) = ((lw / 2).max(1), (lh / 2).max(1));
        let mut next = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                let mut acc = [0f32; 4];
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let sx = (x * 2 + dx).min(lw - 1);
                    let sy = (y * 2 + dy).min(lh - 1);
                    let i = ((sy * lw + sx) * 4) as usize;
                    for c in 0..3 {
                        acc[c] += to_lin(level[i + c]);
                    }
                    acc[3] += level[i + 3] as f32 / 255.0;
                }
                let o = ((y * nw + x) * 4) as usize;
                for c in 0..3 {
                    next[o + c] = to_byte(acc[c] / 4.0);
                }
                next[o + 3] = ((acc[3] / 4.0).clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            }
        }
        level = next;
        lw = nw;
        lh = nh;
    }
    tex.create_view(&Default::default())
}

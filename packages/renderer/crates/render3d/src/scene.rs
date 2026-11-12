//! The decoded scene: a flat list of draws with world matrices, lights,
//! camera and settings, decoded from the word stream `web/src/r3d/encode.ts`
//! writes (format in docs-3d-renderer.md). Hierarchy is resolved here, with
//! three.js's `Object3D` rules (`applyTransform`, `lookAt`, Euler orders,
//! inherited visibility), so the GPU side never sees a tree.

use crate::geometry::Segments;
use glam::{Mat3, Mat4, Quat, Vec3, Vec4};

pub const MAGIC: u32 = 0x5233_4431; // "R3D1"
pub const VERSION: u32 = 4;

// ─── Descriptors ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub enum GeometryDesc {
    Box { w: f32, h: f32, d: f32, seg: Segments },
    Sphere { radius: f32, seg: Segments, start: f32, sweep: f32, lat_start: f32, lat_sweep: f32 },
    Plane { w: f32, h: f32, seg: Segments },
    Cylinder { top: f32, bottom: f32, height: f32, seg: Segments, capped: bool, start: f32, sweep: f32 },
    Torus { radius: f32, tube: f32, seg: Segments, start: f32, sweep: f32 },
    TorusKnot { radius: f32, tube: f32, seg: Segments, p: f32, q: f32 },
    Circle { radius: f32, seg: Segments, start: f32, sweep: f32 },
    Ring { outer: f32, inner: f32, seg: Segments, start: f32, sweep: f32 },
    Buffer(BufferDesc),
    Capsule { radius: f32, height: f32, seg: Segments },
    /// 0 tetrahedron, 1 octahedron, 2 icosahedron, 3 dodecahedron; `detail`
    /// as the engine resolves it (0 unless segments are given).
    Polyhedron { shape: u32, radius: f32, detail: f32 },
    /// Profile points (x, y).
    Lathe { points: Vec<[f32; 2]>, seg: Segments, start: f32, sweep: f32 },
    /// A centripetal Catmull-Rom curve through `points`, swept by a circle.
    Tube { points: Vec<[f32; 3]>, closed: bool, radius: f32, seg: Segments },
    /// `EdgesGeometry(source, threshold degrees)`.
    Edges { source: Box<GeometryDesc>, threshold: f32 },
    /// `WireframeGeometry(source)`.
    Wireframe { source: Box<GeometryDesc> },
    /// The unit quad three's `Sprite` shares.
    SpriteQuad,
    /// A geometry def the renderer keeps across frames (v3), by id.
    Ref(u32),
    /// A type this renderer doesn't build yet (drawn as nothing).
    Unsupported(u32),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct BufferDesc {
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub colors: Option<Vec<f32>>,
    pub indices: Option<Vec<u32>>,
    pub compute_normals: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MaterialKind {
    Basic,
    Standard,
    /// Blinn-Phong (`phong`), and `lambert` as Phong without specular.
    Phong,
    Normal,
    Points,
    Line,
    Sprite,
    Shadow,
    /// `MeshToonMaterial`: Lambert with a stepped (gradient map or two-tone) cosine.
    Toon,
    /// `MeshDepthMaterial` (basic packing): `1 - gl_FragCoord.z`, raw.
    Depth,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Side {
    Front,
    Back,
    Both,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Blend {
    Normal,
    Additive,
    Subtractive,
    Multiply,
    None,
}

/// A colour `map`: which texture (an id the host binds with
/// `Renderer3D::upload_texture` or `set_texture_view`) and how it is sampled.
#[derive(Clone, Debug, PartialEq)]
pub struct MapDesc {
    pub texture: u32,
    /// three's `Texture.matrix` (offset, repeat, rotation, center), rows of a 3x2.
    pub transform: [f32; 6],
    /// 0 clamp, 1 repeat, 2 mirror.
    pub wrap_s: u8,
    pub wrap_t: u8,
    /// three's `flipY` (images and surfaces): sample at `1 - v`.
    pub flip_y: bool,
    pub mag_nearest: bool,
    pub min_nearest: bool,
}

#[derive(Clone, Debug)]
pub struct MaterialDesc {
    pub kind: MaterialKind,
    /// Linear RGB (decoded from core's gamma-encoded colour, as three's
    /// `setRGB(.., SRGBColorSpace)` does).
    pub color: Vec3,
    pub opacity: f32,
    pub roughness: f32,
    pub metalness: f32,
    pub emissive: Vec3,
    pub env_intensity: f32,
    /// Phong specular colour (linear) and shininess.
    pub specular: Vec3,
    pub shininess: f32,
    pub map: Option<MapDesc>,
    /// three's latched `transparent`: blended and sorted back to front.
    pub transparent: bool,
    pub depth_write: bool,
    pub depth_test: bool,
    pub side: Side,
    pub blend: Blend,
    pub wireframe: bool,
    pub vertex_colors: bool,
    pub flat: bool,
    pub tone_mapped: bool,
    pub visible: bool,
    pub alpha_test: f32,
    pub size: f32,
    pub size_attenuation: bool,
    pub fog: bool,
    /// Physical: clearcoat layer (0 off) and its roughness.
    pub clearcoat: f32,
    pub clearcoat_roughness: f32,
    /// Physical: transmission (0 off), thickness, ior, attenuation distance
    /// (infinite when unset) and colour (linear).
    pub transmission: f32,
    pub thickness: f32,
    pub ior: f32,
    pub attenuation_distance: f32,
    pub attenuation_color: Vec3,
    /// `lineDashed`: (dashSize, gapSize, scale).
    pub dash: Option<[f32; 3]>,
    /// Toon: `gradientMap` (sampled at `(dotNL * 0.5 + 0.5, 0)`, red channel).
    pub gradient_map: Option<MapDesc>,
    /// `polygonOffset`: (factor, units), GL's sense (positive pushes away).
    pub polygon_offset: Option<(f32, f32)>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DrawKind {
    Mesh,
    Points,
    /// 0 strip, 1 segments, 2 loop.
    Line(u32),
    Sprite,
}

#[derive(Clone, Debug)]
pub struct Draw {
    pub kind: DrawKind,
    pub geometry: GeometryDesc,
    pub materials: Vec<MaterialDesc>,
    /// Whether the descriptor was a material array (three then draws by the
    /// geometry's groups, and nothing for a geometry without groups).
    pub material_array: bool,
    pub world: Mat4,
    /// Per-instance local matrices (an `InstancedMesh`), or empty.
    pub instances: Vec<Mat4>,
    /// Per-instance linear colours.
    pub instance_colors: Vec<Vec3>,
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    pub render_order: f32,
    /// Index in recording order (three's object id tiebreak).
    pub order: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LightKind {
    Ambient,
    Hemisphere,
    Directional,
    Point,
    Spot,
    Area,
}

#[derive(Clone, Debug)]
pub struct Light {
    pub kind: LightKind,
    /// Linear colour times intensity (×4π for point and spot).
    pub color: Vec3,
    pub ground: Vec3,
    pub position: Vec3,
    pub target: Vec3,
    pub distance: f32,
    pub decay: f32,
    pub angle: f32,
    pub penumbra: f32,
    pub shadow: Option<ShadowDesc>,
    /// Area light: half extents along the light's world X and Y (three's
    /// `halfWidth`/`halfHeight`, rotation only).
    pub half_width: Vec3,
    pub half_height: Vec3,
}

#[derive(Clone, Copy, Debug)]
pub struct ShadowDesc {
    pub softness: f32,
    /// NaN when unset (derived from the scene bounds).
    pub extent: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CameraKind {
    Perspective,
    Orthographic,
}

#[derive(Clone, Debug)]
pub struct CameraDesc {
    pub kind: CameraKind,
    pub world: Mat4,
    pub fov: f32,
    pub zoom: f32,
    pub frustum_height: f32,
    pub near: f32,
    pub far: f32,
    pub distance: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToneMapping {
    None = 0,
    Linear = 1,
    Reinhard = 2,
    Cineon = 3,
    Aces = 4,
    AgX = 5,
    Neutral = 6,
}

#[derive(Clone, Debug)]
pub struct Settings {
    pub tone: ToneMapping,
    pub exposure: f32,
    pub shadows: bool,
    pub shadow_map_size: u32,
    /// 0 none, 1 linear, 2 exp2.
    pub fog: u32,
    pub fog_color: Vec3,
    pub fog_near: f32,
    pub fog_far: f32,
    pub fog_density: f32,
    /// Uniform environment radiance (linear), the `preset: "studio"` room
    /// three generates (a 0xbbbbbb background through PMREM).
    pub environment: Option<Vec3>,
    pub env_background: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            tone: ToneMapping::Aces,
            exposure: 1.0,
            shadows: false,
            shadow_map_size: 2048,
            fog: 0,
            fog_color: Vec3::ZERO,
            fog_near: 1.0,
            fog_far: 1000.0,
            fog_density: 0.0,
            environment: None,
            env_background: false,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Scene {
    pub draws: Vec<Draw>,
    pub lights: Vec<Light>,
    pub camera: Option<CameraDesc>,
    pub settings: Settings,
    /// Op kinds recorded but not drawn (models, unsupported geometry), for
    /// the page's coverage readout.
    pub skipped: Vec<&'static str>,
    /// Geometry defs this frame introduces (id, geometry), and every def id the
    /// stream refers to (hidden draws included): what the renderer keeps.
    pub geometry_defs: Vec<(u32, GeometryDesc)>,
    pub geometry_refs: Vec<u32>,
}

// ─── three.js math ───────────────────────────────────────────────────────────

pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

fn linear_rgb(c: Vec4) -> Vec3 {
    Vec3::new(srgb_to_linear(c.x), srgb_to_linear(c.y), srgb_to_linear(c.z))
}

/// three's `Quaternion.setFromEuler`: order "ABC" composes qA·qB·qC.
pub fn euler_quat(x: f32, y: f32, z: f32, order: u32) -> Quat {
    let (qx, qy, qz) = (Quat::from_rotation_x(x), Quat::from_rotation_y(y), Quat::from_rotation_z(z));
    match order {
        1 => qy * qx * qz, // YXZ
        2 => qz * qx * qy, // ZXY
        3 => qz * qy * qx, // ZYX
        4 => qy * qz * qx, // YZX
        5 => qx * qz * qy, // XZY
        _ => qx * qy * qz, // XYZ
    }
}

/// three's `Matrix4.lookAt(eye, target, up)` rotation (+Z points from
/// target to eye).
pub fn look_rotation(eye: Vec3, target: Vec3, up: Vec3) -> Quat {
    let mut z = eye - target;
    if z.length_squared() == 0.0 {
        z.z = 1.0;
    }
    z = z.normalize();
    let mut x = up.cross(z);
    if x.length_squared() == 0.0 {
        if up.z.abs() == 1.0 {
            z.x += 0.0001;
        } else {
            z.z += 0.0001;
        }
        z = z.normalize();
        x = up.cross(z);
    }
    x = x.normalize();
    let y = z.cross(x);
    Quat::from_mat3(&Mat3::from_cols(x, y, z)).normalize()
}

fn rotation_of(m: &Mat4) -> Quat {
    let c = |v: Vec4| {
        let v = v.truncate();
        let l = v.length();
        if l > 0.0 { v / l } else { v }
    };
    Quat::from_mat3(&Mat3::from_cols(c(m.x_axis), c(m.y_axis), c(m.z_axis))).normalize()
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

struct Reader<'a> {
    refs: Vec<u32>,
    w: &'a [u32],
    i: usize,
}

impl Reader<'_> {
    fn u(&mut self) -> Result<u32, String> {
        let v = *self.w.get(self.i).ok_or("scene stream truncated")?;
        self.i += 1;
        Ok(v)
    }
    fn f(&mut self) -> Result<f32, String> {
        Ok(f32::from_bits(self.u()?))
    }
    fn v3(&mut self) -> Result<Vec3, String> {
        Ok(Vec3::new(self.f()?, self.f()?, self.f()?))
    }
    fn v4(&mut self) -> Result<Vec4, String> {
        Ok(Vec4::new(self.f()?, self.f()?, self.f()?, self.f()?))
    }
    fn floats(&mut self, n: usize) -> Result<Vec<f32>, String> {
        let s = self.w.get(self.i..self.i + n).ok_or("scene stream truncated")?;
        self.i += n;
        Ok(s.iter().map(|b| f32::from_bits(*b)).collect())
    }
    fn words(&mut self, n: usize) -> Result<Vec<u32>, String> {
        let s = self.w.get(self.i..self.i + n).ok_or("scene stream truncated")?;
        self.i += n;
        Ok(s.to_vec())
    }
    /// A colour slot: flag, then gamma-encoded RGBA.
    fn color(&mut self) -> Result<Option<Vec4>, String> {
        let has = self.u()? != 0;
        let c = self.v4()?;
        Ok(has.then_some(c))
    }
    fn segments(&mut self) -> Result<Segments, String> {
        let kind = self.u()?;
        let v = [self.f()?, self.f()?, self.f()?];
        Ok(match kind {
            1 => Segments::Scalar(v[0]),
            2 => Segments::Tuple(v),
            _ => Segments::Unset,
        })
    }
}

fn or(v: f32, d: f32) -> f32 {
    if v.is_nan() { d } else { v }
}

/// A `Transform3D` as recorded; applied by [`Transform::local`].
#[derive(Clone, Debug, Default)]
struct Transform {
    position: Option<Vec3>,
    rotation: Option<(Vec3, u32)>,
    quaternion: Option<Quat>,
    scale: Option<Vec3>,
    look_at: Option<Vec3>,
    hidden: bool,
    /// (casts, receives); `None` means unset (casts and receives).
    shadow: Option<(bool, bool)>,
    render_order: Option<f32>,
}

impl Transform {
    fn read(r: &mut Reader) -> Result<Transform, String> {
        let flags = r.u()?;
        let mut t = Transform::default();
        if flags & 1 != 0 {
            t.position = Some(r.v3()?);
        }
        if flags & 2 != 0 {
            let v = r.v3()?;
            t.rotation = Some((v, r.u()?));
        }
        if flags & 4 != 0 {
            let q = r.v4()?;
            t.quaternion = Some(Quat::from_xyzw(q.x, q.y, q.z, q.w));
        }
        if flags & 8 != 0 {
            t.scale = Some(r.v3()?);
        }
        if flags & 16 != 0 {
            t.look_at = Some(r.v3()?);
        }
        t.hidden = flags & 32 != 0;
        if flags & 64 != 0 {
            t.shadow = Some(match r.u()? {
                0 => (false, false),
                2 => (true, false),
                3 => (false, true),
                _ => (true, true),
            });
        }
        if flags & 128 != 0 {
            t.render_order = Some(r.f()?);
        }
        Ok(t)
    }

    /// three's `applyTransform` then `updateMatrix`: `lookAt` wins over
    /// `quaternion`, which wins over `rotation`. `aims_neg_z` is true for
    /// cameras and lights, which three aims down -Z.
    fn local(&self, parent: &Mat4, aims_neg_z: bool) -> Mat4 {
        let pos = self.position.unwrap_or(Vec3::ZERO);
        let scale = self.scale.unwrap_or(Vec3::ONE);
        let rot = if let Some(at) = self.look_at {
            let world_pos = parent.transform_point3(pos);
            let q = if aims_neg_z {
                look_rotation(world_pos, at, Vec3::Y)
            } else {
                look_rotation(at, world_pos, Vec3::Y)
            };
            rotation_of(parent).inverse() * q
        } else if let Some(q) = self.quaternion {
            q
        } else if let Some((r, order)) = self.rotation {
            let d = std::f32::consts::PI / 180.0;
            euler_quat(r.x * d, r.y * d, r.z * d, order)
        } else {
            Quat::IDENTITY
        };
        Mat4::from_scale_rotation_translation(scale, rot, pos)
    }
}

fn read_geometry(r: &mut Reader) -> Result<GeometryDesc, String> {
    let ty = r.u()?;
    Ok(match ty {
        0 => GeometryDesc::Box { w: or(r.f()?, 1.0), h: or(r.f()?, 1.0), d: or(r.f()?, 1.0), seg: r.segments()? },
        1 => GeometryDesc::Sphere {
            radius: or(r.f()?, 1.0),
            seg: r.segments()?,
            start: or(r.f()?, 0.0),
            sweep: or(r.f()?, 360.0),
            lat_start: or(r.f()?, 0.0),
            lat_sweep: or(r.f()?, 180.0),
        },
        2 => GeometryDesc::Plane { w: or(r.f()?, 1.0), h: or(r.f()?, 1.0), seg: r.segments()? },
        3 | 4 => {
            // Cylinder: [top, bottom] radii (core's `cylinderRadii`); cone: one radius.
            let (top, bottom) = if ty == 3 {
                (or(r.f()?, 1.0), or(r.f()?, 1.0))
            } else {
                (0.0, or(r.f()?, 1.0))
            };
            GeometryDesc::Cylinder {
                top,
                bottom,
                height: or(r.f()?, 1.0),
                seg: r.segments()?,
                capped: r.u()? != 0,
                start: or(r.f()?, 0.0),
                sweep: or(r.f()?, 360.0),
            }
        }
        5 => GeometryDesc::Torus {
            radius: or(r.f()?, 1.0),
            tube: or(r.f()?, 0.4),
            seg: r.segments()?,
            start: or(r.f()?, 0.0),
            sweep: or(r.f()?, 360.0),
        },
        6 => GeometryDesc::TorusKnot {
            radius: or(r.f()?, 1.0),
            tube: or(r.f()?, 0.4),
            seg: r.segments()?,
            p: or(r.f()?, 2.0),
            q: or(r.f()?, 3.0),
        },
        7 => GeometryDesc::Circle { radius: or(r.f()?, 1.0), seg: r.segments()?, start: or(r.f()?, 0.0), sweep: or(r.f()?, 360.0) },
        8 => GeometryDesc::Ring {
            outer: or(r.f()?, 1.0),
            inner: or(r.f()?, 0.5),
            seg: r.segments()?,
            start: or(r.f()?, 0.0),
            sweep: or(r.f()?, 360.0),
        },
        9 => {
            let flags = r.u()?;
            let n = r.u()? as usize;
            let ni = r.u()? as usize;
            let mut b = BufferDesc { positions: r.floats(n * 3)?, compute_normals: flags & 16 != 0, ..Default::default() };
            if flags & 1 != 0 {
                b.normals = Some(r.floats(n * 3)?);
            }
            if flags & 2 != 0 {
                b.uvs = Some(r.floats(n * 2)?);
            }
            if flags & 4 != 0 {
                b.colors = Some(r.floats(n * 3)?);
            }
            if flags & 8 != 0 {
                b.indices = Some(r.words(ni)?);
            }
            GeometryDesc::Buffer(b)
        }
        10 => GeometryDesc::Capsule { radius: or(r.f()?, 0.5), height: or(r.f()?, 1.0), seg: r.segments()? },
        11 => GeometryDesc::Polyhedron { shape: r.u()?, radius: or(r.f()?, 1.0), detail: or(r.f()?, 0.0) },
        12 => {
            let n = r.u()? as usize;
            let points = r.floats(n * 2)?.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
            GeometryDesc::Lathe { points, seg: r.segments()?, start: or(r.f()?, 0.0), sweep: or(r.f()?, 360.0) }
        }
        13 => {
            let n = r.u()? as usize;
            let points = r.floats(n * 3)?.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
            GeometryDesc::Tube { points, closed: r.u()? != 0, radius: or(r.f()?, 1.0), seg: r.segments()? }
        }
        14 => {
            let threshold = or(r.f()?, 1.0);
            GeometryDesc::Edges { source: Box::new(read_geometry(r)?), threshold }
        }
        15 => GeometryDesc::Wireframe { source: Box::new(read_geometry(r)?) },
        16 => {
            let id = r.u()?;
            r.refs.push(id);
            GeometryDesc::Ref(id)
        }
        other => GeometryDesc::Unsupported(other),
    })
}

/// A texture slot: flag, id, three's uv matrix (2 rows), sampler flags.
fn read_map(r: &mut Reader) -> Result<Option<MapDesc>, String> {
    let has_map = r.u()? != 0;
    let texture = r.u()?;
    let transform = [r.f()?, r.f()?, r.f()?, r.f()?, r.f()?, r.f()?];
    let map_flags = r.u()?;
    Ok(has_map.then_some(MapDesc {
        texture,
        transform,
        wrap_s: (map_flags & 3) as u8,
        wrap_t: ((map_flags >> 2) & 3) as u8,
        flip_y: map_flags & 16 != 0,
        mag_nearest: map_flags & 32 != 0,
        min_nearest: map_flags & 64 != 0,
    }))
}

fn read_material(r: &mut Reader) -> Result<MaterialDesc, String> {
    let ty = r.u()?;
    let color = r.color()?;
    let opacity = r.f()?;
    let roughness = r.f()?;
    let metalness = r.f()?;
    let emission = r.color()?;
    let emission_strength = or(r.f()?, 1.0);
    let env_intensity = or(r.f()?, 1.0);
    let flags = r.u()?;
    let faces = r.u()?;
    let blend = r.u()?;
    let alpha_test = or(r.f()?, 0.0);
    let size = r.f()?;
    let specular = r.color()?;
    let shininess = or(r.f()?, 30.0);
    let map = read_map(r)?;
    let clearcoat = or(r.f()?, 0.0);
    let clearcoat_roughness = or(r.f()?, 0.0);
    let transmission = or(r.f()?, 0.0);
    let thickness = or(r.f()?, 0.0);
    let ior = or(r.f()?, 1.5);
    let attenuation_distance = or(r.f()?, f32::INFINITY);
    let attenuation_color = r.color()?.map(linear_rgb).unwrap_or(Vec3::ONE);
    let dash = [or(r.f()?, 3.0), or(r.f()?, 1.0), or(r.f()?, 1.0)];
    let gradient_map = read_map(r)?;
    let polygon_offset = (or(r.f()?, 0.0), or(r.f()?, 0.0));

    let kind = match ty {
        0 => MaterialKind::Basic,
        3 | 4 => MaterialKind::Phong,
        5 => MaterialKind::Normal,
        6 => MaterialKind::Points,
        7 | 8 => MaterialKind::Line,
        9 => MaterialKind::Sprite,
        10 => MaterialKind::Shadow,
        11 => MaterialKind::Toon,
        13 => MaterialKind::Depth,
        _ => MaterialKind::Standard,
    };
    // A colour's alpha stands in for `opacity` when that is unset.
    let color_alpha = color.map(|c| c.w).unwrap_or(1.0);
    let opacity_v = if opacity.is_nan() { color_alpha } else { opacity };
    // three's `needsBlending`: explicit flag, opacity < 1, a translucent colour.
    let explicit_transparent = flags & 1 != 0;
    let physical = ty == 2;
    let transmission = if physical { transmission } else { 0.0 };
    let blends =
        explicit_transparent || (!opacity.is_nan() && opacity < 1.0) || color_alpha < 1.0 || transmission > 0.0;
    let default_color = match kind {
        MaterialKind::Shadow => Vec3::ZERO,
        _ => Vec3::ONE,
    };
    Ok(MaterialDesc {
        kind,
        color: color.map(linear_rgb).unwrap_or(default_color),
        opacity: opacity_v,
        roughness: or(roughness, 1.0),
        metalness: or(metalness, 0.0),
        emissive: emission.map(linear_rgb).unwrap_or(Vec3::ZERO) * emission_strength,
        env_intensity,
        specular: match ty {
            3 => Vec3::ZERO,
            _ => specular.map(linear_rgb).unwrap_or(Vec3::splat(srgb_to_linear(0x11 as f32 / 255.0))),
        },
        // Lambert has no specular lobe at all (not even Phong's Fresnel
        // with a black specular colour); -1 marks it.
        shininess: if ty == 3 { -1.0 } else { shininess.max(1e-4) },
        map,
        // A shadow material is always transparent in three.
        transparent: blends || kind == MaterialKind::Shadow,
        depth_write: if flags & 256 != 0 { flags & 512 != 0 } else { !blends },
        depth_test: flags & 128 == 0,
        side: match faces {
            1 => Side::Back,
            2 => Side::Both,
            _ => Side::Front,
        },
        blend: match blend {
            1 => Blend::Additive,
            2 => Blend::Subtractive,
            3 => Blend::Multiply,
            4 => Blend::None,
            _ => Blend::Normal,
        },
        wireframe: flags & 4 != 0,
        vertex_colors: flags & 8 != 0,
        flat: flags & 16 != 0,
        tone_mapped: flags & 32 == 0,
        visible: flags & 64 == 0,
        alpha_test,
        size: or(size, 1.0),
        size_attenuation: flags & 1024 == 0,
        fog: true,
        clearcoat: if physical { clearcoat.clamp(0.0, 1.0) } else { 0.0 },
        clearcoat_roughness,
        transmission,
        thickness,
        // Standard's fixed F0 of 0.04 is ior 1.5.
        ior: if physical { ior } else { 1.5 },
        attenuation_distance,
        attenuation_color,
        dash: (ty == 8).then_some(dash),
        gradient_map: if ty == 11 { gradient_map } else { None },
        polygon_offset: (flags & 2048 != 0).then_some(polygon_offset),
    })
}

struct Frame {
    world: Mat4,
    visible: bool,
}

/// Decodes a scene stream (see `docs-3d-renderer.md`).
pub fn decode(words: &[u32]) -> Result<Scene, String> {
    let mut r = Reader { refs: Vec::new(), w: words, i: 0 };
    if r.u()? != MAGIC {
        return Err("not a scene stream (bad magic)".into());
    }
    let version = r.u()?;
    if version != VERSION {
        return Err(format!("scene stream version {version}, expected {VERSION}"));
    }
    let mut scene = Scene::default();
    let s = &mut scene.settings;
    s.tone = match r.u()? {
        0 => ToneMapping::None,
        1 => ToneMapping::Linear,
        2 => ToneMapping::Reinhard,
        3 => ToneMapping::Cineon,
        5 => ToneMapping::AgX,
        6 => ToneMapping::Neutral,
        _ => ToneMapping::Aces,
    };
    s.exposure = or(r.f()?, 1.0);
    s.shadows = r.u()? != 0;
    s.shadow_map_size = match r.u()? {
        0 => 512,
        2 => 4096,
        _ => 2048,
    };
    s.fog = r.u()?;
    // three uploads fogColor in the output space (getUnlitUniformColorSpace)
    // and mixes after encoding, so the gamma-encoded colour is used as is.
    s.fog_color = r.color()?.map(|c| c.truncate()).unwrap_or(Vec3::ZERO);
    s.fog_near = or(r.f()?, 1.0);
    s.fog_far = or(r.f()?, 1000.0);
    s.fog_density = or(r.f()?, 0.0);
    let env = r.u()?;
    let env_intensity = or(r.f()?, 1.0);
    s.env_background = r.u()? != 0;
    let _blur = r.f()?;
    if env == 1 {
        s.environment = Some(Vec3::splat(srgb_to_linear(0xbb as f32 / 255.0) * env_intensity));
    }

    let count = r.u()? as usize;
    let mut stack = vec![Frame { world: Mat4::IDENTITY, visible: true }];
    // Shadow flags ride on each drawable's own transform (core copies the
    // scope's onto ops that state none), so groups don't pass them down.
    let mut order = 0u32;
    for _ in 0..count {
        let op = r.u()?;
        let top = stack.last().map(|f| (f.world, f.visible)).unwrap_or((Mat4::IDENTITY, true));
        match op {
            1 => {
                let t = Transform::read(&mut r)?;
                let world = top.0 * t.local(&top.0, false);
                stack.push(Frame { world, visible: top.1 && !t.hidden });
            }
            2 => {
                if stack.len() > 1 {
                    stack.pop();
                }
            }
            3 => {
                let ty = r.u()?;
                let color = r.color()?;
                let intensity = or(r.f()?, 1.0);
                let sky = r.color()?;
                let ground = r.color()?;
                let distance = or(r.f()?, 0.0);
                let decay = or(r.f()?, 2.0);
                let angle = r.f()?;
                let penumbra = or(r.f()?, 0.0);
                let has_target = r.u()? != 0;
                let target = r.v3()?;
                let casts = r.u()? != 0;
                let softness = or(r.f()?, 0.5);
                let extent = r.f()?;
                let width = or(r.f()?, 10.0);
                let height = or(r.f()?, 10.0);
                let t = Transform::read(&mut r)?;
                if !(top.1 && !t.hidden) {
                    continue;
                }
                let world = top.0 * t.local(&top.0, true);
                let kind = match ty {
                    0 => LightKind::Ambient,
                    1 => LightKind::Hemisphere,
                    2 => LightKind::Directional,
                    3 => LightKind::Point,
                    4 => LightKind::Spot,
                    _ => LightKind::Area,
                };
                let scale = if matches!(kind, LightKind::Point | LightKind::Spot) { 4.0 * std::f32::consts::PI } else { 1.0 };
                let (c, g) = if kind == LightKind::Hemisphere {
                    (sky.map(linear_rgb).unwrap_or(Vec3::ONE), ground.map(linear_rgb).unwrap_or(Vec3::ONE))
                } else {
                    (color.map(linear_rgb).unwrap_or(Vec3::ONE), Vec3::ZERO)
                };
                scene.lights.push(Light {
                    kind,
                    color: c * intensity * scale,
                    ground: g * intensity,
                    position: world.w_axis.truncate(),
                    target: if has_target { target } else { Vec3::ZERO },
                    distance,
                    decay,
                    angle: if angle.is_nan() { std::f32::consts::PI / 3.0 } else { angle.to_radians() },
                    penumbra,
                    shadow: casts.then_some(ShadowDesc { softness, extent }),
                    half_width: rotation_of(&world) * Vec3::new(width * 0.5, 0.0, 0.0),
                    half_height: rotation_of(&world) * Vec3::new(0.0, height * 0.5, 0.0),
                });
            }
            4 => {
                let kind = if r.u()? == 1 { CameraKind::Orthographic } else { CameraKind::Perspective };
                let t = Transform::read(&mut r)?;
                let (fov, zoom, fh, near, far, distance) = (r.f()?, r.f()?, r.f()?, r.f()?, r.f()?, r.f()?);
                scene.camera = Some(CameraDesc {
                    kind,
                    world: top.0 * t.local(&top.0, true),
                    fov: or(fov, 50.0),
                    zoom: or(zoom, 1.0),
                    frustum_height: or(fh, 10.0),
                    near,
                    far,
                    distance,
                });
            }
            5..=9 => {
                let geometry = if op == 9 { GeometryDesc::SpriteQuad } else { read_geometry(&mut r)? };
                let mut materials = Vec::new();
                let mut material_array = false;
                if op == 5 {
                    let n = r.u()?;
                    material_array = n != 1;
                    for _ in 0..n {
                        materials.push(read_material(&mut r)?);
                    }
                } else {
                    materials.push(read_material(&mut r)?);
                }
                let mode = if op == 8 { r.u()? } else { 0 };
                let t = Transform::read(&mut r)?;
                let mut instances = Vec::new();
                let mut instance_colors = Vec::new();
                if op == 6 {
                    let n = r.u()?;
                    for _ in 0..n {
                        let it = Transform::read(&mut r)?;
                        instances.push(it.local(&Mat4::IDENTITY, false));
                    }
                    let nc = r.u()?;
                    for _ in 0..nc {
                        instance_colors.push(linear_rgb(r.v4()?));
                    }
                }
                if !(top.1 && !t.hidden) {
                    continue;
                }
                if let GeometryDesc::Unsupported(ty) = geometry {
                    let _ = ty;
                    scene.skipped.push("geometry");
                    continue;
                }
                let world = top.0 * t.local(&top.0, false);
                let (cast, receive) = t.shadow.unwrap_or((true, true));
                scene.draws.push(Draw {
                    kind: match op {
                        7 => DrawKind::Points,
                        8 => DrawKind::Line(mode),
                        9 => DrawKind::Sprite,
                        _ => DrawKind::Mesh,
                    },
                    geometry,
                    materials,
                    material_array,
                    world,
                    instances,
                    instance_colors,
                    cast_shadow: cast,
                    receive_shadow: receive,
                    render_order: t.render_order.unwrap_or(0.0),
                    order,
                });
                order += 1;
            }
            10 => {
                let _ = Transform::read(&mut r)?;
                scene.skipped.push("model");
            }
            other => return Err(format!("unknown scene op {other}")),
        }
    }
    let n = r.u()?;
    for _ in 0..n {
        let id = r.u()?;
        scene.geometry_defs.push((id, read_geometry(&mut r)?));
    }
    scene.geometry_refs = r.refs;
    Ok(scene)
}

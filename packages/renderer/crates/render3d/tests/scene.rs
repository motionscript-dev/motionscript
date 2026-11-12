//! Native checks: three's tessellation counts, Euler orders, `lookAt`, and a
//! hand-written scene stream through the decoder.

use glam::{Mat4, Quat, Vec3, Vec4};
use ms_render3d::geometry::{self, Segments};
use ms_render3d::renderer;
use ms_render3d::scene::{self, DrawKind, GeometryDesc, LightKind, MaterialKind};

#[test]
fn primitive_counts_match_three() {
    let b = geometry::box_geometry(1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    assert_eq!((b.vertex_count(), b.element_count(), b.groups.len()), (24, 36, 6));
    // SphereGeometry(1, 32, 16): (32+1)*(16+1) vertices, poles single triangles.
    let s = geometry::sphere(1.0, 32.0, 16.0, 0.0, std::f32::consts::TAU, 0.0, std::f32::consts::PI);
    assert_eq!(s.vertex_count(), 33 * 17);
    assert_eq!(s.element_count(), (32 * 16 * 2 - 2 * 32) * 3);
    let c = geometry::cylinder(1.0, 1.0, 1.0, 32.0, 1.0, false, 0.0, std::f32::consts::TAU);
    assert_eq!((c.vertex_count(), c.groups.len()), (33 * 2 + 2 * (32 + 33), 3));
    let t = geometry::torus(1.0, 0.4, 16.0, 48.0, std::f32::consts::TAU, 0.0, std::f32::consts::TAU);
    assert_eq!((t.vertex_count(), t.element_count()), (17 * 49, 16 * 48 * 6));
    assert_eq!(Segments::Scalar(2.7).of(&[1.0, 1.0]), vec![2.0, 2.0]);
    assert_eq!(Segments::Tuple([4.0, f32::NAN, f32::NAN]).of(&[32.0, 16.0]), vec![4.0, 16.0]);
}

#[test]
fn euler_orders_compose_like_three() {
    let (x, y, z) = (0.3, -0.7, 1.1);
    let (qx, qy, qz) = (Quat::from_rotation_x(x), Quat::from_rotation_y(y), Quat::from_rotation_z(z));
    assert!(scene::euler_quat(x, y, z, 0).abs_diff_eq(qx * qy * qz, 1e-6));
    assert!(scene::euler_quat(x, y, z, 1).abs_diff_eq(qy * qx * qz, 1e-6));
    assert!(scene::euler_quat(x, y, z, 3).abs_diff_eq(qz * qy * qx, 1e-6));
}

#[test]
fn look_rotation_points_z_from_target() {
    let q = scene::look_rotation(Vec3::new(0.0, 0.0, 5.0), Vec3::ZERO, Vec3::Y);
    assert!((q * Vec3::Z).abs_diff_eq(Vec3::Z, 1e-6));
    let q = scene::look_rotation(Vec3::new(3.0, 0.0, 0.0), Vec3::ZERO, Vec3::Y);
    assert!((q * Vec3::Z).abs_diff_eq(Vec3::X, 1e-6));
}

struct W(Vec<u32>);
impl W {
    fn u(&mut self, v: u32) -> &mut Self { self.0.push(v); self }
    fn f(&mut self, v: f32) -> &mut Self { self.0.push(v.to_bits()); self }
    fn color(&mut self, c: Option<[f32; 4]>) -> &mut Self {
        match c {
            Some(c) => { self.u(1); c.iter().for_each(|v| { self.f(*v); }); }
            None => { self.u(0); (0..4).for_each(|_| { self.f(0.0); }); }
        }
        self
    }
    fn material(&mut self, ty: u32, color: [f32; 4]) -> &mut Self {
        self.material_with(ty, color, 0, [f32::NAN; 2])
    }
    fn material_with(&mut self, ty: u32, color: [f32; 4], flags: u32, offset: [f32; 2]) -> &mut Self {
        self.u(ty).color(Some(color)).f(f32::NAN).f(0.4).f(f32::NAN).color(None).f(f32::NAN).f(f32::NAN)
            .u(flags).u(0).u(0).f(f32::NAN).f(f32::NAN).color(None).f(f32::NAN)
            .u(0).u(0).f(1.0).f(0.0).f(0.0).f(0.0).f(1.0).f(0.0).u(0)
            // v2: clearcoat, roughness, transmission, thickness, ior, attenuation distance + colour,
            // dash, gap, scale, gradient map slot
            .f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).color(None)
            .f(f32::NAN).f(f32::NAN).f(f32::NAN)
            .u(0).u(0).f(1.0).f(0.0).f(0.0).f(0.0).f(1.0).f(0.0).u(0)
            // v4: polygonOffset factor, units
            .f(offset[0]).f(offset[1])
    }
}

#[test]
fn decodes_a_scene_stream() {
    let mut w = W(Vec::new());
    w.u(scene::MAGIC).u(scene::VERSION);
    // tone aces, exposure, shadows on/medium, no fog, studio env
    w.u(4).f(f32::NAN).u(1).u(1).u(0).color(None).f(f32::NAN).f(f32::NAN).f(f32::NAN).u(1).f(0.5).u(0).f(f32::NAN);
    w.u(4); // ops
    // push: position (0, 2, 0), hidden=false
    w.u(1).u(1).f(0.0).f(2.0).f(0.0);
    // directional light with shadow at (3, 4, 0)
    w.u(3).u(2).color(None).f(2.0).color(None).color(None).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN)
        .u(0).f(0.0).f(0.0).f(0.0).u(1).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).u(1).f(3.0).f(4.0).f(0.0);
    // mesh: box 2x1x1, unset segments, standard translucent red, at x=1
    w.u(5).u(0).f(2.0).f(f32::NAN).f(f32::NAN).u(0).f(f32::NAN).f(f32::NAN).f(f32::NAN);
    w.u(1).material(1, [1.0, 0.0, 0.0, 0.5]);
    w.u(1).f(1.0).f(0.0).f(0.0);
    w.u(2);
    w.u(0); // no geometry defs
    let s = scene::decode(&w.0).expect("decodes");
    assert!(s.settings.shadows && s.settings.environment.is_some());
    assert_eq!(s.lights.len(), 1);
    let l = &s.lights[0];
    assert_eq!(l.kind, LightKind::Directional);
    assert!(l.position.abs_diff_eq(Vec3::new(3.0, 6.0, 0.0), 1e-6));
    assert!(l.shadow.is_some());
    assert_eq!(s.draws.len(), 1);
    let d = &s.draws[0];
    assert_eq!(d.kind, DrawKind::Mesh);
    assert!(d.world.w_axis.truncate().abs_diff_eq(Vec3::new(1.0, 2.0, 0.0), 1e-6));
    let m = &d.materials[0];
    assert_eq!(m.kind, MaterialKind::Standard);
    assert!(m.transparent && !m.depth_write && (m.opacity - 0.5).abs() < 1e-6);
    assert!((m.roughness - 0.4).abs() < 1e-6);
}

#[test]
fn geometry_defs_and_refs() {
    let mut w = W(Vec::new());
    w.u(scene::MAGIC).u(scene::VERSION);
    w.u(4).f(f32::NAN).u(0).u(1).u(0).color(None).f(f32::NAN).f(f32::NAN).f(f32::NAN).u(0).f(f32::NAN).u(0).f(f32::NAN);
    w.u(2);
    // a mesh drawing def 7, and a hidden one drawing def 9 (still kept)
    w.u(5).u(16).u(7).u(1).material(0, [1.0; 4]).u(0);
    w.u(5).u(16).u(9).u(1).material(0, [1.0; 4]).u(32);
    // def 7 is new this frame: a sphere of radius 2
    w.u(1).u(7).u(1).f(2.0).u(0).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN).f(f32::NAN);
    let s = scene::decode(&w.0).expect("decodes");
    assert_eq!(s.draws.len(), 1);
    assert_eq!(s.draws[0].geometry, GeometryDesc::Ref(7));
    assert_eq!(s.geometry_refs, vec![7, 9]);
    assert_eq!(s.geometry_defs.len(), 1);
    assert!(matches!(s.geometry_defs[0], (7, GeometryDesc::Sphere { radius, .. }) if radius == 2.0));
}

#[test]
fn decodes_polygon_offset() {
    let mut w = W(Vec::new());
    w.u(scene::MAGIC).u(scene::VERSION);
    w.u(4).f(f32::NAN).u(0).u(1).u(0).color(None).f(f32::NAN).f(f32::NAN).f(f32::NAN).u(0).f(f32::NAN).u(0).f(f32::NAN);
    w.u(2);
    w.u(5).u(0).f(1.0).f(1.0).f(1.0).u(0).f(f32::NAN).f(f32::NAN).f(f32::NAN);
    w.u(1).material_with(0, [1.0; 4], 2048, [1.0, 2.0]).u(0);
    w.u(5).u(0).f(1.0).f(1.0).f(1.0).u(0).f(f32::NAN).f(f32::NAN).f(f32::NAN);
    w.u(1).material_with(0, [1.0; 4], 0, [1.0, 2.0]).u(0);
    w.u(0);
    let s = scene::decode(&w.0).expect("decodes");
    assert_eq!(s.draws[0].materials[0].polygon_offset, Some((1.0, 2.0)));
    assert_eq!(s.draws[1].materials[0].polygon_offset, None);
}

#[test]
fn rejects_other_stream_versions() {
    assert!(scene::decode(&[scene::MAGIC, scene::VERSION - 1]).is_err());
}

/// A plate 0.002 above a face, 21.5 units away, behind the derived near plane
/// (reach / 1000): standard Z cannot tell them apart; reversed Z can, by far
/// more steps with the infinite far plane used when `far` is derived.
#[test]
fn reversed_depth_separates_thin_gaps() {
    let (near, far, d) = (0.0215, 215.0, 21.5);
    let depth = |proj: Mat4, d: f32| {
        let c = proj * Vec4::new(0.0, 0.0, -d, 1.0);
        c.z / c.w
    };
    let steps = |p: Mat4| (depth(p, d).to_bits() as i64 - depth(p, d + 0.002).to_bits() as i64).abs();

    let reversed = renderer::perspective_reversed(0.6, 1.5, near, far);
    assert!((depth(reversed, near) - 1.0).abs() < 1e-5 && depth(reversed, far).abs() < 1e-6);
    assert!(steps(reversed) > 50, "reversed: {} steps", steps(reversed));
    let infinite = renderer::perspective_reversed(0.6, 1.5, near, f32::INFINITY);
    assert!((depth(infinite, near) - 1.0).abs() < 1e-5);
    assert!(steps(infinite) > 500, "infinite: {} steps", steps(infinite));
    let standard = Mat4::perspective_rh(0.6, 1.5, near, far);
    assert!(steps(standard) < 4, "standard: {} steps", steps(standard));

    let ortho = renderer::orthographic_reversed(-1.0, 1.0, -1.0, 1.0, near, far);
    assert!((depth(ortho, near) - 1.0).abs() < 1e-6 && depth(ortho, far).abs() < 1e-6);
}

#[test]
fn ported_generators_match_three_counts() {
    // CapsuleGeometry(0.5, 1, 8, 16): (2·8 + 1 + 1) rows of 17.
    let c = geometry::capsule(0.5, 1.0, 8.0, 16.0);
    assert_eq!((c.vertex_count(), c.element_count()), (18 * 17, 17 * 16 * 6));
    // Non-indexed polyhedra: faces · 4^detail triangles.
    assert_eq!(geometry::polyhedron(2, 1.0, 0.0).vertex_count(), 20 * 3);
    assert_eq!(geometry::polyhedron(0, 1.0, 1.0).vertex_count(), 4 * 4 * 3);
    assert_eq!(geometry::polyhedron(3, 1.0, 0.0).vertex_count(), 36 * 3);
    let ico = geometry::polyhedron(2, 2.0, 1.0);
    assert!(ico.positions.iter().all(|p| (glam::Vec3::from(*p).length() - 2.0).abs() < 1e-5));
    // LatheGeometry(3 points, 12): 13 columns of 3.
    let l = geometry::lathe(&[[0.5, 0.0], [1.0, 1.0], [0.5, 2.0]], 12.0, 0.0, std::f32::consts::TAU);
    assert_eq!((l.vertex_count(), l.element_count()), (39, 12 * 2 * 6));
    // TubeGeometry(curve, 64, r, 8): 65 rings of 9; the ring centres follow the curve.
    let t = geometry::tube(&[[0.0, 0.0, 0.0], [1.0, 1.0, 0.0], [2.0, 0.0, 0.0]], false, 64.0, 0.25, 8.0);
    assert_eq!((t.vertex_count(), t.element_count()), (65 * 9, 64 * 8 * 6));
    let ring0: glam::Vec3 = t.positions[..8].iter().map(|p| glam::Vec3::from(*p)).sum::<glam::Vec3>() / 8.0;
    assert!(ring0.length() < 1e-3);
    // EdgesGeometry(box): 12 edges; WireframeGeometry(box): 18 unique edges.
    let b = geometry::box_geometry(1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    assert_eq!(geometry::edges(&b, 1.0).vertex_count(), 24);
    assert_eq!(geometry::wireframe(&b).vertex_count(), 36);
}

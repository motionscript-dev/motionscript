//! CPU geometry: three.js r185's primitive generators, ported vertex for
//! vertex (same order, same UVs, same index winding and material groups), so
//! a `Geo.box` here tessellates exactly like a `BoxGeometry` there. Buffer
//! geometry (and what the encoder evaluates into it: rounded boxes,
//! parametric surfaces) comes in as arrays.

use glam::{DVec3, Vec3};
use std::collections::{HashMap, HashSet};
use std::f32::consts::PI;

/// A draw range of an indexed geometry bound to one entry of a material
/// array (three's `geometry.groups`).
#[derive(Clone, Copy, Debug)]
pub struct Group {
    pub start: u32,
    pub count: u32,
    pub material: u32,
}

#[derive(Clone, Debug, Default)]
pub struct MeshData {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    /// Per-vertex colour, uploaded as given (three reads it as linear).
    pub colors: Option<Vec<[f32; 3]>>,
    pub indices: Option<Vec<u32>>,
    pub groups: Vec<Group>,
}

impl MeshData {
    fn push(&mut self, p: [f32; 3], n: [f32; 3], uv: [f32; 2]) {
        self.positions.push(p);
        self.normals.push(n);
        self.uvs.push(uv);
    }

    fn idx(&mut self) -> &mut Vec<u32> {
        self.indices.get_or_insert_with(Vec::new)
    }

    pub fn vertex_count(&self) -> u32 {
        self.positions.len() as u32
    }

    pub fn element_count(&self) -> u32 {
        self.indices.as_ref().map(|i| i.len() as u32).unwrap_or(self.vertex_count())
    }

    /// Axis-aligned bounds of the positions (three's `computeBoundingBox`).
    pub fn bounds(&self) -> Option<(Vec3, Vec3)> {
        let mut it = self.positions.iter();
        let first = Vec3::from(*it.next()?);
        let (mut lo, mut hi) = (first, first);
        for p in it {
            let v = Vec3::from(*p);
            lo = lo.min(v);
            hi = hi.max(v);
        }
        Some((lo, hi))
    }

    /// three's `computeBoundingSphere`: the box centre, and the farthest
    /// vertex from it.
    pub fn bounding_sphere(&self) -> (Vec3, f32) {
        let Some((lo, hi)) = self.bounds() else { return (Vec3::ZERO, 0.0) };
        let c = (lo + hi) * 0.5;
        let r2 = self.positions.iter().map(|p| Vec3::from(*p).distance_squared(c)).fold(0.0f32, f32::max);
        (c, r2.sqrt())
    }

    /// three's `computeVertexNormals`: area-weighted face normals summed per
    /// vertex (indexed), or flat per triangle (non-indexed).
    pub fn compute_normals(&mut self) {
        let n = self.positions.len();
        let mut acc = vec![Vec3::ZERO; n];
        let p = |i: usize| Vec3::from(self.positions[i]);
        match &self.indices {
            Some(ix) => {
                for t in ix.chunks_exact(3) {
                    let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
                    if a >= n || b >= n || c >= n {
                        continue;
                    }
                    let f = (p(c) - p(b)).cross(p(a) - p(b));
                    acc[a] += f;
                    acc[b] += f;
                    acc[c] += f;
                }
            }
            None => {
                for t in 0..n / 3 {
                    let (a, b, c) = (t * 3, t * 3 + 1, t * 3 + 2);
                    let f = (p(c) - p(b)).cross(p(a) - p(b));
                    acc[a] = f;
                    acc[b] = f;
                    acc[c] = f;
                }
            }
        }
        self.normals = acc.into_iter().map(|v| v.normalize_or_zero().to_array()).collect();
    }

    /// Edge list of the triangles, the index three builds for `wireframe`.
    pub fn wireframe_indices(&self) -> Vec<u32> {
        let tri: Vec<u32> = match &self.indices {
            Some(ix) => ix.clone(),
            None => (0..self.vertex_count()).collect(),
        };
        let mut out = Vec::with_capacity(tri.len() * 2);
        for t in tri.chunks_exact(3) {
            out.extend_from_slice(&[t[0], t[1], t[1], t[2], t[2], t[0]]);
        }
        out
    }
}

/// How `segments` was stated: unset, one number for every axis, or a tuple
/// (NaN past its length).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segments {
    Unset,
    Scalar(f32),
    Tuple([f32; 3]),
}

impl Segments {
    /// core's `segmentsOf`: each entry floored and at least 1.
    pub fn of(self, defaults: &[f32]) -> Vec<f32> {
        defaults
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let v = match self {
                    Segments::Unset => *d,
                    Segments::Scalar(v) => v,
                    Segments::Tuple(t) => t.get(i).copied().filter(|v| !v.is_nan()).unwrap_or(*d),
                };
                v.floor().max(1.0)
            })
            .collect()
    }
}

pub fn box_geometry(width: f32, height: f32, depth: f32, gx: f32, gy: f32, gz: f32) -> MeshData {
    let mut m = MeshData::default();
    let (gx, gy, gz) = (gx.floor(), gy.floor(), gz.floor());
    // (u, v, w) axes, udir, vdir, width, height, depth, gridX, gridY, material
    build_plane(&mut m, [2, 1, 0], -1.0, -1.0, depth, height, width, gz, gy, 0);
    build_plane(&mut m, [2, 1, 0], 1.0, -1.0, depth, height, -width, gz, gy, 1);
    build_plane(&mut m, [0, 2, 1], 1.0, 1.0, width, depth, height, gx, gz, 2);
    build_plane(&mut m, [0, 2, 1], 1.0, -1.0, width, depth, -height, gx, gz, 3);
    build_plane(&mut m, [0, 1, 2], 1.0, -1.0, width, height, depth, gx, gy, 4);
    build_plane(&mut m, [0, 1, 2], -1.0, -1.0, width, height, -depth, gx, gy, 5);
    m
}

#[allow(clippy::too_many_arguments)]
fn build_plane(
    m: &mut MeshData,
    axes: [usize; 3],
    udir: f32,
    vdir: f32,
    width: f32,
    height: f32,
    depth: f32,
    grid_x: f32,
    grid_y: f32,
    material: u32,
) {
    let [u, v, w] = axes;
    let (seg_w, seg_h) = (width / grid_x, height / grid_y);
    let (wh, hh, dh) = (width / 2.0, height / 2.0, depth / 2.0);
    let (gx, gy) = (grid_x as u32, grid_y as u32);
    let (gx1, gy1) = (gx + 1, gy + 1);
    let base = m.vertex_count();
    let group_start = m.idx().len() as u32;
    for iy in 0..gy1 {
        let y = iy as f32 * seg_h - hh;
        for ix in 0..gx1 {
            let x = ix as f32 * seg_w - wh;
            let mut p = [0.0f32; 3];
            p[u] = x * udir;
            p[v] = y * vdir;
            p[w] = dh;
            let mut n = [0.0f32; 3];
            n[w] = if depth > 0.0 { 1.0 } else { -1.0 };
            m.push(p, n, [ix as f32 / grid_x, 1.0 - iy as f32 / grid_y]);
        }
    }
    let ix = m.idx();
    for iy in 0..gy {
        for x in 0..gx {
            let a = base + x + gx1 * iy;
            let b = base + x + gx1 * (iy + 1);
            let c = base + (x + 1) + gx1 * (iy + 1);
            let d = base + (x + 1) + gx1 * iy;
            ix.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    let count = m.idx().len() as u32 - group_start;
    m.groups.push(Group { start: group_start, count, material });
}

#[allow(clippy::too_many_arguments)]
pub fn sphere(radius: f32, ws: f32, hs: f32, phi_start: f32, phi_len: f32, theta_start: f32, theta_len: f32) -> MeshData {
    let ws = ws.floor().max(3.0) as u32;
    let hs = hs.floor().max(2.0) as u32;
    let theta_end = (theta_start + theta_len).min(PI);
    let mut m = MeshData::default();
    let mut grid: Vec<Vec<u32>> = Vec::new();
    let mut index = 0u32;
    for iy in 0..=hs {
        let v = iy as f32 / hs as f32;
        let mut u_off = 0.0;
        if iy == 0 && theta_start == 0.0 {
            u_off = 0.5 / ws as f32;
        } else if iy == hs && theta_end == PI {
            u_off = -0.5 / ws as f32;
        }
        let mut row = Vec::new();
        for ix in 0..=ws {
            let u = ix as f32 / ws as f32;
            let p = [
                -radius * (phi_start + u * phi_len).cos() * (theta_start + v * theta_len).sin(),
                radius * (theta_start + v * theta_len).cos(),
                radius * (phi_start + u * phi_len).sin() * (theta_start + v * theta_len).sin(),
            ];
            let n = Vec3::from(p).normalize_or_zero().to_array();
            m.push(p, n, [u + u_off, 1.0 - v]);
            row.push(index);
            index += 1;
        }
        grid.push(row);
    }
    let ix = m.idx();
    for iy in 0..hs as usize {
        for x in 0..ws as usize {
            let a = grid[iy][x + 1];
            let b = grid[iy][x];
            let c = grid[iy + 1][x];
            let d = grid[iy + 1][x + 1];
            if iy != 0 || theta_start > 0.0 {
                ix.extend_from_slice(&[a, b, d]);
            }
            if iy != hs as usize - 1 || theta_end < PI {
                ix.extend_from_slice(&[b, c, d]);
            }
        }
    }
    m
}

pub fn plane(width: f32, height: f32, ws: f32, hs: f32) -> MeshData {
    let (gx, gy) = (ws.floor() as u32, hs.floor() as u32);
    let (gx1, gy1) = (gx + 1, gy + 1);
    let (seg_w, seg_h) = (width / gx as f32, height / gy as f32);
    let mut m = MeshData::default();
    for iy in 0..gy1 {
        let y = iy as f32 * seg_h - height / 2.0;
        for x in 0..gx1 {
            let xx = x as f32 * seg_w - width / 2.0;
            m.push([xx, -y, 0.0], [0.0, 0.0, 1.0], [x as f32 / gx as f32, 1.0 - iy as f32 / gy as f32]);
        }
    }
    let ix = m.idx();
    for iy in 0..gy {
        for x in 0..gx {
            let a = x + gx1 * iy;
            let b = x + gx1 * (iy + 1);
            let c = (x + 1) + gx1 * (iy + 1);
            let d = (x + 1) + gx1 * iy;
            ix.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    m
}

#[allow(clippy::too_many_arguments)]
pub fn cylinder(
    r_top: f32,
    r_bottom: f32,
    height: f32,
    radial: f32,
    height_segs: f32,
    open_ended: bool,
    theta_start: f32,
    theta_len: f32,
) -> MeshData {
    let radial = radial.floor() as u32;
    let hseg = height_segs.floor() as u32;
    let half = height / 2.0;
    let mut m = MeshData::default();
    let mut index = 0u32;
    let mut group_start = 0u32;

    // torso
    let slope = (r_bottom - r_top) / height;
    let mut rows: Vec<Vec<u32>> = Vec::new();
    for y in 0..=hseg {
        let v = y as f32 / hseg as f32;
        let radius = v * (r_bottom - r_top) + r_top;
        let mut row = Vec::new();
        for x in 0..=radial {
            let u = x as f32 / radial as f32;
            let theta = u * theta_len + theta_start;
            let (s, c) = theta.sin_cos();
            let n = Vec3::new(s, slope, c).normalize_or_zero().to_array();
            m.push([radius * s, -v * height + half, radius * c], n, [u, 1.0 - v]);
            row.push(index);
            index += 1;
        }
        rows.push(row);
    }
    let mut count = 0;
    for x in 0..radial as usize {
        for y in 0..hseg as usize {
            let a = rows[y][x];
            let b = rows[y + 1][x];
            let c = rows[y + 1][x + 1];
            let d = rows[y][x + 1];
            if r_top > 0.0 || y != 0 {
                m.idx().extend_from_slice(&[a, b, d]);
                count += 3;
            }
            if r_bottom > 0.0 || y != hseg as usize - 1 {
                m.idx().extend_from_slice(&[b, c, d]);
                count += 3;
            }
        }
    }
    m.groups.push(Group { start: group_start, count, material: 0 });
    group_start += count;

    let cap = |m: &mut MeshData, top: bool, index: &mut u32, group_start: &mut u32| {
        let center_start = *index;
        let radius = if top { r_top } else { r_bottom };
        let sign = if top { 1.0 } else { -1.0 };
        for _ in 1..=radial {
            m.push([0.0, half * sign, 0.0], [0.0, sign, 0.0], [0.5, 0.5]);
            *index += 1;
        }
        let center_end = *index;
        for x in 0..=radial {
            let u = x as f32 / radial as f32;
            let theta = u * theta_len + theta_start;
            let (s, c) = theta.sin_cos();
            m.push([radius * s, half * sign, radius * c], [0.0, sign, 0.0], [c * 0.5 + 0.5, s * 0.5 * sign + 0.5]);
            *index += 1;
        }
        let mut count = 0;
        for x in 0..radial {
            let c = center_start + x;
            let i = center_end + x;
            if top {
                m.idx().extend_from_slice(&[i, i + 1, c]);
            } else {
                m.idx().extend_from_slice(&[i + 1, i, c]);
            }
            count += 3;
        }
        m.groups.push(Group { start: *group_start, count, material: if top { 1 } else { 2 } });
        *group_start += count;
    };
    if !open_ended {
        if r_top > 0.0 {
            cap(&mut m, true, &mut index, &mut group_start);
        }
        if r_bottom > 0.0 {
            cap(&mut m, false, &mut index, &mut group_start);
        }
    }
    m
}

#[allow(clippy::too_many_arguments)]
pub fn torus(radius: f32, tube: f32, radial: f32, tubular: f32, arc: f32, theta_start: f32, theta_len: f32) -> MeshData {
    let (rs, ts) = (radial.floor() as u32, tubular.floor() as u32);
    let mut m = MeshData::default();
    for j in 0..=rs {
        let v = theta_start + (j as f32 / rs as f32) * theta_len;
        for i in 0..=ts {
            let u = i as f32 / ts as f32 * arc;
            let p = Vec3::new((radius + tube * v.cos()) * u.cos(), (radius + tube * v.cos()) * u.sin(), tube * v.sin());
            let center = Vec3::new(radius * u.cos(), radius * u.sin(), 0.0);
            m.push(p.to_array(), (p - center).normalize_or_zero().to_array(), [i as f32 / ts as f32, j as f32 / rs as f32]);
        }
    }
    let ix = m.idx();
    for j in 1..=rs {
        for i in 1..=ts {
            let a = (ts + 1) * j + i - 1;
            let b = (ts + 1) * (j - 1) + i - 1;
            let c = (ts + 1) * (j - 1) + i;
            let d = (ts + 1) * j + i;
            ix.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    m
}

pub fn torus_knot(radius: f32, tube: f32, tubular: f32, radial: f32, p: f32, q: f32) -> MeshData {
    let (ts, rs) = (tubular.floor() as u32, radial.floor() as u32);
    let curve = |u: f32| {
        let (su, cu) = u.sin_cos();
        let qu = q / p * u;
        let cs = qu.cos();
        Vec3::new(radius * (2.0 + cs) * 0.5 * cu, radius * (2.0 + cs) * su * 0.5, radius * qu.sin() * 0.5)
    };
    let mut m = MeshData::default();
    for i in 0..=ts {
        let u = i as f32 / ts as f32 * p * PI * 2.0;
        let p1 = curve(u);
        let p2 = curve(u + 0.01);
        let t = p2 - p1;
        let n0 = p2 + p1;
        let b = t.cross(n0);
        let n = b.cross(t).normalize_or_zero();
        let b = b.normalize_or_zero();
        for j in 0..=rs {
            let v = j as f32 / rs as f32 * PI * 2.0;
            let (cx, cy) = (-tube * v.cos(), tube * v.sin());
            let vert = p1 + n * cx + b * cy;
            m.push(vert.to_array(), (vert - p1).normalize_or_zero().to_array(), [i as f32 / ts as f32, j as f32 / rs as f32]);
        }
    }
    let ix = m.idx();
    for j in 1..=ts {
        for i in 1..=rs {
            let a = (rs + 1) * (j - 1) + (i - 1);
            let b = (rs + 1) * j + (i - 1);
            let c = (rs + 1) * j + i;
            let d = (rs + 1) * (j - 1) + i;
            ix.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    m
}

pub fn circle(radius: f32, segments: f32, theta_start: f32, theta_len: f32) -> MeshData {
    let segs = segments.max(3.0);
    let n = segs.floor() as u32;
    let mut m = MeshData::default();
    m.push([0.0; 3], [0.0, 0.0, 1.0], [0.5, 0.5]);
    for s in 0..=n {
        let a = theta_start + s as f32 / segs * theta_len;
        let (x, y) = (radius * a.cos(), radius * a.sin());
        m.push([x, y, 0.0], [0.0, 0.0, 1.0], [(x / radius + 1.0) / 2.0, (y / radius + 1.0) / 2.0]);
    }
    let ix = m.idx();
    for i in 1..=n {
        ix.extend_from_slice(&[i, i + 1, 0]);
    }
    m
}

pub fn ring(inner: f32, outer: f32, theta_segs: f32, phi_segs: f32, theta_start: f32, theta_len: f32) -> MeshData {
    let ts = theta_segs.max(3.0).floor() as u32;
    let ps = phi_segs.max(1.0).floor() as u32;
    let mut m = MeshData::default();
    let mut radius = inner;
    let step = (outer - inner) / ps as f32;
    for _ in 0..=ps {
        for i in 0..=ts {
            let a = theta_start + i as f32 / ts as f32 * theta_len;
            let (x, y) = (radius * a.cos(), radius * a.sin());
            m.push([x, y, 0.0], [0.0, 0.0, 1.0], [(x / outer + 1.0) / 2.0, (y / outer + 1.0) / 2.0]);
        }
        radius += step;
    }
    let ix = m.idx();
    for j in 0..ps {
        let level = j * (ts + 1);
        for i in 0..ts {
            let s = i + level;
            let (a, b, c, d) = (s, s + ts + 1, s + ts + 2, s + 1);
            ix.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    m
}

// ─── Capsule, polyhedra, lathe, tube (three computes these in f64) ─────────

fn f32x3(v: DVec3) -> [f32; 3] {
    [v.x as f32, v.y as f32, v.z as f32]
}

/// `CapsuleGeometry(radius, height, capSegments, radialSegments, heightSegments = 1)`.
pub fn capsule(radius: f32, height: f32, cap_segments: f32, radial_segments: f32) -> MeshData {
    let radius = radius as f64;
    let height = (height as f64).max(0.0);
    let cap = (cap_segments.floor() as u32).max(1);
    let radial = (radial_segments.floor() as u32).max(3);
    let hseg = 1u32;
    let half = height / 2.0;
    let cap_arc = std::f64::consts::FRAC_PI_2 * radius;
    let total = 2.0 * cap_arc + height;
    let rows = cap * 2 + hseg;
    let per_row = radial + 1;
    let mut m = MeshData::default();
    for iy in 0..=rows {
        let (y, r, ny, arc);
        if iy <= cap {
            let s = iy as f64 / cap as f64;
            let a = s * std::f64::consts::PI / 2.0;
            y = -half - radius * a.cos();
            r = radius * a.sin();
            ny = -radius * a.cos();
            arc = s * cap_arc;
        } else if iy <= cap + hseg {
            let s = (iy - cap) as f64 / hseg as f64;
            y = -half + s * height;
            r = radius;
            ny = 0.0;
            arc = cap_arc + s * height;
        } else {
            let s = (iy - cap - hseg) as f64 / cap as f64;
            let a = s * std::f64::consts::PI / 2.0;
            y = half + radius * a.sin();
            r = radius * a.cos();
            ny = radius * a.sin();
            arc = cap_arc + height + s * cap_arc;
        }
        let v = (arc / total).clamp(0.0, 1.0);
        let u_off = if iy == 0 {
            0.5 / radial as f64
        } else if iy == rows {
            -0.5 / radial as f64
        } else {
            0.0
        };
        for ix in 0..=radial {
            let u = ix as f64 / radial as f64;
            let (s, c) = (u * std::f64::consts::TAU).sin_cos();
            let p = DVec3::new(-r * c, y, r * s);
            let n = DVec3::new(-r * c, ny, r * s).normalize_or_zero();
            m.push(f32x3(p), f32x3(n), [(u + u_off) as f32, v as f32]);
        }
        if iy > 0 {
            let prev = (iy - 1) * per_row;
            let ix = m.idx();
            for x in 0..radial {
                let (i1, i2, i3, i4) = (prev + x, prev + x + 1, iy * per_row + x, iy * per_row + x + 1);
                ix.extend_from_slice(&[i1, i2, i3, i2, i4, i3]);
            }
        }
    }
    m
}

/// The four named solids (`TetrahedronGeometry` … `DodecahedronGeometry`):
/// 0 tetrahedron, 1 octahedron, 2 icosahedron (also the default), 3 dodecahedron.
pub fn polyhedron(shape: u32, radius: f32, detail: f32) -> MeshData {
    let t = (1.0 + 5f64.sqrt()) / 2.0;
    let r = 1.0 / t;
    let (verts, idx): (Vec<f64>, Vec<u32>) = match shape {
        0 => (vec![1., 1., 1., -1., -1., 1., -1., 1., -1., 1., -1., -1.], vec![2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1]),
        1 => (
            vec![1., 0., 0., -1., 0., 0., 0., 1., 0., 0., -1., 0., 0., 0., 1., 0., 0., -1.],
            vec![0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2],
        ),
        3 => (
            vec![
                -1., -1., -1., -1., -1., 1., -1., 1., -1., -1., 1., 1., 1., -1., -1., 1., -1., 1., 1., 1., -1., 1., 1., 1.,
                0., -r, -t, 0., -r, t, 0., r, -t, 0., r, t, -r, -t, 0., -r, t, 0., r, -t, 0., r, t, 0., -t, 0., -r, t, 0.,
                -r, -t, 0., r, t, 0., r,
            ],
            vec![
                3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15, 17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8,
                16, 2, 8, 2, 10, 0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15, 2, 16, 18, 2, 18, 3, 2, 3,
                13, 18, 1, 9, 18, 9, 11, 18, 11, 3, 4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7, 19, 5,
                14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
            ],
        ),
        _ => (
            vec![-1., t, 0., 1., t, 0., -1., -t, 0., 1., -t, 0., 0., -1., t, 0., 1., t, 0., -1., -t, 0., 1., -t, t, 0., -1., t, 0., 1., -t, 0., -1., -t, 0., 1.],
            vec![
                0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3,
                4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
            ],
        ),
    };
    let detail = detail.max(0.0).floor() as usize;
    let vert = |i: u32| DVec3::new(verts[i as usize * 3], verts[i as usize * 3 + 1], verts[i as usize * 3 + 2]);
    let mut buf: Vec<DVec3> = Vec::new();
    for f in idx.chunks_exact(3) {
        let (a, b, c) = (vert(f[0]), vert(f[1]), vert(f[2]));
        let cols = detail + 1;
        let mut v: Vec<Vec<DVec3>> = Vec::with_capacity(cols + 1);
        for i in 0..=cols {
            let aj = a.lerp(c, i as f64 / cols as f64);
            let bj = b.lerp(c, i as f64 / cols as f64);
            let rows = cols - i;
            v.push((0..=rows).map(|j| if j == 0 && i == cols { aj } else { aj.lerp(bj, j as f64 / rows as f64) }).collect());
        }
        for i in 0..cols {
            for j in 0..2 * (cols - i) - 1 {
                let k = j / 2;
                if j % 2 == 0 {
                    buf.extend_from_slice(&[v[i][k + 1], v[i + 1][k], v[i][k]]);
                } else {
                    buf.extend_from_slice(&[v[i][k + 1], v[i + 1][k + 1], v[i + 1][k]]);
                }
            }
        }
    }
    for p in buf.iter_mut() {
        *p = p.normalize_or_zero() * radius as f64;
    }
    let azimuth = |v: DVec3| v.z.atan2(-v.x);
    let inclination = |v: DVec3| (-v.y).atan2((v.x * v.x + v.z * v.z).sqrt());
    let mut uv: Vec<[f64; 2]> = buf
        .iter()
        .map(|v| [azimuth(*v) / 2.0 / std::f64::consts::PI + 0.5, 1.0 - (inclination(*v) / std::f64::consts::PI + 0.5)])
        .collect();
    // correctUVs, then correctSeam.
    for t in 0..buf.len() / 3 {
        let (a, b, c) = (buf[t * 3], buf[t * 3 + 1], buf[t * 3 + 2]);
        let azi = azimuth((a + b + c) / 3.0);
        for (k, p) in [a, b, c].iter().enumerate() {
            let u = &mut uv[t * 3 + k];
            if azi < 0.0 && u[0] == 1.0 {
                u[0] -= 1.0;
            }
            if p.x == 0.0 && p.z == 0.0 {
                u[0] = azi / 2.0 / std::f64::consts::PI + 0.5;
            }
        }
    }
    for t in uv.chunks_exact_mut(3) {
        let xs = [t[0][0], t[1][0], t[2][0]];
        let max = xs.iter().copied().fold(f64::MIN, f64::max);
        let min = xs.iter().copied().fold(f64::MAX, f64::min);
        if max > 0.9 && min < 0.1 {
            for u in t.iter_mut() {
                if u[0] < 0.2 {
                    u[0] += 1.0;
                }
            }
        }
    }
    let mut m = MeshData::default();
    for (p, u) in buf.iter().zip(&uv) {
        m.push(f32x3(*p), f32x3(p.normalize_or_zero()), [u[0] as f32, u[1] as f32]);
    }
    if detail == 0 {
        // Flat normals (computeVertexNormals on the non-indexed solid).
        m.compute_normals();
    }
    m
}

/// `LatheGeometry(points, segments, phiStart, phiLength)`; `points` are the
/// profile's (x, y).
pub fn lathe(points: &[[f32; 2]], segments: f32, phi_start: f32, phi_len: f32) -> MeshData {
    let mut m = MeshData::default();
    if points.len() < 2 {
        return m;
    }
    let pts: Vec<(f64, f64)> = points.iter().map(|p| (p[0] as f64, p[1] as f64)).collect();
    let segs = (segments.floor() as u32).max(1);
    let phi_len = (phi_len as f64).clamp(0.0, std::f64::consts::TAU);
    let n = pts.len();
    let mut init = Vec::with_capacity(n);
    let mut prev = DVec3::ZERO;
    for j in 0..n {
        if j == n - 1 {
            // The last vertex takes the last segment's normal unnormalized, as three does.
            init.push(prev);
            continue;
        }
        let (dx, dy) = (pts[j + 1].0 - pts[j].0, pts[j + 1].1 - pts[j].1);
        let cur = DVec3::new(dy, -dx, 0.0);
        if j == 0 {
            prev = cur;
            init.push(cur.normalize_or_zero());
        } else {
            init.push((cur + prev).normalize_or_zero());
            prev = cur;
        }
    }
    for i in 0..=segs {
        let phi = phi_start as f64 + i as f64 / segs as f64 * phi_len;
        let (s, c) = phi.sin_cos();
        for (j, p) in pts.iter().enumerate() {
            let nv = init[j];
            m.push(
                [(p.0 * s) as f32, p.1 as f32, (p.0 * c) as f32],
                [(nv.x * s) as f32, nv.y as f32, (nv.x * c) as f32],
                [i as f32 / segs as f32, j as f32 / (n - 1) as f32],
            );
        }
    }
    let ix = m.idx();
    let n = n as u32;
    for i in 0..segs {
        for j in 0..n - 1 {
            let base = j + i * n;
            let (a, b, c, d) = (base, base + n, base + n + 1, base + 1);
            ix.extend_from_slice(&[a, b, d, c, d, b]);
        }
    }
    m
}

/// three's `CatmullRomCurve3` (centripetal) with `Curve`'s arc-length
/// parametrization (200 divisions) and finite-difference tangents.
struct CatmullRom {
    points: Vec<DVec3>,
    closed: bool,
    lengths: Vec<f64>,
}

impl CatmullRom {
    fn new(points: Vec<DVec3>, closed: bool) -> CatmullRom {
        let mut c = CatmullRom { points, closed, lengths: Vec::new() };
        let mut last = c.point(0.0);
        let mut sum = 0.0;
        c.lengths.push(0.0);
        for p in 1..=200 {
            let cur = c.point(p as f64 / 200.0);
            sum += cur.distance(last);
            c.lengths.push(sum);
            last = cur;
        }
        c
    }

    fn point(&self, t: f64) -> DVec3 {
        let pts = &self.points;
        let l = pts.len();
        let p = (l - if self.closed { 0 } else { 1 }) as f64 * t;
        let mut ip = p.floor() as i64;
        let mut w = p - ip as f64;
        if self.closed {
            ip += if ip > 0 { 0 } else { ((ip.unsigned_abs() as usize / l) as i64 + 1) * l as i64 };
        } else if w == 0.0 && ip == l as i64 - 1 {
            ip = l as i64 - 2;
            w = 1.0;
        }
        let at = |i: i64| pts[(i.rem_euclid(l as i64)) as usize];
        let p0 = if self.closed || ip > 0 { at(ip - 1) } else { pts[0] - pts[1] + pts[0] };
        let p1 = at(ip);
        let p2 = at(ip + 1);
        let p3 = if self.closed || ip + 2 < l as i64 { at(ip + 2) } else { pts[l - 1] - pts[l - 2] + pts[l - 1] };
        let mut dt0 = p0.distance_squared(p1).powf(0.25);
        let mut dt1 = p1.distance_squared(p2).powf(0.25);
        let mut dt2 = p2.distance_squared(p3).powf(0.25);
        if dt1 < 1e-4 {
            dt1 = 1.0;
        }
        if dt0 < 1e-4 {
            dt0 = dt1;
        }
        if dt2 < 1e-4 {
            dt2 = dt1;
        }
        let comp = |x0: f64, x1: f64, x2: f64, x3: f64| {
            let t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1;
            let t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1;
            let (c0, c1, c2, c3) = (x1, t1, -3.0 * x1 + 3.0 * x2 - 2.0 * t1 - t2, 2.0 * x1 - 2.0 * x2 + t1 + t2);
            c0 + c1 * w + c2 * w * w + c3 * w * w * w
        };
        DVec3::new(comp(p0.x, p1.x, p2.x, p3.x), comp(p0.y, p1.y, p2.y, p3.y), comp(p0.z, p1.z, p2.z, p3.z))
    }

    fn u_to_t(&self, u: f64) -> f64 {
        let a = &self.lengths;
        let il = a.len();
        let target = u * a[il - 1];
        let (mut low, mut high) = (0i64, il as i64 - 1);
        while low <= high {
            let i = low + (high - low) / 2;
            let cmp = a[i as usize] - target;
            if cmp < 0.0 {
                low = i + 1;
            } else if cmp > 0.0 {
                high = i - 1;
            } else {
                high = i;
                break;
            }
        }
        let i = high.max(0) as usize;
        if a[i] == target {
            return i as f64 / (il - 1) as f64;
        }
        let (before, after) = (a[i], a[(i + 1).min(il - 1)]);
        (i as f64 + (target - before) / (after - before)) / (il - 1) as f64
    }

    fn tangent_at(&self, u: f64) -> DVec3 {
        let t = self.u_to_t(u);
        let (t1, t2) = ((t - 0.0001).max(0.0), (t + 0.0001).min(1.0));
        (self.point(t2) - self.point(t1)).normalize_or_zero()
    }
}

/// three's `Matrix4.makeRotationAxis` applied to `v`.
fn rotate_axis(v: DVec3, axis: DVec3, angle: f64) -> DVec3 {
    let (s, c) = angle.sin_cos();
    let t = 1.0 - c;
    let (x, y, z) = (axis.x, axis.y, axis.z);
    let (tx, ty) = (t * x, t * y);
    DVec3::new(
        (tx * x + c) * v.x + (tx * y - s * z) * v.y + (tx * z + s * y) * v.z,
        (tx * y + s * z) * v.x + (ty * y + c) * v.y + (ty * z - s * x) * v.z,
        (tx * z - s * y) * v.x + (ty * z + s * x) * v.y + (t * z * z + c) * v.z,
    )
}

/// `TubeGeometry(new CatmullRomCurve3(points, closed), tubular, radius, radial, closed)`.
pub fn tube(points: &[[f32; 3]], closed: bool, tubular: f32, radius: f32, radial: f32) -> MeshData {
    let mut m = MeshData::default();
    if points.len() < 2 {
        return m;
    }
    let curve = CatmullRom::new(points.iter().map(|p| DVec3::new(p[0] as f64, p[1] as f64, p[2] as f64)).collect(), closed);
    let segs = (tubular.floor() as usize).max(1);
    let radial = (radial.floor() as u32).max(1);
    let radius = radius as f64;
    // computeFrenetFrames
    let tangents: Vec<DVec3> = (0..=segs).map(|i| curve.tangent_at(i as f64 / segs as f64)).collect();
    let t0 = tangents[0];
    let mut min = f64::MAX;
    let mut normal = DVec3::ZERO;
    if t0.x.abs() <= min {
        min = t0.x.abs();
        normal = DVec3::X;
    }
    if t0.y.abs() <= min {
        min = t0.y.abs();
        normal = DVec3::Y;
    }
    if t0.z.abs() <= min {
        normal = DVec3::Z;
    }
    let vec = t0.cross(normal).normalize_or_zero();
    let mut normals = vec![t0.cross(vec)];
    let mut binormals = vec![t0.cross(normals[0])];
    for i in 1..=segs {
        let mut n = normals[i - 1];
        let v = tangents[i - 1].cross(tangents[i]);
        if v.length() > f64::EPSILON {
            let v = v.normalize();
            let theta = tangents[i - 1].dot(tangents[i]).clamp(-1.0, 1.0).acos();
            n = rotate_axis(n, v, theta);
        }
        binormals.push(tangents[i].cross(n));
        normals.push(n);
    }
    if closed {
        let mut theta = normals[0].dot(normals[segs]).clamp(-1.0, 1.0).acos() / segs as f64;
        if t0.dot(normals[0].cross(normals[segs])) > 0.0 {
            theta = -theta;
        }
        for i in 1..=segs {
            normals[i] = rotate_axis(normals[i], tangents[i], theta * i as f64);
            binormals[i] = tangents[i].cross(normals[i]);
        }
    }
    let segment = |m: &mut MeshData, i: usize| {
        let p = curve.point(curve.u_to_t(i as f64 / segs as f64));
        let (n, b) = (normals[i], binormals[i]);
        for j in 0..=radial {
            let v = j as f64 / radial as f64 * std::f64::consts::TAU;
            let (s, c) = (v.sin(), -v.cos());
            let nn = (n * c + b * s).normalize_or_zero();
            m.positions.push(f32x3(p + nn * radius));
            m.normals.push(f32x3(nn));
        }
    };
    for i in 0..segs {
        segment(&mut m, i);
    }
    segment(&mut m, if closed { 0 } else { segs });
    for i in 0..=segs {
        for j in 0..=radial {
            m.uvs.push([i as f32 / segs as f32, j as f32 / radial as f32]);
        }
    }
    let ix = m.idx();
    let (segs, r1) = (segs as u32, radial + 1);
    for j in 1..=segs {
        for i in 1..=radial {
            let a = r1 * (j - 1) + (i - 1);
            let b = r1 * j + (i - 1);
            let c = r1 * j + i;
            let d = r1 * (j - 1) + i;
            ix.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    m
}

// ─── Derived line geometry ──────────────────────────────────────────────────

fn line_positions(points: Vec<[f32; 3]>) -> MeshData {
    let n = points.len();
    MeshData { positions: points, normals: vec![[0.0; 3]; n], uvs: vec![[0.0; 2]; n], ..Default::default() }
}

/// `EdgesGeometry(source, thresholdAngle)`: edges between faces whose normals
/// differ by more than the angle (degrees), plus unshared edges, as segment pairs.
pub fn edges(src: &MeshData, threshold_deg: f32) -> MeshData {
    let precision = 1e4f64;
    let threshold_dot = (threshold_deg as f64).to_radians().cos();
    let tri: Vec<u32> = src.indices.clone().unwrap_or_else(|| (0..src.vertex_count()).collect());
    let pos = |i: u32| {
        let p = src.positions[i as usize];
        DVec3::new(p[0] as f64, p[1] as f64, p[2] as f64)
    };
    let round = |v: f64| (v * precision + 0.5).floor() as i64;
    let hash = |v: DVec3| (round(v.x), round(v.y), round(v.z));
    type H = (i64, i64, i64);
    struct Edge {
        i0: u32,
        i1: u32,
        normal: DVec3,
        live: bool,
    }
    let mut keys: HashMap<(H, H), usize> = HashMap::new();
    let mut data: Vec<Edge> = Vec::new();
    let mut out: Vec<[f32; 3]> = Vec::new();
    for t in tri.chunks_exact(3) {
        let v = [pos(t[0]), pos(t[1]), pos(t[2])];
        let normal = (v[2] - v[1]).cross(v[0] - v[1]);
        let normal = if normal.length_squared() > 0.0 { normal.normalize() } else { DVec3::ZERO };
        let h = [hash(v[0]), hash(v[1]), hash(v[2])];
        if h[0] == h[1] || h[1] == h[2] || h[2] == h[0] {
            continue;
        }
        for j in 0..3 {
            let k = (j + 1) % 3;
            let reverse = (h[k], h[j]);
            if let Some(&e) = keys.get(&reverse)
                && data[e].live
            {
                if normal.dot(data[e].normal) <= threshold_dot {
                    out.push(f32x3(v[j]));
                    out.push(f32x3(v[k]));
                }
                data[e].live = false;
            } else if !keys.contains_key(&(h[j], h[k])) {
                keys.insert((h[j], h[k]), data.len());
                data.push(Edge { i0: t[j], i1: t[k], normal, live: true });
            }
        }
    }
    for e in data.iter().filter(|e| e.live) {
        out.push(src.positions[e.i0 as usize]);
        out.push(src.positions[e.i1 as usize]);
    }
    line_positions(out)
}

/// `WireframeGeometry(source)`: every unique triangle edge once, as segment
/// pairs (by group for an indexed source, as three walks it).
pub fn wireframe(src: &MeshData) -> MeshData {
    let mut seen: HashSet<[u32; 6]> = HashSet::new();
    let mut out: Vec<[f32; 3]> = Vec::new();
    let mut edge = |a: [f32; 3], b: [f32; 3], out: &mut Vec<[f32; 3]>| {
        let k = |p: [f32; 3], q: [f32; 3]| [p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), q[0].to_bits(), q[1].to_bits(), q[2].to_bits()];
        if seen.contains(&k(a, b)) || seen.contains(&k(b, a)) {
            return;
        }
        seen.insert(k(a, b));
        seen.insert(k(b, a));
        out.push(a);
        out.push(b);
    };
    match &src.indices {
        Some(ix) => {
            let groups: Vec<(u32, u32)> = if src.groups.is_empty() {
                vec![(0, ix.len() as u32)]
            } else {
                src.groups.iter().map(|g| (g.start, g.count)).collect()
            };
            for (start, count) in groups {
                let end = (start + count).min(ix.len() as u32) as usize;
                let mut i = start as usize;
                while i < end {
                    for j in 0..3 {
                        let (Some(&a), Some(&b)) = (ix.get(i + j), ix.get(i + (j + 1) % 3)) else { continue };
                        edge(src.positions[a as usize], src.positions[b as usize], &mut out);
                    }
                    i += 3;
                }
            }
        }
        None => {
            for t in src.positions.chunks_exact(3) {
                for j in 0..3 {
                    edge(t[j], t[(j + 1) % 3], &mut out);
                }
            }
        }
    }
    line_positions(out)
}

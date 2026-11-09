//! A node outline's inside distance field, for effects that shape themselves
//! to the node (glass bevels it), and its `max_distance`.
//!
//! Built on the CPU from the outline — rasterised with exact-area
//! anti-aliasing (2× below 400k device px), thresholded, run through a
//! Felzenszwalb–Huttenlocher distance transform, refined near the edge from the
//! coverage and softened along the medial axis — then uploaded once as a
//! half-float texture of distance / max distance. Built in the node's *linear*
//! device frame (its matrix without the translation), so a node that only
//! moves reuses the same field; the translation places it.
//!
//! A rounded rect or circle under a scale and rotation skips the raster and
//! the transform: its distance is exact in closed form, which is what those
//! steps approximate, and a glass panel that grows or springs rebuilds its
//! field every frame (20 ms the long way for a 1000 px button, under 3 ms so).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use kurbo::{Affine, BezPath, PathEl, Point};

/// One built field. `texels` are IEEE half floats of distance / `max_distance`.
pub struct Field {
    /// Unique per build, for the GPU texture cache.
    pub id: u64,
    pub w: u32,
    pub h: u32,
    pub texels: Vec<u16>,
    /// Texel (0,0) relative to the node's device origin (its translation), device px.
    pub origin: [f32; 2],
    /// Device px per texel: 1 unless a very large outline was built coarser.
    pub texel: f32,
    /// The deepest point inside the outline, device px (what 1.0 stands for).
    pub max_distance: f32,
}

/// Above this many device px the field is built coarser rather than stall a frame.
const MAX_FIELD_PIXELS: f64 = 1_500_000.0;
/// Below this many device px the outline is rasterised at 2×.
const SUPERSAMPLE_BELOW: f64 = 400_000.0;
/// Fields kept between frames, oldest dropped first.
const CACHE_SIZE: usize = 16;

/// What a field is built from, in node-local px.
pub enum FieldSource {
    /// An outline and whether it fills even-odd.
    Path(BezPath, bool),
    /// A rounded rect (radii tl, tr, br, bl, already clamped) or an ellipse over `rect`.
    Shape { ellipse: bool, rect: [f32; 4], radii: [f32; 4] },
}

#[derive(Default)]
pub struct FieldCache {
    /// Least recently used first.
    entries: Vec<(u64, Arc<Field>)>,
    next_id: u64,
}

impl FieldCache {
    /// The field for an outline (identified by `outline_key`, made by `source`)
    /// under the linear part of `m` (`[a, b, c, d, tx, ty]`, device = a·x + c·y + tx …).
    pub fn get(&mut self, outline_key: u64, m: &[f32], source: impl FnOnce() -> Option<FieldSource>) -> Option<Arc<Field>> {
        let mut h = DefaultHasher::new();
        outline_key.hash(&mut h);
        // As the engine's key: the linear part to five decimals.
        for v in [m[0], m[2], m[1], m[3]] {
            ((v as f64) * 1e5).round().to_bits().hash(&mut h);
        }
        let key = h.finish();
        if let Some(k) = self.entries.iter().position(|e| e.0 == key) {
            let e = self.entries.remove(k);
            let f = e.1.clone();
            self.entries.push(e);
            return Some(f);
        }
        let source = source()?;
        self.next_id += 1;
        let f = match source {
            FieldSource::Shape { ellipse, rect, radii } => match build_shape_field(ellipse, rect, radii, m, self.next_id) {
                Some(f) => f,
                None => {
                    let p = Affine::translate((rect[0] as f64, rect[1] as f64)) * crate::paths::shape_path(ellipse, rect[2] - rect[0], rect[3] - rect[1], radii);
                    build_field(&p, false, m, self.next_id)?
                }
            },
            FieldSource::Path(p, even_odd) => match as_round_rect(&p).and_then(|(rect, radii)| build_shape_field(false, rect, radii, m, self.next_id)) {
                Some(f) => f,
                None => build_field(&p, even_odd, m, self.next_id)?,
            },
        };
        let f = Arc::new(f);
        self.entries.push((key, f.clone()));
        if self.entries.len() > CACHE_SIZE {
            self.entries.remove(0);
        }
        Some(f)
    }
}

/// The device grid a field covers: the outline's control box under `lin`, padded.
struct Grid {
    left: f64,
    top: f64,
    /// Texels per device px (below 1 for a very large outline).
    coarse: f64,
    out_w: usize,
    out_h: usize,
    /// Device px the grid stands for, at its texel size.
    texels: f64,
}

fn grid(bounds: [f64; 4], lin: Affine) -> Option<Grid> {
    let [l, t, r, b] = bounds;
    let corners = [Point::new(l, t), Point::new(r, t), Point::new(l, b), Point::new(r, b)].map(|p| lin * p);
    let min_x = corners.iter().map(|p| p.x).fold(f64::MAX, f64::min);
    let min_y = corners.iter().map(|p| p.y).fold(f64::MAX, f64::min);
    let max_x = corners.iter().map(|p| p.x).fold(f64::MIN, f64::max);
    let max_y = corners.iter().map(|p| p.y).fold(f64::MIN, f64::max);
    let pad = 2.0;
    let left = min_x.floor() - pad;
    let top = min_y.floor() - pad;
    let device_w = max_x.ceil() + pad - left;
    let device_h = max_y.ceil() + pad - top;
    if !(device_w > pad * 2.0) || !(device_h > pad * 2.0) {
        return None;
    }
    let area = device_w * device_h;
    let coarse = if area > MAX_FIELD_PIXELS { (MAX_FIELD_PIXELS / area).sqrt() } else { 1.0 };
    let out_w = ((device_w * coarse).ceil() as usize).max(1);
    let out_h = ((device_h * coarse).ceil() as usize).max(1);
    Some(Grid { left, top, coarse, out_w, out_h, texels: area * coarse * coarse })
}

fn lin_of(m: &[f32]) -> Affine {
    Affine::new([m[0] as f64, m[1] as f64, m[2] as f64, m[3] as f64, 0.0, 0.0])
}

fn build_field(path: &BezPath, even_odd: bool, m: &[f32], id: u64) -> Option<Field> {
    // The bounds are the control points' bounds.
    let cb = path.control_box();
    let bounds = [cb.x0 as f32 as f64, cb.y0 as f32 as f64, cb.x1 as f32 as f64, cb.y1 as f32 as f64];
    let lin = lin_of(m);
    let g = grid(bounds, lin)?;
    let Grid { left, top, coarse, out_w, out_h, .. } = g;
    let ss = if g.texels <= SUPERSAMPLE_BELOW { 2usize } else { 1 };
    let (w, h) = (out_w * ss, out_h * ss);
    let k = coarse * ss as f64;

    let raster = Affine::scale(k) * Affine::translate((-left, -top)) * lin;
    let coverage = rasterise(&(raster * path.clone()), w, h, even_odd);

    let inside = inside_distances(&coverage, w, h);
    let mut field = if ss == 2 { halve(&inside, w, h) } else { inside };
    let mut max_distance = 0.0f32;
    for v in field.iter_mut() {
        *v = (*v as f64 / k) as f32;
        if *v > max_distance {
            max_distance = *v;
        }
    }
    if !(max_distance > 0.0) {
        return None;
    }
    let cover: Vec<f32> = coverage.iter().map(|&a| (a as f64 / 255.0) as f32).collect();
    let cover = if ss == 2 { halve(&cover, w, h) } else { cover };
    refine_edge(&mut field, &cover, out_w, out_h, coarse);
    Some(finish(field, max_distance, g, id))
}

/// A rounded rect's or circle's field from its exact distance, when `m` keeps
/// shapes (distance scales with it) and every corner fits its quadrant; `None` sends the outline the long way.
fn build_shape_field(ellipse: bool, rect: [f32; 4], radii: [f32; 4], m: &[f32], id: u64) -> Option<Field> {
    let [a, b, c, d] = [m[0] as f64, m[1] as f64, m[2] as f64, m[3] as f64];
    // Distances scale with it when its columns are as long and at right
    // angles: a rotation and scale, or their mirror (the y-up flip).
    let scale = (a * a + b * b).sqrt();
    let s2 = scale * scale;
    if !(scale > 0.0) || (a * a + b * b - c * c - d * d).abs() > 1e-6 * s2 || (a * c + b * d).abs() > 1e-6 * s2 {
        return None;
    }
    let [l, t, r, btm] = rect.map(|v| v as f64);
    let (hw, hh) = ((r - l) / 2.0, (btm - t) / 2.0);
    let radii = if ellipse {
        if (hw - hh).abs() > 1e-4 * hw.max(hh) {
            return None;
        }
        [hw; 4]
    } else {
        radii.map(|v| v as f64)
    };
    if radii.iter().any(|&v| !(v >= 0.0) || v > hw.min(hh) + 1e-6) {
        return None;
    }
    let lin = lin_of(m);
    let g = grid([l, t, r, btm], lin)?;
    let inv = lin.inverse();
    let (cx, cy) = (l + hw, t + hh);
    let step = 1.0 / g.coarse;
    let mut field = vec![0.0f32; g.out_w * g.out_h];
    let mut max_distance = 0.0f32;
    for y in 0..g.out_h {
        for x in 0..g.out_w {
            let p = inv * Point::new(g.left + (x as f64 + 0.5) * step, g.top + (y as f64 + 0.5) * step);
            let (px, py) = (p.x - cx, p.y - cy);
            let r = match (px >= 0.0, py >= 0.0) {
                (false, false) => radii[0],
                (true, false) => radii[1],
                (true, true) => radii[2],
                (false, true) => radii[3],
            };
            let (qx, qy) = (px.abs() - hw + r, py.abs() - hh + r);
            let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
            let inside = (-(outside + qx.max(qy).min(0.0) - r)).max(0.0) * scale;
            let v = inside as f32;
            field[y * g.out_w + x] = v;
            if v > max_distance {
                max_distance = v;
            }
        }
    }
    if !(max_distance > 0.0) {
        return None;
    }
    Some(finish(field, max_distance, g, id))
}

/// The rect and corner radii (tl, tr, br, bl) of a path that traces a rounded
/// rect: a drawing API's rect reaches the renderer as one. Read off where the
/// outline leaves each edge, then checked: every point on that outline and the
/// same area enclosed. `None` for anything else.
fn as_round_rect(path: &BezPath) -> Option<([f32; 4], [f32; 4])> {
    let cb = path.control_box();
    let (l, t, r, b) = (cb.x0, cb.y0, cb.x1, cb.y1);
    let (w, h) = (r - l, b - t);
    if !(w > 0.0 && h > 0.0) {
        return None;
    }
    let mut pts: Vec<Point> = Vec::new();
    let mut contours = 0;
    kurbo::flatten(path.iter(), 0.05, |el| match el {
        PathEl::MoveTo(p) => {
            contours += 1;
            pts.push(p);
        }
        PathEl::LineTo(p) => pts.push(p),
        _ => {}
    });
    if contours != 1 || pts.len() < 4 {
        return None;
    }
    let eps = 1e-4 * w.max(h);
    let span = |on: &dyn Fn(&Point) -> bool, coord: &dyn Fn(&Point) -> f64| -> Option<(f64, f64)> {
        let v: Vec<f64> = pts.iter().filter(|p| on(p)).map(coord).collect();
        (!v.is_empty()).then(|| (v.iter().cloned().fold(f64::MAX, f64::min), v.iter().cloned().fold(f64::MIN, f64::max)))
    };
    let top = span(&|p| (p.y - t).abs() <= eps, &|p| p.x)?;
    let bottom = span(&|p| (p.y - b).abs() <= eps, &|p| p.x)?;
    let (hw, hh) = (w / 2.0, h / 2.0);
    let fit = |v: f64| v.clamp(0.0, hw.min(hh));
    let radii = [fit(top.0 - l), fit(r - top.1), fit(r - bottom.1), fit(bottom.0 - l)];
    let (cx, cy) = (l + hw, t + hh);
    let tol = 1e-3 * w.max(h) + 0.01;
    for p in &pts {
        let (px, py) = (p.x - cx, p.y - cy);
        let rr = match (px >= 0.0, py >= 0.0) {
            (false, false) => radii[0],
            (true, false) => radii[1],
            (true, true) => radii[2],
            (false, true) => radii[3],
        };
        let (qx, qy) = (px.abs() - hw + rr, py.abs() - hh + rr);
        let d = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - rr;
        if d.abs() > tol {
            return None;
        }
    }
    let mut area = 0.0;
    for i in 0..pts.len() {
        let (a, c) = (pts[i], pts[(i + 1) % pts.len()]);
        area += a.x * c.y - c.x * a.y;
    }
    let expected = w * h - (1.0 - std::f64::consts::FRAC_PI_4) * radii.iter().map(|v| v * v).sum::<f64>();
    if ((area / 2.0).abs() - expected).abs() > 5e-3 * expected {
        return None;
    }
    Some(([l, t, r, b].map(|v| v as f32), radii.map(|v| v as f32)))
}

/// Softens the medial axis and packs the field as half floats.
fn finish(mut field: Vec<f32>, max_distance: f32, g: Grid, id: u64) -> Field {
    let Grid { left, top, coarse, out_w, out_h, .. } = g;
    soften(&mut field, out_w, out_h, max_distance as f64, coarse);

    let range = max_distance as f64;
    let texels = field.iter().map(|&v| to_half((v as f64 / range).min(1.0) as f32)).collect();
    Field {
        id,
        w: out_w as u32,
        h: out_h as u32,
        texels,
        origin: [left as f32, top as f32],
        texel: (1.0 / coarse) as f32,
        max_distance,
    }
}

/// Coverage bytes of `path` (already in raster px) over a `w × h` raster:
/// exact-area (analytic) anti-aliasing. Subpaths close implicitly.
fn rasterise(path: &BezPath, w: usize, h: usize, even_odd: bool) -> Vec<u8> {
    let mut acc = vec![0.0f32; w * h + w + 4];
    let mut start = Point::ZERO;
    let mut cur = Point::ZERO;
    kurbo::flatten(path.iter(), 0.05, |el| match el {
        PathEl::MoveTo(p) => {
            line(&mut acc, w, h, cur, start);
            start = p;
            cur = p;
        }
        PathEl::LineTo(p) => {
            line(&mut acc, w, h, cur, p);
            cur = p;
        }
        PathEl::ClosePath => {
            line(&mut acc, w, h, cur, start);
            cur = start;
        }
        _ => {}
    });
    line(&mut acc, w, h, cur, start);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        let mut sum = 0.0f32;
        for x in 0..w {
            sum += acc[y * w + x];
            let a = sum.abs();
            let c = if even_odd {
                let v = a % 2.0;
                if v > 1.0 { 2.0 - v } else { v }
            } else {
                a.min(1.0)
            };
            out[y * w + x] = (c * 255.0 + 0.5) as u8;
        }
    }
    out
}

/// Accumulate one edge's signed area (font-rs): each row gets the area left of
/// the edge spread over the pixels it crosses; a prefix sum per row yields coverage.
fn line(acc: &mut [f32], w: usize, h: usize, p0: Point, p1: Point) {
    let (p0, p1) = ((p0.x as f32, p0.y as f32), (p1.x as f32, p1.y as f32));
    if (p0.1 - p1.1).abs() <= f32::EPSILON {
        return;
    }
    let (dir, p0, p1) = if p0.1 < p1.1 { (1.0, p0, p1) } else { (-1.0, p1, p0) };
    let dxdy = (p1.0 - p0.0) / (p1.1 - p0.1);
    let mut x = p0.0;
    if p0.1 < 0.0 {
        x -= p0.1 * dxdy;
    }
    let y0 = p0.1.max(0.0) as usize;
    let y1 = h.min(p1.1.ceil().max(0.0) as usize);
    for y in y0..y1 {
        let row = y * w;
        let dy = ((y + 1) as f32).min(p1.1) - (y as f32).max(p0.1);
        let xnext = x + dxdy * dy;
        let d = dy * dir;
        let (x0, x1) = if x < xnext { (x, xnext) } else { (xnext, x) };
        let x0f_ = x0.floor();
        let x0i = x0f_ as isize;
        let x1c = x1.ceil();
        let x1i = x1c as isize;
        let at = |i: isize| -> Option<usize> {
            let j = row as isize + i;
            (i >= 0 && (i as usize) <= w && j >= 0).then_some(j as usize)
        };
        if x1i <= x0i + 1 {
            let xmf = 0.5 * (x + xnext) - x0f_;
            if let Some(j) = at(x0i) {
                acc[j] += d - d * xmf;
                acc[j + 1] += d * xmf;
            }
        } else if let Some(j) = at(x0i) {
            let s = (x1 - x0).recip();
            let x0f = x0 - x0f_;
            let a0 = 0.5 * s * (1.0 - x0f) * (1.0 - x0f);
            let x1f = x1 - x1c + 1.0;
            let am = 0.5 * s * x1f * x1f;
            acc[j] += d * a0;
            if x1i == x0i + 2 {
                acc[j + 1] += d * (1.0 - a0 - am);
            } else {
                let a1 = s * (1.5 - x0f);
                acc[j + 1] += d * (a1 - a0);
                for xi in x0i + 2..x1i - 1 {
                    acc[row + xi as usize] += d * s;
                }
                let a2 = a1 + (x1i - x0i - 3) as f32 * s;
                acc[row + (x1i - 1) as usize] += d * (1.0 - a2 - am);
            }
            acc[row + x1i as usize] += d * am;
        }
        x = xnext;
    }
}

const FAR: f64 = 1e20;

/// Euclidean distance from each covered pixel's centre to the outline, in
/// pixels; 0 outside (the engine's `insideDistances`).
fn inside_distances(coverage: &[u8], w: usize, h: usize) -> Vec<f32> {
    let n = w.max(h);
    let mut f = vec![0.0f64; n];
    let mut d = vec![0.0f64; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0f64; n + 1];
    let mut grid: Vec<f64> = coverage.iter().map(|&c| if c >= 128 { FAR } else { 0.0 }).collect();
    for x in 0..w {
        for y in 0..h {
            f[y] = grid[y * w + x];
        }
        transform_1d(&f, h, &mut d, &mut v, &mut z);
        for y in 0..h {
            grid[y * w + x] = d[y];
        }
    }
    let mut out = vec![0.0f32; w * h];
    for y in 0..h {
        f[..w].copy_from_slice(&grid[y * w..y * w + w]);
        transform_1d(&f, w, &mut d, &mut v, &mut z);
        for x in 0..w {
            out[y * w + x] = if d[x] > 0.0 { (d[x].sqrt() - 0.5).max(0.0) as f32 } else { 0.0 };
        }
    }
    out
}

/// One dimension of the squared distance transform (Felzenszwalb & Huttenlocher 2012).
fn transform_1d(f: &[f64], n: usize, d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let mut k = 0usize;
    v[0] = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        let qf = q as f64;
        let mut s;
        loop {
            let vk = v[k] as f64;
            s = (f[q] + qf * qf - (f[v[k]] + vk * vk)) / (2.0 * qf - 2.0 * vk);
            if s <= z[k] && k > 0 {
                k -= 1;
            } else {
                break;
            }
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f64::INFINITY;
    }
    k = 0;
    for q in 0..n {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let dq = q as f64 - v[k] as f64;
        d[q] = dq * dq + f[v[k]];
    }
}

/// 2×2 box average of an even-sized grid.
fn halve(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let (hw, hh) = (w / 2, h / 2);
    let mut out = vec![0.0f32; hw * hh];
    for y in 0..hh {
        for x in 0..hw {
            let i = 2 * y * w + 2 * x;
            out[y * hw + x] = ((src[i] as f64 + src[i + 1] as f64 + src[i + w] as f64 + src[i + w + 1] as f64) / 4.0) as f32;
        }
    }
    out
}

/// Box radius (field texels) of the blur `refine_edge` reads the outline from.
const EDGE_BLUR: usize = 2;

/// Replace the transform's staircase near the outline with σ·Φ⁻¹ of the
/// blurred coverage (the engine's `refineEdge`).
fn refine_edge(field: &mut [f32], coverage: &[f32], w: usize, h: usize, texels_per_px: f64) {
    let blurred = box_blur3(coverage, w, h, EDGE_BLUR);
    let smooth = box_blur3(field, w, h, EDGE_BLUR);
    let e = EDGE_BLUR as f64;
    let sigma = (e * e + e).sqrt() / texels_per_px;
    let from = 1.5 * sigma;
    let to = 2.5 * sigma;
    for i in 0..field.len() {
        let d = field[i] as f64;
        if d <= 0.0 {
            continue;
        }
        if d >= to {
            field[i] = smooth[i];
            continue;
        }
        let c = blurred[i] as f64;
        let edge = if c > 0.5 { sigma * inverse_normal(c.min(0.9999)) } else { 0.0 };
        let t = if d <= from { 0.0 } else { (d - from) / (to - from) };
        field[i] = (edge + (smooth[i] as f64 - edge) * t * t * (3.0 - 2.0 * t)) as f32;
    }
}

/// Φ⁻¹(p) for p in [0.5, 1) — Abramowitz & Stegun 26.2.23.
fn inverse_normal(p: f64) -> f64 {
    let t = (-2.0 * (1.0 - p).ln()).sqrt();
    t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t)
}

/// Round off the medial axis past a sixth of the deepest point (the engine's `soften`).
fn soften(field: &mut [f32], w: usize, h: usize, deepest: f64, texels_per_px: f64) {
    let radius = ((deepest * 0.08 * texels_per_px).round() as usize).max(1);
    let blurred = box_blur3(field, w, h, radius);
    let from = deepest * 0.15;
    let to = deepest * 0.6;
    for i in 0..field.len() {
        let d = field[i] as f64;
        if d <= from {
            continue;
        }
        let t = ((d - from) / (to - from)).min(1.0);
        let s = t * t * (3.0 - 2.0 * t);
        field[i] = (d + (blurred[i] as f64 - d) * s) as f32;
    }
}

/// Three passes of a separable box blur, edges clamped.
fn box_blur3(src: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let mut a = src.to_vec();
    let mut b = vec![0.0f32; src.len()];
    for _ in 0..3 {
        box_line(&a, &mut b, w, h, radius, 1, w);
        box_line(&b, &mut a, h, w, radius, w, 1);
    }
    a
}

fn box_line(src: &[f32], dst: &mut [f32], len: usize, lines: usize, r: usize, step: usize, stride: usize) {
    let span = (2 * r + 1) as f64;
    let ci = |i: isize| -> usize { i.clamp(0, len as isize - 1) as usize };
    let r = r as isize;
    for line in 0..lines {
        let base = line * stride;
        let mut sum = 0.0f64;
        for i in -r..=r {
            sum += src[base + ci(i) * step] as f64;
        }
        for i in 0..len as isize {
            dst[base + i as usize * step] = (sum / span) as f32;
            sum += src[base + ci(i + r + 1) * step] as f64 - src[base + ci(i - r) * step] as f64;
        }
    }
}

/// IEEE half-float bits of a value in [0, 1] (the engine's `toHalf`).
fn to_half(value: f32) -> u16 {
    let x = value.to_bits();
    let exp = ((x >> 23) & 0xff) as i32 - 112;
    let mant = x & 0x7f_ffff;
    if exp <= 0 {
        if exp < -10 {
            return 0;
        }
        return ((((mant | 0x80_0000) >> (13 - exp)) + 1) >> 1) as u16;
    }
    ((exp << 10) as u32 + ((mant + 0x1000) >> 13)) as u16
}

/// A hash of anything outline-identifying, for [`FieldCache::get`].
pub fn outline_key(parts: impl Hash) -> u64 {
    let mut h = DefaultHasher::new();
    parts.hash(&mut h);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect_field(w: f32, h: f32, m: [f32; 6]) -> Arc<Field> {
        let mut cache = FieldCache::default();
        let p = crate::paths::shape_path(false, w, h, [0.0; 4]);
        cache.get(1, &m, || Some(FieldSource::Path(p, false))).unwrap()
    }

    /// The deepest point of a w×h rect is h/2 from the outline (less the
    /// medial softening), and the edge texels read as their sub-pixel distance.
    #[test]
    fn rect_depth_and_edge() {
        let f = rect_field(100.0, 60.0, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        assert!((f.max_distance - 30.0).abs() < 0.6, "max {}", f.max_distance);
        assert_eq!(f.origin, [-2.0, -2.0]);
        // The texel centred 2.5 px inside the left edge, mid-height.
        let half = |b: u16| f32::from_bits(((b as u32 & 0x3ff) << 13) | ((((b as u32 >> 10) & 0x1f) + 112) << 23));
        let d = half(f.texels[(32 * f.w + 4) as usize]) * f.max_distance;
        assert!((d - 2.5).abs() < 0.1, "edge distance {d}");
    }

    #[test]
    fn cached_per_linear_transform() {
        let mut cache = FieldCache::default();
        let p = || Some(FieldSource::Path(crate::paths::shape_path(true, 80.0, 80.0, [0.0; 4]), false));
        let a = cache.get(7, &[2.0, 0.0, 0.0, 2.0, 10.0, 0.0], p).unwrap();
        let b = cache.get(7, &[2.0, 0.0, 0.0, 2.0, 99.5, 3.0], p).unwrap();
        let c = cache.get(7, &[1.5, 0.0, 0.0, 1.5, 0.0, 0.0], p).unwrap();
        assert_eq!(a.id, b.id);
        assert_ne!(a.id, c.id);
        assert!((a.max_distance - 80.0).abs() < 1.0, "max {}", a.max_distance);
    }

    fn half(b: u16) -> f32 {
        if b == 0 {
            return 0.0;
        }
        f32::from_bits(((b as u32 & 0x3ff) << 13) | ((((b as u32 >> 10) & 0x1f) + 112) << 23))
    }

    /// The closed form against the raster-and-transform build of the same outline:
    /// same grid and depth, texels a fraction of a pixel apart on average (the
    /// long way rounds sharp corners and is the coarser of the two when rotated).
    #[test]
    fn shape_fields_match_the_long_way() {
        let rot = |deg: f32, s: f32| {
            let (sn, cs) = deg.to_radians().sin_cos();
            [cs * s, sn * s, -sn * s, cs * s, 0.0, 0.0]
        };
        let cases: [(bool, [f32; 4], [f32; 4], [f32; 6]); 6] = [
            (false, [0.0, 0.0, 600.0, 260.0], [130.0; 4], [1.3, 0.0, 0.0, 1.3, 0.0, 0.0]),
            (false, [-50.0, -30.0, 50.0, 30.0], [0.0; 4], [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
            (false, [0.0, 0.0, 320.0, 180.0], [10.0, 40.0, 20.0, 0.0], rot(30.0, 2.0)),
            (true, [0.0, 0.0, 200.0, 200.0], [0.0; 4], [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
            (false, [0.0, 0.0, 760.0, 460.0], [40.0; 4], [2.6, 0.0, 0.0, 2.6, 0.0, 0.0]),
            (false, [0.0, 0.0, 600.0, 260.0], [130.0; 4], [1.3, 0.0, 0.0, -1.3, 0.0, 0.0]),
        ];
        for (ellipse, rect, radii, m) in cases {
            let fast = build_shape_field(ellipse, rect, radii, &m, 1).expect("closed form");
            let p = Affine::translate((rect[0] as f64, rect[1] as f64)) * crate::paths::shape_path(ellipse, rect[2] - rect[0], rect[3] - rect[1], radii);
            let slow = build_field(&p, false, &m, 2).unwrap();
            assert_eq!((fast.w, fast.h, fast.origin, fast.texel), (slow.w, slow.h, slow.origin, slow.texel));
            let depth = (fast.max_distance - slow.max_distance).abs();
            assert!(depth < 0.01 * slow.max_distance + 0.5, "{rect:?} depth {} vs {}", fast.max_distance, slow.max_distance);
            let (mut worst, mut sum) = (0.0f32, 0.0f32);
            for (a, b) in fast.texels.iter().zip(&slow.texels) {
                let e = (half(*a) * fast.max_distance - half(*b) * slow.max_distance).abs();
                worst = worst.max(e);
                sum += e;
            }
            let mean = sum / fast.texels.len() as f32;
            assert!(worst < 2.5 && mean < 0.5, "{rect:?}: worst {worst} px, mean {mean} px");
        }
    }

    #[test]
    fn round_rect_paths_are_recognised() {
        let shift = |p: BezPath| Affine::translate((-300.0, -130.0)) * p;
        let (rect, radii) = as_round_rect(&shift(crate::paths::shape_path(false, 600.0, 260.0, [130.0; 4]))).unwrap();
        assert_eq!(rect, [-300.0, -130.0, 300.0, 130.0]);
        assert!(radii.iter().all(|r| (r - 130.0).abs() < 0.01), "{radii:?}");
        let (_, radii) = as_round_rect(&crate::paths::shape_path(false, 320.0, 180.0, [10.0, 40.0, 20.0, 0.0])).unwrap();
        for (got, want) in radii.iter().zip([10.0, 40.0, 20.0, 0.0]) {
            assert!((got - want).abs() < 0.01, "{radii:?}");
        }
        let kurbo_rrect = kurbo::Shape::to_path(&kurbo::RoundedRect::new(0.0, 0.0, 200.0, 100.0, 24.0), 0.01);
        assert!(as_round_rect(&kurbo_rrect).is_some());
        assert!(as_round_rect(&crate::paths::shape_path(true, 200.0, 200.0, [0.0; 4])).is_some());
        // Not one: an ellipse, a triangle, two rects.
        assert!(as_round_rect(&crate::paths::shape_path(true, 200.0, 100.0, [0.0; 4])).is_none());
        let mut tri = BezPath::new();
        tri.move_to((0.0, 0.0));
        tri.line_to((100.0, 0.0));
        tri.line_to((0.0, 100.0));
        tri.close_path();
        assert!(as_round_rect(&tri).is_none());
        let mut two = crate::paths::shape_path(false, 50.0, 50.0, [0.0; 4]);
        two.extend(Affine::translate((100.0, 0.0)) * crate::paths::shape_path(false, 50.0, 50.0, [0.0; 4]));
        assert!(as_round_rect(&two).is_none());
    }

    #[test]
    fn shape_fields_fall_back_off_similarity() {
        assert!(build_shape_field(false, [0.0, 0.0, 100.0, 60.0], [10.0; 4], &[2.0, 0.0, 0.0, 1.0, 0.0, 0.0], 1).is_none());
        assert!(build_shape_field(true, [0.0, 0.0, 100.0, 60.0], [0.0; 4], &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0], 1).is_none());
        assert!(build_shape_field(false, [0.0, 0.0, 100.0, 60.0], [50.0, 0.0, 0.0, 0.0], &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0], 1).is_none());
    }

    #[test]
    fn build_time_4k_tile() {
        let t = std::time::Instant::now();
        let f = rect_field(360.0, 240.0, [2.0, 0.0, 0.0, 2.0, 0.0, 0.0]);
        eprintln!("field {}x{} in {:?}", f.w, f.h, t.elapsed());
    }
}

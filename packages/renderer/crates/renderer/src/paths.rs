//! Path storage and the outline cache.
//!
//! Every path draw — fill, stroke, dashed stroke, shape union, cut — becomes a
//! *filled outline*: line segments in local space, grouped into horizontal
//! bands. The fragment shader computes exact area coverage of each pixel from
//! the segments of its band (see `path_coverage` in prim.wgsl), so edges get
//! analytic anti-aliasing under any transform and an animated transform reuses
//! the cached outline. Strokes and dashes are turned into outlines by kurbo.
//! Only a change of path data, stroke style or zoom bucket (tolerance) builds
//! the outline again.


use kurbo::{Affine, BezPath, Cap, Join, PathEl, Point, Stroke as KStroke, StrokeOpts};

use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;

use crate::scene::{Dash, Member, Stroke};

pub const VERB_MOVE: u8 = 0;
pub const VERB_LINE: u8 = 1;
pub const VERB_QUAD: u8 = 2;
pub const VERB_CUBIC: u8 = 3;
pub const VERB_CLOSE: u8 = 4;

pub struct PathData {
    pub path: BezPath,
    pub bounds: [f32; 4],
    pub version: u32,
}

#[derive(Default)]
pub struct PathStore {
    paths: Vec<Option<PathData>>,
    next_version: u32,
}

impl PathStore {
    pub fn define(&mut self, id: u32, verbs: Vec<u8>, points: Vec<[f32; 2]>) {
        let path = build_path(&verbs, &points);
        let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for p in &points {
            b[0] = b[0].min(p[0]);
            b[1] = b[1].min(p[1]);
            b[2] = b[2].max(p[0]);
            b[3] = b[3].max(p[1]);
        }
        if points.is_empty() {
            b = [0.0; 4];
        }
        let i = id as usize;
        if self.paths.len() <= i {
            self.paths.resize_with(i + 1, || None);
        }
        self.next_version += 1;
        self.paths[i] = Some(PathData { path, bounds: b, version: self.next_version });
    }

    pub fn free(&mut self, id: u32) {
        if let Some(slot) = self.paths.get_mut(id as usize) {
            *slot = None;
        }
    }

    pub fn get(&self, id: u32) -> Option<&PathData> {
        self.paths.get(id as usize).and_then(|p| p.as_ref())
    }
}

pub fn build_path(verbs: &[u8], pts: &[[f32; 2]]) -> BezPath {
    let mut b = BezPath::new();
    let mut i = 0usize;
    let mut open = false;
    let p = |k: usize| Point::new(pts[k][0] as f64, pts[k][1] as f64);
    for &v in verbs {
        match v {
            VERB_MOVE if i < pts.len() => {
                b.move_to(p(i));
                open = true;
                i += 1;
            }
            VERB_LINE if open && i < pts.len() => {
                b.line_to(p(i));
                i += 1;
            }
            VERB_QUAD if open && i + 1 < pts.len() => {
                b.quad_to(p(i), p(i + 1));
                i += 2;
            }
            VERB_CUBIC if open && i + 2 < pts.len() => {
                b.curve_to(p(i), p(i + 1), p(i + 2));
                i += 3;
            }
            VERB_CLOSE if open => {
                b.close_path();
                open = false;
            }
            _ => {}
        }
    }
    b
}

/// A shape outline built in Rust (used when a rect/ellipse is dashed or joins
/// a union). Its start point and direction are fixed, so a dash pattern
/// always starts in the same place.
pub fn shape_path(ellipse: bool, w: f32, h: f32, r: [f32; 4]) -> BezPath {
    let (w, h) = (w as f64, h as f64);
    let mut b = BezPath::new();
    let k = 0.552_284_8_f64;
    if ellipse {
        let (rx, ry) = (w * 0.5, h * 0.5);
        let (cx, cy) = (rx, ry);
        b.move_to((cx + rx, cy));
        b.curve_to((cx + rx, cy + ry * k), (cx + rx * k, cy + ry), (cx, cy + ry));
        b.curve_to((cx - rx * k, cy + ry), (cx - rx, cy + ry * k), (cx - rx, cy));
        b.curve_to((cx - rx, cy - ry * k), (cx - rx * k, cy - ry), (cx, cy - ry));
        b.curve_to((cx + rx * k, cy - ry), (cx + rx, cy - ry * k), (cx + rx, cy));
        b.close_path();
    } else {
        let q = 1.0 - k;
        let [tl, tr, br, bl] = r.map(|v| v as f64);
        b.move_to((tl, 0.0));
        b.line_to((w - tr, 0.0));
        if tr > 0.0 {
            b.curve_to((w - tr * q, 0.0), (w, tr * q), (w, tr));
        }
        b.line_to((w, h - br));
        if br > 0.0 {
            b.curve_to((w, h - br * q), (w - br * q, h), (w - br, h));
        }
        b.line_to((bl, h));
        if bl > 0.0 {
            b.curve_to((bl * q, h), (0.0, h - bl * q), (0.0, h - bl));
        }
        b.line_to((0.0, tl));
        if tl > 0.0 {
            b.curve_to((0.0, tl * q), (tl * q, 0.0), (tl, 0.0));
        }
        b.close_path();
    }
    b
}

pub fn kurbo_stroke(st: &Stroke, dash: Option<&Dash>) -> KStroke {
    let mut k = KStroke::new(st.width as f64)
        .with_join(match st.join {
            1 => Join::Round,
            2 => Join::Bevel,
            _ => Join::Miter,
        })
        .with_caps(match st.cap {
            1 => Cap::Round,
            2 => Cap::Square,
            _ => Cap::Butt,
        })
        .with_miter_limit(st.miter.max(1.0) as f64);
    if let Some(d) = dash {
        let total: f32 = d.intervals.iter().sum();
        if !d.intervals.is_empty() && total > 0.0 {
            let mut pat: Vec<f64> = d.intervals.iter().map(|v| *v as f64).collect();
            if pat.len() % 2 == 1 {
                pat.extend_from_within(..);
            }
            k = k.with_dashes(d.phase as f64, pat);
        }
    }
    k
}

/// Outline of `path` stroked with `style` (dashes included).
pub fn stroke_outline(path: &BezPath, style: &KStroke, tolerance: f64) -> BezPath {
    kurbo::stroke(path.iter(), style, &StrokeOpts::default(), tolerance)
}

/// Appends the line segments of `path`, flattened, to `out`. Every contour is
/// closed (fills treat open contours as closed). Horizontal segments carry no
/// coverage and are dropped. `flip` reverses direction (for unions, so every
/// member winds the same way).
pub fn push_segments(path: &BezPath, tolerance: f64, flip: bool, out: &mut Vec<[f32; 4]>) {
    let mut start = Point::ZERO;
    let mut cur = Point::ZERO;
    let push = |a: Point, b: Point, out: &mut Vec<[f32; 4]>| {
        if (a.y - b.y).abs() < 1e-9 {
            return;
        }
        let (a, b) = if flip { (b, a) } else { (a, b) };
        out.push([a.x as f32, a.y as f32, b.x as f32, b.y as f32]);
    };
    kurbo::flatten(path.iter(), tolerance, |el| match el {
        PathEl::MoveTo(p) => {
            if cur != start {
                push(cur, start, out);
            }
            start = p;
            cur = p;
        }
        PathEl::LineTo(p) => {
            push(cur, p, out);
            cur = p;
        }
        PathEl::ClosePath => {
            if cur != start {
                push(cur, start, out);
            }
            cur = start;
        }
        _ => {}
    });
    if cur != start {
        push(cur, start, out);
    }
}

type Contours = Vec<Vec<[f64; 2]>>;

/// Flattened closed contours of a path.
fn contours(path: &BezPath, tolerance: f64) -> Contours {
    let mut out: Contours = Vec::new();
    kurbo::flatten(path.iter(), tolerance, |el| match el {
        PathEl::MoveTo(p) => out.push(vec![[p.x, p.y]]),
        PathEl::LineTo(p) => {
            if let Some(c) = out.last_mut() {
                c.push([p.x, p.y]);
            }
        }
        _ => {}
    });
    out.retain(|c| c.len() >= 3);
    out
}

/// The exact outline of a compound shape: members applied in order, each
/// unioned with the result so far or cut out of it. Each member is first
/// normalised under its own fill rule, then everything combines non-zero.
pub fn compound_outline(members: &[Member], store: &PathStore, tolerance: f64) -> BezPath {
    let mut acc: Option<Contours> = None;
    for m in members {
        let path = match m.kind {
            1 | 2 => shape_path(m.kind == 2, m.size[0], m.size[1], m.radii),
            3 => match store.get(m.path) {
                Some(p) => p.path.clone(),
                None => continue,
            },
            _ => continue,
        };
        let t = m.transform.map(|v| v as f64);
        let path = Affine::new(t) * path;
        let raw = contours(&path, tolerance);
        let rule = if m.even_odd { FillRule::EvenOdd } else { FillRule::NonZero };
        let empty: Contours = Vec::new();
        let norm: Contours = raw.overlay(&empty, OverlayRule::Subject, rule).into_iter().flatten().collect();
        acc = Some(match acc {
            // Nothing yet is the empty set: cutting or intersecting keeps it.
            None if m.op == 1 || m.op == 2 => continue,
            None => norm,
            Some(a) => {
                let op = match m.op {
                    1 => OverlayRule::Difference,
                    2 => OverlayRule::Intersect,
                    3 => OverlayRule::Xor,
                    _ => OverlayRule::Union,
                };
                a.overlay(&norm, op, FillRule::NonZero).into_iter().flatten().collect()
            }
        });
    }
    let mut b = BezPath::new();
    for c in acc.unwrap_or_default() {
        if c.len() < 3 {
            continue;
        }
        b.move_to((c[0][0], c[0][1]));
        for p in &c[1..] {
            b.line_to((p[0], p[1]));
        }
        b.close_path();
    }
    b
}

/// Stable hash of a compound's members (and the paths they reference), for
/// its cache key.
pub fn members_hash(members: &[Member], store: &PathStore) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for m in members {
        (m.kind, m.op, m.even_odd, m.path).hash(&mut h);
        for v in m.transform.iter().chain(m.size.iter()).chain(m.radii.iter()) {
            v.to_bits().hash(&mut h);
        }
        if m.kind == 3 {
            store.get(m.path).map(|p| p.version).hash(&mut h);
        }
    }
    h.finish()
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum GeomSource {
    Path { id: u32, version: u32 },
    Shape { ellipse: bool, dims: [u32; 6] },
    /// A union / cut of several members, keyed by the owning node and a hash
    /// of what it was built from.
    Compound { node: u32, hash: u64 },
    /// A glyph outline at a size and `wght` (bits).
    Glyph { font: u32, glyph: u32, size: u32, weight: u32 },
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum GeomStyle {
    Fill { even_odd: bool },
    Stroke { width: u32, join: u8, cap: u8, miter: u32, dash: u32 },
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct GeomKey {
    pub source: GeomSource,
    pub style: GeomStyle,
    /// log2 of the device scale the outline was flattened for.
    pub zoom: i8,
}

/// Where a cached outline lives in the band/segment arenas.
#[derive(Clone, Copy, Debug)]
pub struct Outline {
    /// Offset of the band headers (2 words each: start, count) in `bands`.
    pub band_add: u32,
    /// Same for the subtracted set of a cut, or `u32::MAX`.
    pub band_sub: u32,
    pub band_count: u32,
    pub y0: f32,
    pub band_h: f32,
    pub bounds: [f32; 4],
    pub even_odd: bool,
}

struct Entry {
    outline: Outline,
    last_used: u64,
}

/// What a builder hands the cache: segments to add and (for a cut) subtract.
pub struct Segments {
    pub add: Vec<[f32; 4]>,
    pub sub: Vec<[f32; 4]>,
    pub even_odd: bool,
}

pub struct GeomCache {
    map: crate::fxhash::FxHashMap<GeomKey, Entry>,
    pub segs: Vec<[f32; 4]>,
    pub bands: Vec<u32>,
    /// Arena contents before these points are already on the GPU.
    pub uploaded_segs: usize,
    pub uploaded_bands: usize,
    /// Set when the arenas were cleared and must be re-uploaded whole.
    pub reset: bool,
    pub built_this_frame: u32,
    /// Bumped whenever the arenas are cleared (every outline moves).
    pub epoch: u64,
}

const ARENA_LIMIT_SEGS: usize = 4_000_000;

impl Default for GeomCache {
    fn default() -> Self {
        GeomCache {
            map: Default::default(),
            segs: Vec::new(),
            bands: Vec::new(),
            uploaded_segs: 0,
            uploaded_bands: 0,
            reset: true,
            built_this_frame: 0,
            epoch: 0,
        }
    }
}

/// Bands whose range (widened by `margin`) a segment's y-range overlaps:
/// band i covers (y0 + i·h − margin, y0 + (i+1)·h + margin).
fn band_span(s: &[f32; 4], y0: f32, band_h: f32, n: u32, margin: f32) -> std::ops::Range<usize> {
    let (lo, hi) = (s[1].min(s[3]), s[1].max(s[3]));
    // Candidates by arithmetic, then the exact test of the old per-band loop
    // at both ends (keeps membership identical under rounding).
    let first = (((lo - margin - y0) / band_h).floor() as i64 - 1).clamp(0, n as i64 - 1) as usize;
    let last = (((hi + margin - y0) / band_h).floor() as i64 + 1).clamp(0, n as i64 - 1) as usize;
    let inside = |i: usize| {
        let blo = y0 + i as f32 * band_h - margin;
        let bhi = y0 + (i + 1) as f32 * band_h + margin;
        lo < bhi && hi > blo
    };
    let mut a = first;
    while a <= last && !inside(a) {
        a += 1;
    }
    let mut b = last + 1;
    while b > a && !inside(b - 1) {
        b -= 1;
    }
    a..b
}

fn band_entries(segs: &[[f32; 4]], y0: f32, band_h: f32, n: u32, margin: f32) -> usize {
    segs.iter().map(|s| band_span(s, y0, band_h, n, margin).len()).sum()
}

pub fn zoom_bucket(scale: f32) -> i8 {
    scale.max(1e-3).log2().ceil().clamp(-8.0, 8.0) as i8
}

pub fn tolerance(zoom: i8) -> f64 {
    0.2 / 2f64.powi(zoom as i32)
}

impl GeomCache {
    pub fn begin_frame(&mut self) {
        self.built_this_frame = 0;
        if self.segs.len() > ARENA_LIMIT_SEGS {
            // Prototype policy: drop everything and let the frame rebuild what
            // it still uses.
            self.map.clear();
            self.segs.clear();
            self.bands.clear();
            self.uploaded_segs = 0;
            self.uploaded_bands = 0;
            self.reset = true;
            self.epoch += 1;
        }
    }

    pub fn get_or_build(&mut self, key: GeomKey, frame: u64, build: impl FnOnce(f64) -> Option<Segments>) -> Option<Outline> {
        if let Some(e) = self.map.get_mut(&key) {
            e.last_used = frame;
            return Some(e.outline);
        }
        let s = build(tolerance(key.zoom))?;
        if s.add.is_empty() {
            return None;
        }
        self.built_this_frame += 1;
        let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for g in &s.add {
            b[0] = b[0].min(g[0]).min(g[2]);
            b[1] = b[1].min(g[1]).min(g[3]);
            b[2] = b[2].max(g[0]).max(g[2]);
            b[3] = b[3].max(g[1]).max(g[3]);
        }
        let height = (b[3] - b[1]).max(1e-3);
        // Bands overlap by a little over one device pixel at this zoom bucket,
        // so every segment touching a pixel's footprint is in the pixel's band.
        let margin = 2.0 / 2f32.powi(key.zoom as i32);
        // A pixel loops over its band's segments, so aim at ~8 per band: a
        // full-screen outline of 10k segments under 32 bands cost ~80 ms at
        // 4K. Bands stay at least four margins tall, and the copies of
        // segments spanning several bands stay within 8× the segment count.
        let mut n = ((s.add.len() / 8) as u32).clamp(1, 4096).min(((height / (4.0 * margin)) as u32).max(1));
        while n > 1 && band_entries(&s.add, b[1], height / n as f32, n, margin) > 8 * s.add.len() + 64 {
            n /= 2;
        }
        let band_h = height / n as f32;
        let band_add = self.push_bands(&s.add, b[1], band_h, n, margin);
        let band_sub = if s.sub.is_empty() { u32::MAX } else { self.push_bands(&s.sub, b[1], band_h, n, margin) };
        let outline = Outline { band_add, band_sub, band_count: n, y0: b[1], band_h, bounds: b, even_odd: s.even_odd };
        self.map.insert(key, Entry { outline, last_used: frame });
        Some(outline)
    }

    fn push_bands(&mut self, segs: &[[f32; 4]], y0: f32, band_h: f32, n: u32, margin: f32) -> u32 {
        let base = self.segs.len() as u32;
        self.segs.extend_from_slice(segs);
        let headers = self.bands.len();
        self.bands.resize(headers + 2 * n as usize, 0);
        // Counting sort by band; each band keeps segment order.
        let mut counts = vec![0u32; n as usize];
        for s in segs {
            for i in band_span(s, y0, band_h, n, margin) {
                counts[i] += 1;
            }
        }
        let mut at = Vec::with_capacity(n as usize);
        let mut start = self.bands.len() as u32;
        for (i, &c) in counts.iter().enumerate() {
            self.bands[headers + 2 * i] = start;
            self.bands[headers + 2 * i + 1] = c;
            at.push(start as usize);
            start += c;
        }
        self.bands.resize(start as usize, 0);
        for (k, s) in segs.iter().enumerate() {
            for i in band_span(s, y0, band_h, n, margin) {
                self.bands[at[i]] = base + k as u32;
                at[i] += 1;
            }
        }
        headers as u32
    }
}

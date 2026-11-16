//! Path storage and the outline cache.
//!
//! Every path draw — fill, stroke, dashed stroke, shape union, cut — becomes a
//! *filled outline*: line segments in local space, grouped into horizontal
//! bands. The fragment shader computes exact area coverage of each pixel from
//! the segments of its band (see `path_coverage` in prim.wgsl), so edges get
//! analytic anti-aliasing under any transform and an animated transform reuses
//! the cached outline. Strokes and dashes are turned into outlines by kurbo.
//! Segments and bands are cached apart: a zoom bucket change builds new bands
//! (their margin is one device pixel) over cached segments where it can, and
//! only a change of path data or stroke style, or a finer tolerance than any
//! cached flattening of a curved outline, flattens again.


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
    /// Any quad or cubic: flattening, and so its segments, depend on the tolerance.
    pub has_curves: bool,
}

#[derive(Default)]
pub struct PathStore {
    paths: Vec<Option<PathData>>,
    next_version: u32,
}

impl PathStore {
    pub fn define(&mut self, id: u32, verbs: Vec<u8>, points: Vec<[f32; 2]>) {
        let path = build_path(&verbs, &points);
        let has_curves = verbs.iter().any(|&v| v == VERB_QUAD || v == VERB_CUBIC);
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
        self.paths[i] = Some(PathData { path, bounds: b, version: self.next_version, has_curves });
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

/// Whether a compound's outline is lines only: no ellipse, rounded rect or curved path among its members.
pub fn members_exact(members: &[Member], store: &PathStore) -> bool {
    members.iter().all(|m| match m.kind {
        1 => m.radii.iter().all(|&r| r <= 0.0),
        2 => false,
        3 => store.get(m.path).is_none_or(|p| !p.has_curves),
        _ => true,
    })
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

/// Where an outline's bands are cached: its source and style at a zoom bucket
/// (log2 of the device scale), since a band's margin is one device pixel.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct GeomKey {
    pub source: GeomSource,
    pub style: GeomStyle,
    pub zoom: i8,
}

/// Where an outline lives in the band/segment arenas.
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

/// What a builder hands the cache: segments to add and (for a cut) subtract.
pub struct Segments {
    pub add: Vec<[f32; 4]>,
    pub sub: Vec<[f32; 4]>,
    pub even_odd: bool,
}

/// A flattened outline: `zoom` is the bucket it was flattened for, or
/// `EXACT` for lines only, built once at the finest tolerance.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct SegKey {
    source: GeomSource,
    style: GeomStyle,
    zoom: i8,
}

const EXACT: i8 = i8::MIN;

/// How many buckets finer than asked a cached outline may be and still serve:
/// each bucket is ~√2 more segments on curves, which every pixel loops over.
const MAX_FINER: i8 = 4;

/// Its `add` segments, then its `sub` ones, from `start` in `segs`.
#[derive(Clone, Copy)]
struct SegEntry {
    start: u32,
    add: u32,
    sub: u32,
    even_odd: bool,
    bounds: [f32; 4],
    last_used: u64,
}

/// Bands over a `SegEntry`'s segments: `words` words of `bands` from `start`,
/// the added set's headers and lists, then the subtracted set's.
#[derive(Clone, Copy)]
struct BandEntry {
    seg: SegKey,
    outline: Outline,
    start: u32,
    words: u32,
    last_used: u64,
}

pub struct GeomCache {
    seg_map: crate::fxhash::FxHashMap<SegKey, SegEntry>,
    band_map: crate::fxhash::FxHashMap<GeomKey, BandEntry>,
    pub segs: Vec<[f32; 4]>,
    pub bands: Vec<u32>,
    /// Arena contents before these points are already on the GPU.
    pub uploaded_segs: usize,
    pub uploaded_bands: usize,
    /// Set when the arenas were rewritten and must be re-uploaded whole.
    pub reset: bool,
    /// Outlines flattened (and stroked) this frame.
    pub built_this_frame: u32,
    /// Band sets built this frame, over new or cached segments.
    pub banded_this_frame: u32,
    /// Bumped whenever the arenas are compacted (every outline moves).
    pub epoch: u64,
    /// Arena sizes when a sweep last found nothing to evict.
    swept_at: (usize, usize),
    /// Segments and band words past which a main build sweeps.
    limits: (usize, usize),
    /// Scratch: each segment's band range while bands are built.
    spans: Vec<(u32, u32)>,
}

const ARENA_LIMIT_SEGS: usize = 4_000_000;
const ARENA_LIMIT_BANDS: usize = 16_000_000;
/// Builds an outline stays cached after its last use, however full the arenas:
/// a frame is a main build plus a build per redrawn surface.
const PROTECT_BUILDS: u64 = 8;

impl Default for GeomCache {
    fn default() -> Self {
        GeomCache {
            seg_map: Default::default(),
            band_map: Default::default(),
            segs: Vec::new(),
            bands: Vec::new(),
            uploaded_segs: 0,
            uploaded_bands: 0,
            reset: true,
            built_this_frame: 0,
            banded_this_frame: 0,
            epoch: 0,
            swept_at: (0, 0),
            limits: (ARENA_LIMIT_SEGS, ARENA_LIMIT_BANDS),
            spans: Vec::new(),
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

/// Each segment's `band_span` into `out`; returns how many band entries they make.
fn band_spans(segs: &[[f32; 4]], y0: f32, band_h: f32, n: u32, margin: f32, out: &mut Vec<(u32, u32)>) -> usize {
    out.clear();
    let mut entries = 0;
    for s in segs {
        let r = band_span(s, y0, band_h, n, margin);
        entries += r.len();
        out.push((r.start as u32, r.end as u32));
    }
    entries
}

/// Appends band headers and lists for segments with these `spans`, which sit
/// from `base` in the segment arena; returns the headers' offset.
fn push_bands(bands: &mut Vec<u32>, spans: &[(u32, u32)], base: u32, n: u32) -> u32 {
    let headers = bands.len();
    bands.resize(headers + 2 * n as usize, 0);
    // Counting sort by band; each band keeps segment order.
    let mut counts = vec![0u32; n as usize];
    for &(a, b) in spans {
        for i in a..b {
            counts[i as usize] += 1;
        }
    }
    let mut at = Vec::with_capacity(n as usize);
    let mut start = bands.len() as u32;
    for (i, &c) in counts.iter().enumerate() {
        bands[headers + 2 * i] = start;
        bands[headers + 2 * i + 1] = c;
        at.push(start as usize);
        start += c;
    }
    bands.resize(start as usize, 0);
    for (k, &(a, b)) in spans.iter().enumerate() {
        for i in a as usize..b as usize {
            bands[at[i]] = base + k as u32;
            at[i] += 1;
        }
    }
    headers as u32
}

/// Moves a band block copied to a new place: headers point `db` words on, list
/// entries `ds` segments on. `old` is where the block began.
fn relocate(block: &mut [u32], o: &Outline, old: u32, db: i64, ds: i64) {
    let n = o.band_count as usize;
    let len = block.len();
    let add_end = if o.band_sub == u32::MAX { len } else { (o.band_sub - old) as usize };
    let mut fix = |headers: u32, end: usize| {
        let h = (headers - old) as usize;
        for i in 0..n {
            block[h + 2 * i] = (block[h + 2 * i] as i64 + db) as u32;
        }
        for w in &mut block[h + 2 * n..end] {
            *w = (*w as i64 + ds) as u32;
        }
    };
    fix(o.band_add, add_end);
    if o.band_sub != u32::MAX {
        fix(o.band_sub, len);
    }
}

const MAX_ZOOM: i8 = 8;

pub fn zoom_bucket(scale: f32) -> i8 {
    scale.max(1e-3).log2().ceil().clamp(-8.0, MAX_ZOOM as f32) as i8
}

pub fn tolerance(zoom: i8) -> f64 {
    0.2 / 2f64.powi(zoom as i32)
}

impl GeomCache {
    #[cfg(test)]
    pub fn with_limits(segs: usize, bands: usize) -> Self {
        GeomCache { limits: (segs, bands), ..Default::default() }
    }

    /// Starts build `frame`. A main build (`sweep`) past the arena limits
    /// evicts what no recent build used and compacts the rest; surface builds
    /// only add, as the main frame may still draw from the arenas as they are.
    pub fn begin_frame(&mut self, frame: u64, sweep: bool) {
        self.built_this_frame = 0;
        self.banded_this_frame = 0;
        if !sweep || (self.segs.len() <= self.limits.0 && self.bands.len() <= self.limits.1) {
            return;
        }
        if self.swept_at == (self.segs.len(), self.bands.len()) {
            return;
        }
        if !self.evict(frame) {
            self.swept_at = (self.segs.len(), self.bands.len());
            return;
        }
        self.compact();
    }

    /// The outline for `key`, building its segments with `build` (given the
    /// flattening tolerance) when no cached flattening serves. `exact`: lines
    /// only, built at the finest tolerance (kurbo leaves out a join that turns
    /// less than 2·tolerance/width), so one build serves every zoom. Otherwise
    /// a flattening up to `MAX_FINER` buckets finer serves too, so scaling down
    /// builds bands only.
    pub fn get_or_build(&mut self, key: GeomKey, exact: bool, frame: u64, build: impl FnOnce(f64) -> Option<Segments>) -> Option<Outline> {
        if let Some(b) = self.band_map.get_mut(&key) {
            b.last_used = frame;
            let (seg, outline) = (b.seg, b.outline);
            if let Some(s) = self.seg_map.get_mut(&seg) {
                s.last_used = frame;
            }
            return Some(outline);
        }
        let at = |zoom: i8| SegKey { source: key.source, style: key.style, zoom };
        let found = if exact {
            Some(at(EXACT)).filter(|k| self.seg_map.contains_key(k))
        } else {
            (0..=MAX_FINER).map(|d| at(key.zoom.saturating_add(d))).find(|k| self.seg_map.contains_key(k))
        };
        let seg_key = match found {
            Some(k) => k,
            None => {
                let s = build(tolerance(if exact { MAX_ZOOM } else { key.zoom }))?;
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
                let k = at(if exact { EXACT } else { key.zoom });
                let start = self.segs.len() as u32;
                self.segs.extend_from_slice(&s.add);
                self.segs.extend_from_slice(&s.sub);
                let e = SegEntry { start, add: s.add.len() as u32, sub: s.sub.len() as u32, even_odd: s.even_odd, bounds: b, last_used: frame };
                self.seg_map.insert(k, e);
                k
            }
        };
        let e = self.seg_map.get_mut(&seg_key).unwrap();
        e.last_used = frame;
        let e = *e;
        self.banded_this_frame += 1;
        let (start, na) = (e.start as usize, e.add as usize);
        let add = &self.segs[start..start + na];
        let sub = &self.segs[start + na..start + na + e.sub as usize];
        let b = e.bounds;
        let height = (b[3] - b[1]).max(1e-3);
        // Bands overlap by a little over one device pixel at this zoom bucket,
        // so every segment touching a pixel's footprint is in the pixel's band.
        let margin = 2.0 / 2f32.powi(key.zoom as i32);
        // A pixel loops over its band's segments, so aim at ~8 per band: a
        // full-screen outline of 10k segments under 32 bands cost ~80 ms at
        // 4K. Bands stay at least four margins tall, and the copies of
        // segments spanning several bands stay within 8× the segment count.
        let mut n = ((na / 8) as u32).clamp(1, 4096).min(((height / (4.0 * margin)) as u32).max(1));
        let mut spans = std::mem::take(&mut self.spans);
        while band_spans(add, b[1], height / n as f32, n, margin, &mut spans) > 8 * na + 64 && n > 1 {
            n /= 2;
        }
        let band_h = height / n as f32;
        let block = self.bands.len() as u32;
        let band_add = push_bands(&mut self.bands, &spans, e.start, n);
        let band_sub = if sub.is_empty() {
            u32::MAX
        } else {
            band_spans(sub, b[1], band_h, n, margin, &mut spans);
            push_bands(&mut self.bands, &spans, e.start + e.add, n)
        };
        self.spans = spans;
        let outline = Outline { band_add, band_sub, band_count: n, y0: b[1], band_h, bounds: b, even_odd: e.even_odd };
        let words = self.bands.len() as u32 - block;
        self.band_map.insert(key, BandEntry { seg: seg_key, outline, start: block, words, last_used: frame });
        Some(outline)
    }

    /// Drops the least recently used outlines until the arenas are half their
    /// limits, sparing what the last `PROTECT_BUILDS` builds used. A dropped
    /// flattening takes its bands with it. False when nothing could go.
    fn evict(&mut self, frame: u64) -> bool {
        let stale_before = frame.saturating_sub(PROTECT_BUILDS);
        let mut live = self.segs.len();
        let mut stale: Vec<(u64, SegKey, usize)> = self
            .seg_map
            .iter()
            .filter(|(_, e)| e.last_used < stale_before)
            .map(|(k, e)| (e.last_used, *k, (e.add + e.sub) as usize))
            .collect();
        stale.sort_unstable_by_key(|s| s.0);
        let mut dropped = std::collections::HashSet::new();
        for (_, k, n) in stale {
            if live <= self.limits.0 / 2 {
                break;
            }
            dropped.insert(k);
            live -= n;
        }
        let before = self.band_map.len();
        self.band_map.retain(|_, b| !dropped.contains(&b.seg));
        let mut words: usize = self.band_map.values().map(|b| b.words as usize).sum();
        if words > self.limits.1 / 2 {
            let mut stale: Vec<(u64, GeomKey, usize)> = self
                .band_map
                .iter()
                .filter(|(_, b)| b.last_used < stale_before)
                .map(|(k, b)| (b.last_used, *k, b.words as usize))
                .collect();
            stale.sort_unstable_by_key(|s| s.0);
            for (_, k, n) in stale {
                if words <= self.limits.1 / 2 {
                    break;
                }
                self.band_map.remove(&k);
                words -= n;
            }
        }
        for k in &dropped {
            self.seg_map.remove(k);
        }
        !dropped.is_empty() || self.band_map.len() != before
    }

    /// Rewrites both arenas with only what the maps hold. Every outline moves,
    /// so the next upload is whole and `epoch` tells builders their records
    /// point into the old arenas.
    fn compact(&mut self) {
        let mut segs = Vec::with_capacity(self.seg_map.values().map(|e| (e.add + e.sub) as usize).sum());
        let mut moved: crate::fxhash::FxHashMap<SegKey, i64> = Default::default();
        for (k, e) in self.seg_map.iter_mut() {
            let at = segs.len() as u32;
            segs.extend_from_slice(&self.segs[e.start as usize..(e.start + e.add + e.sub) as usize]);
            moved.insert(*k, at as i64 - e.start as i64);
            e.start = at;
        }
        let mut bands = Vec::with_capacity(self.band_map.values().map(|b| b.words as usize).sum());
        for b in self.band_map.values_mut() {
            let at = bands.len();
            bands.extend_from_slice(&self.bands[b.start as usize..(b.start + b.words) as usize]);
            let db = at as i64 - b.start as i64;
            relocate(&mut bands[at..], &b.outline, b.start, db, moved[&b.seg]);
            b.start = at as u32;
            b.outline.band_add = (b.outline.band_add as i64 + db) as u32;
            if b.outline.band_sub != u32::MAX {
                b.outline.band_sub = (b.outline.band_sub as i64 + db) as u32;
            }
        }
        self.segs = segs;
        self.bands = bands;
        self.uploaded_segs = 0;
        self.uploaded_bands = 0;
        self.reset = true;
        self.epoch += 1;
        self.swept_at = (0, 0);
    }
}

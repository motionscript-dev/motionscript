//! Turns the retained scene into one frame's program: a flat list of GPU
//! instances plus ops (draw runs, clip push/pop, layer begin/end) that the
//! executor in `gpu.rs` replays.
//!
//! Two passes over the tree:
//! 1. `measure` — world transforms top-down and device bounds bottom-up.
//! 2. `emit` — culls against the current clip/viewport rectangle, decides
//!    which groups need an offscreen layer, and appends instances.

use crate::paths::{
    build_path, compound_outline, kurbo_stroke, members_hash, push_segments, shape_path, stroke_outline, zoom_bucket, GeomCache, GeomKey, GeomSource, GeomStyle,
    Outline, Segments,
};
use crate::field::{outline_key, Field, FieldCache, FieldSource};
use crate::scene::*;
use ms_text::{block_shift, place_on_path, Align, Paragraph, ParagraphLayout, PlacedGlyph, Polyline, TextEngine};

pub const K_FILL_RRECT: u32 = 0;
pub const K_FILL_ELLIPSE: u32 = 1;
pub const K_STROKE_RRECT: u32 = 2;
pub const K_STROKE_ELLIPSE: u32 = 3;
pub const K_SHADOW_RRECT: u32 = 4;
pub const K_PATH: u32 = 5;
/// `Prim::info[0]` flag: the prim's transform is projective (`p` ≠ 0 0 1).
/// Lets affine fragments skip the perspective row entirely.
pub const PROJECTIVE: u32 = 0x100;

pub const BLEND_NORMAL: u8 = 0;
const BLEND_SCREEN: u8 = 2;
const BLEND_PLUS: u8 = 16;

/// Blend modes the fixed-function blender can do on premultiplied colour.
pub fn hardware_blend(mode: u8) -> Option<usize> {
    match mode {
        BLEND_NORMAL => Some(0),
        BLEND_PLUS => Some(1),
        BLEND_SCREEN => Some(2),
        _ => None,
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, Default, Debug)]
pub struct Prim {
    /// 2x2 part of the local→device transform: a b c d
    pub m: [f32; 4],
    /// e f (translation), opacity, stroke width
    pub t: [f32; 4],
    /// shape rectangle in local units: x0 y0 x1 y1
    pub rect: [f32; 4],
    /// corner radii tl tr br bl
    pub radii: [f32; 4],
    /// quad to rasterise in local units (shape + AA fringe + stroke/shadow reach)
    pub quad: [f32; 4],
    /// solid colour used when `info.y` is NONE (shadows)
    pub color: [f32; 4],
    /// kind, paint id, sigma bits (shadows), clip (index + 1 into
    /// `Frame::clips`, 0 = unclipped)
    pub info: [u32; 4],
    /// paths: band header offset, band count, flags (bit 0 even-odd),
    /// subtracted set's band offset (or NONE)
    pub ext: [u32; 4],
}
// Projective prims (flag `PROJECTIVE` in info.x) carry the transform's
// perspective row g h i in a slot their kind leaves unused, keeping the
// instance at 128 bytes (a 144-byte stride cost ~2% on a card-heavy frame):
// paths in `rect.xyz` (the shader never reads a path's rect), every other
// kind as f32 bits in `ext.xyz`. See `base_prim`, `path_fields`.

#[derive(Clone, Copy, Debug)]
pub enum Op {
    /// Instanced primitives; `image` is the texture their paint samples
    /// (`NONE` for none). Runs split where it changes.
    Prims { start: u32, count: u32, image: u32 },
    /// Draw a finished layer (see [`Layer`]) into this target.
    Composite(u32),
}

/// The ops drawn into one render target, with each op's device bounds so a
/// region can be replayed (backdrops for advanced blends).
#[derive(Default)]
pub struct TargetOps {
    pub ops: Vec<Op>,
    pub bounds: Vec<[f32; 4]>,
}

#[derive(Clone, Copy, Debug, Default)]
pub enum DevFilter {
    #[default]
    None,
    Blur { sigma: f32 },
    DropShadow { dx: f32, dy: f32, sigma: f32, color: [f32; 4] },
    /// Only the blurred, tinted, offset silhouette is composited (a shape's
    /// own drop shadow; the shape itself is drawn normally after it).
    Shadow { dx: f32, dy: f32, sigma: f32, color: [f32; 4] },
}

/// One effect step of a layer, in device units (see `scene::EffectSpec`).
#[derive(Clone, Debug)]
pub struct DevEffect {
    pub index: u32,
    pub flags: u32,
    pub aux: u32,
    pub blur: [f32; 3],
    pub params: Vec<f32>,
    /// Device px per logical px the step measures in (`u.scale`).
    pub scale: f32,
    /// Seconds the effect animates with (`u.time`): its node's elapsed time.
    pub time: f32,
    /// The node outline's distance field (index into `Frame::fields`) for
    /// effects that ask for it (flags bit 3), else `NONE`.
    pub field: u32,
    /// Where the field's texel (0,0) lands, device px.
    pub field_origin: [f32; 2],
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Layer {
    /// Integer device rectangle x0 y0 x1 y1.
    pub rect: [i32; 4],
    pub opacity: f32,
    pub blend: u8,
    pub filter: DevFilter,
    /// Index into `Frame::targets` holding the layer's content.
    pub target: u32,
    /// For advanced blends: the target it composites into and how many of that
    /// target's ops precede it (the backdrop to re-render).
    pub parent: u32,
    pub prefix: u32,
    /// A mask layer (same rect) and its mode (see `Scene::mask`).
    pub mask: Option<(u32, u8)>,
    /// Clip (index + 1) applied when the layer is composited; content inside
    /// the layer is not clipped by it.
    pub clip: u32,
    /// The layer's effect chain: a range of `Frame::effects`.
    pub effects: (u32, u32),
    /// The box effects measure against (device px: centre x, y, width,
    /// height).
    pub effect_box: [f32; 4],
    /// Device px to the node's own box (0–1, turning and scaling with it),
    /// as rows `[x, y, 1]·xyz`, each `w` the box's size in logical px.
    pub node_frame: [f32; 8],
    /// A backdrop-effect layer: its content is a replay of what `parent`
    /// holds beneath it (ops before `prefix`), run through its effects and
    /// composited through `clip` (the node's silhouette).
    pub backdrop: bool,
}

/// A clip region: the coverage of `prim`'s shape times its parent's, rendered
/// once per frame into the clip atlas over `rect` (device px).
#[derive(Clone, Copy, Debug)]
pub struct ClipInfo {
    pub prim: u32,
    /// Parent clip (index + 1), 0 for none.
    pub parent: u32,
    pub rect: [i32; 4],
}

#[derive(Default)]
pub struct Frame {
    pub prims: Vec<Prim>,
    /// Target 0 is the canvas; every layer adds one.
    pub targets: Vec<TargetOps>,
    pub layers: Vec<Layer>,
    pub clips: Vec<ClipInfo>,
    pub effects: Vec<DevEffect>,
    /// Distance fields the effects read (`DevEffect::field`).
    pub fields: Vec<std::sync::Arc<Field>>,
    /// Image id per paint, copied from the scene each frame.
    paint_images: Vec<u32>,
    /// User fill paints (by paint id), copied from the scene each frame.
    pub user_paints: Vec<Option<crate::scene::UserPaint>>,
    cur: usize,
    cur_rect: [f32; 4],
    /// Clip (index + 1) that new primitives get.
    cur_clip: u32,
    pub culled: u32,
    /// No prim run may grow across this point (target, op count): the start
    /// of a subtree whose ops are being recorded for reuse.
    seal: (usize, usize),
    /// This build, and the build whose prims `clean` is relative to (0 = none).
    pub build_id: u64,
    pub prev_build_id: u64,
    /// Prim ranges identical, index for index, to the previous build's: the
    /// executor only uploads the rest (see `Gpu::render_sized`).
    pub clean: Vec<[u32; 2]>,
    /// Prims replayed from recorded subtrees this build.
    pub reused: u32,
}

impl Frame {
    fn push(&mut self, op: Op) {
        let t = &mut self.targets[self.cur];
        t.ops.push(op);
        t.bounds.push(self.cur_rect);
    }

    pub fn op_count(&self) -> usize {
        self.targets.iter().map(|t| t.ops.len()).sum()
    }

    /// Opens a layer: subsequent ops go to its own target until `end_layer`.
    fn begin_layer(&mut self, mut layer: Layer) -> (u32, usize) {
        let idx = self.layers.len() as u32;
        layer.clip = self.cur_clip;
        self.cur_clip = 0;
        let target = self.targets.len();
        self.targets.push(TargetOps::default());
        layer.target = target as u32;
        layer.parent = self.cur as u32;
        layer.prefix = self.targets[self.cur].ops.len() as u32;
        self.layers.push(layer);
        let saved = self.cur;
        self.cur = target;
        (idx, saved)
    }

    /// Closes a layer that is not composited by itself (a mask).
    fn end_layer_detached(&mut self, idx: u32, saved: usize) {
        self.cur = saved;
        self.cur_clip = self.layers[idx as usize].clip;
    }

    fn end_layer(&mut self, idx: u32, saved: usize) {
        self.cur = saved;
        self.cur_clip = self.layers[idx as usize].clip;
        let r = self.layers[idx as usize].rect;
        self.cur_rect = [r[0] as f32, r[1] as f32, r[2] as f32, r[3] as f32];
        self.push(Op::Composite(idx));
    }
}

type Rect = [f32; 4];

fn empty_rect() -> Rect {
    [f32::MAX, f32::MAX, f32::MIN, f32::MIN]
}
fn is_empty(r: &Rect) -> bool {
    r[0] >= r[2] || r[1] >= r[3]
}
fn union(a: Rect, b: Rect) -> Rect {
    [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])]
}
fn intersect(a: Rect, b: Rect) -> Rect {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])]
}
fn outset(a: Rect, d: f32) -> Rect {
    [a[0] - d, a[1] - d, a[2] + d, a[3] + d]
}

/// Flags a non-path prim whose `base_prim` stashed a perspective row in
/// `ext` (paths are flagged by `path_fields`).
fn mark_projective(p: &mut Prim) {
    if p.info[0] & 0xff != K_PATH && p.ext[3] == EXT_ROW {
        p.info[0] |= PROJECTIVE;
    }
}

/// `ext.w` marker of a perspective row stashed by `base_prim`.
const EXT_ROW: u32 = 0x7072_6f6a;

/// A path prim's band fields from outline `o`, moving a stashed perspective
/// row from `ext` to `rect`.
fn path_fields(p: &mut Prim, o: &Outline) {
    let row = p.ext;
    p.ext = [o.band_add, o.band_count, o.even_odd as u32, o.band_sub];
    if row[3] == EXT_ROW {
        p.rect = [f32::from_bits(row[0]), f32::from_bits(row[1]), f32::from_bits(row[2]), 0.0];
        p.info[0] |= PROJECTIVE;
    } else {
        p.rect = o.bounds;
    }
}

fn is_affine(m: &[f32]) -> bool {
    m.len() < 9 || (m[6] == 0.0 && m[7] == 0.0 && m[8] == 1.0)
}

/// `p · c` (apply `c` first).
fn mul(p: &Xf, c: &Xf) -> Xf {
    if is_affine(c) && is_affine(p) {
        return [
            p[0] * c[0] + p[2] * c[1],
            p[1] * c[0] + p[3] * c[1],
            p[0] * c[2] + p[2] * c[3],
            p[1] * c[2] + p[3] * c[3],
            p[0] * c[4] + p[2] * c[5] + p[4],
            p[1] * c[4] + p[3] * c[5] + p[5],
            0.0,
            0.0,
            1.0,
        ];
    }
    // Rows of [a c e / b d f / g h i].
    let row = |m: &Xf, r: usize| -> [f32; 3] {
        match r {
            0 => [m[0], m[2], m[4]],
            1 => [m[1], m[3], m[5]],
            _ => [m[6], m[7], m[8]],
        }
    };
    let col = |m: &Xf, k: usize| -> [f32; 3] {
        match k {
            0 => [m[0], m[1], m[6]],
            1 => [m[2], m[3], m[7]],
            _ => [m[4], m[5], m[8]],
        }
    };
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let (r0, r1, r2) = (row(p, 0), row(p, 1), row(p, 2));
    let (c0, c1, c2) = (col(c, 0), col(c, 1), col(c, 2));
    [dot(r0, c0), dot(r1, c0), dot(r0, c1), dot(r1, c1), dot(r0, c2), dot(r1, c2), dot(r2, c0), dot(r2, c1), dot(r2, c2)]
}

/// An affine 2×3 (a member's transform) as an `Xf`.
fn lift(m: &[f32; 6]) -> Xf {
    [m[0], m[1], m[2], m[3], m[4], m[5], 0.0, 0.0, 1.0]
}

/// Below this `w` a point counts as at or behind the eye: projective
/// geometry is cut there (the GPU clips quads at w = 0 too).
const NEAR_W: f32 = 1e-3;

/// `r`'s corners as a polygon cut to w ≥ NEAR_W under `m`, in local units.
fn front_polygon(m: &[f32], r: Rect) -> ([[f32; 2]; 8], usize) {
    let w = |x: f32, y: f32| m[6] * x + m[7] * y + m[8] - NEAR_W;
    let sq = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    let mut out = [[0.0f32; 2]; 8];
    let mut n = 0;
    for k in 0..4 {
        let (a, b) = (sq[k], sq[(k + 1) % 4]);
        let (wa, wb) = (w(a[0], a[1]), w(b[0], b[1]));
        if wa >= 0.0 {
            out[n] = a;
            n += 1;
        }
        if (wa >= 0.0) != (wb >= 0.0) {
            let t = wa / (wa - wb);
            out[n] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            n += 1;
        }
    }
    (out, n)
}

/// Device bounds of local rect `r` under `m` (the part in front of the eye).
fn map_rect(m: &[f32], r: Rect) -> Rect {
    let mut out = empty_rect();
    if is_affine(m) {
        for (x, y) in [(r[0], r[1]), (r[2], r[1]), (r[0], r[3]), (r[2], r[3])] {
            let px = m[0] * x + m[2] * y + m[4];
            let py = m[1] * x + m[3] * y + m[5];
            out = union(out, [px, py, px, py]);
        }
        return out;
    }
    let (poly, n) = front_polygon(m, r);
    for &[x, y] in &poly[..n] {
        let w = (m[6] * x + m[7] * y + m[8]).max(NEAR_W);
        let px = (m[0] * x + m[2] * y + m[4]) / w;
        let py = (m[1] * x + m[3] * y + m[5]) / w;
        out = union(out, [px, py, px, py]);
    }
    out
}

/// Device px per local unit along local x and y at local point (x, y).
fn axis_scales(m: &[f32], x: f32, y: f32) -> (f32, f32) {
    if is_affine(m) {
        return ((m[0] * m[0] + m[1] * m[1]).sqrt(), (m[2] * m[2] + m[3] * m[3]).sqrt());
    }
    let w = (m[6] * x + m[7] * y + m[8]).max(NEAR_W);
    let dx = (m[0] * x + m[2] * y + m[4]) / w;
    let dy = (m[1] * x + m[3] * y + m[5]) / w;
    let jx = [(m[0] - dx * m[6]) / w, (m[1] - dy * m[6]) / w];
    let jy = [(m[2] - dx * m[7]) / w, (m[3] - dy * m[7]) / w];
    ((jx[0] * jx[0] + jx[1] * jx[1]).sqrt(), (jy[0] * jy[0] + jy[1] * jy[1]).sqrt())
}

/// Device px to node box uv, for `Layer::node_frame`: the inverse of `m` onto
/// the node's own box `eb` (local x, y, w, h), or the device box `dev` itself
/// where `m` is projective or flat and has no single inverse.
fn node_frame(m: &[f32], eb: [f32; 4], dev: Rect, sc: f32) -> [f32; 8] {
    let (a, b, c, d, e, f) = (m[0], m[1], m[2], m[3], m[4], m[5]);
    let det = a * d - b * c;
    let s = sc.max(1e-6);
    if is_affine(m) && eb[2] > 0.0 && eb[3] > 0.0 && det.abs() > 1e-12 {
        let (sx, sy) = axis_scales(m, 0.0, 0.0);
        let (w, h) = (eb[2] * det, eb[3] * det);
        return [
            d / w,
            -c / w,
            ((c * f - d * e) / det - eb[0]) / eb[2],
            eb[2] * sx / s,
            -b / h,
            a / h,
            ((b * e - a * f) / det - eb[1]) / eb[3],
            eb[3] * sy / s,
        ];
    }
    let (w, h) = (dev[2] - dev[0], dev[3] - dev[1]);
    if !(w > 0.0 && h > 0.0) {
        return [0.0; 8];
    }
    [1.0 / w, 0.0, -dev[0] / w, w / s, 0.0, 1.0 / h, -dev[1] / h, h / s]
}

/// Largest axis scale of a transform (device px per local unit), at the
/// local origin when projective.
fn max_scale(m: &[f32]) -> f32 {
    let (sx, sy) = axis_scales(m, 0.0, 0.0);
    sx.max(sy)
}
fn min_scale(m: &[f32]) -> f32 {
    let (sx, sy) = axis_scales(m, 0.0, 0.0);
    sx.min(sy).max(1e-6)
}

/// Largest axis scale where the device-space centre of `dev` maps from:
/// the scale a projective group's device-space filters measure at.
fn scale_near(m: &[f32], dev: Rect) -> f32 {
    if is_affine(m) || is_empty(&dev) {
        return max_scale(m);
    }
    let (px, py) = ((dev[0] + dev[2]) * 0.5, (dev[1] + dev[3]) * 0.5);
    // Inverse homography by adjugate: rows of H are [a c e / b d f / g h i].
    let (a, b, c, d, e, f, g, h, k) = (m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    let x = (d * k - f * h) * px + (e * h - c * k) * py + (c * f - e * d);
    let y = (f * g - b * k) * px + (a * k - e * g) * py + (e * b - a * f);
    let w = (b * h - d * g) * px + (c * g - a * h) * py + (a * d - c * b);
    if w.abs() < 1e-12 {
        return max_scale(m);
    }
    let (sx, sy) = axis_scales(m, x / w, y / w);
    sx.max(sy).min(1e3)
}

/// (largest, smallest) axis scale over local rect `r`: under perspective the
/// scale varies across a shape, and flattening tolerance wants the largest
/// while the AA fringe (in local units) wants the smallest. Capped, since
/// geometry reaching the eye plane magnifies without bound.
fn scale_range(m: &[f32], r: Rect) -> [f32; 2] {
    if is_affine(m) || is_empty(&r) {
        return [max_scale(m), min_scale(m)];
    }
    let (poly, n) = front_polygon(m, r);
    let (mut hi, mut lo) = (0.0f32, f32::MAX);
    for &[x, y] in &poly[..n] {
        let (sx, sy) = axis_scales(m, x, y);
        hi = hi.max(sx.max(sy));
        lo = lo.min(sx.min(sy));
    }
    if n == 0 {
        return [max_scale(m), min_scale(m)];
    }
    [hi.min(1e3), lo.clamp(1e-3, 1e3)]
}

fn clamp_radii(r: [f32; 4], w: f32, h: f32) -> [f32; 4] {
    let lim = (w.min(h) * 0.5).max(0.0);
    [r[0].clamp(0.0, lim), r[1].clamp(0.0, lim), r[2].clamp(0.0, lim), r[3].clamp(0.0, lim)]
}

/// A text node's laid-out paragraph, kept until its state changes.
struct TextCache {
    rev: u64,
    para: Paragraph,
    layout: ParagraphLayout,
    /// Paragraph space → block-local (`block_shift`).
    shift: (f32, f32),
    /// Text on a path: each glyph's placement (path space = node space).
    placed: Option<Vec<PlacedGlyph>>,
    /// The paragraph text as UTF-16, to find trailing whitespace.
    utf16: Vec<u16>,
    decorations: Vec<u8>,
    run_paints: Vec<u32>,
}

#[derive(Default)]
pub struct FrameBuilder {
    world: Vec<Xf>,
    /// Per node: (largest, smallest) device px per local unit over its
    /// local bounds (see `scale_range`).
    scales: Vec<[f32; 2]>,
    bounds: Vec<Rect>,
    effect_boxes: Vec<Rect>,
    frame_no: u64,
    /// Borrowed from the renderer for the duration of `build`.
    engine: TextEngine,
    texts: crate::fxhash::FxHashMap<u32, TextCache>,
    fields: FieldCache,
    /// Reuse of clean subtrees across main builds (off for surfaces).
    reuse: bool,
    /// Per node: what its last measure saw (see `measure`).
    meas: Vec<MeasRec>,
    /// Per group: its emitted output from an earlier build (see `SubCache`).
    subs: Vec<Option<Box<SubCache>>>,
    /// Inside a subtree being recorded (no nested records).
    recording: bool,
    main_builds: u64,
    /// Scene revision of the previous main build.
    last_rev: u64,
    /// `GeomCache::epoch` the recorded subtrees point into.
    geom_epoch: u64,
}

#[derive(Clone, Copy, Default)]
struct MeasRec {
    parent: Xf,
    /// Scene revision of the measure (0 = never / flushed).
    rev: u64,
    /// The subtree holds effects (never reused: their inputs aren't all
    /// tracked per node).
    fx: bool,
    /// Its parent transform differs from the previous measure (or there was
    /// none): it moved, so it is not worth recording.
    moved: bool,
}

/// What `emit` produced for a clean group: replayed, with its indices moved,
/// while the subtree and its inputs (world transform, cull, alpha) stay the
/// same. Recorded at the frontier between changed and unchanged parts of the
/// tree, so a frame where a few nodes move reuses everything else.
struct SubCache {
    /// Scene revision when recorded; valid while the subtree's revision and
    /// the flush revision are not newer.
    rev: u64,
    world: Xf,
    cull: Rect,
    alpha: f32,
    /// Frame state at entry when recorded: counts of prims, entry-target ops,
    /// targets, layers, clips, effects; the entry target and clip.
    base: [u32; 6],
    entry_target: u32,
    entry_clip: u32,
    prims: Vec<Prim>,
    ops: Vec<Op>,
    bounds: Vec<Rect>,
    targets: Vec<TargetOps>,
    layers: Vec<Layer>,
    clips: Vec<ClipInfo>,
    culled: u32,
    exit_rect: Rect,
    /// Where it was placed in the last main build: (build, prim start, clip
    /// shift, entry clip). Same as now → its prims are unchanged on the GPU.
    placed: (u64, u32, u32, u32),
}

struct Ctx {
    cull: Rect,
    alpha: f32,
}

impl FrameBuilder {
    pub fn build(&mut self, scene: &Scene, geom: &mut GeomCache, engine: &mut TextEngine, out: &mut Frame) {
        let Some(vp) = scene.viewport.as_ref() else {
            // Nothing to draw: clears `out`.
            self.build_inner(scene, geom, out, NONE, 0, 0, 1.0);
            return;
        };
        let (root, w, h, scale) = (scene.root, vp.width, vp.height, vp.scale);
        std::mem::swap(&mut self.engine, engine);
        self.reuse = true;
        self.main_builds += 1;
        out.prev_build_id = out.build_id;
        self.build_inner(scene, geom, out, root, w, h, scale);
        self.reuse = false;
        self.last_rev = scene.revision;
        std::mem::swap(&mut self.engine, engine);
    }

    /// Drops everything kept for reuse; the next build walks the whole tree.
    pub fn flush(&mut self) {
        self.meas.iter_mut().for_each(|m| m.rev = 0);
        self.subs.iter_mut().for_each(|c| *c = None);
    }

    /// A detached subtree (a `Tex.surface` source) as its own frame, `w`×`h`
    /// px at scale 1, origin top-left.
    #[allow(clippy::too_many_arguments)]
    pub fn build_subtree(&mut self, scene: &Scene, geom: &mut GeomCache, engine: &mut TextEngine, root: u32, w: u32, h: u32, out: &mut Frame) {
        std::mem::swap(&mut self.engine, engine);
        out.prev_build_id = 0;
        self.build_inner(scene, geom, out, root, w, h, 1.0);
        std::mem::swap(&mut self.engine, engine);
    }

    #[allow(clippy::too_many_arguments)]
    fn build_inner(&mut self, scene: &Scene, geom: &mut GeomCache, out: &mut Frame, root: u32, vw: u32, vh: u32, scale: f32) {
        self.frame_no += 1;
        out.prims.clear();
        out.targets.clear();
        out.targets.push(TargetOps::default());
        out.cur = 0;
        out.clips.clear();
        out.effects.clear();
        out.fields.clear();
        out.cur_clip = 0;
        out.paint_images = scene.paints.images();
        out.user_paints = scene.paints.users();
        out.layers.clear();
        out.culled = 0;
        out.seal = (usize::MAX, 0);
        out.build_id = self.frame_no;
        out.clean.clear();
        out.reused = 0;
        self.recording = false;
        geom.begin_frame();
        // A geometry arena reset (here or in a surface build since) moves
        // every outline: recorded prims point into the old arena.
        if geom.epoch != self.geom_epoch {
            self.geom_epoch = geom.epoch;
            self.flush();
        }
        if root == NONE || root as usize >= scene.len() {
            return;
        }
        let n = scene.len();
        self.world.resize(n, IDENTITY);
        self.scales.resize(n, [1.0, 1.0]);
        self.bounds.resize(n, empty_rect());
        self.effect_boxes.resize(n, empty_rect());
        self.meas.resize(n, MeasRec::default());
        self.subs.resize_with(n, || None);
        let root_m = [scale, 0.0, 0.0, scale, 0.0, 0.0, 0.0, 0.0, 1.0];
        self.measure(scene, root, &root_m);
        let screen = [0.0, 0.0, vw as f32, vh as f32];
        let mut ctx = Ctx { cull: screen, alpha: 1.0 };
        self.emit(scene, geom, out, root, &mut ctx);
    }

    /// Lays out a text node (cached by its state revision).
    fn text_layout(&mut self, s: &Scene, id: u32) -> Option<&TextCache> {
        let node = s.text.get(id as usize)?.as_ref()?;
        let path = (node.path != NONE).then(|| s.paths.get(node.path)).flatten();
        // A path that changed (new version) must re-place the glyphs.
        let rev = node.rev ^ path.map(|p| (p.version as u64) << 40).unwrap_or(0);
        let stale = self.texts.get(&id).is_none_or(|c| c.rev != rev);
        if stale {
            let state = &node.state;
            let (para, layout, shift, placed) = match path {
                Some(pd) => {
                    // Text on a path: one unwrapped, left-aligned line
                    // (newlines as spaces), placed along the path per `align`.
                    let mut para = self.engine.paragraph(state, state.runs.first().map(|r| r.style.size).unwrap_or(16.0), f32::INFINITY);
                    for r in &mut para.runs {
                        r.text = r.text.replace('\n', " ");
                    }
                    para.align = Align::Left;
                    para.max_width = 0.0;
                    para.box_width = 0.0;
                    let layout = self.engine.layout(&para);
                    let mut contours: Vec<Vec<[f32; 2]>> = Vec::new();
                    kurbo::flatten(pd.path.iter(), 0.1, |el| match el {
                        kurbo::PathEl::MoveTo(p) => contours.push(vec![[p.x as f32, p.y as f32]]),
                        kurbo::PathEl::LineTo(p) => {
                            if let Some(c) = contours.last_mut() {
                                c.push([p.x as f32, p.y as f32]);
                            }
                        }
                        kurbo::PathEl::ClosePath => {
                            if let Some(c) = contours.last_mut() && let Some(&first) = c.first() {
                                c.push(first);
                            }
                        }
                        _ => {}
                    });
                    let placed = place_on_path(&layout, &Polyline::new(&contours), state.align);
                    (para, layout, (0.0, 0.0), Some(placed))
                }
                None => {
                    let para = self.engine.resolved_paragraph(state);
                    let layout = self.engine.layout(&para);
                    let shift = block_shift(&layout, state.height, state.vertical_align);
                    (para, layout, shift, None)
                }
            };
            let utf16 = para.text().encode_utf16().collect();
            self.texts.insert(id, TextCache { rev, para, layout, shift, placed, utf16, decorations: node.decorations.clone(), run_paints: node.run_paints.clone() });
        }
        self.texts.get(&id)
    }

    /// Block-local bounds of a text node's line boxes, padded for glyph
    /// overhang (italics, accents above the line box).
    fn text_bounds(&mut self, s: &Scene, id: u32) -> Rect {
        let Some(t) = self.text_layout(s, id) else { return empty_rect() };
        let (sx, sy) = t.shift;
        let size = t.para.runs.iter().map(|r| r.style.size).fold(0.0f32, f32::max);
        if let Some(placed) = &t.placed {
            let mut b = empty_rect();
            for g in placed {
                b = union(b, [g.x, g.y, g.x, g.y]);
            }
            return if is_empty(&b) && placed.is_empty() { empty_rect() } else { outset(b, size * 1.2) };
        }
        outset([sx, sy, sx + t.layout.layout_width, sy + t.layout.height], size * 0.3)
    }

    /// World transform and device bounds of node `id` and its subtree. A
    /// subtree unchanged since its last measure under the same parent
    /// transform keeps what that measure stored.
    fn measure(&mut self, s: &Scene, id: u32, parent: &Xf) -> Rect {
        let i = id as usize;
        let r = self.meas[i];
        if self.reuse && r.rev != 0 && s.sub_rev[i] <= r.rev && s.flush_rev <= r.rev && r.parent == *parent {
            self.meas[i].moved = false;
            return self.bounds[i];
        }
        let b = self.measure_node(s, id, parent);
        let fx = !s.effects[i].is_empty()
            || (s.kind[i] == Kind::Group && s.children[i].iter().any(|&c| (c as usize) < s.len() && self.meas[c as usize].fx));
        let moved = r.rev == 0 || r.parent != *parent;
        self.meas[i] = MeasRec { parent: *parent, rev: s.revision, fx, moved };
        b
    }

    fn measure_node(&mut self, s: &Scene, id: u32, parent: &Xf) -> Rect {
        let i = id as usize;
        let m = mul(parent, &s.transform[i]);
        self.world[i] = m;
        self.scales[i] = [max_scale(&m), min_scale(&m)];
        let b = match s.kind[i] {
            Kind::Free => empty_rect(),
            Kind::Group => {
                let mut b = empty_rect();
                for k in 0..s.children[i].len() {
                    let c = s.children[i][k];
                    if (c as usize) < s.len() {
                        b = union(b, self.measure(s, c, &m));
                    }
                }
                let clip = s.clip[i];
                if clip.enabled {
                    b = intersect(b, map_rect(&m, clip.rect));
                }
                match s.filter[i] {
                    Filter::None => {}
                    Filter::Blur { sigma } => b = outset(b, 3.0 * sigma * max_scale(&m)),
                    Filter::DropShadow { dx, dy, sigma, .. } => {
                        let sc = max_scale(&m);
                        let sh = outset(b, 3.0 * sigma * sc);
                        let off = map_rect(&m, [dx, dy, dx, dy]);
                        let org = map_rect(&m, [0.0, 0.0, 0.0, 0.0]);
                        let (ox, oy) = (off[0] - org[0], off[1] - org[1]);
                        b = union(b, [sh[0] + ox, sh[1] + oy, sh[2] + ox, sh[3] + oy]);
                    }
                }
                b
            }
            Kind::Rect | Kind::Ellipse => {
                let [w, h] = s.size[i];
                let mut local = [0.0, 0.0, w, h];
                let st = &s.stroke[i];
                if st.paint != NONE {
                    local = outset(local, st.width * 0.5);
                }
                for sh in &s.shadows[i] {
                    let r = outset([sh.dx, sh.dy, w + sh.dx, h + sh.dy], sh.spread + 3.0 * sh.sigma);
                    local = union(local, r);
                }
                self.leaf_device(i, &m, local)
            }
            Kind::Text => {
                let mut local = self.text_bounds(s, id);
                let st = &s.stroke[i];
                if st.paint != NONE {
                    local = outset(local, st.width * 0.5 * st.miter.max(1.0).min(4.0));
                }
                let body = local;
                for sh in &s.shadows[i] {
                    let r = body;
                    local = union(local, outset([r[0] + sh.dx, r[1] + sh.dy, r[2] + sh.dx, r[3] + sh.dy], sh.spread.max(0.0) + 3.0 * sh.sigma));
                }
                if is_empty(&local) { empty_rect() } else { self.leaf_device(i, &m, local) }
            }
            Kind::Compound => {
                let mut local = empty_rect();
                for mb in &s.members[i] {
                    if !mb.adds_area() {
                        continue;
                    }
                    let r = match mb.kind {
                        3 => s.paths.get(mb.path).map(|p| p.bounds).unwrap_or(empty_rect()),
                        _ => [0.0, 0.0, mb.size[0], mb.size[1]],
                    };
                    local = union(local, map_rect(&lift(&mb.transform), r));
                }
                let st = &s.stroke[i];
                if st.paint != NONE {
                    local = outset(local, st.width * 0.5 * st.miter.max(1.0).min(4.0));
                }
                for sh in &s.shadows[i] {
                    let r = local;
                    local = union(local, outset([r[0] + sh.dx, r[1] + sh.dy, r[2] + sh.dx, r[3] + sh.dy], sh.spread.max(0.0) + 3.0 * sh.sigma));
                }
                if is_empty(&local) { empty_rect() } else { self.leaf_device(i, &m, local) }
            }
            Kind::Path => match s.paths.get(s.path[i]) {
                Some(p) => {
                    let st = &s.stroke[i];
                    let reach =
                        if st.paint != NONE { st.width * 0.5 * st.miter.max(1.0).min(4.0) } else { 0.0 };
                    let mut local = outset(p.bounds, reach);
                    for sh in &s.shadows[i] {
                        let r = p.bounds;
                        local = union(local, outset([r[0] + sh.dx, r[1] + sh.dy, r[2] + sh.dx, r[3] + sh.dy], sh.spread.max(0.0) + 3.0 * sh.sigma));
                    }
                    self.leaf_device(i, &m, local)
                }
                None => empty_rect(),
            },
        };
        let b = if s.effects[i].is_empty() {
            b
        } else {
            let eb = s.effect_box[i];
            let boxed = if eb[2] > 0.0 && eb[3] > 0.0 { map_rect(&m, [eb[0], eb[1], eb[0] + eb[2], eb[1] + eb[3]]) } else { b };
            self.effect_boxes[i] = boxed;
            let reach: f32 = s.effects[i].iter().map(|e| e.reach.max(0.0)).sum();
            if is_empty(&b) { b } else { outset(b, reach * max_scale(&m)) }
        };
        self.bounds[i] = b;
        b
    }

    /// Device bounds of leaf `i`'s local bounds, recording its scale range.
    fn leaf_device(&mut self, i: usize, m: &Xf, local: Rect) -> Rect {
        if !is_affine(m) {
            self.scales[i] = scale_range(m, local);
        }
        outset(map_rect(m, local), 1.0)
    }

    /// Attaches node `i`'s effect chain to layer `l` (device units).
    /// The node's effects that `pick` selects, in order, as layer `l`'s chain.
    fn attach_effects(&self, s: &Scene, out: &mut Frame, l: u32, i: usize, m: &Xf, pick: impl Fn(usize, &EffectSpec) -> bool) {
        let n = s.effects[i].iter().enumerate().filter(|(k, e)| pick(*k, e)).count() as u32;
        if n == 0 {
            return;
        }
        let sc = max_scale(m);
        let start = out.effects.len() as u32;
        for (_, e) in s.effects[i].iter().enumerate().filter(|(k, e)| pick(*k, e)) {
            out.effects.push(DevEffect {
                scale: sc,
                time: s.effect_time[i],
                index: e.index,
                flags: e.flags,
                aux: e.aux,
                blur: [e.blur[0] * sc, e.blur[1] * sc, e.blur[2]],
                params: e.params.clone(),
                field: NONE,
                field_origin: [0.0; 2],
            });
        }
        let b = self.effect_boxes[i];
        let layer = &mut out.layers[l as usize];
        layer.effects = (start, n);
        layer.effect_box = [(b[0] + b[2]) * 0.5, (b[1] + b[3]) * 0.5, b[2] - b[0], b[3] - b[1]];
        layer.node_frame = node_frame(m, s.effect_box[i], b, sc);
    }

    fn push_prim(out: &mut Frame, mut p: Prim) {
        mark_projective(&mut p);
        let idx = out.prims.len() as u32;
        p.info[3] = out.cur_clip;
        let image = if p.info[1] == NONE { NONE } else { out.paint_images.get(p.info[1] as usize).copied().unwrap_or(NONE) };
        out.prims.push(p);
        let rect = out.cur_rect;
        let sealed = out.seal == (out.cur, out.targets[out.cur].ops.len());
        let t = &mut out.targets[out.cur];
        if let Some(Op::Prims { start, count, image: im }) = t.ops.last_mut()
            && *start + *count == idx
            && *im == image
            && !sealed
        {
            *count += 1;
            let b = t.bounds.last_mut().unwrap();
            *b = union(*b, rect);
            return;
        }
        out.push(Op::Prims { start: idx, count: 1, image });
    }

    fn base_prim(m: &Xf, opacity: f32) -> Prim {
        let mut p = Prim { m: [m[0], m[1], m[2], m[3]], t: [m[4], m[5], opacity, 0.0], ..Default::default() };
        if !is_affine(m) {
            p.ext = [m[6].to_bits(), m[7].to_bits(), m[8].to_bits(), EXT_ROW];
        }
        p
    }

    fn emit(&mut self, s: &Scene, geom: &mut GeomCache, out: &mut Frame, id: u32, ctx: &mut Ctx) {
        let i = id as usize;
        let b = self.bounds[i];
        if is_empty(&intersect(b, ctx.cull)) {
            out.culled += 1;
            return;
        }
        let m = self.world[i];
        let opacity = s.opacity[i];
        if opacity <= 0.0 {
            return;
        }
        match s.kind[i] {
            Kind::Free => {}
            Kind::Group => {
                if s.effects[i].iter().any(is_backdrop) {
                    self.emit_backdrop(s, geom, out, id, &m, ctx.cull);
                }
                if !self.reuse || self.recording || self.meas[i].fx {
                    self.emit_group(s, geom, out, id, ctx, m, opacity);
                    return;
                }
                let clean = s.sub_rev[i] <= self.last_rev && s.flush_rev <= self.last_rev && !self.meas[i].moved;
                if !clean {
                    // Changed or moved now: likely to again, so emit it plainly
                    // (its unchanged parts record themselves further down).
                    self.subs[i] = None;
                    self.emit_group(s, geom, out, id, ctx, m, opacity);
                    return;
                }
                if let Some(c) = self.subs[i].take() {
                    if c.rev >= s.sub_rev[i] && c.rev >= s.flush_rev && c.world == m && c.cull == ctx.cull && c.alpha == ctx.alpha {
                        let mut c = c;
                        self.replay_sub(out, &mut c);
                        self.subs[i] = Some(c);
                        return;
                    }
                }
                self.record_sub(s, geom, out, id, ctx, m, opacity);
            }
            Kind::Rect | Kind::Ellipse | Kind::Path | Kind::Compound | Kind::Text => {
                let blend = s.blend[i];
                let alpha = ctx.alpha * opacity;
                if s.effects[i].iter().any(is_backdrop) {
                    self.emit_backdrop(s, geom, out, id, &m, ctx.cull);
                }
                let foreground = s.effects[i].iter().any(|e| !is_backdrop(e));
                out.cur_rect = intersect(b, ctx.cull);
                if blend == BLEND_NORMAL && !foreground {
                    self.emit_shadow_layers(s, geom, out, id, &m, alpha, ctx.cull);
                    out.cur_rect = intersect(b, ctx.cull);
                    self.emit_leaf(s, geom, out, id, &m, alpha);
                } else {
                    // A blend mode applies to the shape as a unit (shadow, fill and
                    // stroke together), so it is isolated in a layer that the
                    // compositor blends against the backdrop.
                    let reach: f32 = s.effects[i].iter().filter(|e| !is_backdrop(e)).map(|e| e.reach.max(0.0)).sum::<f32>() * max_scale(&m);
                    let r = intersect(b, outset(ctx.cull, reach));
                    let (layer, saved) = out.begin_layer(Layer {
                        rect: [r[0].floor() as i32, r[1].floor() as i32, r[2].ceil() as i32, r[3].ceil() as i32],
                        opacity: 1.0,
                        blend,
                        filter: DevFilter::None,
                        target: 0,
                        parent: 0,
                        prefix: 0,
                        mask: None,
                        clip: 0,
                        ..Default::default()
                    });
                    self.attach_effects(s, out, layer, i, &m, |_, e| !is_backdrop(e));
                    self.emit_shadow_layers(s, geom, out, id, &m, alpha, r);
                    out.cur_rect = r;
                    self.emit_leaf(s, geom, out, id, &m, alpha);
                    out.end_layer(layer, saved);
                }
            }
        }
    }

    /// Emits group `id` and keeps what it produced for later builds.
    #[allow(clippy::too_many_arguments)]
    fn record_sub(&mut self, s: &Scene, geom: &mut GeomCache, out: &mut Frame, id: u32, ctx: &mut Ctx, m: Xf, opacity: f32) {
        let et = out.cur;
        let base = [
            out.prims.len() as u32,
            out.targets[et].ops.len() as u32,
            out.targets.len() as u32,
            out.layers.len() as u32,
            out.clips.len() as u32,
            out.effects.len() as u32,
        ];
        let (entry_clip, culled0, seal0) = (out.cur_clip, out.culled, out.seal);
        let (cull, alpha) = (ctx.cull, ctx.alpha);
        out.seal = (et, base[1] as usize);
        self.recording = true;
        self.emit_group(s, geom, out, id, ctx, m, opacity);
        self.recording = false;
        out.seal = seal0;
        // Only what the relocation in `replay_sub` understands is kept.
        let ok = out.effects.len() as u32 == base[5]
            && out.cur == et
            && out.cur_clip == entry_clip
            && out.prims[base[0] as usize..].iter().all(|p| p.info[3] == 0 || p.info[3] == entry_clip || p.info[3] > base[4]);
        if ok {
            let t = &out.targets[et];
            let c = SubCache {
                rev: s.revision,
                world: m,
                cull,
                alpha,
                base,
                entry_target: et as u32,
                entry_clip,
                prims: out.prims[base[0] as usize..].to_vec(),
                ops: t.ops[base[1] as usize..].to_vec(),
                bounds: t.bounds[base[1] as usize..].to_vec(),
                targets: out.targets[base[2] as usize..].iter().map(|t| TargetOps { ops: t.ops.clone(), bounds: t.bounds.clone() }).collect(),
                layers: out.layers[base[3] as usize..].to_vec(),
                clips: out.clips[base[4] as usize..].to_vec(),
                culled: out.culled - culled0,
                exit_rect: out.cur_rect,
                placed: (self.main_builds, base[0], 0, entry_clip),
            };
            self.subs[id as usize] = Some(Box::new(c));
        }
        Self::merge_first_run(out, et, base[1] as usize);
    }

    /// Appends a recorded subtree's output, its indices moved to where it
    /// lands in this frame.
    fn replay_sub(&mut self, out: &mut Frame, c: &mut SubCache) {
        let et = out.cur;
        let p0 = out.prims.len() as u32;
        let o0 = out.targets[et].ops.len() as u32;
        let (dp, dt, dl, dc, de) = (
            p0.wrapping_sub(c.base[0]),
            (out.targets.len() as u32).wrapping_sub(c.base[2]),
            (out.layers.len() as u32).wrapping_sub(c.base[3]),
            (out.clips.len() as u32).wrapping_sub(c.base[4]),
            (out.effects.len() as u32).wrapping_sub(c.base[5]),
        );
        let (old_clip, new_clip, clip_base) = (c.entry_clip, out.cur_clip, c.base[4]);
        let map_clip = move |k: u32| {
            if k == 0 {
                0
            } else if k > clip_base {
                k.wrapping_add(dc)
            } else {
                debug_assert_eq!(k, old_clip);
                new_clip
            }
        };
        let start = out.prims.len();
        out.prims.extend_from_slice(&c.prims);
        if dc != 0 || old_clip != new_clip {
            for p in &mut out.prims[start..] {
                p.info[3] = map_clip(p.info[3]);
            }
        }
        // Unchanged since the last build's placement: its prims are already
        // on the GPU at these indices.
        let placed = (self.main_builds, p0, dc, new_clip);
        if c.placed == (self.main_builds - 1, p0, dc, new_clip) && !c.prims.is_empty() {
            let end = p0 + c.prims.len() as u32;
            match out.clean.last_mut() {
                Some(r) if r[1] == p0 => r[1] = end,
                _ => out.clean.push([p0, end]),
            }
        }
        c.placed = placed;
        let (old_et, base_ops) = (c.entry_target, c.base[1]);
        let reloc_op = |op: &Op| match *op {
            Op::Prims { start, count, image } => Op::Prims { start: start.wrapping_add(dp), count, image },
            Op::Composite(l) => Op::Composite(l.wrapping_add(dl)),
        };
        {
            let t = &mut out.targets[et];
            t.ops.extend(c.ops.iter().map(reloc_op));
            t.bounds.extend_from_slice(&c.bounds);
        }
        for t in &c.targets {
            out.targets.push(TargetOps { ops: t.ops.iter().map(reloc_op).collect(), bounds: t.bounds.clone() });
        }
        for l in &c.layers {
            let mut l = *l;
            l.target = l.target.wrapping_add(dt);
            if l.parent == old_et {
                l.parent = et as u32;
                l.prefix = l.prefix.wrapping_sub(base_ops).wrapping_add(o0);
            } else {
                l.parent = l.parent.wrapping_add(dt);
            }
            l.mask = l.mask.map(|(m, mode)| (m.wrapping_add(dl), mode));
            l.clip = map_clip(l.clip);
            if l.effects.1 != 0 {
                l.effects.0 = l.effects.0.wrapping_add(de);
            }
            out.layers.push(l);
        }
        for k in &c.clips {
            out.clips.push(ClipInfo { prim: k.prim.wrapping_add(dp), parent: map_clip(k.parent), rect: k.rect });
        }
        out.culled += c.culled;
        out.reused += c.prims.len() as u32;
        out.cur_rect = c.exit_rect;
        Self::merge_first_run(out, et, o0 as usize);
    }

    /// Joins the first prim run a subtree appended at op `k` of target `t`
    /// to the run before it, as `push_prim` would have without the seal.
    fn merge_first_run(out: &mut Frame, t: usize, k: usize) {
        let ops = &mut out.targets[t];
        if k == 0 || k >= ops.ops.len() {
            return;
        }
        if let (Op::Prims { start: s0, count: c0, image: i0 }, Op::Prims { start: s1, count: c1, image: i1 }) = (ops.ops[k - 1], ops.ops[k])
            && s0 + c0 == s1
            && i0 == i1
        {
            ops.ops[k - 1] = Op::Prims { start: s0, count: c0 + c1, image: i0 };
            ops.bounds[k - 1] = union(ops.bounds[k - 1], ops.bounds[k]);
            ops.ops.remove(k);
            ops.bounds.remove(k);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit_group(
        &mut self,
        s: &Scene,
        geom: &mut GeomCache,
        out: &mut Frame,
        id: u32,
        ctx: &mut Ctx,
        m: Xf,
        opacity: f32,
    ) {
        let i = id as usize;
        let blend = s.blend[i];
        let filter = s.filter[i];
        let kids = &s.children[i];

        // Opacity folds into the child when exactly one paint would be drawn.
        let foldable = opacity < 1.0
            && s.effects[i].is_empty()
            && kids.len() == 1
            && matches!(filter, Filter::None)
            && blend == BLEND_NORMAL
            && {
                let c = kids[0] as usize;
                c < s.len()
                    && matches!(s.kind[c], Kind::Rect | Kind::Ellipse | Kind::Path | Kind::Compound | Kind::Text)
                    && s.shadows[c].is_empty()
                    && ((s.fill[c] != NONE) as u8 + (s.stroke[c].paint != NONE) as u8) <= 1
            };
        let masked = s.mask[i] != 0 && !kids.is_empty();
        let has_effects = s.effects[i].iter().any(|e| !is_backdrop(e));
        let needs_layer = (opacity < 1.0 && !foldable)
            || blend != BLEND_NORMAL
            || !matches!(filter, Filter::None)
            || masked
            || has_effects;

        let saved_cull = ctx.cull;
        let saved_alpha = ctx.alpha;
        let saved_clip = out.cur_clip;
        let mut layer_idx: Option<(u32, usize)> = None;

        if needs_layer {
            let sc = scale_near(&m, self.bounds[i]);
            let (dev_filter, reach) = match filter {
                Filter::None => (DevFilter::None, 0.0),
                Filter::Blur { sigma } => (DevFilter::Blur { sigma: sigma * sc }, 3.0 * sigma * sc),
                Filter::DropShadow { dx, dy, sigma, color } => {
                    let off = [m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy];
                    let reach = 3.0 * sigma * sc + off[0].abs().max(off[1].abs());
                    (DevFilter::DropShadow { dx: off[0], dy: off[1], sigma: sigma * sc, color }, reach)
                }
            };
            // Content just outside the visible area still bleeds in through a
            // blur, so the layer (and what is drawn into it) reaches past the cull.
            let effect_reach: f32 = s.effects[i].iter().map(|e| e.reach.max(0.0)).sum::<f32>() * sc;
            let content_cull = outset(ctx.cull, reach + effect_reach);
            let r = intersect(self.bounds[i], content_cull);
            if is_empty(&r) {
                return;
            }
            let rect = [r[0].floor() as i32, r[1].floor() as i32, r[2].ceil() as i32, r[3].ceil() as i32];
            layer_idx = Some(out.begin_layer(Layer {
                rect,
                opacity: opacity * ctx.alpha,
                blend,
                filter: dev_filter,
                target: 0,
                parent: 0,
                prefix: 0,
                mask: None,
                clip: 0,
                ..Default::default()
            }));
            if let Some((l, _)) = layer_idx {
                self.attach_effects(s, out, l, i, &m, |_, e| !is_backdrop(e));
            }
            ctx.cull = r;
            ctx.alpha = 1.0;
        } else if foldable {
            ctx.alpha *= opacity;
        }

        // Masks: the first child is the mask, rendered into its own layer of
        // the same rect and multiplied in when the content layer composites.
        // With a filter, the mask applies inside (to the content) and the
        // filter to the masked result, as nested layers would.
        let mut inner_idx: Option<(u32, usize)> = None;
        if masked && let Some((outer, _)) = layer_idx {
            let rect = out.layers[outer as usize].rect;
            let target_layer = if matches!(filter, Filter::None) {
                outer
            } else {
                let li = out.begin_layer(Layer {
                    rect,
                    opacity: 1.0,
                    blend: BLEND_NORMAL,
                    filter: DevFilter::None,
                    target: 0,
                    parent: 0,
                    prefix: 0,
                    mask: None,
                    clip: 0,
                    ..Default::default()
                });
                inner_idx = Some(li);
                li.0
            };
            let (mi, saved) = out.begin_layer(Layer {
                rect,
                opacity: 1.0,
                blend: BLEND_NORMAL,
                filter: DevFilter::None,
                target: 0,
                parent: 0,
                prefix: 0,
                mask: None,
                clip: 0,
                ..Default::default()
            });
            let c = kids[0];
            if (c as usize) < s.len() {
                self.emit(s, geom, out, c, ctx);
            }
            out.end_layer_detached(mi, saved);
            out.layers[target_layer as usize].mask = Some((mi, s.mask[i]));
        }

        let clip = s.clip[i];
        let clip_path = if clip.enabled && clip.path != NONE {
            s.paths.get(clip.path).and_then(|pd| {
                let key = GeomKey {
                    source: GeomSource::Path { id: clip.path, version: pd.version },
                    style: GeomStyle::Fill { even_odd: clip.even_odd },
                    zoom: zoom_bucket(scale_range(&m, clip.rect)[0]),
                };
                geom.get_or_build(key, self.frame_no, |tol| {
                    let mut add = Vec::new();
                    push_segments(&pd.path, tol, false, &mut add);
                    Some(Segments { add, sub: Vec::new(), even_odd: clip.even_odd })
                })
            })
        } else {
            None
        };
        if clip.enabled && (clip.path == NONE || clip_path.is_some()) {
            let aa = 2.0 / scale_range(&m, clip.rect)[1];
            let mut p = Self::base_prim(&m, 1.0);
            match clip_path {
                Some(o) => {
                    p.info = [K_PATH, NONE, 0, 0];
                    path_fields(&mut p, &o);
                    p.radii = [0.0, 0.0, o.y0, o.band_h];
                    p.quad = outset(o.bounds, aa);
                }
                None => {
                    let [x0, y0, x1, y1] = clip.rect;
                    p.info = [K_FILL_RRECT, NONE, 0, 0];
                    p.rect = clip.rect;
                    p.radii = clamp_radii([clip.radius; 4], x1 - x0, y1 - y0);
                    p.quad = outset(clip.rect, aa);
                }
            }
            ctx.cull = intersect(ctx.cull, map_rect(&m, clip.rect));
            if is_empty(&ctx.cull) {
                // Nothing of the group is visible.
                ctx.cull = saved_cull;
                ctx.alpha = saved_alpha;
                out.cur_clip = saved_clip;
                if let Some((idx, saved)) = inner_idx {
                    out.end_layer(idx, saved);
                }
                if let Some((idx, saved)) = layer_idx {
                    out.end_layer(idx, saved);
                }
                return;
            }
            let c = ctx.cull;
            let inst = out.prims.len() as u32;
            mark_projective(&mut p);
            out.prims.push(p);
            out.clips.push(ClipInfo {
                prim: inst,
                parent: out.cur_clip,
                rect: [c[0].floor() as i32, c[1].floor() as i32, c[2].ceil() as i32, c[3].ceil() as i32],
            });
            out.cur_clip = out.clips.len() as u32;
        }

        let first = if masked && layer_idx.is_some() { 1 } else { 0 };
        for k in first..kids.len() {
            let c = kids[k];
            if (c as usize) < s.len() {
                self.emit(s, geom, out, c, ctx);
            }
        }

        out.cur_clip = saved_clip;
        if let Some((idx, saved)) = inner_idx {
            out.end_layer(idx, saved);
        }
        if let Some((idx, saved)) = layer_idx {
            out.end_layer(idx, saved);
        }
        ctx.cull = saved_cull;
        ctx.alpha = saved_alpha;
    }

    #[allow(clippy::too_many_arguments)]
    fn emit_leaf(
        &mut self,
        s: &Scene,
        geom: &mut GeomCache,
        out: &mut Frame,
        id: u32,
        m: &Xf,
        alpha: f32,
    ) {
        let i = id as usize;
        let [sc_max, sc_min] = self.scales[i];
        let aa = 2.0 / sc_min;
        let fill = s.fill[i];
        let st = s.stroke[i];
        let zoom = zoom_bucket(sc_max);
        match s.kind[i] {
            Kind::Rect | Kind::Ellipse => {
                let ellipse = s.kind[i] == Kind::Ellipse;
                let [w, h] = s.size[i];
                if w <= 0.0 || h <= 0.0 {
                    return;
                }
                let radii = if ellipse { [0.0; 4] } else { clamp_radii(s.radii[i], w, h) };
                for sh in s.shadows[i].iter().filter(|_| !needs_shadow_layer(s, i)) {
                    let rect = [sh.dx - sh.spread, sh.dy - sh.spread, w + sh.dx + sh.spread, h + sh.dy + sh.spread];
                    let base = if ellipse { [w.min(h) * 0.5; 4] } else { radii };
                    let r = base.map(|r| if r > 0.0 { (r + sh.spread).max(0.0) } else { 0.0 });
                    let mut p = Self::base_prim(m, alpha);
                    p.info = [K_SHADOW_RRECT, NONE, sh.sigma.to_bits(), 0];
                    p.rect = rect;
                    p.radii = clamp_radii(r, rect[2] - rect[0], rect[3] - rect[1]);
                    p.quad = outset(rect, 3.0 * sh.sigma + aa);
                    p.color = sh.color;
                    Self::push_prim(out, p);
                }
                if fill != NONE {
                    let mut p = Self::base_prim(m, alpha);
                    p.info = [if ellipse { K_FILL_ELLIPSE } else { K_FILL_RRECT }, fill, 0, 0];
                    p.rect = [0.0, 0.0, w, h];
                    p.radii = radii;
                    p.quad = outset(p.rect, aa);
                    Self::push_prim(out, p);
                }
                if st.paint != NONE && st.width > 0.0 {
                    let dash = s.dashes.get(st.dash as usize).and_then(|d| d.as_ref());
                    if let Some(d) = dash {
                        // Dashes can't be an SDF: stroke the shape's outline.
                        let dims = [w.to_bits(), h.to_bits(), radii[0].to_bits(), radii[1].to_bits(), radii[2].to_bits(), radii[3].to_bits()];
                        let key = GeomKey { source: GeomSource::Shape { ellipse, dims }, style: stroke_style(&st), zoom };
                        let built = geom.get_or_build(key, self.frame_no, |tol| {
                            let outline = stroke_outline(&shape_path(ellipse, w, h, radii), &kurbo_stroke(&st, Some(d)), tol);
                            let mut add = Vec::new();
                            push_segments(&outline, tol, false, &mut add);
                            Some(Segments { add, sub: Vec::new(), even_odd: false })
                        });
                        if let Some(o) = built {
                            Self::push_outline(out, m, alpha, st.paint, o, aa);
                        }
                    } else {
                        let mut p = Self::base_prim(m, alpha);
                        p.t[3] = st.width;
                        p.info = [if ellipse { K_STROKE_ELLIPSE } else { K_STROKE_RRECT }, st.paint, 0, 0];
                        p.rect = [0.0, 0.0, w, h];
                        p.radii = radii;
                        p.quad = outset(p.rect, st.width * 0.5 + aa);
                        Self::push_prim(out, p);
                    }
                }
            }
            Kind::Text => {
                if fill != NONE {
                    self.push_glyphs(s, geom, out, id, m, alpha, fill, None, aa);
                }
                if st.paint != NONE && st.width > 0.0 {
                    self.push_glyphs(s, geom, out, id, m, alpha, st.paint, Some(st), aa);
                }
            }
            Kind::Compound => {
                let hash = members_hash(&s.members[i], &s.paths);
                let source = GeomSource::Compound { node: id, hash };
                let members = &s.members[i];
                if fill != NONE {
                    let key = GeomKey { source, style: GeomStyle::Fill { even_odd: false }, zoom };
                    let built = geom.get_or_build(key, self.frame_no, |tol| {
                        let outline = compound_outline(members, &s.paths, tol);
                        let mut add = Vec::new();
                        push_segments(&outline, tol, false, &mut add);
                        Some(Segments { add, sub: Vec::new(), even_odd: false })
                    });
                    if let Some(o) = built {
                        Self::push_outline(out, m, alpha, fill, o, aa);
                    }
                }
                if st.paint != NONE && st.width > 0.0 {
                    let dash = s.dashes.get(st.dash as usize).and_then(|d| d.as_ref());
                    let key = GeomKey { source, style: stroke_style(&st), zoom };
                    let built = geom.get_or_build(key, self.frame_no, |tol| {
                        let union = compound_outline(members, &s.paths, tol);
                        let outline = stroke_outline(&union, &kurbo_stroke(&st, dash), tol);
                        let mut add = Vec::new();
                        push_segments(&outline, tol, false, &mut add);
                        Some(Segments { add, sub: Vec::new(), even_odd: false })
                    });
                    if let Some(o) = built {
                        Self::push_outline(out, m, alpha, st.paint, o, aa);
                    }
                }
            }
            Kind::Path => {
                let pid = s.path[i];
                let Some(pd) = s.paths.get(pid) else { return };
                let source = GeomSource::Path { id: pid, version: pd.version };
                if fill != NONE {
                    let even_odd = s.fill_rule[i] == 1;
                    let key = GeomKey { source, style: GeomStyle::Fill { even_odd }, zoom };
                    let built = geom.get_or_build(key, self.frame_no, |tol| {
                        let mut add = Vec::new();
                        push_segments(&pd.path, tol, false, &mut add);
                        Some(Segments { add, sub: Vec::new(), even_odd })
                    });
                    if let Some(o) = built {
                        Self::push_outline(out, m, alpha, fill, o, aa);
                    }
                }
                if st.paint != NONE && st.width > 0.0 {
                    let dash = s.dashes.get(st.dash as usize).and_then(|d| d.as_ref());
                    let key = GeomKey { source, style: stroke_style(&st), zoom };
                    let built = geom.get_or_build(key, self.frame_no, |tol| {
                        let outline = stroke_outline(&pd.path, &kurbo_stroke(&st, dash), tol);
                        let mut add = Vec::new();
                        push_segments(&outline, tol, false, &mut add);
                        Some(Segments { add, sub: Vec::new(), even_odd: false })
                    });
                    if let Some(o) = built {
                        Self::push_outline(out, m, alpha, st.paint, o, aa);
                    }
                }
            }
            _ => {}
        }
    }

    /// The node's silhouette (engine `clipSelf`): the fill geometry of a
    /// rect, ellipse, path or compound, or a group's clip. Text and unclipped
    /// groups have none (the engine's text never records an outline). Returns
    /// the clip primitive, its local bounds and the outline it covers.
    fn silhouette(s: &Scene, geom: &mut GeomCache, frame_no: u64, i: usize, m: &Xf, sc: [f32; 2]) -> Option<(Prim, Rect, SilOutline)> {
        let aa = 2.0 / sc[1];
        let zoom = zoom_bucket(sc[0]);
        let mut p = Self::base_prim(m, 1.0);
        let path_prim = |p: &mut Prim, o: &Outline| {
            p.info = [K_PATH, NONE, 0, 0];
            path_fields(p, o);
            p.radii = [0.0, 0.0, o.y0, o.band_h];
            p.quad = outset(o.bounds, aa);
        };
        let rrect_prim = |p: &mut Prim, r: Rect, radii: [f32; 4], ellipse: bool| {
            p.info = [if ellipse { K_FILL_ELLIPSE } else { K_FILL_RRECT }, NONE, 0, 0];
            p.rect = r;
            p.radii = radii;
            p.quad = outset(r, aa);
        };
        match s.kind[i] {
            Kind::Rect | Kind::Ellipse => {
                let [w, h] = s.size[i];
                let ellipse = s.kind[i] == Kind::Ellipse;
                let radii = if ellipse { [0.0; 4] } else { clamp_radii(s.radii[i], w, h) };
                rrect_prim(&mut p, [0.0, 0.0, w, h], radii, ellipse);
                Some((p, [0.0, 0.0, w, h], SilOutline::Shape { ellipse, rect: [0.0, 0.0, w, h], radii }))
            }
            Kind::Path | Kind::Compound => {
                let local = leaf_local_bounds(s, i);
                if is_empty(&local) {
                    return None;
                }
                let source = match s.kind[i] {
                    Kind::Compound => GeomSource::Compound { node: i as u32, hash: members_hash(&s.members[i], &s.paths) },
                    _ => GeomSource::Path { id: s.path[i], version: s.paths.get(s.path[i])?.version },
                };
                let even_odd = s.kind[i] == Kind::Path && s.fill_rule[i] == 1;
                let key = GeomKey { source, style: GeomStyle::Fill { even_odd }, zoom };
                let o = geom.get_or_build(key, frame_no, |tol| {
                    let outline = match s.kind[i] {
                        Kind::Compound => compound_outline(&s.members[i], &s.paths, tol),
                        _ => s.paths.get(s.path[i])?.path.clone(),
                    };
                    let mut add = Vec::new();
                    push_segments(&outline, tol, false, &mut add);
                    Some(Segments { add, sub: Vec::new(), even_odd })
                })?;
                path_prim(&mut p, &o);
                let sil = match s.kind[i] {
                    Kind::Compound => SilOutline::Compound,
                    _ => SilOutline::Path { id: s.path[i], even_odd },
                };
                Some((p, local, sil))
            }
            Kind::Group => {
                let clip = s.clip[i];
                if !clip.enabled || is_empty(&clip.rect) {
                    return None;
                }
                if clip.path != NONE {
                    let pd = s.paths.get(clip.path)?;
                    let key = GeomKey {
                        source: GeomSource::Path { id: clip.path, version: pd.version },
                        style: GeomStyle::Fill { even_odd: clip.even_odd },
                        zoom,
                    };
                    let o = geom.get_or_build(key, frame_no, |tol| {
                        let mut add = Vec::new();
                        push_segments(&pd.path, tol, false, &mut add);
                        Some(Segments { add, sub: Vec::new(), even_odd: clip.even_odd })
                    })?;
                    path_prim(&mut p, &o);
                    Some((p, clip.rect, SilOutline::Path { id: clip.path, even_odd: clip.even_odd }))
                } else {
                    let [x0, y0, x1, y1] = clip.rect;
                    let radii = clamp_radii([clip.radius; 4], x1 - x0, y1 - y0);
                    rrect_prim(&mut p, clip.rect, radii, false);
                    Some((p, clip.rect, SilOutline::Shape { ellipse: false, rect: clip.rect, radii }))
                }
            }
            _ => None,
        }
    }

    /// Backdrop effects (engine `applyBackdropEffects`): what lies beneath
    /// the node — re-rendered, not read back — goes through the effects and is
    /// composited back through the node's silhouette, before the node itself
    /// draws. The layer reaches past the silhouette by the effects' reach so
    /// blurs and lenses sample real content. A node without a silhouette
    /// (text, an unclipped group) skips them, as the engine does.
    fn emit_backdrop(&mut self, s: &Scene, geom: &mut GeomCache, out: &mut Frame, id: u32, m: &Xf, cull: Rect) {
        let i = id as usize;
        let Some((mut p, local, sil)) = Self::silhouette(s, geom, self.frame_no, i, m, self.scales[i]) else {
            return;
        };
        let dev = outset(map_rect(m, local), 1.0);
        let visible = intersect(dev, cull);
        if is_empty(&visible) {
            return;
        }
        let reach: f32 = s.effects[i].iter().filter(|e| is_backdrop(e)).map(|e| e.reach.max(0.0)).sum::<f32>() * max_scale(m);
        let r = intersect(outset(dev, reach), outset(cull, reach));
        let saved_clip = out.cur_clip;
        let inst = out.prims.len() as u32;
        mark_projective(&mut p);
        out.prims.push(p);
        out.clips.push(ClipInfo {
            prim: inst,
            parent: out.cur_clip,
            rect: [visible[0].floor() as i32, visible[1].floor() as i32, visible[2].ceil() as i32, visible[3].ceil() as i32],
        });
        let clip = out.clips.len() as u32;
        // The engine composes the filters into one backdrop layer and leaves
        // it open while each shader effect snapshots the surface — which
        // doesn't hold that layer — and paints its lens over it. So with
        // filters present every lens reads the raw backdrop (each its own
        // layer from the same prefix); without, lenses chain in one layer.
        let fx = &s.effects[i];
        let has_filters = fx.iter().any(|e| is_backdrop(e) && e.flags & 4 != 0);
        let mut chains: Vec<Box<dyn Fn(usize, &EffectSpec) -> bool>> = Vec::new();
        if has_filters {
            chains.push(Box::new(|_, e| is_backdrop(e) && e.flags & 4 != 0));
            for k in (0..fx.len()).filter(|&k| is_backdrop(&fx[k]) && fx[k].flags & 4 == 0) {
                chains.push(Box::new(move |j, _| j == k));
            }
        } else {
            chains.push(Box::new(|_, e| is_backdrop(e)));
        }
        let rect = [r[0].floor() as i32, r[1].floor() as i32, r[2].ceil() as i32, r[3].ceil() as i32];
        let mut prefix = None;
        let mut field: Option<u32> = None;
        for pick in chains {
            out.cur_clip = clip;
            let (layer, saved) = out.begin_layer(Layer { rect, opacity: 1.0, blend: BLEND_NORMAL, backdrop: true, ..Default::default() });
            let l = &mut out.layers[layer as usize];
            l.prefix = *prefix.get_or_insert(l.prefix);
            let start = out.effects.len();
            self.attach_effects(s, out, layer, i, m, pick);
            // Effects that shape themselves to the node read its outline as a
            // distance field, built once per outline and linear transform.
            for k in start..out.effects.len() {
                if out.effects[k].flags & 8 == 0 {
                    continue;
                }
                let f = *field.get_or_insert_with(|| {
                    let key = sil.key(s, i);
                    match self.fields.get(key, m, || sil.source(s, i)) {
                        Some(f) => {
                            out.fields.push(f);
                            out.fields.len() as u32 - 1
                        }
                        None => NONE,
                    }
                });
                if f != NONE {
                    let o = out.fields[f as usize].origin;
                    out.effects[k].field = f;
                    out.effects[k].field_origin = [m[4] + o[0], m[5] + o[1]];
                }
            }
            out.cur_rect = visible;
            out.end_layer(layer, saved);
        }
        out.cur_clip = saved_clip;
    }

    /// Drop shadows that the closed-form rrect shadow can't draw (paths,
    /// compounds, non-circular ellipses): the silhouette — dilated by the
    /// spread — goes into a layer whose blurred, tinted, offset copy is
    /// composited before the shape.
    #[allow(clippy::too_many_arguments)]
    fn emit_shadow_layers(&mut self, s: &Scene, geom: &mut GeomCache, out: &mut Frame, id: u32, m: &Xf, alpha: f32, cull: Rect) {
        let i = id as usize;
        if s.shadows[i].is_empty() || !needs_shadow_layer(s, i) {
            return;
        }
        let local = if s.kind[i] == Kind::Text { self.text_bounds(s, id) } else { leaf_local_bounds(s, i) };
        if is_empty(&local) {
            return;
        }
        let [sc, sc_min] = self.scales[i];
        let aa = 2.0 / sc_min;
        let zoom = zoom_bucket(sc);
        for sh in s.shadows[i].clone() {
            let off = [m[0] * sh.dx + m[2] * sh.dy, m[1] * sh.dx + m[3] * sh.dy];
            let sigma = sh.sigma * sc;
            let spread = sh.spread.max(0.0);
            let shape = outset(map_rect(m, outset(local, spread)), 1.0 + 3.0 * sigma);
            // The part of the shadow that lands inside `cull`, in silhouette space.
            let shifted_cull = [cull[0] - off[0], cull[1] - off[1], cull[2] - off[0], cull[3] - off[1]];
            let r = intersect(shape, outset(shifted_cull, 3.0 * sigma));
            if is_empty(&r) {
                continue;
            }
            let rect = [r[0].floor() as i32, r[1].floor() as i32, r[2].ceil() as i32, r[3].ceil() as i32];
            let (li, saved) = out.begin_layer(Layer {
                rect,
                opacity: alpha,
                blend: BLEND_NORMAL,
                filter: DevFilter::Shadow { dx: off[0], dy: off[1], sigma, color: sh.color },
                target: 0,
                parent: 0,
                prefix: 0,
                mask: None,
                clip: 0,
                ..Default::default()
            });
            out.cur_rect = r;
            if s.kind[i] == Kind::Text {
                self.push_glyphs(s, geom, out, id, m, 1.0, NONE, None, aa);
                if spread > 0.0 {
                    let st = Stroke { paint: NONE, width: 2.0 * spread, join: 1, cap: 1, miter: 4.0, dash: NONE };
                    self.push_glyphs(s, geom, out, id, m, 1.0, NONE, Some(st), aa);
                }
            } else if s.kind[i] == Kind::Ellipse {
                let [w, h] = s.size[i];
                let mut p = Self::base_prim(m, 1.0);
                p.info = [K_FILL_ELLIPSE, NONE, 0, 0];
                p.rect = [-spread, -spread, w + spread, h + spread];
                p.quad = outset(p.rect, aa);
                p.color = [0.0, 0.0, 0.0, 1.0];
                Self::push_prim(out, p);
            } else {
                let source = match s.kind[i] {
                    Kind::Compound => GeomSource::Compound { node: id, hash: members_hash(&s.members[i], &s.paths) },
                    _ => match s.paths.get(s.path[i]) {
                        Some(pd) => GeomSource::Path { id: s.path[i], version: pd.version },
                        None => GeomSource::Path { id: NONE, version: 0 },
                    },
                };
                let even_odd = s.kind[i] == Kind::Path && s.fill_rule[i] == 1;
                let silhouette = |tol: f64| match s.kind[i] {
                    Kind::Compound => Some(compound_outline(&s.members[i], &s.paths, tol)),
                    _ => s.paths.get(s.path[i]).map(|p| p.path.clone()),
                };
                let fill_key = GeomKey { source, style: GeomStyle::Fill { even_odd }, zoom };
                if let Some(o) = geom.get_or_build(fill_key, self.frame_no, |tol| {
                    let mut add = Vec::new();
                    push_segments(&silhouette(tol)?, tol, false, &mut add);
                    Some(Segments { add, sub: Vec::new(), even_odd })
                }) {
                    Self::push_outline(out, m, 1.0, NONE, o, aa);
                    out.prims.last_mut().unwrap().color = [0.0, 0.0, 0.0, 1.0];
                }
                if spread > 0.0 {
                    let st = Stroke { paint: NONE, width: 2.0 * spread, join: 1, cap: 1, miter: 4.0, dash: NONE };
                    let key = GeomKey { source, style: stroke_style(&st), zoom };
                    if let Some(o) = geom.get_or_build(key, self.frame_no, |tol| {
                        let outline = stroke_outline(&silhouette(tol)?, &kurbo_stroke(&st, None), tol);
                        let mut add = Vec::new();
                        push_segments(&outline, tol, false, &mut add);
                        Some(Segments { add, sub: Vec::new(), even_odd: false })
                    }) {
                        Self::push_outline(out, m, 1.0, NONE, o, aa);
                        out.prims.last_mut().unwrap().color = [0.0, 0.0, 0.0, 1.0];
                    }
                }
            }
            out.end_layer(li, saved);
        }
    }

    /// Every glyph of a text node as an outline quad: filled, or stroked with
    /// `stroke`. Each glyph's outline is cached at its size and weight and
    /// placed by a translation; the paint is evaluated in block-local space
    /// (`radii.xy` = the glyph's offset), so a gradient spans the whole block.
    /// `paint` NONE draws solid black (shadow silhouettes).
    #[allow(clippy::too_many_arguments)]
    fn push_glyphs(
        &mut self,
        s: &Scene,
        geom: &mut GeomCache,
        out: &mut Frame,
        id: u32,
        m: &Xf,
        alpha: f32,
        paint: u32,
        stroke: Option<Stroke>,
        aa: f32,
    ) {
        if self.text_layout(s, id).is_none() {
            return;
        }
        let zoom = zoom_bucket(self.scales[id as usize][0]);
        let frame_no = self.frame_no;
        let t = self.texts.remove(&id).unwrap();
        let (sx, sy) = t.shift;
        let weight_of = |run: &ms_text::GlyphRun| {
            run.wght.unwrap_or_else(|| t.para.runs.get(run.run as usize).map(|r| r.style.weight).unwrap_or(400.0))
        };
        // (glyph run, glyph id, glyph → node transform, paint offset)
        let mut items: Vec<(usize, u32, Xf, [f32; 2])> = Vec::new();
        match &t.placed {
            Some(placed) => {
                for g in placed {
                    items.push((g.run as usize, g.id, lift(&g.matrix()), [g.x, g.y]));
                }
            }
            None => {
                for (ri, run) in t.layout.runs.iter().enumerate() {
                    for g in &run.glyphs {
                        let (ox, oy) = (sx + g.x, sy + g.y);
                        items.push((ri, g.id, [1.0, 0.0, 0.0, 1.0, ox, oy, 0.0, 0.0, 1.0], [ox, oy]));
                    }
                }
            }
        }
        // Each run paints with its own paint when it has one (rich text spans:
        // a fill node carries the spans' fills, a stroke node their strokes).
        let run_paint = |src: usize| match t.run_paints.get(src) {
            Some(&p) if p != NONE => p,
            _ => paint,
        };
        for (ri, glyph, gt, offset) in items {
            let run = &t.layout.runs[ri];
            let paint = run_paint(run.run as usize);
            let weight = weight_of(run);
            let source = GeomSource::Glyph { font: run.font.0, glyph, size: run.size.to_bits(), weight: weight.to_bits() };
            let style = match &stroke {
                Some(st) => stroke_style(st),
                None => GeomStyle::Fill { even_odd: false },
            };
            let engine = &mut self.engine;
            let built = geom.get_or_build(GeomKey { source, style, zoom }, frame_no, |tol| {
                let gp = engine.fonts.glyph_path(run.font, glyph, run.size, weight)?;
                if gp.is_empty() {
                    return None;
                }
                let path = build_path(&gp.verbs, &gp.points);
                let path = match &stroke {
                    Some(st) => stroke_outline(&path, &kurbo_stroke(st, None), tol),
                    None => path,
                };
                let mut add = Vec::new();
                push_segments(&path, tol, false, &mut add);
                Some(Segments { add, sub: Vec::new(), even_odd: false })
            });
            let Some(o) = built else { continue };
            // Glyphs sit exactly where layout puts them: no pixel snapping,
            // so slowly moving or scaling text glides instead of stepping.
            let gm = mul(m, &gt);
            Self::push_outline(out, &gm, alpha, paint, o, aa);
            let p = out.prims.last_mut().unwrap();
            p.radii[0] = offset[0];
            p.radii[1] = offset[1];
            if paint == NONE {
                p.color = [0.0, 0.0, 0.0, 1.0];
            }
        }
        // Underline / line-through: one rect per glyph run (trailing
        // whitespace excluded, placed by the font's metrics).
        if t.placed.is_none() {
            for run in &t.layout.runs {
                let kind = t.decorations.get(run.run as usize).copied().unwrap_or(0);
                if kind == 0 || run.glyphs.is_empty() {
                    continue;
                }
                let paint = run_paint(run.run as usize);
                let mut count = run.glyphs.len();
                while count > 0 {
                    let c = run.glyphs[count - 1].cluster as usize;
                    let ch = t.utf16.get(c).copied().unwrap_or(0);
                    if char::from_u32(ch as u32).is_some_and(|c| c.is_whitespace()) {
                        count -= 1;
                    } else {
                        break;
                    }
                }
                if count == 0 {
                    continue;
                }
                let style = &t.para.runs[run.run as usize].style;
                let first = run.glyphs[0];
                let last = run.glyphs[count - 1];
                let left = sx + first.x;
                let right = sx + last.x + (last.advance - style.letter_spacing).max(0.0);
                let baseline = sy + first.y;
                let fm = self.engine.fonts.metrics(run.font, weight_of(run));
                let k = run.size / fm.upem.max(1.0);
                let positive = |v: f32| (v > 0.0).then_some(v);
                let (top, bottom) = if kind == 1 {
                    let th = positive(fm.underline_thickness * k).unwrap_or(run.size / 14.0);
                    let top = baseline + positive(fm.underline_position * k).unwrap_or(th);
                    (top, top + th)
                } else {
                    let th = positive(fm.strikeout_thickness * k).unwrap_or(run.size / 14.0);
                    let centre = baseline + if fm.strikeout_position < 0.0 { fm.strikeout_position * k } else { -run.size * 0.26 };
                    (centre - th / 2.0, centre + th / 2.0)
                };
                let mut p = Self::base_prim(m, alpha);
                p.rect = [left, top, right, bottom];
                p.quad = outset(p.rect, aa + stroke.map(|s| s.width).unwrap_or(0.0));
                match &stroke {
                    Some(st) => {
                        p.t[3] = st.width;
                        p.info = [K_STROKE_RRECT, paint, 0, 0];
                    }
                    None => p.info = [K_FILL_RRECT, paint, 0, 0],
                }
                if paint == NONE {
                    p.color = [0.0, 0.0, 0.0, 1.0];
                }
                Self::push_prim(out, p);
            }
        }
        self.texts.insert(id, t);
    }

    /// A cached outline drawn as one analytic-coverage quad over its bounds.
    /// It batches with the SDF primitives (same pipeline).
    fn push_outline(out: &mut Frame, m: &Xf, alpha: f32, paint: u32, o: Outline, aa: f32) {
        let mut p = Self::base_prim(m, alpha);
        p.info = [K_PATH, paint, 0, 0];
        path_fields(&mut p, &o);
        p.radii = [0.0, 0.0, o.y0, o.band_h];
        p.quad = outset(o.bounds, aa);
        Self::push_prim(out, p);
    }
}

fn is_backdrop(e: &EffectSpec) -> bool {
    e.flags & 2 != 0
}

/// Whether a leaf's shadows need the blurred-layer path.
fn needs_shadow_layer(s: &Scene, i: usize) -> bool {
    match s.kind[i] {
        Kind::Path | Kind::Compound | Kind::Text => true,
        Kind::Ellipse => (s.size[i][0] - s.size[i][1]).abs() > 1e-3,
        _ => false,
    }
}

/// Local bounds of a leaf's own shape (no stroke, no shadows).
fn leaf_local_bounds(s: &Scene, i: usize) -> Rect {
    match s.kind[i] {
        Kind::Rect | Kind::Ellipse => [0.0, 0.0, s.size[i][0], s.size[i][1]],
        Kind::Path => s.paths.get(s.path[i]).map(|p| p.bounds).unwrap_or(empty_rect()),
        Kind::Compound => {
            let mut local = empty_rect();
            for mb in s.members[i].iter().filter(|mb| mb.adds_area()) {
                let r = match mb.kind {
                    3 => s.paths.get(mb.path).map(|p| p.bounds).unwrap_or(empty_rect()),
                    _ => [0.0, 0.0, mb.size[0], mb.size[1]],
                };
                local = union(local, map_rect(&lift(&mb.transform), r));
            }
            local
        }
        _ => empty_rect(),
    }
}

fn stroke_style(st: &Stroke) -> GeomStyle {
    GeomStyle::Stroke {
        width: st.width.to_bits(),
        join: st.join,
        cap: st.cap,
        miter: st.miter.to_bits(),
        dash: st.dash,
    }
}

/// The outline a silhouette covers, for its distance field.
enum SilOutline {
    /// A rounded rect (or ellipse) over `rect`, local px.
    Shape { ellipse: bool, rect: Rect, radii: [f32; 4] },
    Path { id: u32, even_odd: bool },
    /// The node's compound members.
    Compound,
}

impl SilOutline {
    fn key(&self, s: &Scene, i: usize) -> u64 {
        match *self {
            SilOutline::Shape { ellipse, rect, radii } => outline_key((0u8, ellipse, rect.map(f32::to_bits), radii.map(f32::to_bits))),
            SilOutline::Path { id, even_odd } => outline_key((1u8, id, s.paths.get(id).map(|p| p.version), even_odd)),
            SilOutline::Compound => outline_key((2u8, i, members_hash(&s.members[i], &s.paths))),
        }
    }

    /// What the field is built from, in local px.
    fn source(&self, s: &Scene, i: usize) -> Option<FieldSource> {
        match *self {
            SilOutline::Shape { ellipse, rect, radii } => Some(FieldSource::Shape { ellipse, rect, radii }),
            SilOutline::Path { id, even_odd } => Some(FieldSource::Path(s.paths.get(id)?.path.clone(), even_odd)),
            SilOutline::Compound => Some(FieldSource::Path(compound_outline(&s.members[i], &s.paths, 0.05), false)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(nf: &[f32; 8], p: [f32; 2]) -> [f32; 2] {
        [nf[0] * p[0] + nf[1] * p[1] + nf[2], nf[4] * p[0] + nf[5] * p[1] + nf[6]]
    }

    #[test]
    fn node_frame_turns_and_scales_with_the_node() {
        // A 100×50 box centred on the origin, scaled 2× and turned a quarter
        // clockwise, then moved to (300, 200): local +x runs down the screen.
        let m: Xf = [0.0, 2.0, -2.0, 0.0, 300.0, 200.0, 0.0, 0.0, 1.0];
        let eb = [-50.0, -25.0, 100.0, 50.0];
        let nf = node_frame(&m, eb, map_rect(&m, [-50.0, -25.0, 50.0, 25.0]), 2.0);
        let close = |a: [f32; 2], b: [f32; 2]| (a[0] - b[0]).abs() < 1e-5 && (a[1] - b[1]).abs() < 1e-5;
        // The local top-left (-50, -25) lands at (350, 100) on screen.
        assert!(close(apply(&nf, [350.0, 100.0]), [0.0, 0.0]));
        assert!(close(apply(&nf, [300.0, 200.0]), [0.5, 0.5]));
        // Local top-right (50, -25) is at (350, 300).
        assert!(close(apply(&nf, [350.0, 300.0]), [1.0, 0.0]));
        assert!(close([nf[3], nf[7]], [100.0, 50.0]));
    }

    #[test]
    fn node_frame_falls_back_to_the_device_box_when_projective() {
        let m: Xf = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.001, 0.0, 1.0];
        let nf = node_frame(&m, [0.0, 0.0, 10.0, 10.0], [20.0, 40.0, 120.0, 90.0], 1.0);
        assert_eq!(nf, [0.01, 0.0, -0.2, 100.0, 0.0, 0.02, -0.8, 50.0]);
    }
}

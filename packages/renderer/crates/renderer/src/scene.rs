//! The retained scene: one typed column per property, indexed by node id.
//!
//! Ids are small dense integers handed out by the TypeScript side (it keeps the
//! free list), so a node's slot *is* its id and no hash lookup sits on the hot
//! path. Columns grow together in [`Scene::ensure`].

use crate::paths::PathStore;

pub const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Free,
    Group,
    Rect,
    Ellipse,
    Path,
    /// Several shapes painted as one surface (union, with cuts).
    Compound,
    /// A text block laid out by ms-text; local space is block-local (origin
    /// at the block's centre, as core draws text).
    Text,
}

impl Kind {
    pub fn from_u32(v: u32) -> Kind {
        match v {
            0 => Kind::Group,
            1 => Kind::Rect,
            2 => Kind::Ellipse,
            3 => Kind::Path,
            4 => Kind::Compound,
            5 => Kind::Text,
            _ => Kind::Free,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Stroke {
    pub paint: u32,
    pub width: f32,
    /// 0 miter, 1 round, 2 bevel
    pub join: u8,
    /// 0 butt, 1 round, 2 square
    pub cap: u8,
    pub miter: f32,
    pub dash: u32,
}

impl Default for Stroke {
    fn default() -> Self {
        Stroke { paint: NONE, width: 0.0, join: 0, cap: 0, miter: 4.0, dash: NONE }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Shadow {
    pub dx: f32,
    pub dy: f32,
    pub sigma: f32,
    pub spread: f32,
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Clip {
    pub enabled: bool,
    /// Rounded-rect clip, or the bounds of `path` when that is set.
    pub rect: [f32; 4],
    pub radius: f32,
    /// A path clip (`NONE` = the rounded rect).
    pub path: u32,
    pub even_odd: bool,
}

#[derive(Clone, Copy, Debug, Default)]
pub enum Filter {
    #[default]
    None,
    Blur { sigma: f32 },
    DropShadow { dx: f32, dy: f32, sigma: f32, color: [f32; 4] },
}

/// One member of a compound shape. Members apply in order: each one is
/// unioned with the result so far, or cut out of it when `cut` is set.
#[derive(Clone, Copy, Debug)]
pub struct Member {
    /// 1 rect, 2 ellipse, 3 path
    pub kind: u8,
    /// How it combines with the members before it: 0 union, 1 cut
    /// (difference), 2 intersect, 3 exclude (xor).
    pub op: u8,
    pub transform: [f32; 6],
    pub size: [f32; 2],
    pub radii: [f32; 4],
    pub path: u32,
    pub even_odd: bool,
}
impl Member {
    /// A cut or an intersection: it adds no area of its own to the bounds.
    pub fn adds_area(&self) -> bool {
        self.op == 0 || self.op == 3
    }
}


/// One node effect (see `src/effects/`), with what its TS packer derived from
/// the authored options. Lengths are logical px.
#[derive(Clone, Debug)]
pub struct EffectSpec {
    /// Index into `effects::EFFECTS`.
    pub index: u32,
    /// bit 0: clip to the input's alpha; bit 1: a backdrop effect; bit 2: a
    /// filter-surface effect (the engine composes backdrop filters apart from
    /// its shader lenses).
    pub flags: u32,
    /// Extra texture (an uploaded image id) or `NONE`.
    pub aux: u32,
    /// How far the effect can draw past its input.
    pub reach: f32,
    /// Blur feeding `blurred()`: sigma along the angle, sigma across it, angle (rad).
    pub blur: [f32; 3],
    pub params: Vec<f32>,
}

/// A `Kind::Text` node's state.
#[derive(Clone, Debug)]
pub struct TextNode {
    pub state: ms_text::TextBlockState,
    /// Bumped on every change, for the layout cache.
    pub rev: u64,
    /// Per run: 0 none, 1 underline, 2 line-through.
    pub decorations: Vec<u8>,
    /// Per run: its own fill paint (rich text spans), or `NONE` for the node's.
    pub run_paints: Vec<u32>,
    /// Text on a path (a path id), or `NONE`.
    pub path: u32,
}

#[derive(Clone, Debug)]
pub struct Dash {
    pub intervals: Vec<f32>,
    pub phase: f32,
}

/// Paint kind of an image (or video frame) paint.
pub const PAINT_IMAGE: u32 = 4;
/// Paint kind of a user (WGSL) fill: head[3] = program, color = time,
/// texture image (or `NONE` as -1), geom = the fill box; its stops carry the
/// `Params` bytes, four words per stop colour.
pub const PAINT_USER: u32 = 10;
/// Set in a paint's batch key (`PaintTable::images`) for a user fill: each
/// draws on its own, with its own pipeline and `Params`.
pub const USER_FILL: u32 = 0x8000_0000;

/// What drawing a user fill paint needs at encode time.
#[derive(Clone, Debug)]
pub struct UserPaint {
    pub program: u32,
    pub texture: u32,
    pub params: Vec<f32>,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, Default)]
pub struct GpuPaint {
    /// kind, stop count, first stop, unused
    pub head: [u32; 4],
    pub color: [f32; 4],
    /// linear: x0 y0 x1 y1 · radial: cx cy r 0 · sweep: cx cy start end ·
    /// image: a b c d of the local → uv matrix (color.xy = e f, color.z = id)
    pub geom: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, Default)]
pub struct GpuStop {
    pub color: [f32; 4],
    pub offset: [f32; 4],
}

/// Deduplicated paint table. The TS side interns paints by value and defines
/// each one once; nodes refer to them by id.
#[derive(Default)]
pub struct PaintTable {
    pub paints: Vec<GpuPaint>,
    pub stops: Vec<Vec<GpuStop>>,
    pub dirty: bool,
}

impl PaintTable {
    pub fn define(&mut self, id: u32, mut paint: GpuPaint, stops: Vec<GpuStop>) {
        let i = id as usize;
        if self.paints.len() <= i {
            self.paints.resize(i + 1, GpuPaint::default());
            self.stops.resize(i + 1, Vec::new());
        }
        paint.head[1] = stops.len() as u32;
        self.paints[i] = paint;
        self.stops[i] = stops;
        self.dirty = true;
    }

    /// Flattened stop array with each paint's `head[2]` pointing into it.
    /// Image id of each paint (`NONE` for the others).
    pub fn images(&self) -> Vec<u32> {
        self.paints
            .iter()
            .enumerate()
            .map(|(i, p)| match p.head[0] & 0xff {
                PAINT_IMAGE => p.head[3],
                PAINT_USER => USER_FILL | i as u32,
                _ => NONE,
            })
            .collect()
    }

    /// The user fill paints, by paint id.
    pub fn users(&self) -> Vec<Option<UserPaint>> {
        self.paints
            .iter()
            .enumerate()
            .map(|(i, p)| {
                (p.head[0] & 0xff == PAINT_USER).then(|| UserPaint {
                    program: p.head[3],
                    texture: if p.color[1] < 0.0 { NONE } else { p.color[1] as u32 },
                    params: self.stops[i].iter().flat_map(|s| s.color).collect(),
                })
            })
            .collect()
    }

    pub fn pack(&mut self) -> (Vec<GpuPaint>, Vec<GpuStop>) {
        let mut flat = Vec::new();
        let mut paints = self.paints.clone();
        for (i, p) in paints.iter_mut().enumerate() {
            p.head[2] = flat.len() as u32;
            flat.extend_from_slice(&self.stops[i]);
        }
        if flat.is_empty() {
            flat.push(GpuStop::default());
        }
        if paints.is_empty() {
            paints.push(GpuPaint::default());
        }
        self.dirty = false;
        (paints, flat)
    }
}

pub struct Viewport {
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub clear: [f32; 4],
}

#[derive(Default)]
pub struct Scene {
    pub kind: Vec<Kind>,
    pub children: Vec<Vec<u32>>,
    pub transform: Vec<Xf>,
    pub size: Vec<[f32; 2]>,
    pub radii: Vec<[f32; 4]>,
    pub fill: Vec<u32>,
    pub stroke: Vec<Stroke>,
    pub shadows: Vec<Vec<Shadow>>,
    pub opacity: Vec<f32>,
    pub blend: Vec<u8>,
    pub clip: Vec<Clip>,
    pub filter: Vec<Filter>,
    pub path: Vec<u32>,
    pub fill_rule: Vec<u8>,
    pub members: Vec<Vec<Member>>,
    /// Mask mode of a group: 0 none, 1 alpha, 2 luminance, 3 inverted alpha,
    /// 4 inverted luminance. The group's first child is the mask.
    pub mask: Vec<u8>,
    pub text: Vec<Option<TextNode>>,
    /// Node effects in application order, and the box they measure against
    /// (local x, y, w, h).
    pub effects: Vec<Vec<EffectSpec>>,
    pub effect_box: Vec<[f32; 4]>,
    /// The node's elapsed time (s) its effects animate with (`u.time`).
    pub effect_time: Vec<f32>,
    pub root: u32,
    pub paints: PaintTable,
    pub paths: PathStore,
    pub dashes: Vec<Option<Dash>>,
    pub viewport: Option<Viewport>,
    /// Bumped on any structural or property change; the frame builder uses it
    /// to skip rebuilding an unchanged scene.
    pub revision: u64,
    /// Change tracking for reuse of clean subtrees (see `FrameBuilder`): the
    /// parent that last listed each node, and the revision of the last change
    /// anywhere in its subtree.
    pub parent: Vec<u32>,
    pub sub_rev: Vec<u64>,
    /// Listed by more than one parent over its life: a change under it could
    /// miss an ancestor, so it invalidates everything instead.
    pub multi: Vec<bool>,
    /// Revision of the last change no node tracks (paint, path and dash
    /// definitions, root, viewport): nothing built before it can be reused.
    pub flush_rev: u64,
    /// What a node's subtree draws, apart from `sub_rev` (which any op on it
    /// bumps): the revision of the last change to the words of its ops or its
    /// descendants', so a node rewritten as it was (a host handing over a new
    /// document every frame) stays clean. `Tex.surface` images redraw by it.
    pub content_rev: Vec<u64>,
    /// Per node, its last batch's op words, hashed in order, and the batch
    /// being read (its hash so far, and the revision that hash is for).
    pub node_words: Vec<u64>,
    pub batch_words: Vec<(u64, u64)>,
    /// Per definition (opcode, id), its words, hashed; and the revision of the
    /// last one that changed, or of a font registered since.
    pub def_words: crate::fxhash::FxHashMap<(u32, u32), u64>,
    pub content_flush: u64,
}

/// A node transform: a b c d e f (affine, as canvas `setTransform`) plus the
/// perspective row g h i, mapping (x, y) to ((a·x + c·y + e) / w,
/// (b·x + d·y + f) / w) with w = g·x + h·y + i. Affine when g = h = 0, i = 1.
pub type Xf = [f32; 9];
pub const IDENTITY: Xf = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];

impl Scene {
    pub fn new() -> Self {
        Scene { root: NONE, ..Default::default() }
    }

    pub fn ensure(&mut self, id: u32) {
        let n = id as usize + 1;
        if self.kind.len() >= n {
            return;
        }
        self.kind.resize(n, Kind::Free);
        self.children.resize(n, Vec::new());
        self.transform.resize(n, IDENTITY);
        self.size.resize(n, [0.0; 2]);
        self.radii.resize(n, [0.0; 4]);
        self.fill.resize(n, NONE);
        self.stroke.resize(n, Stroke::default());
        self.shadows.resize(n, Vec::new());
        self.opacity.resize(n, 1.0);
        self.blend.resize(n, 0);
        self.clip.resize(n, Clip::default());
        self.filter.resize(n, Filter::None);
        self.path.resize(n, NONE);
        self.fill_rule.resize(n, 0);
        self.members.resize(n, Vec::new());
        self.mask.resize(n, 0);
        self.text.resize(n, None);
        self.effects.resize(n, Vec::new());
        self.effect_box.resize(n, [0.0; 4]);
        self.effect_time.resize(n, 0.0);
        self.parent.resize(n, NONE);
        self.sub_rev.resize(n, u64::MAX);
        self.multi.resize(n, false);
        self.content_rev.resize(n, u64::MAX);
        self.node_words.resize(n, 0);
        self.batch_words.resize(n, (u64::MAX, 0));
    }

    /// Records that nodes `touched` changed in revision `rev`: their subtree
    /// revision and every ancestor's.
    pub fn mark_changed(&mut self, touched: &[u32], rev: u64) {
        for &id in touched {
            let mut x = id as usize;
            while x < self.sub_rev.len() && self.sub_rev[x] != rev {
                self.sub_rev[x] = rev;
                if self.multi[x] {
                    self.flush_rev = rev;
                }
                x = self.parent[x] as usize;
            }
        }
    }

    /// Folds the hash of one of node `id`'s ops in batch `rev` into the
    /// node's batch hash (`written` lists the nodes the batch wrote).
    pub fn add_words(&mut self, id: u32, h: u64, rev: u64, written: &mut Vec<u32>) {
        let Some(b) = self.batch_words.get_mut(id as usize) else { return };
        if b.0 != rev {
            *b = (rev, 0x9e37_79b9_7f4a_7c15);
            written.push(id);
        }
        b.1 = (b.1.rotate_left(5) ^ h).wrapping_mul(0xf135_7aea_2e62_a9c5);
    }

    /// The nodes batch `rev` wrote: one whose words differ from its last
    /// batch's changed, and its ancestors' content with it.
    pub fn mark_content(&mut self, written: &[u32], rev: u64) {
        for &id in written {
            let i = id as usize;
            let h = self.batch_words[i].1;
            if self.node_words[i] == h && self.content_rev[i] != u64::MAX {
                continue;
            }
            self.node_words[i] = h;
            let mut x = i;
            while x < self.content_rev.len() && self.content_rev[x] != rev {
                self.content_rev[x] = rev;
                if self.multi[x] {
                    self.content_flush = rev;
                }
                x = self.parent[x] as usize;
            }
        }
    }

    /// `parent` lists `kid` (called for each child list received).
    pub fn set_parent(&mut self, kid: u32, parent: u32, touched: &mut Vec<u32>) {
        self.ensure(kid);
        let old = self.parent[kid as usize];
        if old != parent {
            if old != NONE {
                self.multi[kid as usize] = true;
                touched.push(old);
            }
            self.parent[kid as usize] = parent;
        }
    }

    pub fn create(&mut self, id: u32, kind: Kind) {
        self.ensure(id);
        let i = id as usize;
        self.kind[i] = kind;
        self.children[i].clear();
        self.transform[i] = IDENTITY;
        self.size[i] = [0.0; 2];
        self.radii[i] = [0.0; 4];
        self.fill[i] = NONE;
        self.stroke[i] = Stroke::default();
        self.shadows[i].clear();
        self.opacity[i] = 1.0;
        self.blend[i] = 0;
        self.clip[i] = Clip::default();
        self.filter[i] = Filter::None;
        self.path[i] = NONE;
        self.fill_rule[i] = 0;
        self.members[i].clear();
        self.mask[i] = 0;
        self.text[i] = None;
        self.effects[i].clear();
    }

    pub fn destroy(&mut self, id: u32) {
        if let Some(k) = self.kind.get_mut(id as usize) {
            *k = Kind::Free;
            self.children[id as usize].clear();
        }
    }

    pub fn len(&self) -> usize {
        self.kind.len()
    }
}

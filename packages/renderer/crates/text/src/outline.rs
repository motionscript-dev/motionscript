//! Glyph outlines as path data in the renderer's verb encoding.
//!
//! The same encoding `crates/renderer/src/protocol.rs` accepts for
//! `OP_DEF_PATH`: one byte per verb (move 0, line 1, quad 2, cubic 3, close 4)
//! and the points the verbs consume as `[x, y]` f32 pairs, in px at the
//! requested size, y down, origin at the glyph's pen position on the
//! baseline. A glyph can therefore be defined once as a cached path and drawn
//! at each glyph position with a translate.

use crate::font::{FontId, FontStore};
use harfrust::font::glyph::outline::{DrawMemory, DrawOptions, PathSink};
use harfrust::GlyphId;

pub const VERB_MOVE: u8 = 0;
pub const VERB_LINE: u8 = 1;
pub const VERB_QUAD: u8 = 2;
pub const VERB_CUBIC: u8 = 3;
pub const VERB_CLOSE: u8 = 4;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GlyphPath {
    pub verbs: Vec<u8>,
    pub points: Vec<[f32; 2]>,
}

impl GlyphPath {
    pub fn is_empty(&self) -> bool {
        self.verbs.is_empty()
    }

    /// Control-point bounds `[min_x, min_y, max_x, max_y]`, or `None` if empty.
    pub fn bounds(&self) -> Option<[f32; 4]> {
        let mut it = self.points.iter();
        let first = it.next()?;
        let mut b = [first[0], first[1], first[0], first[1]];
        for p in it {
            b[0] = b[0].min(p[0]);
            b[1] = b[1].min(p[1]);
            b[2] = b[2].max(p[0]);
            b[3] = b[3].max(p[1]);
        }
        Some(b)
    }
}

struct Sink {
    scale: f32,
    path: GlyphPath,
    open: bool,
}

impl Sink {
    fn pt(&mut self, x: f32, y: f32) {
        self.path.points.push([x * self.scale, -y * self.scale]);
    }
}

impl PathSink for Sink {
    fn move_to(&mut self, x: f32, y: f32) {
        if self.open {
            self.path.verbs.push(VERB_CLOSE);
        }
        self.path.verbs.push(VERB_MOVE);
        self.pt(x, y);
        self.open = true;
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.path.verbs.push(VERB_LINE);
        self.pt(x, y);
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.path.verbs.push(VERB_QUAD);
        self.pt(cx0, cy0);
        self.pt(x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.path.verbs.push(VERB_CUBIC);
        self.pt(cx0, cy0);
        self.pt(cx1, cy1);
        self.pt(x, y);
    }
    fn close(&mut self) {
        if self.open {
            self.path.verbs.push(VERB_CLOSE);
            self.open = false;
        }
    }
}

impl FontStore {
    /// The outline of `glyph` in face `id` at `size` px and `weight` (the
    /// `wght` axis, ignored by static faces). Drawn in font units and scaled
    /// in f32, unhinted. `None` for an
    /// unknown face or glyph; an empty path for a glyph with no outline
    /// (a space).
    pub fn glyph_path(&mut self, id: FontId, glyph: u32, size: f32, weight: f32) -> Option<GlyphPath> {
        if id.0 as usize >= self.faces.len() {
            return None;
        }
        let (font, _) = self.face_mut(id).instance(weight);
        let upem = font.units_per_em() as f32;
        let outlines = font.outline_glyphs();
        let Some(outline) = outlines.get(GlyphId::new(glyph)) else {
            return if glyph < font.num_glyphs() { Some(GlyphPath::default()) } else { None };
        };
        let mut sink = Sink { scale: size / upem, path: GlyphPath::default(), open: false };
        outline.draw(&DrawOptions::new(), DrawMemory::default(), &mut sink).ok()?;
        if sink.open {
            sink.path.verbs.push(VERB_CLOSE);
        }
        Some(sink.path)
    }
}

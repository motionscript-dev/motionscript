//! wasm-bindgen API (feature `wasm`), used by the web parity harness
//! (`web/src/text-parity.ts`). Results come back as flat `Float32Array`s so a
//! call is one copy; the layouts are documented on each function.
//!
//! Runs are passed as the joined text plus a `Float32Array` of 6 numbers per
//! run: `[utf16Length, size, weight, slant (0 normal, 1 italic, 2 oblique),
//! letterSpacing, familyIndex]`, with the family names joined by `\n`.

use crate::block::{FontSize, TextBlockState, VerticalAlign};
use crate::font::{FontId, Slant};
use crate::layout::{Align, Paragraph, ParagraphLayout, RunStyle, TextRun};
use crate::on_path::{place_on_path, Polyline};
use crate::TextEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MsText {
    engine: TextEngine,
}

fn runs_from(text: &str, runs: &[f32], families: &str) -> Vec<TextRun> {
    let fams: Vec<&str> = families.split('\n').collect();
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    let mut byte = 0usize;
    for r in runs.chunks_exact(6) {
        let mut want = r[0] as u32;
        let start = byte;
        while want > 0 {
            let Some((b, c)) = chars.next() else { break };
            byte = b + c.len_utf8();
            want = want.saturating_sub(c.len_utf16() as u32);
        }
        out.push(TextRun {
            text: text[start..byte].to_string(),
            style: RunStyle {
                family: fams.get(r[5] as usize).copied().unwrap_or("").to_string(),
                size: r[1],
                weight: r[2],
                slant: Slant::from_index(r[3] as u32),
                letter_spacing: r[4],
            },
        });
    }
    out
}

/// `[layoutWidth, width, height, maxIntrinsic, lineCount, glyphCount,
///   per line: start, end, top, bottom, baseline, left, width, caretCount, carets…,
///   per glyph: line, id, x, y, advance, cluster, font, size, wght (NaN = static), run]`
fn encode(l: &ParagraphLayout) -> Vec<f32> {
    let glyphs: usize = l.runs.iter().map(|r| r.glyphs.len()).sum();
    let mut v = vec![l.layout_width, l.width, l.height, l.max_intrinsic, l.lines.len() as f32, glyphs as f32];
    for ln in &l.lines {
        v.extend([ln.start as f32, ln.end as f32, ln.top, ln.bottom, ln.baseline, ln.left, ln.width, ln.carets.len() as f32]);
        v.extend(&ln.carets);
    }
    for r in &l.runs {
        for g in &r.glyphs {
            v.extend([
                r.line as f32,
                g.id as f32,
                g.x,
                g.y,
                g.advance,
                g.cluster as f32,
                r.font.0 as f32,
                r.size,
                r.wght.unwrap_or(f32::NAN),
                r.run as f32,
            ]);
        }
    }
    v
}

#[wasm_bindgen]
impl MsText {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MsText {
        MsText { engine: TextEngine::new() }
    }

    /// Registers font bytes under `family`; returns the font id, or -1.
    pub fn register_font(&mut self, bytes: &[u8], family: &str) -> i32 {
        self.engine.register_font(bytes.to_vec(), family).map(|id| id.0 as i32).unwrap_or(-1)
    }

    pub fn set_family_fallbacks(&mut self, family: &str, ids: &[u32]) {
        let ids: Vec<FontId> = ids.iter().map(|i| FontId(*i)).collect();
        self.engine.fonts.set_family_fallbacks(family, &ids);
    }

    pub fn set_default_fallbacks(&mut self, ids: &[u32]) {
        let ids: Vec<FontId> = ids.iter().map(|i| FontId(*i)).collect();
        self.engine.fonts.set_default_fallbacks(&ids);
    }

    /// `measureText` → `[width, height]`.
    pub fn measure_text(&mut self, text: &str, size: f32, family: &str, weight: f32, letter_spacing: f32, slant: u32) -> Vec<f32> {
        let (w, h) = self.engine.measure_text(text, size, family, weight, letter_spacing, Slant::from_index(slant));
        vec![w, h]
    }

    /// Paragraph layout in paragraph space; see [`encode`]. `align`: 0 left,
    /// 1 right, 2 center, 3 justify, 4 start, 5 end. `max_width <= 0` = no wrap.
    #[allow(clippy::too_many_arguments)]
    pub fn layout(&mut self, text: &str, runs: &[f32], families: &str, line_height: f32, align: u32, max_width: f32, box_width: f32) -> Vec<f32> {
        let para = Paragraph {
            runs: runs_from(text, runs, families),
            line_height,
            align: Align::from_index(align),
            max_width,
            box_width,
        };
        encode(&self.engine.layout(&para))
    }

    /// `layoutTextBlock` → `[width, height, lineCount, per line: start, end,
    /// top, bottom, caretCount, carets…]`, or empty for no layout.
    /// `font_size` NaN = autofit. `valign`: 0 top, 1 center, 2 bottom.
    #[allow(clippy::too_many_arguments)]
    pub fn text_block(
        &mut self,
        text: &str,
        runs: &[f32],
        families: &str,
        font_size: f32,
        min_font_size: f32,
        line_height: f32,
        align: u32,
        valign: u32,
        wrap: bool,
        width: f32,
        height: f32,
    ) -> Vec<f32> {
        let state = TextBlockState {
            runs: runs_from(text, runs, families),
            font_size: if font_size.is_nan() { FontSize::Autofit } else { FontSize::Px(font_size) },
            min_font_size,
            line_height,
            align: Align::from_index(align),
            vertical_align: VerticalAlign::from_index(valign),
            wrap,
            width,
            height,
        };
        let Some(b) = self.engine.text_block_layout(&state) else { return Vec::new() };
        let mut v = vec![b.width, b.height, b.lines.len() as f32];
        for l in &b.lines {
            v.extend([l.start as f32, l.end as f32, l.top, l.bottom, l.carets.len() as f32]);
            v.extend(&l.carets);
        }
        v
    }

    /// Glyph outline → `[verbCount, verbs…, x0, y0, x1, y1, …]` in px, y down.
    pub fn glyph_path(&mut self, font: u32, glyph: u32, size: f32, weight: f32) -> Vec<f32> {
        let Some(p) = self.engine.fonts.glyph_path(FontId(font), glyph, size, weight) else { return Vec::new() };
        let mut v = Vec::with_capacity(1 + p.verbs.len() + p.points.len() * 2);
        v.push(p.verbs.len() as f32);
        v.extend(p.verbs.iter().map(|&b| b as f32));
        for pt in &p.points {
            v.extend(pt);
        }
        v
    }

    /// Text on a path: shapes one unwrapped left-aligned line and places it
    /// along `points` (a polyline, `[x0, y0, x1, y1, …]`) per `align`.
    /// Returns 7 numbers per glyph: the glyph id, then its affine matrix
    /// `[a, b, c, d, e, f]` (see `PlacedGlyph::matrix`). Newlines become
    /// spaces; the whitespace around them is collapsed by the caller, since it
    /// changes run lengths.
    #[allow(clippy::too_many_arguments)]
    pub fn text_on_path(&mut self, text: &str, runs: &[f32], families: &str, line_height: f32, align: u32, points: &[f32]) -> Vec<f32> {
        let flat: String = text.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
        let para = Paragraph { runs: runs_from(&flat, runs, families), line_height, align: Align::Left, max_width: 0.0, box_width: 0.0 };
        let layout = self.engine.layout(&para);
        let poly = Polyline::new(&[points.chunks_exact(2).map(|p| [p[0], p[1]]).collect()]);
        let mut v = Vec::new();
        for g in place_on_path(&layout, &poly, Align::from_index(align)) {
            v.push(g.id as f32);
            v.extend(g.matrix());
        }
        v
    }
}

impl Default for MsText {
    fn default() -> Self {
        Self::new()
    }
}

//! Shaping one item (a run of text in one face, size and `wght`) with harfrust.
//!
//! The font scale is the size in 16.16 fixed point, so advances and offsets
//! come back in 1/65536 px, the precision glyphs are positioned at.

use crate::varied::VariedAdvances;
use harfrust::{Buffer, Direction, Font, FontFuncs, GlyphId, ShapeOptions, ShaperFont};

#[derive(Copy, Clone, Debug, Default)]
pub struct ShapedGlyph {
    pub id: u32,
    /// Byte offset of the glyph's cluster in the paragraph text.
    pub cluster: u32,
    pub advance: f32,
    pub x_offset: f32,
    /// y-down.
    pub y_offset: f32,
}

const FIXED: f32 = 65536.0;

/// Shapes `text` (which starts at byte `base` of the paragraph) left-to-right
/// and appends glyphs with paragraph byte clusters.
pub fn shape_item(
    font: &Font,
    varied: Option<&VariedAdvances>,
    size: f32,
    text: &str,
    base: u32,
    buffer: &mut Buffer,
    out: &mut Vec<ShapedGlyph>,
) {
    if text.is_empty() {
        return;
    }
    let scale = (size * FIXED).round() as i32;
    let funcs = WholeUnitAdvances { varied };
    let shaper = ShaperFont::new(font).with_scale(scale).with_font_funcs(Some(&funcs));
    buffer.clear();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    // Bidi is out of scope (core's caret model is left-to-right in v1).
    buffer.set_direction(Direction::LeftToRight);
    if harfrust::shape(&shaper, buffer, ShapeOptions::new()).is_err() {
        return;
    }
    for (info, pos) in buffer.glyph_infos().iter().zip(buffer.glyph_positions()) {
        out.push(ShapedGlyph {
            id: info.glyph_id,
            cluster: base + info.cluster,
            advance: pos.x_advance as f32 / FIXED,
            x_offset: pos.x_offset as f32 / FIXED,
            y_offset: -(pos.y_offset as f32) / FIXED,
        });
    }
}

/// Advances as FreeType reports them for a variable font: the `HVAR`-varied advance computed in 16.16 and
/// rounded to whole font units before scaling (see [`crate::varied`]). Static
/// faces and default locations use the plain `hmtx` advance.
struct WholeUnitAdvances<'a> {
    varied: Option<&'a VariedAdvances<'a>>,
}

impl FontFuncs for WholeUnitAdvances<'_> {
    fn glyph_h_advance(&self, font: &ShaperFont, glyph: GlyphId) -> i32 {
        let Some(v) = self.varied else { return font.default_glyph_h_advance(glyph) };
        let units = v.advance(glyph).unwrap_or_else(|| font.glyph_metrics().h_advance(glyph).round() as i32);
        font.scale().scale_x(units)
    }
}

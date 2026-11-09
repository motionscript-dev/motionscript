//! `ms-text`: text shaping, paragraph layout, measurement and glyph outlines
//! for the Motion Script renderer. No GPU: it builds for wasm32 and native.
//!
//! Stack: harfrust (HarfBuzz port) for shaping, read-fonts' font model for
//! metrics, variations and outlines, unicode-linebreak (UAX #14) for break
//! opportunities, and our own line breaker (see DESIGN.md §5).

pub mod block;
pub mod font;
pub mod layout;
pub mod on_path;
pub mod outline;
pub mod shape;
pub mod varied;
#[cfg(feature = "wasm")]
pub mod wasm;

pub use font::{FaceMetrics, FontId, FontStore, Slant};
pub use block::{block_shift, FontSize, TextBlockLayout, TextBlockLine, TextBlockState, VerticalAlign};
pub use on_path::{place_on_path, PlacedGlyph, Polyline};
pub use outline::GlyphPath;
pub use layout::{Align, Glyph, GlyphRun, Layouter, Line, Paragraph, ParagraphLayout, RunStyle, TextRun};

/// Fonts plus a reusable layouter: the object a host keeps.
#[derive(Default)]
pub struct TextEngine {
    pub fonts: FontStore,
    layouter: Layouter,
}

impl TextEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers font bytes under a family name; `None` if they aren't a font.
    pub fn register_font(&mut self, bytes: Vec<u8>, family: &str) -> Option<FontId> {
        self.fonts.register(bytes, family)
    }

    /// Shapes and lays out a paragraph (paragraph space, see [`layout`]).
    pub fn layout(&mut self, para: &Paragraph) -> ParagraphLayout {
        self.layouter.layout(&mut self.fonts, para)
    }
}

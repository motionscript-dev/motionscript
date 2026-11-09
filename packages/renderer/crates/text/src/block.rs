//! Core's measurement contract: `MeasureContext2D.measureText` and
//! `TextBlockSource.layoutTextBlock`. See DESIGN.md §5.1 for the contract.

use crate::font::Slant;
use crate::layout::{Align, Paragraph, ParagraphLayout, RunStyle, TextRun};
use crate::TextEngine;

/// `TextState.verticalAlign`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub enum VerticalAlign {
    Top,
    #[default]
    Center,
    Bottom,
}

impl VerticalAlign {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => VerticalAlign::Top,
            2 => VerticalAlign::Bottom,
            _ => VerticalAlign::Center,
        }
    }
}

/// `TextState.fontSize`.
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum FontSize {
    Px(f32),
    Autofit,
}

/// The shaping fields of a `TextState` (or a `RichTextState`): what
/// `layoutTextBlock` reads. Paint, transform and decoration are the renderer's.
#[derive(Clone, Debug)]
pub struct TextBlockState {
    /// Styled runs (core's `segments`, or `RichText` spans). A plain Text node
    /// is one run. With more than one run, `font_size` is ignored (each run
    /// carries its size, already resolved to the probe size for autofit).
    pub runs: Vec<TextRun>,
    pub font_size: FontSize,
    pub min_font_size: f32,
    pub line_height: f32,
    pub align: Align,
    pub vertical_align: VerticalAlign,
    pub wrap: bool,
    pub width: f32,
    pub height: f32,
}

/// Core's `TextBlockLine`, block-local: origin at the block centre, y down.
#[derive(Clone, Debug, PartialEq)]
pub struct TextBlockLine {
    pub start: u32,
    pub end: u32,
    pub top: f32,
    pub bottom: f32,
    pub carets: Vec<f32>,
}

/// Core's `TextBlockLayout`.
#[derive(Clone, Debug, PartialEq)]
pub struct TextBlockLayout {
    pub lines: Vec<TextBlockLine>,
    pub width: f32,
    pub height: f32,
}

/// The size autofit measures at before scaling to the box.
pub const AUTOFIT_PROBE_SIZE: f32 = 100.0;

/// Where block-local space sits in paragraph space: add `(x, y)` to a
/// paragraph-space position. Centres the layout box on the origin and
/// applies `verticalAlign` against a box height.
pub fn block_shift(layout: &ParagraphLayout, box_height: f32, valign: VerticalAlign) -> (f32, f32) {
    let h = layout.height;
    let v = if box_height > 0.0 {
        match valign {
            VerticalAlign::Top => (h - box_height) / 2.0,
            VerticalAlign::Bottom => (box_height - h) / 2.0,
            VerticalAlign::Center => 0.0,
        }
    } else {
        0.0
    };
    (-layout.layout_width / 2.0, -h / 2.0 + v)
}

impl TextEngine {
    /// `measureText(text, fontSize, fontFamily, fontWeight, letterSpacing,
    /// fontStyle)`: one unwrapped run, line height 1, the shaped advance width
    /// (longest line) and line-box height. Empty text measures 0×0.
    pub fn measure_text(&mut self, text: &str, size: f32, family: &str, weight: f32, letter_spacing: f32, slant: Slant) -> (f32, f32) {
        if text.is_empty() {
            return (0.0, 0.0);
        }
        let style = RunStyle { family: family.to_string(), size, weight, slant, letter_spacing };
        let mut p = Paragraph::single(text, style);
        p.line_height = 1.0;
        let l = self.layout(&p);
        (l.width, l.height)
    }

    /// The size and wrap a state lays out with: `'autofit'` probes an
    /// unwrapped layout at [`AUTOFIT_PROBE_SIZE`] and scales to fit the box;
    /// with wrap on it stops at `min_font_size` and wraps instead
    pub fn resolve_shaping(&mut self, state: &TextBlockState) -> (f32, bool) {
        let mut wrap = state.wrap && state.width > 0.0;
        let FontSize::Px(px) = state.font_size else {
            let mut size = AUTOFIT_PROBE_SIZE;
            if state.width > 0.0 && state.height > 0.0 {
                let probe = self.layout(&self.paragraph(state, size, f32::INFINITY));
                let sw = if probe.width > 0.0 { state.width / probe.width } else { 1.0 };
                let sh = if probe.height > 0.0 { state.height / probe.height } else { 1.0 };
                let fit = size * sw.min(sh);
                if wrap && fit < state.min_font_size {
                    size = state.min_font_size;
                } else {
                    size = fit;
                    wrap = false;
                }
            }
            return (size, wrap);
        };
        (px, wrap)
    }

    /// The paragraph a state lays out as, at `size` (single-run states) and
    /// wrap width `max_width`.
    pub fn paragraph(&self, state: &TextBlockState, size: f32, max_width: f32) -> Paragraph {
        let mut runs = state.runs.clone();
        if runs.len() == 1 {
            runs[0].style.size = size;
        }
        Paragraph { runs, line_height: state.line_height, align: state.align, max_width, box_width: state.width }
    }

    /// The paragraph a state draws: autofit and wrap resolved.
    pub fn resolved_paragraph(&mut self, state: &TextBlockState) -> Paragraph {
        if state.runs.len() > 1 {
            let wrap = state.wrap && state.width > 0.0;
            return self.paragraph(state, 0.0, if wrap { state.width } else { f32::INFINITY });
        }
        let (size, wrap) = self.resolve_shaping(state);
        self.paragraph(state, size, if wrap { state.width } else { f32::INFINITY })
    }

    /// `layoutTextBlock(state)`: lines with caret slots, block-local. `None`
    /// when there are no runs. Text on a path and transformed segments are
    /// the caller's `null` (core checks those before asking).
    pub fn text_block_layout(&mut self, state: &TextBlockState) -> Option<TextBlockLayout> {
        if state.runs.is_empty() {
            return None;
        }
        let para = self.resolved_paragraph(state);
        if para.runs.iter().all(|r| r.text.is_empty()) {
            // An empty block still has one caret slot, as tall as a line of
            // the first run's face: measure a stand-in glyph, keep its height.
            let mut probe = para.clone();
            probe.runs.truncate(1);
            probe.runs[0].text = "M".to_string();
            let p = self.block_from(&probe, state)?;
            let line = &p.lines[0];
            return Some(TextBlockLayout {
                lines: vec![TextBlockLine { start: 0, end: 0, top: line.top, bottom: line.bottom, carets: vec![0.0] }],
                width: 0.0,
                height: p.height,
            });
        }
        self.block_from(&para, state)
    }

    fn block_from(&mut self, para: &Paragraph, state: &TextBlockState) -> Option<TextBlockLayout> {
        let l = self.layout(para);
        let (sx, sy) = block_shift(&l, state.height, state.vertical_align);
        let lines: Vec<TextBlockLine> = l
            .lines
            .iter()
            .map(|ln| TextBlockLine {
                start: ln.start,
                end: ln.end,
                top: ln.top + sy,
                bottom: ln.bottom + sy,
                carets: ln.carets.iter().map(|c| c + sx).collect(),
            })
            .collect();
        if lines.is_empty() {
            return None;
        }
        Some(TextBlockLayout { lines, width: l.width, height: l.height })
    }
}

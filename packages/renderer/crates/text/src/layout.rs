//! Paragraph layout.
//!
//! Core's flow layout and caret model read what this produces, and stored
//! documents were laid out by these rules, so they stay as they are rather
//! than becoming cleaner ones:
//!
//! - One paragraph per call; rich runs are styles over byte ranges of the
//!   joined text. Adjacent runs that resolve to the same face, size and
//!   weight are shaped together (kerning crosses them).
//! - Letter spacing is added after every cluster, including the last.
//! - Greedy wrapping at UAX #14 opportunities. Trailing whitespace hangs: it
//!   never forces a break and isn't part of the line width. A word wider than
//!   the line is broken between clusters.
//! - Line boxes: the tallest ascent and descent of the runs on the line
//!   (`lineHeight > 0` rescales each run's ascent+descent to `lineHeight ×
//!   size`), and the box height is **rounded to whole pixels** with the
//!   rounding put above the baseline.
//! - Alignment against the layout width; justify spreads the slack over the
//!   whitespace patches of every line but the last of each paragraph.
//!
//! All positions are in paragraph space: origin at the top-left of the layout
//! box, y down. Character offsets in the output are UTF-16 code units (what JS
//! strings index), so they line up with core's `TextBlockLine`.

use crate::font::{FontId, FontStore, Slant};
use crate::shape::{shape_item, ShapedGlyph};
use crate::varied::VariedAdvances;
use harfrust::Buffer;
use unicode_linebreak::{linebreaks, BreakOpportunity};

/// Horizontal alignment, as `TextState.textAlign` names it. Left-to-right
/// only, so start = left and end = right.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub enum Align {
    Left,
    Right,
    #[default]
    Center,
    Justify,
    Start,
    End,
}

impl Align {
    pub fn from_index(i: u32) -> Align {
        match i {
            0 => Align::Left,
            1 => Align::Right,
            3 => Align::Justify,
            4 => Align::Start,
            5 => Align::End,
            _ => Align::Center,
        }
    }

    fn factor(self) -> f32 {
        match self {
            Align::Left | Align::Start | Align::Justify => 0.0,
            Align::Center => 0.5,
            Align::Right | Align::End => 1.0,
        }
    }
}

/// The shaping inputs of one rich run (core's `TextSegment` / `ResolvedTextSpan`
/// minus paint).
#[derive(Clone, Debug, PartialEq)]
pub struct RunStyle {
    pub family: String,
    pub size: f32,
    pub weight: f32,
    pub slant: Slant,
    pub letter_spacing: f32,
}

impl RunStyle {
    pub fn new(family: &str, size: f32) -> Self {
        RunStyle { family: family.to_string(), size, weight: 400.0, slant: Slant::Normal, letter_spacing: 0.0 }
    }
}

#[derive(Clone, Debug)]
pub struct TextRun {
    pub text: String,
    pub style: RunStyle,
}

/// One paragraph to lay out, and its options.
#[derive(Clone, Debug)]
pub struct Paragraph {
    pub runs: Vec<TextRun>,
    /// `TextState.lineHeight`: 0 = the font's own line height, else a
    /// multiplier of each run's size.
    pub line_height: f32,
    pub align: Align,
    /// Wrap width; `<= 0` or non-finite = no wrapping.
    pub max_width: f32,
    /// Box width used to place unwrapped text per `align`.
    pub box_width: f32,
}

impl Paragraph {
    pub fn single(text: &str, style: RunStyle) -> Self {
        Paragraph {
            runs: vec![TextRun { text: text.to_string(), style }],
            line_height: 0.0,
            align: Align::Center,
            max_width: 0.0,
            box_width: 0.0,
        }
    }

    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }
}

/// A positioned glyph.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Glyph {
    pub id: u32,
    /// Pen position (origin on the baseline), paragraph space, y down.
    pub x: f32,
    pub y: f32,
    /// Pen advance to the next glyph: the shaped advance, plus the
    /// cluster's letter spacing on its last glyph.
    pub advance: f32,
    /// UTF-16 offset of the glyph's cluster in the paragraph text.
    pub cluster: u32,
}

/// Glyphs of one line that share a face, size, `wght` and source run: the
/// unit a renderer draws (one font, one paint).
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphRun {
    pub line: u32,
    /// Index of the `TextRun` the glyphs come from.
    pub run: u32,
    pub font: FontId,
    pub size: f32,
    /// The `wght` the face was instanced at, for variable faces.
    pub wght: Option<f32>,
    pub glyphs: Vec<Glyph>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// `[start, end)` UTF-16 range; a soft-wrapped line keeps its trailing
    /// spaces, a hard break belongs to neither line (core's convention).
    pub start: u32,
    pub end: u32,
    /// Line box, paragraph space.
    pub top: f32,
    pub bottom: f32,
    pub baseline: f32,
    /// Ascent/descent (positive) the box was built from.
    pub ascent: f32,
    pub descent: f32,
    /// Left edge and width of the content, trailing whitespace excluded.
    pub left: f32,
    pub width: f32,
    /// Caret x per slot, `end - start + 1` of them, paragraph space.
    pub carets: Vec<f32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ParagraphLayout {
    /// Width the paragraph was laid out at: the wrap width, or
    /// `max(ceil(max_intrinsic) + 1, box_width)` unwrapped (a second pass at
    /// the measured width).
    pub layout_width: f32,
    /// Longest line (block width).
    pub width: f32,
    pub height: f32,
    /// Widest hard paragraph, unwrapped.
    pub max_intrinsic: f32,
    pub lines: Vec<Line>,
    pub runs: Vec<GlyphRun>,
}

#[derive(Clone, Debug)]
struct Cluster {
    /// Byte range in the paragraph text.
    start: u32,
    end: u32,
    /// Glyph range in `glyphs`.
    g0: u32,
    g1: u32,
    /// Advance including letter spacing.
    width: f32,
    run: u32,
    item: u32,
    whitespace: bool,
    hard: bool,
    break_after: bool,
}

#[derive(Clone, Debug)]
struct Item {
    font: FontId,
    run: u32,
    size: f32,
    wght: Option<f32>,
    /// Metrics, px.
    ascent: f32,
    descent: f32,
    leading: f32,
}

pub struct Layouter {
    buffer: Option<Buffer>,
}

impl Default for Layouter {
    fn default() -> Self {
        Self::new()
    }
}

impl Layouter {
    pub fn new() -> Self {
        Layouter { buffer: Some(Buffer::new()) }
    }

    pub fn layout(&mut self, fonts: &mut FontStore, para: &Paragraph) -> ParagraphLayout {
        let text = para.text();
        if text.is_empty() || para.runs.is_empty() || fonts.is_empty() {
            return ParagraphLayout::default();
        }
        let shaped = self.shape(fonts, para, &text);
        let wrapping = para.max_width.is_finite() && para.max_width > 0.0;
        let max_intrinsic = shaped.max_intrinsic();
        let layout_width = if wrapping {
            para.max_width
        } else {
            (max_intrinsic.ceil() + 1.0).max(para.box_width)
        };
        let mut out = shaped.lines(para, &text, if wrapping { para.max_width } else { f32::INFINITY }, layout_width);
        out.layout_width = layout_width;
        out.max_intrinsic = max_intrinsic;
        out
    }

    fn shape(&mut self, fonts: &mut FontStore, para: &Paragraph, text: &str) -> Shaped {
        // Byte range of each run.
        let mut run_ranges = Vec::with_capacity(para.runs.len());
        let mut at = 0u32;
        for r in &para.runs {
            run_ranges.push((at, at + r.text.len() as u32));
            at += r.text.len() as u32;
        }

        // Hard breaks (mandatory opportunities other than the end of text).
        let mut hard_after = Vec::new();
        let mut soft_after = Vec::new();
        for (pos, op) in linebreaks(text) {
            match op {
                BreakOpportunity::Mandatory if pos < text.len() => hard_after.push(pos as u32),
                BreakOpportunity::Mandatory => {}
                BreakOpportunity::Allowed => soft_after.push(pos as u32),
            }
        }

        // Itemize: (byte range, face, run) with newline characters cut out.
        struct Piece {
            start: u32,
            end: u32,
            font: FontId,
            run: u32,
            hard: bool,
        }
        let mut pieces: Vec<Piece> = Vec::new();
        for (ri, r) in para.runs.iter().enumerate() {
            let (base, _) = run_ranges[ri];
            let primary = fonts.match_face(&r.style.family, r.style.weight, r.style.slant).unwrap_or(FontId(0));
            for (off, c) in r.text.char_indices() {
                let start = base + off as u32;
                let end = start + c.len_utf8() as u32;
                let hard = is_line_terminator(c);
                let font = if hard || c.is_whitespace() || c.is_control() || fonts.has_glyph(primary, c) {
                    primary
                } else {
                    fonts.fallback_chain(&r.style.family).find(|f| fonts.has_glyph(*f, c)).unwrap_or(primary)
                };
                match pieces.last_mut() {
                    Some(p) if !hard && !p.hard && p.font == font && p.run == ri as u32 && p.end == start => p.end = end,
                    // \r\n is one break.
                    Some(p) if hard && p.hard && p.end == start && &text[p.start as usize..p.end as usize] == "\r" && c == '\n' => {
                        p.end = end
                    }
                    _ => pieces.push(Piece { start, end, font, run: ri as u32, hard }),
                }
            }
        }

        // Instance faces and merge adjacent pieces with one shaping key.
        let mut items: Vec<Item> = Vec::new();
        let mut spans: Vec<(u32, u32, u32, bool)> = Vec::new(); // (start, end, item, hard)
        for p in &pieces {
            let style = &para.runs[p.run as usize].style;
            let (font, wght) = fonts.face_mut(p.font).instance(style.weight);
            let m = crate::font::face_metrics(&font);
            let k = style.size / m.upem;
            let item = Item {
                font: p.font,
                run: p.run,
                size: style.size,
                wght,
                ascent: m.ascent * k,
                descent: m.descent * k,
                leading: m.leading * k,
            };
            let same_key = |a: &Item| a.font == item.font && a.size == item.size && a.wght == item.wght;
            let merge = !p.hard
                && matches!(spans.last(), Some(&(_, end, idx, false)) if end == p.start && same_key(&items[idx as usize]));
            if merge {
                spans.last_mut().unwrap().1 = p.end;
            } else {
                items.push(item);
                spans.push((p.start, p.end, items.len() as u32 - 1, p.hard));
            }
        }

        // Shape and build clusters.
        let mut buffer = self.buffer.take().unwrap_or_default();
        let mut glyphs: Vec<ShapedGlyph> = Vec::new();
        let mut clusters: Vec<Cluster> = Vec::new();
        let run_of = |byte: u32| run_ranges.iter().position(|&(s, e)| byte >= s && byte < e).unwrap_or(0) as u32;
        for &(start, end, idx, hard) in &spans {
            let item = &items[idx as usize];
            if hard {
                clusters.push(Cluster {
                    start,
                    end,
                    g0: glyphs.len() as u32,
                    g1: glyphs.len() as u32,
                    width: 0.0,
                    run: item.run,
                    item: idx,
                    whitespace: true,
                    hard: true,
                    break_after: true,
                });
                continue;
            }
            let face = fonts.face_mut(item.font);
            let (font, wght) = face.instance(para.runs[item.run as usize].style.weight);
            let bytes = face.bytes.clone();
            let varied = wght.and_then(|w| VariedAdvances::new(&bytes, w));
            let g_start = glyphs.len();
            shape_item(&font, varied.as_ref(), item.size, &text[start as usize..end as usize], start, &mut buffer, &mut glyphs);
            // Group glyphs by cluster (monotone, left-to-right).
            let mut gi = g_start;
            while gi < glyphs.len() {
                let c = glyphs[gi].cluster;
                let mut gj = gi + 1;
                while gj < glyphs.len() && glyphs[gj].cluster == c {
                    gj += 1;
                }
                let c_end = if gj < glyphs.len() { glyphs[gj].cluster } else { end };
                let run = run_of(c);
                let ls = para.runs[run as usize].style.letter_spacing;
                let adv: f32 = glyphs[gi..gj].iter().map(|g| g.advance).sum();
                let s = &text[c as usize..c_end as usize];
                clusters.push(Cluster {
                    start: c,
                    end: c_end,
                    g0: gi as u32,
                    g1: gj as u32,
                    width: adv + ls,
                    run,
                    item: idx,
                    whitespace: !s.is_empty() && s.chars().all(char::is_whitespace),
                    hard: false,
                    break_after: false,
                });
                gi = gj;
            }
        }
        self.buffer = Some(buffer);

        // Mark soft opportunities on cluster ends.
        let mut ci = 0;
        for b in soft_after {
            while ci < clusters.len() && clusters[ci].end < b {
                ci += 1;
            }
            if ci < clusters.len() && clusters[ci].end == b {
                clusters[ci].break_after = true;
            }
        }
        let _ = hard_after;

        Shaped { glyphs, clusters, items, text_len: text.len() as u32 }
    }
}

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{0B}' | '\u{0C}' | '\u{85}' | '\u{2028}' | '\u{2029}')
}

struct Shaped {
    glyphs: Vec<ShapedGlyph>,
    clusters: Vec<Cluster>,
    items: Vec<Item>,
    text_len: u32,
}

/// A line as cluster indices: `[c0, c1)`, content up to `content_end`.
struct LineSpan {
    c0: usize,
    c1: usize,
    content_end: usize,
    hard: bool,
}

impl Shaped {
    /// Widest hard paragraph, trailing whitespace excluded (a whitespace-only
    /// one counts its whitespace).
    fn max_intrinsic(&self) -> f32 {
        let mut best = 0.0f32;
        let mut w = 0.0f32;
        let mut content = 0.0f32;
        for c in &self.clusters {
            if c.hard {
                best = best.max(if content.abs() < 1e-4 { w } else { content });
                w = 0.0;
                content = 0.0;
                continue;
            }
            w += c.width;
            if !c.whitespace {
                content = w;
            }
        }
        // A whitespace-only paragraph counts its whitespace, as SkParagraph.
        best.max(if content.abs() < 1e-4 { w } else { content })
    }

    fn break_lines(&self, max_width: f32) -> Vec<LineSpan> {
        let cl = &self.clusters;
        let n = cl.len();
        let mut lines = Vec::new();
        // Tolerance for float noise when a word fits exactly.
        let fits = |w: f32| w <= max_width + 1e-4;
        let mut start = 0usize;
        let mut i = 0usize;
        // Width of [start, i) including trailing whitespace, and of its content.
        let mut full = 0.0f32;
        let mut content_end = start;
        while i < n {
            // The next word: clusters up to and including a break opportunity.
            let mut j = i;
            let mut wfull = 0.0f32;
            let mut wcore = 0.0f32;
            let mut wcore_end = i;
            let mut hard = false;
            while j < n {
                let c = &cl[j];
                if c.hard {
                    hard = true;
                    j += 1;
                    break;
                }
                wfull += c.width;
                if !c.whitespace {
                    wcore = wfull;
                    wcore_end = j + 1;
                }
                j += 1;
                if c.break_after {
                    break;
                }
            }
            let line_empty = content_end == start;
            if !line_empty && !fits(full + wcore) {
                // Word goes to the next line.
                lines.push(LineSpan { c0: start, c1: i, content_end, hard: false });
                start = i;
                full = 0.0;
                content_end = start;
                continue;
            }
            if line_empty && wcore_end > i && !fits(full + wcore) {
                // A word wider than the line: break it between clusters.
                let mut k = i;
                let mut w = full;
                while k < wcore_end {
                    if k > i && !fits(w + cl[k].width) {
                        break;
                    }
                    w += cl[k].width;
                    k += 1;
                }
                if k < wcore_end {
                    lines.push(LineSpan { c0: start, c1: k, content_end: k, hard: false });
                    start = k;
                    i = k;
                    full = 0.0;
                    content_end = start;
                    continue;
                }
            }
            // Word joins the line.
            if wcore_end > i {
                content_end = wcore_end;
            }
            full += wfull;
            i = j;
            if hard {
                lines.push(LineSpan { c0: start, c1: i, content_end, hard: true });
                start = i;
                full = 0.0;
                content_end = start;
            }
        }
        // The last line, which is empty after a trailing hard break.
        let ends_hard = n > 0 && cl[n - 1].hard;
        if start < n || ends_hard || lines.is_empty() {
            lines.push(LineSpan { c0: start, c1: n, content_end, hard: false });
        }
        lines
    }

    fn lines(&self, para: &Paragraph, text: &str, max_width: f32, layout_width: f32) -> ParagraphLayout {
        let spans = self.break_lines(max_width);
        let u16_at = utf16_offsets(text);
        let cl = &self.clusters;
        let lh = para.line_height;
        let mut out = ParagraphLayout::default();
        let mut y = 0.0f32;
        let last_line = spans.len() - 1;
        for (li, span) in spans.iter().enumerate() {
            // Metrics: every item on the line; an empty line takes the item
            // at its position (the break's own, or the last).
            let mut asc = 0.0f32;
            let mut desc = 0.0f32;
            let mut any = false;
            let mut seen: Vec<u32> = Vec::new();
            let mut take = |item: &Item| {
                let (mut a, mut d) = (item.ascent + item.leading * 0.5, item.descent + item.leading * 0.5);
                if lh > 0.0 && a + d > 0.0 {
                    let m = lh * item.size / (a + d);
                    a *= m;
                    d *= m;
                }
                asc = asc.max(a);
                desc = desc.max(d);
            };
            for c in &cl[span.c0..span.c1] {
                if c.hard && span.c1 - span.c0 > 1 {
                    continue;
                }
                if !seen.contains(&c.item) {
                    seen.push(c.item);
                    take(&self.items[c.item as usize]);
                    any = true;
                }
            }
            if !any {
                let idx = if span.c0 < cl.len() { cl[span.c0].item } else { cl.last().map(|c| c.item).unwrap_or(0) };
                take(&self.items[idx as usize]);
            }
            let h = (asc + desc).round();
            let baseline = y + h - desc;

            // Horizontal placement.
            let content_w: f32 = cl[span.c0..span.content_end].iter().map(|c| c.width).sum();
            let justify = para.align == Align::Justify && li != last_line && !span.hard;
            let mut extra_at: Vec<(usize, f32)> = Vec::new();
            let (left, width) = if justify && content_w < layout_width {
                // Slack over whitespace patches inside the content.
                let mut patches = Vec::new();
                let mut in_patch = false;
                for k in span.c0..span.content_end {
                    if cl[k].whitespace && !cl[k].hard {
                        if !in_patch {
                            patches.push(k);
                        }
                        in_patch = true;
                    } else {
                        in_patch = false;
                    }
                }
                if patches.is_empty() {
                    (0.0, content_w)
                } else {
                    let step = (layout_width - content_w) / patches.len() as f32;
                    extra_at = patches.into_iter().map(|k| (k, step)).collect();
                    (0.0, layout_width)
                }
            } else {
                ((layout_width - content_w) * para.align.factor(), content_w)
            };

            // Glyphs and carets.
            let line_start16 = u16_at[cl.get(span.c0).map(|c| c.start).unwrap_or(self.text_len) as usize];
            // The line's text runs to the next line's first cluster, minus a hard break.
            let mut end_byte = cl.get(span.c1).map(|c| c.start).unwrap_or(self.text_len);
            if span.c1 > span.c0 && cl[span.c1 - 1].hard {
                end_byte = cl[span.c1 - 1].start;
            }
            let line_end16 = u16_at[end_byte as usize];
            let mut carets = Vec::with_capacity((line_end16 - line_start16 + 1) as usize);
            let mut x = left;
            let mut ex = 0usize;
            for k in span.c0..span.c1 {
                let c = &cl[k];
                if c.hard {
                    continue;
                }
                let mut w = c.width;
                while ex < extra_at.len() && extra_at[ex].0 == k {
                    w += extra_at[ex].1;
                    ex += 1;
                }
                // Glyphs; trailing whitespace past the content is a ghost
                // and draws nothing (SkParagraph leaves it out too).
                let item = &self.items[c.item as usize];
                // A justified whitespace cluster takes its slack before its
                // glyph, as SkParagraph shifts it.
                let mut gx = x + (w - c.width);
                let ghost = k >= span.content_end;
                let cluster_glyphs = &self.glyphs[c.g0 as usize..if ghost { c.g0 } else { c.g1 } as usize];
                let shaped: f32 = cluster_glyphs.iter().map(|g| g.advance).sum();
                for (gi, g) in cluster_glyphs.iter().enumerate() {
                    let advance = if gi + 1 == cluster_glyphs.len() { g.advance + (c.width - shaped) } else { g.advance };
                    let glyph = Glyph { id: g.id, x: gx + g.x_offset, y: baseline + g.y_offset, advance, cluster: u16_at[c.start as usize] };
                    match out.runs.last_mut() {
                        Some(r) if r.line == li as u32 && r.run == c.run && r.font == item.font && r.size == item.size && r.wght == item.wght => {
                            r.glyphs.push(glyph)
                        }
                        _ => out.runs.push(GlyphRun {
                            line: li as u32,
                            run: c.run,
                            font: item.font,
                            size: item.size,
                            wght: item.wght,
                            glyphs: vec![glyph],
                        }),
                    }
                    gx += g.advance;
                }
                // Carets: a cluster's width split evenly over its UTF-16 units
                // (a ligature's characters each get a share).
                let s16 = u16_at[c.start as usize];
                let e16 = u16_at[c.end as usize];
                let n16 = (e16 - s16).max(1);
                for u in 0..(e16 - s16) {
                    carets.push(x + w * u as f32 / n16 as f32);
                }
                x += w;
            }
            carets.push(x);
            carets.truncate((line_end16 - line_start16 + 1) as usize);
            while carets.len() < (line_end16 - line_start16 + 1) as usize {
                carets.push(x);
            }
            let with_spaces: f32 = cl[span.c0..span.c1].iter().map(|c| c.width).sum();
            out.lines.push(Line {
                start: line_start16,
                end: line_end16,
                top: baseline - asc,
                bottom: baseline + desc,
                baseline,
                ascent: asc,
                descent: desc,
                left,
                width,
                carets,
            });
            // The longest line is measured before justification. A line with no
            // advance but its whitespace counts that whitespace, as SkParagraph's
            // ParagraphImpl does (`nearlyZero(advance) ? widthWithTrailingSpaces`),
            // so measuring " " is a space's width (core counts wrapped lines by
            // measuring words and spaces separately).
            out.width = out.width.max(if content_w.abs() < 1e-4 { with_spaces } else { content_w });
            y += h;
        }
        out.height = y;
        out
    }
}

/// UTF-16 offset of every byte position (valid at char boundaries).
fn utf16_offsets(text: &str) -> Vec<u32> {
    let mut v = vec![0u32; text.len() + 1];
    let mut u = 0u32;
    for (b, c) in text.char_indices() {
        for k in 0..c.len_utf8() {
            v[b + k] = u;
        }
        u += c.len_utf16() as u32;
    }
    v[text.len()] = u;
    v
}

/// UTF-16 length of `s`.
pub fn utf16_len(s: &str) -> u32 {
    s.chars().map(|c| c.len_utf16() as u32).sum()
}

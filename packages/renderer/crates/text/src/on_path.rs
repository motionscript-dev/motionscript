//! Text on a path: each glyph's transform from arc length.
//!
//! The string is shaped as one
//! unwrapped, left-aligned line (newlines become spaces), the line is offset
//! along the path by `textAlign` against the path length, and each glyph is
//! centred on the point at the arc length of its advance midpoint, rotated to
//! the tangent there, and raised off the path by its own baseline offset.
//! Glyphs whose midpoint falls off either end are dropped.

use crate::layout::{Align, Glyph, ParagraphLayout};

/// A flattened path: one or more polylines, measured end to end in order
/// (core's `PathSampler` treats contours the same way).
#[derive(Clone, Debug, Default)]
pub struct Polyline {
    points: Vec<[f32; 2]>,
    /// Cumulative length at each point.
    lengths: Vec<f32>,
    /// Index of the first point of each contour.
    starts: Vec<usize>,
    pub length: f32,
}

impl Polyline {
    pub fn new(contours: &[Vec<[f32; 2]>]) -> Self {
        let mut p = Polyline::default();
        let mut total = 0.0f32;
        for c in contours {
            if c.is_empty() {
                continue;
            }
            p.starts.push(p.points.len());
            for (i, pt) in c.iter().enumerate() {
                if i > 0 {
                    let q = c[i - 1];
                    total += ((pt[0] - q[0]).powi(2) + (pt[1] - q[1]).powi(2)).sqrt();
                }
                p.points.push(*pt);
                p.lengths.push(total);
            }
        }
        p.length = total;
        p
    }

    /// Point and unit tangent at distance `d`, clamped to `[0, length]`.
    pub fn frame_at(&self, d: f32) -> Option<([f32; 2], [f32; 2])> {
        if self.length <= 0.0 {
            return None;
        }
        let d = d.clamp(0.0, self.length);
        // First segment (within a contour) whose end reaches d with nonzero length.
        let n = self.points.len();
        let mut best = None;
        for i in 1..n {
            if self.starts.contains(&i) {
                continue;
            }
            let (l0, l1) = (self.lengths[i - 1], self.lengths[i]);
            if l1 > l0 {
                best = Some(i);
                if l1 >= d {
                    break;
                }
            }
        }
        let i = best?;
        let (a, b) = (self.points[i - 1], self.points[i]);
        let (l0, l1) = (self.lengths[i - 1], self.lengths[i]);
        let t = ((d - l0) / (l1 - l0)).clamp(0.0, 1.0);
        let len = l1 - l0;
        Some(([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [(b[0] - a[0]) / len, (b[1] - a[1]) / len]))
    }
}

/// A glyph placed on the path. Draw it with
/// `translate(x, y) · rotate(angle) · translate(-half_advance, 0)`, which is
/// [`PlacedGlyph::matrix`].
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PlacedGlyph {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    /// Radians, y-down (clockwise on screen).
    pub angle: f32,
    pub half_advance: f32,
    /// Index into the layout's `runs` (face, size, `wght`).
    pub run: u32,
}

impl PlacedGlyph {
    /// Affine `[a, b, c, d, e, f]` (x' = a·x + c·y + e, y' = b·x + d·y + f)
    /// taking glyph space (pen origin on the baseline) to path space.
    pub fn matrix(&self) -> [f32; 6] {
        let (s, c) = self.angle.sin_cos();
        [c, s, -s, c, self.x - c * self.half_advance, self.y - s * self.half_advance]
    }
}

/// Places the glyphs of `layout` (a single unwrapped line, laid out with
/// [`Align::Left`]) along `path`, offset by `align`.
pub fn place_on_path(layout: &ParagraphLayout, path: &Polyline, align: Align) -> Vec<PlacedGlyph> {
    let Some(line) = layout.lines.first() else { return Vec::new() };
    let baseline = line.baseline;
    // The line's trailing slot: where the pen ends after the last glyph.
    let text_width: f32 = layout
        .runs
        .iter()
        .filter(|r| r.line == 0)
        .flat_map(|r| r.glyphs.last())
        .map(|g| g.x + g.advance)
        .fold(0.0, f32::max);
    let offset = match align {
        Align::Right | Align::End => path.length - text_width,
        Align::Center => (path.length - text_width) / 2.0,
        _ => 0.0,
    };
    let mut out = Vec::new();
    for (ri, run) in layout.runs.iter().enumerate().filter(|(_, r)| r.line == 0) {
        for g in &run.glyphs {
            let Glyph { id, x, y, advance, .. } = *g;
            let d = x + advance / 2.0 + offset;
            if d < 0.0 || d > path.length {
                continue;
            }
            let Some((p, t)) = path.frame_at(d) else { continue };
            let perp = y - baseline;
            out.push(PlacedGlyph {
                id,
                x: p[0] - perp * t[1],
                y: p[1] + perp * t[0],
                angle: t[1].atan2(t[0]),
                half_advance: advance / 2.0,
                run: ri as u32,
            });
        }
    }
    out
}

//! Font registry: bytes in, ids out, family matching and fallback.
//!
//! Faces are registered under a family name, a request
//! for `(family, weight, slant)` picks the closest face by CSS font matching,
//! and a variable face is then set to the requested `wght`. Static faces
//! ignore the axis.

use harfrust::font::attribute::Style;
use harfrust::{Font, Tag};
use std::collections::HashMap;
use std::sync::Arc;

/// A registered face. Dense index into the registry.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FontId(pub u32);

/// Upright, italic or oblique, as `TextState.fontStyle` names it.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Default)]
pub enum Slant {
    #[default]
    Normal,
    Italic,
    Oblique,
}

impl Slant {
    pub fn from_index(i: u32) -> Slant {
        match i {
            1 => Slant::Italic,
            2 => Slant::Oblique,
            _ => Slant::Normal,
        }
    }
}

pub const WGHT: Tag = Tag::new(b"wght");

/// Line metrics of a face at one location, in font units.
#[derive(Copy, Clone, Debug, Default)]
pub struct FaceMetrics {
    pub upem: f32,
    /// Positive, above the baseline.
    pub ascent: f32,
    /// Positive, below the baseline.
    pub descent: f32,
    pub leading: f32,
    pub underline_position: f32,
    pub underline_thickness: f32,
    pub strikeout_position: f32,
    pub strikeout_thickness: f32,
}

pub(crate) struct Face {
    pub family: String,
    pub bytes: Arc<Vec<u8>>,
    pub font: Font,
    pub weight: f32,
    pub slant: Slant,
    /// `wght` axis range, when the face is variable on weight.
    pub wght: Option<(f32, f32)>,
    /// Instances at a `wght` value (bits of the clamped f32).
    instances: HashMap<u32, Font>,
}

impl Face {
    /// The face at `weight` on its `wght` axis (clamped), or the face itself
    /// when it has no such axis.
    pub fn instance(&mut self, weight: f32) -> (Font, Option<f32>) {
        let Some((lo, hi)) = self.wght else {
            return (self.font.clone(), None);
        };
        let w = weight.clamp(lo, hi);
        let font = self
            .instances
            .entry(w.to_bits())
            .or_insert_with(|| self.font.instance_builder().variations([(WGHT, w)]).build())
            .clone();
        (font, Some(w))
    }
}

/// Reads the metrics lines are laid out with: `hhea` unless the font sets
/// `USE_TYPO_METRICS`, then `OS/2` typo; leading is the chosen line gap.
pub(crate) fn face_metrics(font: &Font) -> FaceMetrics {
    let m = font.metrics();
    let line = if m.use_typo_metrics { m.typo_line.or(m.hhea_line) } else { m.hhea_line.or(m.typo_line) };
    let (ascent, descent, leading) = match line {
        Some(l) => (l.ascender.to_f32(), -l.descender.to_f32(), l.line_gap.to_f32()),
        None => (m.units_per_em as f32 * 0.8, m.units_per_em as f32 * 0.2, 0.0),
    };
    let s = font.style_metrics();
    let (up, ut) = s
        .underline
        .map(|d| (-d.position.to_f32(), d.thickness.to_f32()))
        .unwrap_or((0.0, 0.0));
    let (sp, st) = s
        .strike_through
        .map(|d| (-d.position.to_f32(), d.thickness.to_f32()))
        .unwrap_or((0.0, 0.0));
    FaceMetrics {
        upem: m.units_per_em as f32,
        ascent,
        descent,
        leading,
        underline_position: up,
        underline_thickness: ut,
        strikeout_position: sp,
        strikeout_thickness: st,
    }
}

#[derive(Default)]
pub struct FontStore {
    pub(crate) faces: Vec<Face>,
    /// Lower-cased family name → faces registered under it.
    families: HashMap<String, Vec<FontId>>,
    /// Lower-cased family name → fallback faces tried (in order) for a
    /// character the matched face has no glyph for.
    family_fallbacks: HashMap<String, Vec<FontId>>,
    /// Tried after a family's own fallbacks.
    default_fallbacks: Vec<FontId>,
}

impl FontStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers font bytes under `family` (the engine's `loadFont` alias).
    /// Weight and slant come from the font itself (`OS/2`, `fvar`). Returns
    /// `None` if the bytes aren't a font.
    pub fn register(&mut self, bytes: Vec<u8>, family: &str) -> Option<FontId> {
        let bytes = Arc::new(bytes);
        let font = Font::new(bytes.clone() as Arc<dyn AsRef<[u8]> + Send + Sync>, 0)?;
        let attrs = font.default_attributes();
        let wght = font
            .axes()
            .iter()
            .find(|a| a.tag() == WGHT)
            .map(|a| (a.min_value(), a.max_value()));
        let slant = match attrs.style {
            Style::Italic => Slant::Italic,
            Style::Oblique(_) => Slant::Oblique,
            _ => Slant::Normal,
        };
        let id = FontId(self.faces.len() as u32);
        self.faces.push(Face {
            family: family.to_string(),
            bytes,
            font,
            weight: attrs.weight.value(),
            slant,
            wght,
            instances: HashMap::new(),
        });
        self.families.entry(family.to_lowercase()).or_default().push(id);
        Some(id)
    }

    /// Fallback faces for characters `family`'s matched face lacks.
    pub fn set_family_fallbacks(&mut self, family: &str, fallbacks: &[FontId]) {
        self.family_fallbacks.insert(family.to_lowercase(), fallbacks.to_vec());
    }

    /// Fallback faces tried for every family after its own list.
    pub fn set_default_fallbacks(&mut self, fallbacks: &[FontId]) {
        self.default_fallbacks = fallbacks.to_vec();
    }

    pub fn len(&self) -> usize {
        self.faces.len()
    }

    pub fn is_empty(&self) -> bool {
        self.faces.is_empty()
    }

    pub fn family_of(&self, id: FontId) -> Option<&str> {
        self.faces.get(id.0 as usize).map(|f| f.family.as_str())
    }

    /// The face a `(family, weight, slant)` request resolves to, by CSS font
    /// matching (slant first, then weight). Unknown family → the default
    /// fallbacks' first face, then any face.
    pub fn match_face(&self, family: &str, weight: f32, slant: Slant) -> Option<FontId> {
        let Some(ids) = self.families.get(&family.to_lowercase()) else {
            return self.default_fallbacks.first().copied().or(if self.faces.is_empty() { None } else { Some(FontId(0)) });
        };
        let order: &[Slant] = match slant {
            Slant::Normal => &[Slant::Normal, Slant::Oblique, Slant::Italic],
            Slant::Italic => &[Slant::Italic, Slant::Oblique, Slant::Normal],
            Slant::Oblique => &[Slant::Oblique, Slant::Italic, Slant::Normal],
        };
        for s in order {
            let cands: Vec<FontId> = ids.iter().copied().filter(|id| self.faces[id.0 as usize].slant == *s).collect();
            if cands.is_empty() {
                continue;
            }
            // A variable face covering the weight is an exact match.
            if let Some(id) = cands.iter().copied().find(|id| {
                matches!(self.faces[id.0 as usize].wght, Some((lo, hi)) if weight >= lo && weight <= hi)
            }) {
                return Some(id);
            }
            return Some(css_weight_match(&cands, weight, |id| self.faces[id.0 as usize].weight));
        }
        ids.first().copied()
    }

    /// Faces to try, in order, for a character the primary face lacks.
    pub(crate) fn fallback_chain(&self, family: &str) -> impl Iterator<Item = FontId> + '_ {
        self.family_fallbacks
            .get(&family.to_lowercase())
            .into_iter()
            .flatten()
            .chain(self.default_fallbacks.iter())
            .copied()
    }

    pub(crate) fn has_glyph(&self, id: FontId, c: char) -> bool {
        self.faces[id.0 as usize].font.charmap().map_unicode(c).is_some()
    }

    pub(crate) fn face_mut(&mut self, id: FontId) -> &mut Face {
        &mut self.faces[id.0 as usize]
    }

    /// Line metrics of `id` at `weight` (its `wght` axis), font units.
    pub fn metrics(&mut self, id: FontId, weight: f32) -> FaceMetrics {
        let (font, _) = self.face_mut(id).instance(weight);
        face_metrics(&font)
    }
}

/// CSS Fonts 4 §5.2 weight matching among faces of one slant.
fn css_weight_match(cands: &[FontId], want: f32, weight_of: impl Fn(FontId) -> f32) -> FontId {
    let exact = cands.iter().copied().find(|id| weight_of(*id) == want);
    if let Some(id) = exact {
        return id;
    }
    let below = || cands.iter().copied().filter(|id| weight_of(*id) < want).max_by(|a, b| weight_of(*a).total_cmp(&weight_of(*b)));
    let above = || cands.iter().copied().filter(|id| weight_of(*id) > want).min_by(|a, b| weight_of(*a).total_cmp(&weight_of(*b)));
    if (400.0..=500.0).contains(&want) {
        let up_to_500 = cands
            .iter()
            .copied()
            .filter(|id| weight_of(*id) > want && weight_of(*id) <= 500.0)
            .min_by(|a, b| weight_of(*a).total_cmp(&weight_of(*b)));
        up_to_500.or_else(below).or_else(above).unwrap()
    } else if want < 400.0 {
        below().or_else(above).unwrap()
    } else {
        above().or_else(below).unwrap()
    }
}

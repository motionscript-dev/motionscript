//! Variable-font advances at FreeType's precision.
//!
//! FreeType normalizes variation coordinates
//! (and runs `avar`, region scalars and `HVAR` deltas) in 16.16 fixed point
//! and then rounds the varied advance to whole font units. HarfBuzz and
//! read-fonts normalize to 2.14, which is close but flips the rounding for
//! advances that land within ~0.002 units of a half: at `wght` 650 Inter's
//! "g" is 545.5013 units in 2.14 and 545.4996 in 16.16, so FreeType gives 545
//! and a 2.14 shaper 546. This module redoes FreeType's arithmetic so
//! advances match it glyph for glyph at any weight.

use read_fonts::tables::hvar::Hvar;
use read_fonts::tables::variations::{DeltaSetIndexMap, ItemVariationStore};
use read_fonts::types::{GlyphId, Tag};
use read_fonts::{FontRef, TableProvider};

fn q16(v: f64) -> f64 {
    (v * 65536.0).round() / 65536.0
}

/// FreeType's normalized coordinates (16.16) for user-space `values`.
pub fn ft_normalized(font: &FontRef, values: &[(Tag, f32)]) -> Vec<f64> {
    let Ok(fvar) = font.fvar() else { return Vec::new() };
    let Ok(axes) = fvar.axes() else { return Vec::new() };
    let avar = font.avar().ok();
    let maps: Vec<_> = avar.as_ref().map(|a| a.axis_segment_maps().iter().collect()).unwrap_or_default();
    axes.iter()
        .enumerate()
        .map(|(i, a)| {
            let (min, def, max) = (a.min_value().to_f64(), a.default_value().to_f64(), a.max_value().to_f64());
            let v = values.iter().rev().find(|(t, _)| *t == a.axis_tag()).map(|(_, v)| *v as f64).unwrap_or(def).clamp(min, max);
            let mut n = if v < def && def > min {
                -q16((def - v) / (def - min))
            } else if v > def && max > def {
                q16((v - def) / (max - def))
            } else {
                0.0
            };
            if let Some(Ok(map)) = maps.get(i) {
                let pairs = map.axis_value_maps();
                for w in pairs.windows(2) {
                    let (f0, t0) = (w[0].from_coordinate().to_f32() as f64, w[0].to_coordinate().to_f32() as f64);
                    let (f1, t1) = (w[1].from_coordinate().to_f32() as f64, w[1].to_coordinate().to_f32() as f64);
                    if n >= f0 && n <= f1 {
                        n = if f1 > f0 { q16(t0 + (t1 - t0) * q16((n - f0) / (f1 - f0))) } else { t0 };
                        break;
                    }
                }
            }
            n
        })
        .collect()
}

/// `HVAR` region scalars at `coords`, each quantized like FreeType's.
pub fn region_scalars(ivs: &ItemVariationStore, coords: &[f64]) -> Vec<f64> {
    let Ok(list) = ivs.variation_region_list() else { return Vec::new() };
    list.variation_regions()
        .iter()
        .map(|r| {
            let Ok(r) = r else { return 0.0 };
            let mut s = 1.0f64;
            for (i, ax) in r.region_axes().iter().enumerate() {
                let (start, peak, end) = (ax.start_coord().to_f32() as f64, ax.peak_coord().to_f32() as f64, ax.end_coord().to_f32() as f64);
                let c = coords.get(i).copied().unwrap_or(0.0);
                if start > peak || peak > end || (start < 0.0 && end > 0.0 && peak != 0.0) || peak == 0.0 || c == peak {
                    continue;
                }
                if c <= start || c >= end {
                    return 0.0;
                }
                let f = if c < peak { q16((c - start) / (peak - start)) } else { q16((end - c) / (end - peak)) };
                s = q16(s * f);
            }
            s
        })
        .collect()
}

/// Advances of one variable-font instance, FreeType style.
pub struct VariedAdvances<'a> {
    font: FontRef<'a>,
    hvar: Option<(ItemVariationStore<'a>, Option<DeltaSetIndexMap<'a>>)>,
    scalars: Vec<f64>,
}

impl<'a> VariedAdvances<'a> {
    pub fn new(bytes: &'a [u8], wght: f32) -> Option<Self> {
        let font = FontRef::new(bytes).ok()?;
        let coords = ft_normalized(&font, &[(Tag::new(b"wght"), wght)]);
        let hvar: Option<Hvar> = font.hvar().ok();
        let hvar = hvar.and_then(|h| Some((h.item_variation_store().ok()?, h.advance_width_mapping().and_then(|m| m.ok()))));
        let scalars = hvar.as_ref().map(|(ivs, _)| region_scalars(ivs, &coords)).unwrap_or_default();
        hvar.as_ref()?;
        Some(VariedAdvances { font, hvar, scalars })
    }

    /// Advance in whole font units.
    pub fn advance(&self, glyph: GlyphId) -> Option<i32> {
        let hmtx = self.font.hmtx().ok()?;
        let base = hmtx.advance(glyph)? as f64;
        let (ivs, map) = self.hvar.as_ref()?;
        let (outer, inner) = match map {
            Some(m) => {
                let i = m.get(glyph.to_u32()).ok()?;
                (i.outer, i.inner)
            }
            None => (0, glyph.to_u32() as u16),
        };
        let data = ivs.item_variation_data().get(outer as usize)?.ok()?;
        let mut delta = 0.0f64;
        for (ri, d) in data.region_indexes().iter().zip(data.delta_set(inner)) {
            delta += q16(self.scalars.get(ri.get() as usize).copied().unwrap_or(0.0) * d as f64);
        }
        // FT_fixedToInt: round half up.
        Some((base + delta + 0.5).floor() as i32)
    }
}

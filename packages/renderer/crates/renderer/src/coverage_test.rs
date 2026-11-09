//! CPU port of the shader's path coverage (`band_area` in prim.wgsl), used to
//! check outlines without a GPU.

#![cfg(test)]

use crate::paths::*;
use crate::scene::{Member, Stroke, NONE};

fn seg_cov(xa: f32, xb: f32, x0: f32, w: f32) -> f32 {
    let (lo, hi) = (xa.min(xb), xa.max(xb));
    let d = hi - lo;
    if d < 1e-3 * w {
        return ((0.5 * (lo + hi) - x0) / w).clamp(0.0, 1.0);
    }
    let a = x0.clamp(lo, hi);
    let b = (x0 + w).clamp(lo, hi);
    let ramp = ((0.5 * (a + b) - x0) / w).clamp(0.0, 1.0);
    ((b - a) * ramp + (hi - b)) / d
}

fn area(segs: &[[f32; 4]], p: [f32; 2], fw: [f32; 2]) -> f32 {
    let x0 = p[0] - 0.5 * fw[0];
    let (y0, y1) = (p[1] - 0.5 * fw[1], p[1] + 0.5 * fw[1]);
    let mut acc = 0.0;
    for s in segs {
        let (mut s, mut dir) = (*s, 1.0);
        if s[1] > s[3] {
            s = [s[2], s[3], s[0], s[1]];
            dir = -1.0;
        }
        let ya = s[1].max(y0);
        let yb = s[3].min(y1);
        if yb <= ya {
            continue;
        }
        let slope = (s[2] - s[0]) / (s[3] - s[1]);
        let xa = s[0] + (ya - s[1]) * slope;
        let xb = s[0] + (yb - s[1]) * slope;
        acc += dir * seg_cov(xa, xb, x0, fw[0]) * (yb - ya);
    }
    acc / fw[1]
}

fn tile1() -> Vec<Member> {
    let t = |x: f32, y: f32| [1.0, 0.0, 0.0, 1.0, x, y];
    vec![
        Member { kind: 1, op: 0, transform: t(40.0, 60.0), size: [140.0, 120.0], radii: [18.0; 4], path: NONE, even_odd: false },
        Member { kind: 2, op: 0, transform: t(120.0, 110.0), size: [140.0, 140.0], radii: [0.0; 4], path: NONE, even_odd: false },
        Member { kind: 1, op: 0, transform: t(70.0, 170.0), size: [80.0, 80.0], radii: [0.0; 4], path: NONE, even_odd: false },
    ]
}

#[test]
fn union_fill_is_solid_inside_and_empty_outside() {
    let store = PathStore::default();
    let tol = tolerance(0);
    let outline = compound_outline(&tile1(), &store, tol);
    let mut segs = Vec::new();
    push_segments(&outline, tol, false, &mut segs);
    let mut worst_in = 0.0f32;
    for y in 0..40 {
        for x in 0..40 {
            let p = [70.0 + x as f32 * 2.3, 75.0 + y as f32 * 2.1];
            let c = area(&segs, p, [1.0, 1.0]).abs().min(1.0);
            worst_in = worst_in.max((1.0 - c).abs());
        }
    }
    let outside = area(&segs, [10.0, 10.0], [1.0, 1.0]).abs();
    assert!(worst_in < 1e-3, "inside coverage off by {worst_in}");
    assert!(outside < 1e-6, "outside coverage {outside}");
}

#[test]
fn union_stroke_is_empty_inside() {
    let store = PathStore::default();
    let tol = tolerance(0);
    let union = compound_outline(&tile1(), &store, tol);
    let st = Stroke { paint: 0, width: 3.0, join: 1, cap: 0, miter: 4.0, dash: NONE };
    let outline = stroke_outline(&union, &kurbo_stroke(&st, None), tol);
    let mut segs = Vec::new();
    push_segments(&outline, tol, false, &mut segs);
    let mut worst = (0.0f32, [0.0f32; 2]);
    for y in 0..40 {
        for x in 0..40 {
            let p = [70.0 + x as f32 * 2.3, 75.0 + y as f32 * 2.1];
            let c = area(&segs, p, [1.0, 1.0]).abs().min(1.0);
            if c > worst.0 {
                worst = (c, p);
            }
        }
    }
    assert!(worst.0 < 1e-3, "stroke leaks {} at {:?} ({} segments)", worst.0, worst.1, segs.len());
}

/// Coverage exactly as the shader reads it: only the pixel's band.
fn banded(cache: &GeomCache, o: &Outline, p: [f32; 2], fw: [f32; 2]) -> f32 {
    let n = o.band_count;
    let band = (((p[1] - o.y0) / o.band_h).floor().clamp(0.0, (n - 1) as f32)) as u32;
    let start = cache.bands[(o.band_add + band * 2) as usize] as usize;
    let count = cache.bands[(o.band_add + band * 2 + 1) as usize] as usize;
    let segs: Vec<[f32; 4]> = cache.bands[start..start + count].iter().map(|&k| cache.segs[k as usize]).collect();
    area(&segs, p, fw)
}

#[test]
fn banded_union_stroke_is_empty_inside() {
    let store = PathStore::default();
    let mut cache = GeomCache::default();
    let st = Stroke { paint: 0, width: 3.0, join: 1, cap: 0, miter: 4.0, dash: NONE };
    let key = GeomKey { source: GeomSource::Compound { node: 1, hash: 1 }, style: GeomStyle::Fill { even_odd: false }, zoom: 0 };
    let o = cache
        .get_or_build(key, 0, |tol| {
            let union = compound_outline(&tile1(), &store, tol);
            let outline = stroke_outline(&union, &kurbo_stroke(&st, None), tol);
            let mut add = Vec::new();
            push_segments(&outline, tol, false, &mut add);
            Some(Segments { add, sub: Vec::new(), even_odd: false })
        })
        .unwrap();
    let mut worst = (0.0f32, [0.0f32; 2]);
    for y in 0..400 {
        for x in 0..230 {
            let p = [45.0 + x as f32 * 1.0 + 0.37, 63.0 + y as f32 * 0.1];
            // Only points well inside the union (away from the stroke band).
            let inside = (p[0] > 62.0 && p[0] < 160.0 && p[1] > 66.0 && p[1] < 105.0)
                || ((p[0] - 190.0).powi(2) + (p[1] - 180.0).powi(2)).sqrt() < 60.0;
            if !inside {
                continue;
            }
            let c = banded(&cache, &o, p, [1.04, 1.04]).abs().min(1.0);
            if c > worst.0 {
                worst = (c, p);
            }
        }
    }
    assert!(worst.0 < 1e-3, "banded stroke leaks {} at {:?} (bands {}, h {})", worst.0, worst.1, o.band_count, o.band_h);
}

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
        .get_or_build(key, false, 0, |tol| {
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

/// A jagged closed polyline (a coastline): `n` points round a centre.
fn coast(n: usize, cx: f64, cy: f64, r: f64) -> kurbo::BezPath {
    let mut b = kurbo::BezPath::new();
    for i in 0..n {
        let a = i as f64 / n as f64 * std::f64::consts::TAU;
        let rr = r * (1.0 + 0.08 * (a * 13.0).sin() + 0.04 * (a * 57.0).cos());
        let p = (cx + rr * a.cos(), cy + rr * a.sin());
        if i == 0 {
            b.move_to(p)
        } else {
            b.line_to(p)
        }
    }
    b.close_path();
    b
}

fn circle(cx: f64, cy: f64, r: f64) -> kurbo::BezPath {
    let mut b = kurbo::BezPath::new();
    let k = 0.552_284_8 * r;
    b.move_to((cx + r, cy));
    b.curve_to((cx + r, cy + k), (cx + k, cy + r), (cx, cy + r));
    b.curve_to((cx - k, cy + r), (cx - r, cy + k), (cx - r, cy));
    b.curve_to((cx - r, cy - k), (cx - k, cy - r), (cx, cy - r));
    b.curve_to((cx + k, cy - r), (cx + r, cy - k), (cx + r, cy));
    b.close_path();
    b
}

fn path_key(id: u32, zoom: i8) -> GeomKey {
    GeomKey { source: GeomSource::Path { id, version: 1 }, style: GeomStyle::Fill { even_odd: false }, zoom }
}

fn fill_of(path: &kurbo::BezPath) -> impl Fn(f64) -> Option<Segments> + '_ {
    move |tol| {
        let mut add = Vec::new();
        push_segments(path, tol, false, &mut add);
        Some(Segments { add, sub: Vec::new(), even_odd: false })
    }
}

/// Worst coverage error over a grid as the shader reads it at `zoom` (a
/// device pixel is 2^-zoom local units): `inside` says 1, 0 or don't care.
fn worst_banded(cache: &GeomCache, o: &Outline, zoom: i8, inside: impl Fn(f32, f32, f32) -> Option<bool>) -> f32 {
    let fw = 1.04 * 2f32.powi(-(zoom as i32));
    let (w, h) = (o.bounds[2] - o.bounds[0] + 10.0, o.bounds[3] - o.bounds[1] + 10.0);
    let mut worst = 0.0f32;
    for y in 0..120 {
        for x in 0..120 {
            let p = [o.bounds[0] - 5.0 + w * (x as f32 + 0.37) / 120.0, o.bounds[1] - 5.0 + h * (y as f32 + 0.61) / 120.0];
            let Some(want) = inside(p[0], p[1], fw) else { continue };
            let c = banded(cache, o, p, [fw, fw]).abs().min(1.0);
            worst = worst.max((c - if want { 1.0 } else { 0.0 }).abs());
        }
    }
    worst
}

#[test]
fn a_curve_free_fill_flattens_once_for_every_zoom() {
    let path = coast(4000, 200.0, 200.0, 150.0);
    let mut cache = GeomCache::default();
    let within = |x: f32, y: f32, fw: f32| {
        let d = ((x - 200.0).powi(2) + (y - 200.0).powi(2)).sqrt();
        if d < 130.0 - fw {
            Some(true)
        } else if d > 175.0 + fw {
            Some(false)
        } else {
            None
        }
    };
    let mut builds = 0;
    for (frame, zoom) in [0i8, 1, 2, 3, -1, -3, -6].into_iter().enumerate() {
        cache.begin_frame(frame as u64, true);
        let o = cache.get_or_build(path_key(1, zoom), true, frame as u64, fill_of(&path)).unwrap();
        builds += cache.built_this_frame;
        assert_eq!(cache.banded_this_frame, 1, "zoom {zoom} builds its own bands");
        let worst = worst_banded(&cache, &o, zoom, within);
        assert!(worst < 1e-3, "zoom {zoom}: coverage off by {worst}");
    }
    assert_eq!(builds, 1, "one flattening serves every zoom");
    cache.begin_frame(9, true);
    cache.get_or_build(path_key(1, 3), true, 9, fill_of(&path)).unwrap();
    assert_eq!((cache.built_this_frame, cache.banded_this_frame), (0, 0), "a zoom seen before reuses its bands");
}

#[test]
fn a_finer_flattening_serves_smaller_scales() {
    let path = circle(100.0, 100.0, 80.0);
    let mut cache = GeomCache::default();
    let within = |x: f32, y: f32, fw: f32| {
        let d = ((x - 100.0).powi(2) + (y - 100.0).powi(2)).sqrt();
        if d < 79.0 - fw {
            Some(true)
        } else if d > 81.0 + fw {
            Some(false)
        } else {
            None
        }
    };
    let mut frame = 0u64;
    let mut at = |cache: &mut GeomCache, zoom: i8| {
        frame += 1;
        cache.begin_frame(frame, true);
        let o = cache.get_or_build(path_key(2, zoom), false, frame, fill_of(&path)).unwrap();
        let worst = worst_banded(cache, &o, zoom, within);
        assert!(worst < 1e-3, "zoom {zoom}: coverage off by {worst}");
        cache.built_this_frame
    };
    assert_eq!(at(&mut cache, 2), 1);
    for zoom in [1, 0, -1, -2] {
        assert_eq!(at(&mut cache, zoom), 0, "zoom {zoom} reuses zoom 2's segments");
    }
    assert_eq!(at(&mut cache, 3), 1, "a larger scale flattens finer");
    assert_eq!(at(&mut cache, -3), 1, "more than four buckets coarser flattens again");
    assert_eq!(at(&mut cache, -2), 0, "the nearest finer flattening serves");
}

#[test]
fn polyline_strokes_without_round_parts_are_lines_only() {
    let path = coast(500, 0.0, 0.0, 100.0);
    let mut open = kurbo::BezPath::new();
    for (i, el) in path.elements().iter().take(300).enumerate() {
        if let kurbo::PathEl::LineTo(p) | kurbo::PathEl::MoveTo(p) = el {
            if i == 0 {
                open.move_to(*p)
            } else {
                open.line_to(*p)
            }
        }
    }
    // Lines only at any tolerance; a coarse one leaves out joins that turn little.
    let st = Stroke { paint: 0, width: 2.5, join: 0, cap: 0, miter: 4.0, dash: NONE };
    let count = |tol: f64| stroke_outline(&path, &kurbo_stroke(&st, None), tol).elements().len();
    assert!(count(tolerance(-4)) < count(tolerance(8)));
    for (join, cap) in [(0u8, 0u8), (2, 2), (0, 2), (2, 0)] {
        for dash in [None, Some(crate::scene::Dash { intervals: vec![7.0, 3.0], phase: 1.5 })] {
            let st = Stroke { paint: 0, width: 2.5, join, cap, miter: 4.0, dash: NONE };
            for p in [&path, &open] {
                for tol in [tolerance(-4), tolerance(6)] {
                    let o = stroke_outline(p, &kurbo_stroke(&st, dash.as_ref()), tol);
                    let curved = o.elements().iter().any(|e| matches!(e, kurbo::PathEl::QuadTo(..) | kurbo::PathEl::CurveTo(..)));
                    assert!(!curved, "join {join} cap {cap} dashed {}: the outline has curves", dash.is_some());
                }
            }
        }
    }
}

/// The subtracted set's coverage, as the shader reads it.
fn sub_banded(cache: &GeomCache, o: &Outline, p: [f32; 2], fw: [f32; 2]) -> f32 {
    if o.band_sub == u32::MAX {
        return 0.0;
    }
    banded(cache, &Outline { band_add: o.band_sub, ..*o }, p, fw)
}

#[test]
fn a_sweep_evicts_stale_outlines_and_compaction_keeps_the_rest() {
    let paths: Vec<_> = (0..6).map(|i| coast(600, 100.0 + 40.0 * i as f64, 100.0, 60.0)).collect();
    let cut = circle(100.0, 100.0, 30.0);
    let mut cache = GeomCache::with_limits(2500, 1_000_000);
    let cut_key = GeomKey { source: GeomSource::Compound { node: 9, hash: 9 }, style: GeomStyle::Fill { even_odd: false }, zoom: 0 };
    let build_cut = |tol: f64| {
        let (mut add, mut sub) = (Vec::new(), Vec::new());
        push_segments(&paths[0], tol, false, &mut add);
        push_segments(&cut, tol, false, &mut sub);
        Some(Segments { add, sub, even_odd: false })
    };
    for (i, p) in paths.iter().enumerate() {
        cache.begin_frame(i as u64, true);
        cache.get_or_build(path_key(i as u32, 0), true, i as u64, fill_of(p)).unwrap();
    }
    cache.get_or_build(cut_key, false, 5, build_cut).unwrap();
    let probe = |cache: &mut GeomCache, frame: u64| {
        let o = cache.get_or_build(path_key(5, 0), true, frame, fill_of(&paths[5])).unwrap();
        let c = cache.get_or_build(cut_key, false, frame, build_cut).unwrap();
        let pts: Vec<[f32; 2]> = (0..400).map(|k| [40.0 + (k % 20) as f32 * 14.1, 30.0 + (k / 20) as f32 * 7.3]).collect();
        let a: Vec<f32> = pts.iter().map(|&p| banded(cache, &o, p, [1.0, 1.0])).collect();
        let b: Vec<f32> = pts.iter().map(|&p| banded(cache, &c, p, [1.0, 1.0]) - sub_banded(cache, &c, p, [1.0, 1.0])).collect();
        (a, b)
    };
    let before = probe(&mut cache, 6);
    let epoch = cache.epoch;
    assert!(cache.segs.len() > 2500);
    cache.begin_frame(20, true);
    assert!(cache.epoch > epoch && cache.reset, "the sweep compacts");
    assert!(cache.segs.len() <= 1250, "evicted down to half the limit: {} segments left", cache.segs.len());
    let after = probe(&mut cache, 20);
    assert_eq!(cache.built_this_frame, 0, "the recently used outlines stayed");
    assert_eq!(before, after, "compaction moved the outlines without changing them");
    cache.begin_frame(21, true);
    cache.get_or_build(path_key(0, 0), true, 21, fill_of(&paths[0])).unwrap();
    assert_eq!(cache.built_this_frame, 1, "an evicted outline builds again");
    let quiet = cache.epoch;
    cache.begin_frame(22, false);
    cache.begin_frame(23, false);
    assert_eq!(cache.epoch, quiet, "surface builds never sweep");
}

//! Layout, measurement and outlines against recorded reference numbers:
//! `tests/oracle.json` holds the expected results for the cases in
//! `cases.json`, frozen so stored documents keep laying out the same.
//!
//! Needs the engine checkout next to this repo for the fonts
//! (`../e2e/fonts`, or `MS_FONTS_DIR`); skips otherwise.

use ms_text::*;
use serde_json::Value;
use std::path::PathBuf;

fn fonts_dir() -> Option<PathBuf> {
    let p = std::env::var("MS_FONTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../e2e/fonts"));
    p.exists().then_some(p)
}

fn engine() -> Option<TextEngine> {
    let dir = fonts_dir()?;
    let mut e = TextEngine::new();
    e.register_font(std::fs::read(dir.join("inter/inter-regular.ttf")).ok()?, "Inter")?;
    e.register_font(std::fs::read(dir.join("fira-mono/fira-mono.ttf")).ok()?, "Fira Mono")?;
    Some(e)
}

fn load(name: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join(name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

pub fn paragraph(c: &Value) -> Paragraph {
    let runs = c["runs"].as_array().unwrap().iter().map(|r| TextRun {
        text: r["text"].as_str().unwrap().to_string(),
        style: RunStyle {
            family: r["family"].as_str().unwrap().to_string(),
            size: r["size"].as_f64().unwrap() as f32,
            weight: r["weight"].as_f64().unwrap() as f32,
            slant: match r["style"].as_str().unwrap() { "italic" => Slant::Italic, "oblique" => Slant::Oblique, _ => Slant::Normal },
            letter_spacing: r["letterSpacing"].as_f64().unwrap() as f32,
        },
    }).collect();
    let align = match c["align"].as_str().unwrap() {
        "left" => Align::Left, "right" => Align::Right, "justify" => Align::Justify,
        "start" => Align::Start, "end" => Align::End, _ => Align::Center,
    };
    Paragraph {
        runs,
        line_height: c["lineHeight"].as_f64().unwrap() as f32,
        align,
        max_width: c["maxWidth"].as_f64().unwrap() as f32,
        box_width: c["boxWidth"].as_f64().unwrap() as f32,
    }
}

#[test]
fn parity_with_recorded_layout() {
    let Some(mut e) = engine() else { eprintln!("fonts not found; skipping"); return };
    let cases = load("cases.json");
    let oracle = load("oracle.json");
    let mut failures = Vec::new();
    for c in cases.as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let o = &oracle[name]["layout"];
        let got = e.layout(&paragraph(c));
        let ol = o["lines"].as_array().unwrap();
        let breaks_ok = ol.len() == got.lines.len()
            && ol.iter().zip(&got.lines).all(|(a, b)| a["start"].as_u64() == Some(b.start as u64) && a["end"].as_u64() == Some(b.end as u64));
        let mut caret = 0f64;
        let mut lw = 0f64;
        let mut vert = 0f64;
        if breaks_ok {
            for (a, b) in ol.iter().zip(&got.lines) {
                lw = lw.max((a["width"].as_f64().unwrap() - b.width as f64).abs());
                lw = lw.max((a["left"].as_f64().unwrap() - b.left as f64).abs());
                for k in ["top", "bottom", "baseline"] {
                    let v = match k { "top" => b.top, "bottom" => b.bottom, _ => b.baseline };
                    vert = vert.max((a[k].as_f64().unwrap() - v as f64).abs());
                }
                for (x, y) in a["carets"].as_array().unwrap().iter().zip(&b.carets) {
                    caret = caret.max((x.as_f64().unwrap() - *y as f64).abs());
                }
            }
        }
        let og: Vec<(u64, f64)> = o["glyphs"].as_array().unwrap().iter().map(|g| (g["id"].as_u64().unwrap(), g["x"].as_f64().unwrap())).collect();
        let gg: Vec<(u64, f64)> = got.runs.iter().flat_map(|r| r.glyphs.iter().map(|g| (g.id as u64, g.x as f64))).collect();
        let ids_ok = og.len() == gg.len() && og.iter().zip(&gg).all(|(a, b)| a.0 == b.0);
        let gx = if ids_ok { og.iter().zip(&gg).map(|(a, b)| (a.1 - b.1).abs()).fold(0.0, f64::max) } else { f64::NAN };
        let dw = (o["width"].as_f64().unwrap() - got.width as f64).abs();
        let dh = (o["height"].as_f64().unwrap() - got.height as f64).abs();
        let dl = (o["layoutWidth"].as_f64().unwrap() - got.layout_width as f64).abs();
        println!("{name:18} breaks {:5} ids {:5} glyph-x {gx:7.4} caret {caret:7.4} line-w {lw:7.4} vert {vert:7.4} w {dw:7.4} h {dh:7.4} lw {dl:5.2}", breaks_ok, ids_ok);
        if !breaks_ok {
            println!("   want {:?}", ol.iter().map(|l| (l["start"].as_u64().unwrap(), l["end"].as_u64().unwrap())).collect::<Vec<_>>());
            println!("   got  {:?}", got.lines.iter().map(|l| (l.start, l.end)).collect::<Vec<_>>());
        }
        if !breaks_ok || !ids_ok || gx > 0.5 || caret > 0.5 || lw > 0.5 {
            failures.push(name.to_string());
        }
    }
    assert!(failures.is_empty(), "cases off: {failures:?}");
}

/// Glyph outlines against the recorded ones: tight bounds of
/// the path, y down, at the default location.
#[test]
fn outlines_match_recorded() {
    let Some(mut e) = engine() else { eprintln!("fonts not found; skipping"); return };
    let oracle = load("oracle.json");
    let mut worst = 0f32;
    for o in oracle["__outlines"].as_array().unwrap() {
        let id = e.fonts.match_face(o["family"].as_str().unwrap(), 400.0, Slant::Normal).unwrap();
        let size = o["size"].as_f64().unwrap() as f32;
        let p = e.fonts.glyph_path(id, o["id"].as_u64().unwrap() as u32, size, 400.0).unwrap();
        let b = tight_bounds(&p);
        let want: Vec<f32> = o["bounds"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
        for k in 0..4 {
            worst = worst.max((b[k] - want[k]).abs());
        }
    }
    println!("outline tight-bounds worst delta {worst:.5} px");
    assert!(worst < 0.01, "outline bounds off by {worst}");
}

/// Tight bounds by evaluating curves densely.
fn tight_bounds(p: &GlyphPath) -> [f32; 4] {
    let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    let mut add = |x: f32, y: f32| {
        b[0] = b[0].min(x);
        b[1] = b[1].min(y);
        b[2] = b[2].max(x);
        b[3] = b[3].max(y);
    };
    let (mut i, mut cur, mut start) = (0usize, [0f32; 2], [0f32; 2]);
    for &v in &p.verbs {
        match v {
            ms_text::outline::VERB_MOVE => { cur = p.points[i]; start = cur; add(cur[0], cur[1]); i += 1; }
            ms_text::outline::VERB_LINE => { cur = p.points[i]; add(cur[0], cur[1]); i += 1; }
            ms_text::outline::VERB_QUAD => {
                let (c, e) = (p.points[i], p.points[i + 1]);
                for s in 0..=256 {
                    let t = s as f32 / 256.0;
                    let u = 1.0 - t;
                    add(u * u * cur[0] + 2.0 * u * t * c[0] + t * t * e[0], u * u * cur[1] + 2.0 * u * t * c[1] + t * t * e[1]);
                }
                cur = e;
                i += 2;
            }
            ms_text::outline::VERB_CUBIC => {
                let (c1, c2, e) = (p.points[i], p.points[i + 1], p.points[i + 2]);
                for s in 0..=256 {
                    let t = s as f32 / 256.0;
                    let u = 1.0 - t;
                    let f = |a: f32, b: f32, c: f32, d: f32| u * u * u * a + 3.0 * u * u * t * b + 3.0 * u * t * t * c + t * t * t * d;
                    add(f(cur[0], c1[0], c2[0], e[0]), f(cur[1], c1[1], c2[1], e[1]));
                }
                cur = e;
                i += 3;
            }
            _ => cur = start,
        }
    }
    b
}

/// Text on a straight horizontal path: every glyph sits where the line layout
/// put it, unrotated, shifted by the alignment offset.
#[test]
fn text_on_straight_path() {
    let Some(mut e) = engine() else { return };
    let mut st = RunStyle::new("Inter", 40.0);
    st.weight = 700.0;
    let mut p = Paragraph::single("Curving Along the Arc", st);
    p.align = Align::Left;
    let l = e.layout(&p);
    let path = Polyline::new(&[vec![[-320.0, 80.0], [320.0, 80.0]]]);
    let placed = place_on_path(&l, &path, Align::Center);
    let glyphs: Vec<&Glyph> = l.runs.iter().flat_map(|r| &r.glyphs).collect();
    assert_eq!(placed.len(), glyphs.len());
    let last = glyphs.last().unwrap();
    let offset = (640.0 - (last.x + last.advance)) / 2.0;
    for (g, pg) in glyphs.iter().zip(&placed) {
        let m = pg.matrix();
        // The glyph origin maps to its line position on the path.
        assert!((m[4] - (-320.0 + offset + g.x)).abs() < 1e-3, "{} vs {}", m[4], -320.0 + offset + g.x);
        assert!((m[5] - 80.0).abs() < 1e-3);
        assert!(pg.angle.abs() < 1e-6);
    }
}

/// `measureText` and `layoutTextBlock` against the recorded paragraph numbers.
#[test]
fn block_contract() {
    let Some(mut e) = engine() else { return };
    let oracle = load("oracle.json");
    let cases = load("cases.json");
    for c in cases.as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let para = paragraph(c);
        for (r, want) in para.runs.iter().zip(oracle[name]["measure"].as_array().unwrap()) {
            let s = &r.style;
            let (w, h) = e.measure_text(&r.text, s.size, &s.family, s.weight, s.letter_spacing, s.slant);
            assert!((w as f64 - want["width"].as_f64().unwrap()).abs() < 0.01, "{name} measure w");
            assert!((h as f64 - want["height"].as_f64().unwrap()).abs() < 0.01, "{name} measure h");
        }
        let o = &oracle[name]["layout"];
        let lw = o["layoutWidth"].as_f64().unwrap() as f32;
        let state = TextBlockState {
            runs: para.runs.clone(),
            font_size: FontSize::Px(para.runs[0].style.size),
            min_font_size: 12.0,
            line_height: para.line_height,
            align: para.align,
            vertical_align: VerticalAlign::Center,
            wrap: para.max_width > 0.0,
            width: if para.max_width > 0.0 { para.max_width } else { para.box_width },
            height: 0.0,
        };
        let b = e.text_block_layout(&state).unwrap();
        let h = o["height"].as_f64().unwrap() as f32;
        for (ol, bl) in o["lines"].as_array().unwrap().iter().zip(&b.lines) {
            assert!((bl.top - (ol["top"].as_f64().unwrap() as f32 - h / 2.0)).abs() < 1e-3, "{name} top");
            for (x, y) in ol["carets"].as_array().unwrap().iter().zip(&bl.carets) {
                assert!((*y - (x.as_f64().unwrap() as f32 - lw / 2.0)).abs() < 0.01, "{name} caret");
            }
        }
    }
    // Empty text: one zero-width slot as tall as a line of the face.
    let state = TextBlockState {
        runs: vec![TextRun { text: String::new(), style: RunStyle::new("Inter", 30.0) }],
        font_size: FontSize::Px(30.0),
        min_font_size: 12.0,
        line_height: 0.0,
        align: Align::Center,
        vertical_align: VerticalAlign::Center,
        wrap: false,
        width: 0.0,
        height: 0.0,
    };
    let b = e.text_block_layout(&state).unwrap();
    assert_eq!(b.lines.len(), 1);
    assert_eq!(b.lines[0].carets, vec![0.0]);
    assert!((b.height - 36.0).abs() < 1e-3);
}

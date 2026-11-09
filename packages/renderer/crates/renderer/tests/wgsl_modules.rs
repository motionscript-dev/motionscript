//! Every WGSL module the renderer ships passes naga's validation natively, so
//! a broken shader fails `cargo test` instead of the first frame in a browser.
//! Modules are discovered, not listed: the built-in effects through
//! `effects::EFFECTS`, standalone `.wgsl` files under each crate's `src/`
//! (effect bodies aside, which need their header), and `*_WGSL` raw-string
//! consts in the crates' Rust sources.

use std::fs;
use std::path::{Path, PathBuf};

use ms_renderer::{effects, user_shader};

fn validate(name: &str, src: &str) -> Result<naga::Module, String> {
    let module = naga::front::wgsl::parse_str(src).map_err(|e| format!("{name}: {}", e.emit_to_string(src)))?;
    naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::default())
        .validate(&module)
        .map_err(|e| format!("{name}: {}", e.emit_to_string(src)))?;
    Ok(module)
}

fn crates_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            walk(&path, out);
        } else {
            out.push(path);
        }
    }
}

fn sources() -> Vec<PathBuf> {
    let mut files = Vec::new();
    for krate in fs::read_dir(crates_dir()).unwrap() {
        let src = krate.unwrap().path().join("src");
        if src.is_dir() {
            walk(&src, &mut files);
        }
    }
    files.sort();
    files
}

/// An effect's generated parameter accessors (`effects/gen/`), only valid in front of its body.
fn is_effect_params(path: &Path) -> bool {
    path.parent().is_some_and(|d| d.ends_with("effects/gen"))
}

fn is_effect_part(path: &Path) -> bool {
    path.parent().and_then(Path::file_name).is_some_and(|d| d == "effects")
}

/// `const NAME_WGSL: &str = r#"…"#;` in a Rust source.
fn inline_modules(rs: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = rs;
    while let Some(at) = rest.find("const ") {
        rest = &rest[at + 6..];
        let Some((name, tail)) = rest.split_once(':') else { break };
        let name = name.trim();
        if !name.ends_with("_WGSL") {
            continue;
        }
        let Some(open) = tail.find("r#\"") else { break };
        let body = &tail[open + 3..];
        let Some(close) = body.find("\"#") else { break };
        out.push((name.to_string(), body[..close].to_string()));
        rest = &body[close..];
    }
    out
}

fn has_entry(module: &naga::Module, name: &str) -> bool {
    module.entry_points.iter().any(|e| e.name == name)
}

#[test]
fn built_in_effects_validate() {
    let mut failures = Vec::new();
    for (name, body) in effects::EFFECTS {
        let (src, prefilter) = effects::module(body);
        match validate(name, &src) {
            Ok(m) => {
                for entry in ["vs_effect", "fs_effect"].into_iter().chain(prefilter.then_some("fs_prefilter")) {
                    if !has_entry(&m, entry) {
                        failures.push(format!("{name}: no entry point `{entry}`"));
                    }
                }
            }
            Err(e) => failures.push(e),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn every_effect_file_is_registered() {
    let files: Vec<String> = sources()
        .into_iter()
        .filter(|p| is_effect_part(p) && p.extension().is_some_and(|e| e == "wgsl"))
        .filter_map(|p| p.file_stem()?.to_str().map(str::to_string))
        .filter(|n| !n.starts_with('_'))
        .collect();
    let registered: Vec<&str> = effects::EFFECTS.iter().map(|(n, _)| *n).collect();
    assert!(!files.is_empty());
    assert_eq!(files, registered);
}

#[test]
fn standalone_and_inline_modules_validate() {
    let mut failures = Vec::new();
    let mut seen = 0;
    for path in sources() {
        let label = path.strip_prefix(crates_dir()).unwrap_or(&path).display().to_string();
        match path.extension().and_then(|e| e.to_str()) {
            Some("wgsl") if !is_effect_part(&path) && !is_effect_params(&path) => {
                seen += 1;
                if let Err(e) = validate(&label, &fs::read_to_string(&path).unwrap()) {
                    failures.push(e);
                }
            }
            Some("rs") => {
                for (name, src) in inline_modules(&fs::read_to_string(&path).unwrap()) {
                    seen += 1;
                    if let Err(e) = validate(&format!("{label}: {name}"), &src) {
                        failures.push(e);
                    }
                }
            }
            _ => {}
        }
    }
    // prim, composite, render3d's three and the mip blit at the time of writing.
    assert!(seen >= 6, "found only {seen} modules");
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn user_shader_assemblies_validate() {
    user_shader::compile(user_shader::KIND_FILL, "fn fill(in: FillIn) -> vec4f { return vec4f(in.uv, 0.0, 1.0); }").unwrap();
    user_shader::compile(user_shader::KIND_EFFECT, "fn effect(in: EffectIn) -> vec4f { return sample_src(in.uv); }").unwrap();
}

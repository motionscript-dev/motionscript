//! Discovers `src/effects/*.wgsl` (one file per effect) and generates the
//! registry, so adding an effect never edits a shared file. Each effect's
//! body is preceded by its parameter accessors, `src/effects/gen/<name>.wgsl`
//! (generated from its TS port by `scripts/gen-effect-params.mjs`).

use std::{env, fs, path::Path};

fn main() {
    let dir = Path::new("src/effects");
    println!("cargo:rerun-if-changed=src/effects");
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    (p.extension()? == "wgsl" && !p.file_stem()?.to_str()?.starts_with('_'))
                        .then(|| p.file_stem()?.to_str().map(str::to_string))?
                })
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    let mut out = String::from(
        "/// Built-in effects, sorted by name: (name, WGSL body after its parameter accessors).\npub const EFFECTS: &[(&str, &str)] = &[\n",
    );
    for n in &names {
        let abs = fs::canonicalize(dir.join(format!("{n}.wgsl"))).unwrap();
        let params = fs::canonicalize(dir.join(format!("gen/{n}.wgsl")))
            .unwrap_or_else(|_| panic!("src/effects/gen/{n}.wgsl is missing: run `node scripts/gen-effect-params.mjs`"));
        println!("cargo:rerun-if-changed={}", abs.display());
        println!("cargo:rerun-if-changed={}", params.display());
        out.push_str(&format!(
            "    ({n:?}, concat!(include_str!({:?}), include_str!({:?}))),\n",
            params.display().to_string(),
            abs.display().to_string()
        ));
    }
    out.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("effects_gen.rs"), out).unwrap();
}

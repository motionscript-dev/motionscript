//! `web/src/user-shaders.ts` warms a user program's pipelines in the browser
//! from its own copy of gpu.rs's bind group layouts (wgpu hands out no
//! `GPUPipelineLayout`), so the browser's cache serves wgpu's pipelines. A
//! copy that drifts warms nothing, silently; this reads both sources and
//! holds the copy (`USER_LAYOUTS`) equal to gpu.rs.

const GPU: &str = include_str!("gpu.rs");
const WEB: &str = include_str!("../../../web/src/user-shaders.ts");

/// The text from `open` (a bracket at `from`) to its match, exclusive.
fn balanced(src: &str, from: usize) -> &str {
    let b = src.as_bytes();
    let (open, close) = match b[from] {
        b'(' => (b'(', b')'),
        b'[' => (b'[', b']'),
        _ => (b'{', b'}'),
    };
    let mut depth = 0;
    for (i, &c) in b.iter().enumerate().skip(from) {
        if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
            if depth == 0 {
                return &src[from + 1..i];
            }
        }
    }
    panic!("unbalanced from {from}");
}

/// Splits on commas outside brackets, dropping empty pieces.
fn top_level(src: &str) -> Vec<&str> {
    let (mut out, mut depth, mut last) = (Vec::new(), 0i32, 0);
    for (i, c) in src.char_indices() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                out.push(src[last..i].trim());
                last = i + 1;
            }
            _ => {}
        }
    }
    out.push(src[last..].trim());
    out.retain(|s| !s.is_empty());
    out
}

/// gpu.rs's layout bound to `let <var> =`, as user-shaders.ts names its entries.
fn gpu_layout(var: &str) -> Vec<String> {
    let head = format!("let {var} = device.create_bind_group_layout(");
    let at = GPU.find(&head).unwrap_or_else(|| panic!("gpu.rs: no `{head}`"));
    let desc = balanced(GPU, at + head.len() - 1);
    let entries_at = desc.find("entries: &[").expect("entries") + "entries: &".len();
    let entries = balanced(desc, entries_at);
    top_level(entries)
        .into_iter()
        .enumerate()
        .map(|(i, e)| {
            if e.starts_with("tex_entry(") {
                assert_eq!(e, format!("tex_entry({i})"), "{var}: binding order");
                return "texture".to_string();
            }
            assert!(e.contains(&format!("binding: {i},")), "{var}: entry {i} is not binding {i}: {e}");
            assert!(e.contains("visibility: vis"), "{var}: entry {i} visibility: {e}");
            let kind = if e.contains("ty: dyn_uniform") {
                "uniform"
            } else if e.contains("ty: ro_storage") {
                "storage"
            } else if e.contains("SamplerBindingType::Filtering") {
                "sampler"
            } else if e.contains("filterable: false") && e.contains("D2Array") && !e.contains("multisampled: true") {
                "unfilterable-2d-array"
            } else {
                panic!("{var}: entry {i} has a kind user-shaders.ts doesn't know: {e}")
            };
            kind.to_string()
        })
        .collect()
}

/// gpu.rs's pipeline layout labelled `label`: its groups' layouts.
fn gpu_pipeline(label: &str) -> Vec<Vec<String>> {
    let tag = format!("label: Some(\"{label}\"),");
    let at = GPU.find(&tag).unwrap_or_else(|| panic!("gpu.rs: no pipeline layout `{label}`"));
    let list_at = at + GPU[at..].find("bind_group_layouts: &[").unwrap() + "bind_group_layouts: &".len();
    top_level(balanced(GPU, list_at))
        .into_iter()
        .map(|g| gpu_layout(g.trim_start_matches("Some(&").trim_end_matches(')')))
        .collect()
}

/// `USER_LAYOUTS[scope]` in user-shaders.ts.
fn web_layouts(scope: &str) -> Vec<Vec<String>> {
    let table_at = WEB.find("export const USER_LAYOUTS = {").expect("user-shaders.ts: USER_LAYOUTS");
    let table = balanced(WEB, table_at + "export const USER_LAYOUTS = ".len());
    let key = format!("{scope}: [");
    let at = table.find(&key).unwrap_or_else(|| panic!("USER_LAYOUTS.{scope}"));
    top_level(balanced(table, at + key.len() - 1))
        .into_iter()
        .map(|group| top_level(group.trim_start_matches('[').trim_end_matches(']')).into_iter().map(|k| k.trim_matches('"').to_string()).collect())
        .collect()
}

#[test]
fn user_fill_layouts_match_gpu_rs() {
    assert_eq!(web_layouts("fill"), gpu_pipeline("user-fill"));
}

#[test]
fn user_effect_layouts_match_gpu_rs() {
    assert_eq!(web_layouts("effect"), gpu_pipeline("user-effect"));
}

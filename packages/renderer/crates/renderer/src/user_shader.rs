//! User shaders: fills and effects an author writes in WGSL against the
//! contract in DESIGN.md §6.3. The author's code is appended to a header and
//! to the renderer's own shader (`prim.wgsl` for a fill, the effect header for
//! an effect) with every renderer name prefixed `ms_`, so the author's names
//! can't collide with ours. naga validates the assembled module and reflects
//! `struct Params` (the uniforms `u`); diagnostics point into the author's code.

use naga::{AddressSpace, ScalarKind, TypeInner};

pub const KIND_FILL: u32 = 0;
pub const KIND_EFFECT: u32 = 1;

/// Largest `Params` struct, in bytes: one uniform slot of the frame's arena.
pub const MAX_PARAMS: u32 = 512;

/// Loop iterations one invocation (one pixel) may run, summed over every loop
/// in the author's code; past it every loop breaks. A shader that never ends
/// would hang the GPU until the driver resets the device, taking every
/// surface on the page with it.
pub const LOOP_BUDGET: u32 = 16_384;

/// The budget's counter. Private, so per invocation and shared by every loop
/// and function: nested loops and loops in helpers called from loops add up
/// rather than multiply.
const LOOP_COUNTER: &str = "var<private> ms_loop_spent: u32 = 0u;\n";

/// A private variable is non-uniform to WGSL's analysis, so the guard's
/// `break` would make every derivative after a loop an error. naga has
/// already checked the author's own code, unguarded.
const GUARDED_DIRECTIVE: &str = "diagnostic(off, derivative_uniformity);\n";

/// What the author's code can use in a fill (prepended, documented in
/// DESIGN.md §6.3 and the site's shader docs).
const FILL_HEADER: &str = "struct FillIn {
    uv: vec2f,
    local: vec2f,
    size: vec2f,
    time: f32,
    scale: f32,
}
@group(2) @binding(0) var<uniform> u: Params;
fn sample_texture(uv: vec2f) -> vec4f {
    return textureSampleLevel(ms_image_tex, ms_image_samp, uv, 0.0);
}
";

/// The fill's bridge: replaces prim.wgsl's `user_paint` stub. Straight colour
/// out, in the working space, as every paint.
const FILL_BRIDGE: &str = "fn ms_user_paint(pt: ms_Paint, p: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
    var fi: FillIn;
    fi.local = p - pt.geom.xy;
    fi.size = pt.geom.zw;
    fi.uv = fi.local / max(pt.geom.zw, vec2f(1e-6));
    fi.time = pt.color.x;
    fi.scale = inverseSqrt(max(abs(dx.x * dy.y - dx.y * dy.x), 1e-12));
    let c = fill(fi);
    return ms_working(vec4f(select(vec3f(0.0), c.rgb / c.a, c.a > 0.0), c.a));
}
";

const EFFECT_HEADER: &str = "struct EffectIn {
    uv: vec2f,
    px: vec2f,
    local: vec2f,
    size: vec2f,
    time: f32,
    scale: f32,
    node: vec2f,
    node_size: vec2f,
}
@group(1) @binding(0) var<uniform> u: Params;
fn sample_src(uv: vec2f) -> vec4f {
    return ms_src(ms_box_origin() + uv * ms_box_size());
}
fn sample_src_px(px: vec2f) -> vec4f {
    return ms_src(px);
}
";

/// The effect's bridge: the built-in header's `effect(p)` entry, calling the
/// author's `effect(in)`. `ms_param(0)` is the blend mode + 1 a foreground
/// effect composites onto its input with (0 = the output replaces it).
const EFFECT_BRIDGE: &str = "const ms_TILE_CLAMP: bool = true;
const ms_FILTER_NEAREST: bool = false;
fn ms_effect(p: vec2f) -> vec4f {
    var fx: EffectIn;
    let s = max(ms_u.scale, 1e-6);
    fx.px = p;
    fx.size = ms_box_size() / s;
    fx.local = (p - ms_box_origin()) / s;
    fx.uv = (p - ms_box_origin()) / max(ms_box_size(), vec2f(1e-6));
    fx.time = ms_u.time;
    fx.scale = ms_u.scale;
    let q = vec3f(p, 1.0);
    fx.node = vec2f(dot(ms_u.node[0].xyz, q), dot(ms_u.node[1].xyz, q));
    fx.node_size = vec2f(ms_u.node[0].w, ms_u.node[1].w);
    let o = effect(fx);
    let mode = ms_param(0u);
    if (mode > 0.5) {
        return ms_blend_mode(u32(mode - 0.5), o, ms_src(p));
    }
    return o;
}
";

/// One problem in the author's code. `line`/`column` are 1-based in the
/// author's source; 0 when the problem lies outside it.
#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    pub line: u32,
    pub column: u32,
    pub length: u32,
    pub message: String,
}

/// One member of `struct Params`, laid out as WGSL's uniform rules place it.
#[derive(Clone, Debug, PartialEq)]
pub struct Field {
    pub name: String,
    /// Byte offset in the struct.
    pub offset: u32,
    /// 0 f32, 1 i32, 2 u32.
    pub scalar: u32,
    /// Components per element (1–4).
    pub components: u32,
    /// Elements (array length × matrix columns), each `stride` bytes apart.
    pub elements: u32,
    pub stride: u32,
    /// The WGSL type as written back (`vec3<f32>`, `array<vec4<f32>, 4>`).
    pub ty: String,
}

#[derive(Debug)]
pub struct Compiled {
    /// The whole module to hand the GPU.
    pub wgsl: String,
    pub fields: Vec<Field>,
    /// Size of `Params` in bytes.
    pub size: u32,
}

/// Validates the author's `source` for `kind` and assembles its module.
pub fn compile(kind: u32, source: &str) -> Result<Compiled, Vec<Diagnostic>> {
    if source.len() > 64_000 {
        return Err(vec![outside(format!("the source is {} characters, over the 64000 limit", source.len()))]);
    }
    let entry = if kind == KIND_FILL { "fill" } else { "effect" };
    if !declares(source, "fn", entry) {
        return Err(vec![outside(format!(
            "no `fn {entry}(in: {}) -> vec4f`: a {entry} shader defines it",
            if kind == KIND_FILL { "FillIn" } else { "EffectIn" }
        ))]);
    }
    let (prefix, user_at) = assemble_prefix(kind, source);
    let wgsl = format!("{prefix}{source}\n");
    let module = naga::front::wgsl::parse_str(&wgsl).map_err(|e| {
        let mut out: Vec<Diagnostic> = e.labels().map(|(span, label)| at(&wgsl, user_at, span, message_with(e.message(), label))).collect();
        if out.is_empty() {
            out.push(outside(e.message().to_string()));
        }
        // The first label is the error itself; keep one diagnostic per place.
        out.dedup_by(|a, b| a.line == b.line && a.column == b.column);
        out
    })?;
    let mut validator = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::default());
    validator.validate(&module).map_err(|e| {
        let message = chain(e.as_inner());
        let mut out: Vec<Diagnostic> = e.spans().map(|(span, label)| at(&wgsl, user_at, *span, message_with(&message, label))).collect();
        // The innermost span in the author's code is the one to show first.
        out.sort_by_key(|d| d.line == 0);
        if out.is_empty() {
            out.push(outside(message));
        }
        out.truncate(1);
        out
    })?;
    let (fields, size) = reflect(&module).map_err(|m| vec![outside(m)])?;
    let guarded = guard_loops(source);
    if guarded == source {
        return Ok(Compiled { wgsl, fields, size });
    }
    let wgsl = format!("{GUARDED_DIRECTIVE}{prefix}{guarded}\n");
    let checked = naga::front::wgsl::parse_str(&wgsl).map_err(|e| e.message().to_string()).and_then(|m| {
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::default())
            .validate(&m)
            .map(|_| ())
            .map_err(|e| chain(e.as_inner()))
    });
    checked.map_err(|m| vec![outside(format!("the renderer's loop guard broke this shader (a renderer bug): {m}"))])?;
    Ok(Compiled { wgsl, fields, size })
}

/// `source` with every `loop`, `for` and `while` body opening on a check of
/// the invocation's [`LOOP_BUDGET`]. Inserted on the loop's own line, so
/// the browser's line numbers still point into the author's code.
fn guard_loops(source: &str) -> String {
    let guard = format!(" if ms_loop_spent >= {LOOP_BUDGET}u {{ break; }} ms_loop_spent += 1u;");
    let mut at: Vec<usize> = tokens(source)
        .into_iter()
        .filter(|t| matches!(t.1, "loop" | "for" | "while"))
        .filter_map(|(pos, word)| body_open(source, pos + word.len()))
        .collect();
    at.dedup();
    let mut out = String::with_capacity(source.len() + at.len() * guard.len());
    let mut last = 0;
    for open in at {
        out.push_str(&source[last..=open]);
        out.push_str(&guard);
        last = open + 1;
    }
    out.push_str(&source[last..]);
    out
}

/// The first `{` at or after `from`, comments skipped. A loop's header (a
/// `for`'s parentheses, a `while` condition) holds no braces: WGSL has no
/// brace-delimited expressions.
fn body_open(src: &str, from: usize) -> Option<usize> {
    let b = src.as_bytes();
    let mut i = from;
    while i < b.len() {
        if let Some(end) = comment_end(b, i) {
            i = end;
        } else if b[i] == b'{' {
            return Some(i);
        } else {
            i += 1;
        }
    }
    None
}

/// Where the comment starting at `i` ends, if one starts there.
fn comment_end(b: &[u8], i: usize) -> Option<usize> {
    if b[i] != b'/' {
        return None;
    }
    match b.get(i + 1) {
        Some(b'/') => {
            let mut j = i;
            while j < b.len() && b[j] != b'\n' {
                j += 1;
            }
            Some(j)
        }
        Some(b'*') => {
            // Block comments nest in WGSL.
            let (mut j, mut depth) = (i, 0);
            while j < b.len() {
                if b[j] == b'/' && b.get(j + 1) == Some(&b'*') {
                    depth += 1;
                    j += 2;
                } else if b[j] == b'*' && b.get(j + 1) == Some(&b'/') {
                    depth -= 1;
                    j += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    j += 1;
                }
            }
            Some(j)
        }
        _ => None,
    }
}

/// Header and renderer code before the author's, and the byte offset where
/// the author's code starts.
fn assemble_prefix(kind: u32, source: &str) -> (String, usize) {
    let mut out = String::new();
    if kind == KIND_FILL {
        out.push_str(FILL_HEADER);
        out.push_str(&with_bridge(&prefixed(include_str!("shaders/prim.wgsl"), &[]), "fn ms_user_paint(", FILL_BRIDGE));
    } else {
        out.push_str(EFFECT_HEADER);
        out.push_str(&prefixed(crate::effects::HEADER, &["effect", "TILE_CLAMP", "FILTER_NEAREST"]));
        out.push_str(EFFECT_BRIDGE);
    }
    if !declares(source, "struct", "Params") {
        out.push_str("struct Params { ms_unused: f32 }\n");
    }
    out.push_str(LOOP_COUNTER);
    out.push_str("// ── the author's code ──\n");
    let at = out.len();
    (out, at)
}

/// Whether `source` (comments aside) declares `keyword name`.
fn declares(source: &str, keyword: &str, name: &str) -> bool {
    let toks = tokens(source);
    toks.windows(2).any(|w| w[0].1 == keyword && w[1].1 == name)
}

/// The identifier tokens of WGSL `src` (comments skipped), with byte offsets.
fn tokens(src: &str) -> Vec<(usize, &str)> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if let Some(end) = comment_end(b, i) {
            i = end;
        } else if c.is_ascii_digit() {
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'.') {
                i += 1;
            }
        } else if c.is_ascii_alphabetic() || c == b'_' {
            let s = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            out.push((s, &src[s..i]));
        } else {
            i += 1;
        }
    }
    out
}

/// `src` with every module-scope name it declares (plus `extra`) renamed
/// `ms_<name>`, wherever it appears.
fn prefixed(src: &str, extra: &[&str]) -> String {
    let toks = tokens(src);
    let mut names: Vec<&str> = extra.to_vec();
    for (k, &(at, word)) in toks.iter().enumerate() {
        // Module scope: at the start of a line, or after attributes only.
        let lead = src[..at].rsplit('\n').next().unwrap_or("");
        let top = lead.is_empty() || lead.starts_with('@');
        if !top || !matches!(word, "fn" | "struct" | "const" | "var" | "alias" | "override") {
            continue;
        }
        // `var<uniform> name`: skip the address space.
        let name = toks[k + 1..].iter().map(|t| t.1).find(|w| !matches!(*w, "uniform" | "storage" | "read" | "read_write" | "private" | "workgroup"));
        if let Some(n) = name {
            names.push(n);
        }
    }
    let mut out = String::with_capacity(src.len() + names.len() * 16);
    let mut last = 0;
    for (at, word) in toks {
        if names.contains(&word) {
            out.push_str(&src[last..at]);
            out.push_str("ms_");
            out.push_str(word);
            last = at + word.len();
        }
    }
    out.push_str(&src[last..]);
    out
}

/// `src` with the function starting at `head` replaced by `body`.
fn with_bridge(src: &str, head: &str, body: &str) -> String {
    let Some(start) = src.find(head) else { return src.to_string() };
    let open = start + src[start..].find('{').unwrap();
    let mut depth = 0;
    let mut end = open;
    for (i, c) in src[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = open + i + 1;
                    break;
                }
            }
            _ => {}
        }
    }
    format!("{}{}{}", &src[..start], body, &src[end..])
}

fn outside(message: String) -> Diagnostic {
    Diagnostic { line: 0, column: 0, length: 0, message }
}

fn message_with(message: &str, label: &str) -> String {
    if label.is_empty() || label == message { message.to_string() } else { format!("{message}: {label}") }
}

/// A span in the assembled module as a place in the author's code.
fn at(wgsl: &str, user_at: usize, span: naga::Span, message: String) -> Diagnostic {
    let Some(r) = span.to_range() else { return outside(message) };
    if r.start < user_at {
        // A renderer name the author redefined, or the header's use of `Params`.
        return outside(message);
    }
    // Past the end (an unclosed brace) is reported on the last line.
    let before = &wgsl[user_at..r.start.min(wgsl.len().saturating_sub(1)).max(user_at)];
    let line = before.matches('\n').count() as u32 + 1;
    let col = before.rsplit('\n').next().map(|s| s.chars().count()).unwrap_or(0) as u32 + 1;
    Diagnostic { line, column: col, length: (r.end - r.start) as u32, message }
}

/// An error and its causes, outermost first.
fn chain(e: &dyn std::error::Error) -> String {
    let mut s = e.to_string();
    let mut cur = e.source();
    while let Some(c) = cur {
        let m = c.to_string();
        if !s.contains(&m) {
            s.push_str(": ");
            s.push_str(&m);
        }
        cur = c.source();
    }
    s
}

/// `struct Params`, as the uniform `u` lays it out.
fn reflect(module: &naga::Module) -> Result<(Vec<Field>, u32), String> {
    let gctx = module.to_ctx();
    let Some((_, var)) = module.global_variables.iter().find(|(_, v)| v.name.as_deref() == Some("u") && v.space == AddressSpace::Uniform) else {
        return Ok((Vec::new(), 0));
    };
    let ty = &module.types[var.ty];
    let size = ty.inner.size(gctx);
    if size > MAX_PARAMS {
        return Err(format!("struct Params is {size} bytes; the limit is {MAX_PARAMS}"));
    }
    let TypeInner::Struct { members, .. } = &ty.inner else { return Ok((Vec::new(), size)) };
    let mut fields = Vec::new();
    for m in members {
        let Some(name) = m.name.clone() else { continue };
        if name == "ms_unused" {
            continue;
        }
        let inner = &module.types[m.ty].inner;
        let (elem, elements, stride) = match inner {
            TypeInner::Array { base, size: naga::ArraySize::Constant(n), stride } => (&module.types[*base].inner, n.get(), *stride),
            _ => (inner, 1, 0),
        };
        let (scalar, components, cols, col_stride) = match elem {
            TypeInner::Scalar(s) => (s.kind, 1, 1, 0),
            TypeInner::Vector { size, scalar } => (scalar.kind, *size as u32, 1, 0),
            TypeInner::Matrix { columns, rows, scalar } => {
                let r = *rows as u32;
                (scalar.kind, r, *columns as u32, if r == 2 { 8 } else { 16 })
            }
            _ => return Err(format!("Params.{name}: only scalars, vectors, matrices and arrays of them can be uniforms here")),
        };
        let scalar = match scalar {
            ScalarKind::Float => 0,
            ScalarKind::Sint => 1,
            ScalarKind::Uint => 2,
            _ => return Err(format!("Params.{name}: use f32, i32 or u32")),
        };
        let (elements, stride) = if cols > 1 {
            if elements > 1 {
                return Err(format!("Params.{name}: arrays of matrices aren't supported"));
            }
            (cols, col_stride)
        } else {
            (elements, stride)
        };
        fields.push(Field { name, offset: m.offset, scalar, components, elements, stride, ty: type_name(module, m.ty) });
    }
    Ok((fields, size))
}

fn type_name(module: &naga::Module, ty: naga::Handle<naga::Type>) -> String {
    let scalar = |s: &naga::Scalar| match s.kind {
        ScalarKind::Sint => "i32",
        ScalarKind::Uint => "u32",
        ScalarKind::Bool => "bool",
        _ => "f32",
    };
    match &module.types[ty].inner {
        TypeInner::Scalar(s) => scalar(s).to_string(),
        TypeInner::Vector { size, scalar: s } => format!("vec{}<{}>", *size as u32, scalar(s)),
        TypeInner::Matrix { columns, rows, scalar: s } => format!("mat{}x{}<{}>", *columns as u32, *rows as u32, scalar(s)),
        TypeInner::Array { base, size: naga::ArraySize::Constant(n), .. } => format!("array<{}, {}>", type_name(module, *base), n),
        _ => "?".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILL: &str = "struct Params { amount: f32, tint: vec3f, steps: i32, ramp: array<vec4f, 2> }
fn fill(in: FillIn) -> vec4f {
    let a = u.amount * in.uv.x;
    return vec4f(u.tint * a, a);
}
";

    #[test]
    fn fill_compiles_and_reflects() {
        let c = compile(KIND_FILL, FILL).unwrap();
        let names: Vec<_> = c.fields.iter().map(|f| (f.name.as_str(), f.offset, f.components, f.elements, f.stride)).collect();
        assert_eq!(names, vec![("amount", 0, 1, 1, 0), ("tint", 16, 3, 1, 0), ("steps", 28, 1, 1, 0), ("ramp", 32, 4, 2, 16)]);
        assert_eq!(c.size, 64);
        assert_eq!(c.fields[2].scalar, 1);
    }

    #[test]
    fn effect_compiles_without_params() {
        let src = "fn effect(in: EffectIn) -> vec4f { return sample_src(in.uv + vec2f(0.01 * in.time, 0.0)); }";
        let c = compile(KIND_EFFECT, src).unwrap();
        assert!(c.fields.is_empty());
    }

    #[test]
    fn author_names_dont_collide_with_the_renderers() {
        // `cov`, `grow`, `value_noise` and `premul` are renderer functions.
        let src = "fn cov(x: f32) -> f32 { return x; }
fn value_noise(p: vec2f) -> f32 { return p.x; }
fn premul(c: vec4f) -> vec4f { return c; }
fn fill(in: FillIn) -> vec4f { return premul(vec4f(cov(value_noise(in.uv)))); }";
        compile(KIND_FILL, src).unwrap();
        let fx = "fn src(p: vec2f) -> vec4f { return vec4f(p, 0.0, 1.0); }
fn effect(in: EffectIn) -> vec4f { return src(in.uv) * sample_src_px(in.px); }";
        compile(KIND_EFFECT, fx).unwrap();
    }

    #[test]
    fn diagnostics_point_into_the_authors_code() {
        let src = "fn fill(in: FillIn) -> vec4f {\n    let a = 1.0;\n    return vec4f(a, b, 0.0, 1.0);\n}\n";
        let d = compile(KIND_FILL, src).unwrap_err();
        assert_eq!((d[0].line, d[0].column), (3, 21), "{d:?}");
        assert!(d[0].message.contains("no definition") || d[0].message.contains("b"), "{d:?}");
        let typed = "fn effect(in: EffectIn) -> vec4f {\n    let x: f32 = in.uv;\n    return vec4f(x);\n}\n";
        let d = compile(KIND_EFFECT, typed).unwrap_err();
        assert_eq!(d[0].line, 2, "{d:?}");
        let unclosed = compile(KIND_FILL, "fn fill(in: FillIn) -> vec4f {
    return vec4f(1.0);
").unwrap_err();
        assert_eq!(unclosed[0].line, 3, "{unclosed:?}");
        let missing = compile(KIND_FILL, "fn main() {}").unwrap_err();
        assert_eq!(missing[0].line, 0);
    }

    const GUARD_AT: &str = " if ms_loop_spent >= 16384u { break; } ms_loop_spent += 1u;";

    #[test]
    fn loops_open_on_the_budget_check() {
        let src = "fn fill(in: FillIn) -> vec4f {
    var a = 0.0;
    for (var i = 0; i < 4; i++) {
        var j = 0;
        while j < i {
            j++;
            if j == 2 { continue; }
            loop {
                a += 1.0;
                if a > 3.0 { break; }
                continuing { break if a > 9.0; }
            }
        }
    }
    return vec4f(a);
}
";
        let g = guard_loops(src);
        assert_eq!(g.matches(GUARD_AT).count(), 3, "{g}");
        assert!(g.contains(&format!("i++) {{{GUARD_AT}\n")), "{g}");
        assert!(g.contains(&format!("while j < i {{{GUARD_AT}\n")), "{g}");
        assert!(g.contains(&format!("loop {{{GUARD_AT}\n")), "{g}");
        assert!(g.contains("continuing { break if a > 9.0; }"), "{g}");
        assert_eq!(g.lines().count(), src.lines().count());
        let c = compile(KIND_FILL, src).unwrap();
        assert!(c.wgsl.starts_with(GUARDED_DIRECTIVE));
        assert_eq!(c.wgsl.matches(GUARD_AT).count(), 3);
    }

    #[test]
    fn loop_words_in_comments_are_not_guarded() {
        let src = "// for (;;) { forever }
/* while true { /* nested loop { */ } */
fn fill(in: FillIn) -> vec4f {
    var s = 0.0;
    for (var i = 0; i < 3; i++) /* { not here */ { s += 1.0; } // loop {
    return vec4f(s);
}
";
        let g = guard_loops(src);
        assert_eq!(g.matches(GUARD_AT).count(), 1, "{g}");
        assert!(g.contains(&format!("/* {{ not here */ {{{GUARD_AT} s += 1.0; }}")), "{g}");
        compile(KIND_FILL, src).unwrap();
    }

    #[test]
    fn a_shader_without_loops_is_unchanged() {
        let c = compile(KIND_FILL, FILL).unwrap();
        assert!(!c.wgsl.contains("diagnostic(off"));
        assert!(!c.wgsl.contains(GUARD_AT));
    }

    #[test]
    fn endless_loops_and_derivatives_after_them_validate() {
        let src = "fn effect(in: EffectIn) -> vec4f {
    var x = 0.0;
    loop { x += 1.0; }
    let d = dpdx(in.uv.x);
    while true { x -= 1.0; }
    return sample_src(in.uv) * (d + x);
}
";
        let c = compile(KIND_EFFECT, src).unwrap();
        assert_eq!(c.wgsl.matches(GUARD_AT).count(), 2);
    }

    #[test]
    fn diagnostics_keep_their_place_in_guarded_code() {
        let src = "fn fill(in: FillIn) -> vec4f {\n    for (var i = 0; i < 2; i++) { let q = nope; }\n    return vec4f(1.0);\n}\n";
        let d = compile(KIND_FILL, src).unwrap_err();
        assert_eq!((d[0].line, d[0].column), (2, 43), "{d:?}");
    }

    #[test]
    fn params_layout_errors_are_reported() {
        let src = "struct Params { a: array<f32, 4> }\nfn fill(in: FillIn) -> vec4f { return vec4f(u.a[0]); }";
        let d = compile(KIND_FILL, src).unwrap_err();
        assert!(!d[0].message.is_empty());
    }
}

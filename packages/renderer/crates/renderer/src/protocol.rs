//! The delta protocol: a stream of 32-bit words the TS side writes straight
//! into WASM memory. Each record is `opcode, payload…`; floats travel as their
//! IEEE bits. `web/src/protocol.ts` is the writer and must match this file.

use crate::scene::*;

pub const OP_CREATE: u32 = 1;
pub const OP_DESTROY: u32 = 2;
pub const OP_CHILDREN: u32 = 3;
pub const OP_TRANSFORM: u32 = 4;
pub const OP_SIZE: u32 = 5;
pub const OP_RADII: u32 = 6;
pub const OP_FILL: u32 = 7;
pub const OP_STROKE: u32 = 8;
pub const OP_SHADOWS: u32 = 9;
pub const OP_OPACITY: u32 = 10;
pub const OP_BLEND: u32 = 11;
pub const OP_CLIP: u32 = 12;
pub const OP_FILTER: u32 = 13;
pub const OP_PATH: u32 = 14;
pub const OP_MEMBERS: u32 = 15;
pub const OP_MASK: u32 = 16;
pub const OP_TEXT: u32 = 17;
pub const OP_EFFECTS: u32 = 18;
/// A projective transform: TRANSFORM's six numbers plus the perspective row.
pub const OP_TRANSFORM3: u32 = 19;
pub const OP_DEF_PAINT: u32 = 20;
pub const OP_DEF_PATH: u32 = 21;
pub const OP_DEF_DASH: u32 = 22;
pub const OP_FREE_PATH: u32 = 24;
pub const OP_ROOT: u32 = 30;
pub const OP_VIEWPORT: u32 = 31;

struct Reader<'a> {
    w: &'a [u32],
    i: usize,
}

impl<'a> Reader<'a> {
    #[inline]
    fn u(&mut self) -> Result<u32, String> {
        let v = *self.w.get(self.i).ok_or("delta stream truncated")?;
        self.i += 1;
        Ok(v)
    }
    #[inline]
    fn f(&mut self) -> Result<f32, String> {
        Ok(f32::from_bits(self.u()?))
    }
    fn f4(&mut self) -> Result<[f32; 4], String> {
        Ok([self.f()?, self.f()?, self.f()?, self.f()?])
    }
    /// A UTF-8 string: byte length, then the bytes packed four per word.
    fn s(&mut self) -> Result<String, String> {
        let n = self.u()? as usize;
        let mut bytes = Vec::with_capacity(n);
        for _ in 0..n.div_ceil(4) {
            let w = self.u()?;
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        bytes.truncate(n);
        String::from_utf8(bytes).map_err(|_| "text is not UTF-8".to_string())
    }
}

pub fn apply(scene: &mut Scene, words: &[u32]) -> Result<(), String> {
    let rev = scene.revision + 1;
    let mut touched: Vec<u32> = Vec::new();
    let mut written: Vec<u32> = Vec::new();
    let res = apply_ops(scene, words, rev, &mut touched, &mut written);
    if res.is_err() {
        // Some ops of the batch may have landed: trust nothing built before.
        scene.flush_rev = rev;
        scene.content_flush = rev;
    }
    touched.retain(|&id| (id as usize) < scene.len());
    scene.mark_changed(&touched, rev);
    scene.mark_content(&written, rev);
    scene.revision = rev;
    res
}

/// One op's words, hashed.
fn hash_words(words: &[u32]) -> u64 {
    use std::hash::Hasher;
    let mut h = crate::fxhash::FxHasher::default();
    h.write(bytemuck::cast_slice(words));
    h.finish()
}

fn apply_ops(scene: &mut Scene, words: &[u32], rev: u64, touched: &mut Vec<u32>, written: &mut Vec<u32>) -> Result<(), String> {
    let mut r = Reader { w: words, i: 0 };
    while r.i < words.len() {
        let start = r.i;
        apply_op(scene, &mut r, rev, touched)?;
        // Content tracking: each node's ops and each definition, by their words.
        let op = words[start];
        let has_id = (OP_CREATE..=OP_TRANSFORM3).contains(&op) || matches!(op, OP_DEF_PAINT | OP_DEF_PATH | OP_DEF_DASH | OP_FREE_PATH);
        let id = if has_id { words.get(start + 1).copied().unwrap_or(NONE) } else { NONE };
        let h = hash_words(&words[start..r.i]);
        if (OP_CREATE..=OP_TRANSFORM3).contains(&op) {
            scene.add_words(id, h, rev, written);
        } else if scene.def_words.insert((op, id), h).is_some_and(|old| old != h) {
            // A redefinition may change any node using it; a new id changes
            // nothing drawn (the nodes naming it changed their own words).
            scene.content_flush = rev;
        }
    }
    Ok(())
}

fn apply_op(scene: &mut Scene, r: &mut Reader, rev: u64, touched: &mut Vec<u32>) -> Result<(), String> {
    let words = r.w;
    {
        let op = r.u()?;
        // Node ops start with the node id: note it for change tracking.
        if (OP_CREATE..=OP_EFFECTS).contains(&op) {
            if let Some(&id) = words.get(r.i) {
                touched.push(id);
            }
        } else {
            // A definition under a new id changes nothing already drawn
            // (the TypeScript side hands ids out in order); a redefinition,
            // root or viewport change may change anything.
            let id = words.get(r.i).copied().unwrap_or(NONE);
            let fresh = match op {
                OP_DEF_PAINT => id as usize >= scene.paints.paints.len(),
                OP_DEF_PATH => scene.paths.get(id).is_none(),
                OP_DEF_DASH => !matches!(scene.dashes.get(id as usize), Some(Some(_))),
                _ => false,
            };
            if !fresh {
                scene.flush_rev = rev;
            }
        }
        match op {
            OP_CREATE => {
                let id = r.u()?;
                let kind = Kind::from_u32(r.u()?);
                scene.create(id, kind);
            }
            OP_DESTROY => {
                let id = r.u()?;
                scene.destroy(id);
            }
            OP_CHILDREN => {
                let id = r.u()?;
                let n = r.u()? as usize;
                scene.ensure(id);
                let mut kids = std::mem::take(&mut scene.children[id as usize]);
                kids.clear();
                for _ in 0..n {
                    kids.push(r.u()?);
                }
                for &k in &kids {
                    scene.set_parent(k, id, touched);
                }
                scene.children[id as usize] = kids;
            }
            OP_TRANSFORM => {
                let id = r.u()? as usize;
                scene.transform[id] = [r.f()?, r.f()?, r.f()?, r.f()?, r.f()?, r.f()?, 0.0, 0.0, 1.0];
            }
            OP_TRANSFORM3 => {
                let id = r.u()? as usize;
                let mut t = IDENTITY;
                for v in &mut t {
                    *v = r.f()?;
                }
                scene.transform[id] = t;
            }
            OP_SIZE => {
                let id = r.u()? as usize;
                scene.size[id] = [r.f()?, r.f()?];
            }
            OP_RADII => {
                let id = r.u()? as usize;
                scene.radii[id] = r.f4()?;
            }
            OP_FILL => {
                let id = r.u()? as usize;
                scene.fill[id] = r.u()?;
            }
            OP_STROKE => {
                let id = r.u()? as usize;
                scene.stroke[id] = Stroke {
                    paint: r.u()?,
                    width: r.f()?,
                    join: r.u()? as u8,
                    cap: r.u()? as u8,
                    miter: r.f()?,
                    dash: r.u()?,
                };
            }
            OP_SHADOWS => {
                let id = r.u()? as usize;
                let n = r.u()? as usize;
                let mut list = std::mem::take(&mut scene.shadows[id]);
                list.clear();
                for _ in 0..n {
                    list.push(Shadow {
                        dx: r.f()?,
                        dy: r.f()?,
                        sigma: r.f()?,
                        spread: r.f()?,
                        color: r.f4()?,
                    });
                }
                scene.shadows[id] = list;
            }
            OP_OPACITY => {
                let id = r.u()? as usize;
                scene.opacity[id] = r.f()?;
            }
            OP_BLEND => {
                let id = r.u()? as usize;
                scene.blend[id] = r.u()? as u8;
            }
            OP_CLIP => {
                let id = r.u()? as usize;
                let enabled = r.u()? != 0;
                let rect = r.f4()?;
                let radius = r.f()?;
                let path = r.u()?;
                let even_odd = r.u()? == 1;
                scene.clip[id] = Clip { enabled, rect, radius, path, even_odd };
            }
            OP_FILTER => {
                let id = r.u()? as usize;
                let kind = r.u()?;
                let sigma = r.f()?;
                let dx = r.f()?;
                let dy = r.f()?;
                let color = r.f4()?;
                scene.filter[id] = match kind {
                    1 => Filter::Blur { sigma },
                    2 => Filter::DropShadow { dx, dy, sigma, color },
                    _ => Filter::None,
                };
            }
            OP_PATH => {
                let id = r.u()? as usize;
                scene.path[id] = r.u()?;
                scene.fill_rule[id] = r.u()? as u8;
            }
            OP_TEXT => {
                use ms_text::{Align, FontSize, RunStyle, Slant, TextBlockState, TextRun, VerticalAlign};
                let id = r.u()? as usize;
                let align = Align::from_index(r.u()?);
                let vertical_align = VerticalAlign::from_index(r.u()?);
                let wrap = r.u()? != 0;
                let size = r.f()?;
                let min_font_size = r.f()?;
                let line_height = r.f()?;
                let width = r.f()?;
                let height = r.f()?;
                let n = r.u()? as usize;
                let mut runs = Vec::with_capacity(n);
                let mut decorations = Vec::with_capacity(n);
                let mut run_paints = Vec::with_capacity(n);
                for _ in 0..n {
                    decorations.push(r.u()? as u8);
                    run_paints.push(r.u()?);
                    let size = r.f()?;
                    let weight = r.f()?;
                    let slant = Slant::from_index(r.u()?);
                    let letter_spacing = r.f()?;
                    let family = r.s()?;
                    let text = r.s()?;
                    runs.push(TextRun { text, style: RunStyle { family, size, weight, slant, letter_spacing } });
                }
                let path = r.u()?;
                let font_size = if size > 0.0 { FontSize::Px(size) } else { FontSize::Autofit };
                let state = TextBlockState { runs, font_size, min_font_size, line_height, align, vertical_align, wrap, width, height };
                let rev = scene.revision + 1;
                scene.text[id] = Some(TextNode { state, rev, decorations, run_paints, path });
            }
            OP_EFFECTS => {
                let id = r.u()? as usize;
                scene.effect_box[id] = r.f4()?;
                scene.effect_time[id] = r.f()?;
                let n = r.u()? as usize;
                let mut list = Vec::with_capacity(n);
                for _ in 0..n {
                    let index = r.u()?;
                    let flags = r.u()?;
                    let aux = r.u()?;
                    let reach = r.f()?;
                    let blur = [r.f()?, r.f()?, r.f()?];
                    let np = r.u()? as usize;
                    let mut params = Vec::with_capacity(np);
                    for _ in 0..np {
                        params.push(r.f()?);
                    }
                    list.push(EffectSpec { index, flags, aux, reach, blur, params });
                }
                scene.effects[id] = list;
            }
            OP_MASK => {
                let id = r.u()? as usize;
                scene.mask[id] = r.u()? as u8;
            }
            OP_MEMBERS => {
                let id = r.u()? as usize;
                let n = r.u()? as usize;
                let mut list = std::mem::take(&mut scene.members[id]);
                list.clear();
                for _ in 0..n {
                    let kind = r.u()? as u8;
                    let op = r.u()? as u8;
                    let transform = [r.f()?, r.f()?, r.f()?, r.f()?, r.f()?, r.f()?];
                    let size = [r.f()?, r.f()?];
                    let radii = r.f4()?;
                    let path = r.u()?;
                    let even_odd = r.u()? == 1;
                    list.push(Member { kind, op, transform, size, radii, path, even_odd });
                }
                scene.members[id] = list;
            }
            OP_DEF_PAINT => {
                let id = r.u()?;
                let kind = r.u()?;
                let geom = r.f4()?;
                let color = r.f4()?;
                let n = r.u()? as usize;
                let mut stops = Vec::with_capacity(n);
                for _ in 0..n {
                    let off = r.f()?;
                    stops.push(GpuStop { offset: [off, 0.0, 0.0, 0.0], color: r.f4()? });
                }
                // Image paints carry their image id in color.z (see paint docs
                // in prim.wgsl); the frame builder batches draws by it.
                let image = if kind & 0xff == PAINT_IMAGE || kind & 0xff == PAINT_USER { color[2] as u32 } else { NONE };
                scene.paints.define(id, GpuPaint { head: [kind, 0, 0, image], color, geom }, stops);
            }
            OP_DEF_PATH => {
                let id = r.u()?;
                let nverbs = r.u()? as usize;
                let npoints = r.u()? as usize;
                let mut verbs = Vec::with_capacity(nverbs);
                let words = nverbs.div_ceil(4);
                for _ in 0..words {
                    let w = r.u()?;
                    for k in 0..4 {
                        if verbs.len() < nverbs {
                            verbs.push(((w >> (k * 8)) & 0xff) as u8);
                        }
                    }
                }
                let mut points = Vec::with_capacity(npoints);
                for _ in 0..npoints {
                    points.push([r.f()?, r.f()?]);
                }
                scene.paths.define(id, verbs, points);
            }
            OP_DEF_DASH => {
                let id = r.u()? as usize;
                let n = r.u()? as usize;
                let phase = r.f()?;
                let mut intervals = Vec::with_capacity(n);
                for _ in 0..n {
                    intervals.push(r.f()?);
                }
                if scene.dashes.len() <= id {
                    scene.dashes.resize(id + 1, None);
                }
                scene.dashes[id] = Some(Dash { intervals, phase });
            }
            OP_FREE_PATH => {
                let id = r.u()?;
                scene.paths.free(id);
            }
            OP_ROOT => {
                scene.root = r.u()?;
            }
            OP_VIEWPORT => {
                let width = r.u()?;
                let height = r.u()?;
                let scale = r.f()?;
                let clear = r.f4()?;
                scene.viewport = Some(Viewport { width, height, scale, clear });
            }
            other => return Err(format!("unknown delta opcode {other} at word {}", r.i - 1)),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A group (0) over a rect (1) at `opacity`, as a host rebuilding its
    /// document every frame writes it: every node, in full.
    fn frame(opacity: f32) -> Vec<u32> {
        vec![OP_CREATE, 0, 0, OP_CREATE, 1, 1, OP_CHILDREN, 0, 1, 1, OP_OPACITY, 1, opacity.to_bits()]
    }

    #[test]
    fn content_moves_only_when_words_change() {
        let mut s = Scene::new();
        apply(&mut s, &frame(1.0)).unwrap();
        let first = s.content_rev[0];
        apply(&mut s, &frame(1.0)).unwrap();
        // Rewritten as it was: every node touched, no content changed.
        assert_eq!(s.sub_rev[0], s.revision);
        assert_eq!(s.content_rev[0], first);
        apply(&mut s, &frame(0.5)).unwrap();
        assert_eq!(s.content_rev[1], s.revision);
        assert_eq!(s.content_rev[0], s.revision, "an ancestor's content moves with its child's");
        // An op the node stops sending is a change too (CREATE reset it).
        apply(&mut s, &frame(0.5)[..10]).unwrap();
        assert_eq!(s.content_rev[1], s.revision);
    }

    #[test]
    fn only_a_redefinition_flushes_content() {
        let mut s = Scene::new();
        apply(&mut s, &[OP_ROOT, 0]).unwrap();
        let flush = s.content_flush;
        apply(&mut s, &[OP_ROOT, 0]).unwrap();
        assert_eq!(s.content_flush, flush);
        apply(&mut s, &[OP_ROOT, 3]).unwrap();
        assert_eq!(s.content_flush, s.revision);
    }
}

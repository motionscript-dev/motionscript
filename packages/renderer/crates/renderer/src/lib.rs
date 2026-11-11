//! Experimental retained-mode 2D renderer on wgpu/WebGPU.
//!
//! The JS side owns the document. It writes property deltas into a word buffer
//! that lives in this module's linear memory (`delta_buffer`), then calls
//! `apply` and `render`. See `DESIGN.md` at the repo root.

#[cfg(test)]
mod coverage_test;
#[cfg(test)]
mod layout_parity_test;
mod field;
mod frame;
mod fxhash;
#[cfg(target_arch = "wasm32")]
mod gpu;
mod paths;
mod protocol;
mod scene;
pub mod user_shader;

/// Built-in effects (`src/effects/*.wgsl`) and the header each is compiled with.
pub mod effects {
    include!(concat!(env!("OUT_DIR"), "/effects_gen.rs"));
    pub const HEADER: &str = include_str!("effects/_header.wgsl");
    /// Floats an effect pass takes (`EffectU.p`).
    pub const PARAMS: usize = 64;

    /// The WGSL module of effect `body`: header, body, and the prefilter entry
    /// when the effect defines `prefilter`.
    pub fn module(body: &str) -> (String, bool) {
        let prefilter = body.contains("fn prefilter(");
        let mut src = format!("{HEADER}\n{body}\n");
        if prefilter {
            src.push_str("@fragment\nfn fs_prefilter(in: EffectV) -> @location(0) vec4f {\n    return prefilter(device_of(in.pos.xy));\n}\n");
        }
        (src, prefilter)
    }
}

// The WebGPU entry points exist only on wasm32; the scene, protocol, outline
// and frame code also build natively, for tests.
#[cfg(target_arch = "wasm32")]
pub use api::*;

#[cfg(target_arch = "wasm32")]
mod api {
    use super::*;

    use std::cell::RefCell;
    use std::rc::Rc;

    use wasm_bindgen::prelude::*;
    use wasm_bindgen::JsCast;

    thread_local! {
        static PANIC_LISTENER: RefCell<Option<js_sys::Function>> = const { RefCell::new(None) };
    }

    /// `panic = "abort"` traps, and the instance is not safe to call again
    /// (a `RefCell` may be left borrowed), so the host is told what happened
    /// before the trap unwinds into whichever call it was. Unwinding on
    /// wasm32 needs a nightly std.
    #[wasm_bindgen(start)]
    fn start() {
        std::panic::set_hook(Box::new(|info| {
            console_error_panic_hook::hook(info);
            let message = JsValue::from_str(&info.to_string());
            PANIC_LISTENER.with(|l| {
                if let Ok(l) = l.try_borrow() {
                    if let Some(f) = l.as_ref() {
                        let _ = f.call1(&JsValue::NULL, &message);
                    }
                }
            });
        }));
    }

    /// Called with the message when the renderer panics, just before the trap.
    #[wasm_bindgen]
    pub fn set_panic_listener(listener: Option<js_sys::Function>) {
        PANIC_LISTENER.with(|l| *l.borrow_mut() = listener);
    }

    #[wasm_bindgen]
    extern "C" {
        // Works in windows and workers alike.
        #[wasm_bindgen(js_namespace = performance, js_name = now)]
        fn now() -> f64;
    }

    #[wasm_bindgen]
    pub struct Renderer {
        scene: scene::Scene,
        gpu: gpu::Gpu,
        deltas: Vec<u32>,
        builder: frame::FrameBuilder,
        frame: frame::Frame,
        geom: paths::GeomCache,
        text: ms_text::TextEngine,
        built_revision: u64,
        /// `Tex.surface` sources: image id → (subtree root, width, height,
        /// scene revision last drawn).
        /// Per surface image: root node, size, the scene revision it was drawn
        /// at and the generations of the images it painted with.
        surfaces: std::collections::HashMap<u32, (u32, u32, u32, u64, u64)>,
        surface_frame: frame::Frame,
        last_build_ms: f64,
        last_encode_ms: f64,
        last_scene3d_set_ms: f64,
        /// `set_scene3d` decode + hand-over since the last render, and the 3D draws' CPU.
        scene3d_set_ms: f64,
        scene3d_draw_ms: f64,
        scene3d_maps_ms: f64,
        /// Surfaces redrawn by the last frame.
        surfaces_drawn: u32,
        last_apply_ms: f64,
    }

    #[wasm_bindgen]
    impl Renderer {
        /// Gets the GPU device every renderer on the page shares ready, ahead of the first `create`.
        pub async fn prewarm() -> Result<(), JsValue> {
            gpu::prewarm().await.map_err(|e| JsValue::from_str(&e))
        }

        /// Drops the shared device and its pipelines, so the next `prewarm` or
        /// `create` asks for a new one. For a host that learnt of a lost device
        /// before wgpu's own callback ran.
        pub fn forget_device() {
            gpu::forget_shared_device();
        }

        /// Creates a renderer drawing into an `HTMLCanvasElement` or `OffscreenCanvas`.
        pub async fn create(canvas: JsValue, width: u32, height: u32) -> Result<Renderer, JsValue> {
            let target = if canvas.is_instance_of::<web_sys::HtmlCanvasElement>() {
                wgpu::SurfaceTarget::Canvas(canvas.unchecked_into())
            } else {
                wgpu::SurfaceTarget::OffscreenCanvas(canvas.unchecked_into())
            };
            let gpu = gpu::Gpu::new(target, width, height).await.map_err(|e| JsValue::from_str(&e))?;
            Ok(Renderer {
                scene: scene::Scene::new(),
                gpu,
                deltas: vec![0; 1 << 16],
                builder: Default::default(),
                frame: Default::default(),
                geom: Default::default(),
                text: ms_text::TextEngine::new(),
                built_revision: u64::MAX,
                surfaces: Default::default(),
                surface_frame: Default::default(),
                last_build_ms: 0.0,
                last_encode_ms: 0.0,
                scene3d_set_ms: 0.0,
                last_scene3d_set_ms: 0.0,
                scene3d_draw_ms: 0.0,
                scene3d_maps_ms: 0.0,
                surfaces_drawn: 0,
                last_apply_ms: 0.0,
            })
        }

        /// Pointer (byte offset into WASM memory) of a word buffer holding at least
        /// `min_words` words. May reallocate, so callers re-read the pointer and
        /// refresh their views after calling it.
        pub fn delta_buffer(&mut self, min_words: u32) -> u32 {
            if (self.deltas.len() as u32) < min_words {
                self.deltas.resize(min_words.next_power_of_two() as usize, 0);
            }
            self.deltas.as_mut_ptr() as u32
        }

        pub fn delta_capacity(&self) -> u32 {
            self.deltas.len() as u32
        }

        /// Applies the first `words` words of the delta buffer to the scene.
        pub fn apply(&mut self, words: u32) -> Result<(), JsValue> {
            let t0 = now();
            let n = (words as usize).min(self.deltas.len());
            protocol::apply(&mut self.scene, &self.deltas[..n]).map_err(|e| JsValue::from_str(&e))?;
            if self.scene.paints.dirty {
                let (p, s) = self.scene.paints.pack();
                self.gpu.upload_paints(&p, &s);
            }
            self.last_apply_ms = now() - t0;
            Ok(())
        }

        pub fn resize(&mut self, width: u32, height: u32) {
            self.gpu.resize(width, height);
            self.built_revision = u64::MAX;
        }

        /// Registers font bytes under a family name; returns the font id, or
        /// -1 if the bytes aren't a font.
        pub fn register_font(&mut self, bytes: &[u8], family: &str) -> i32 {
            let id = self.text.register_font(bytes.to_vec(), family).map(|f| f.0 as i32).unwrap_or(-1);
            // Text already in the scene may lay out differently now.
            self.scene.revision += 1;
            self.scene.flush_rev = self.scene.revision;
            self.scene.content_flush = self.scene.revision;
            for t in self.scene.text.iter_mut().flatten() {
                t.rev = self.scene.revision;
            }
            id
        }

        /// Uploads image `id` from an `ImageBitmap`, `VideoFrame`,
        /// `HTMLImageElement`, `HTMLVideoElement`, `HTMLCanvasElement` or
        /// `OffscreenCanvas` (a GPU copy). Call again with each new video
        /// frame; the texture is reused. `mipmaps` for still images.
        pub fn upload_image(&mut self, id: u32, source: JsValue, mipmaps: bool) -> Result<(), JsValue> {
            use wgpu::ExternalImageSource as S;
            self.surfaces.remove(&id);
            self.gpu.drop_scene3d(id);
            let (src, w, h) = if let Some(b) = source.dyn_ref::<web_sys::ImageBitmap>() {
                (S::ImageBitmap(b.clone()), b.width(), b.height())
            } else if let Some(f) = source.dyn_ref::<web_sys::VideoFrame>() {
                (S::VideoFrame(<web_sys::VideoFrame as Clone>::clone(f)), f.display_width(), f.display_height())
            } else if let Some(i) = source.dyn_ref::<web_sys::HtmlImageElement>() {
                (S::HTMLImageElement(i.clone()), i.natural_width(), i.natural_height())
            } else if let Some(v) = source.dyn_ref::<web_sys::HtmlVideoElement>() {
                (S::HTMLVideoElement(v.clone()), v.video_width(), v.video_height())
            } else if let Some(c) = source.dyn_ref::<web_sys::HtmlCanvasElement>() {
                (S::HTMLCanvasElement(c.clone()), c.width(), c.height())
            } else if let Some(c) = source.dyn_ref::<web_sys::OffscreenCanvas>() {
                (S::OffscreenCanvas(c.clone()), c.width(), c.height())
            } else {
                return Err(JsValue::from_str("upload_image: unsupported source"));
            };
            if w == 0 || h == 0 {
                return Err(JsValue::from_str("upload_image: empty source"));
            }
            self.gpu.upload_image(id, src, w, h, mipmaps);
            // Draws bind images at encode time; a new texture needs a new frame.
            self.built_revision = u64::MAX;
            Ok(())
        }

        /// A 3D scene (the word stream `web/src/r3d/encode.ts` writes from
        /// core's `Scene3D`) as image `id`, drawn at `width`×`height` px on
        /// this renderer's device and sampled by image paints like any image.
        pub fn set_scene3d(&mut self, id: u32, width: u32, height: u32, words: &[u32]) -> Result<(), JsValue> {
            // An image id is one thing at a time.
            self.surfaces.remove(&id);
            let t0 = now();
            let scene = ms_render3d::decode(words).map_err(|e| JsValue::from_str(&e))?;
            self.gpu.set_scene3d(id, width.max(1), height.max(1), scene);
            self.scene3d_set_ms += now() - t0;
            Ok(())
        }

        /// Image `id` is the 2D subtree under node `root` (a detached group),
        /// drawn at `width`×`height` px whenever the scene changes: a
        /// `Tex.surface` source for 3D maps, and an image for image paints.
        pub fn set_surface(&mut self, id: u32, root: u32, width: u32, height: u32) {
            let (w, h) = (width.max(1), height.max(1));
            self.gpu.drop_scene3d(id);
            self.gpu.ensure_surface(id, w, h);
            // Handed over again as it was (a host rebuilding its document every
            // frame): what it drew stands until its content changes.
            if !matches!(self.surfaces.get(&id), Some(s) if (s.0, s.1, s.2) == (root, w, h)) {
                self.surfaces.insert(id, (root, w, h, u64::MAX, 0));
            }
        }

        /// Scene `scene`'s texture `tex` (an encoder texture id) is image
        /// `image`: an uploaded image or a surface.
        pub fn scene3d_bind(&mut self, scene: u32, tex: u32, image: u32, srgb: bool) {
            self.gpu.scene3d_bind(scene, tex, image, srgb);
        }

        /// Scene `scene`'s texture `tex` from straight RGBA8 rows (a data texture).
        pub fn scene3d_pixels(&mut self, scene: u32, tex: u32, rgba: &[u8], width: u32, height: u32, srgb: bool) {
            self.gpu.scene3d_pixels(scene, tex, rgba, width, height, srgb);
        }

        /// What the last 3D scenes recorded that `ms-render3d` doesn't draw.
        pub fn scene3d_skipped(&self, id: u32) -> Vec<String> {
            self.gpu.scene3d_skipped(id)
        }

        pub fn free_image(&mut self, id: u32) {
            self.surfaces.remove(&id);
            self.gpu.free_image(id);
        }

        /// core's `measureText`: `[width, height]`.
        pub fn measure_text(&mut self, text: &str, size: f32, family: &str, weight: f32, letter_spacing: f32, slant: u32) -> Vec<f32> {
            let (w, h) = self.text.measure_text(text, size, family, weight, letter_spacing, ms_text::Slant::from_index(slant));
            vec![w, h]
        }

        /// core's `layoutTextBlock` for a text node already in the scene, flat:
        /// `[width, height, lineCount, then per line: start, end, top,
        /// bottom, caretCount, carets…]`; empty when there is none.
        pub fn text_block_layout(&mut self, id: u32) -> Vec<f32> {
            let Some(Some(t)) = self.scene.text.get(id as usize) else { return Vec::new() };
            if t.path != scene::NONE {
                return Vec::new();
            }
            let Some(l) = self.text.text_block_layout(&t.state.clone()) else { return Vec::new() };
            let mut out = vec![l.width, l.height, l.lines.len() as f32];
            for line in &l.lines {
                out.extend_from_slice(&[line.start as f32, line.end as f32, line.top, line.bottom, line.carets.len() as f32]);
                out.extend_from_slice(&line.carets);
            }
            out
        }

        pub fn set_options(&mut self, linear: bool, dither: bool) {
            self.gpu.linear = linear;
            self.gpu.dither = dither;
        }

        /// Redraws every surface whose subtree changed since it was drawn, or
        /// an image it paints with (so a surface's 3D maps rebuild only then).
        /// The main frame rebuilds after these (their geometry is uploaded and
        /// drawn before the main build sweeps the cache).
        fn render_surfaces(&mut self) {
            let rev = self.scene.revision;
            let s = &self.scene;
            let stale: Vec<(u32, u64)> = self
                .surfaces
                .iter()
                .filter_map(|(&id, &(root, _, _, drawn, images))| {
                    let sig = self.subtree_images(root);
                    let changed = drawn == u64::MAX
                        || s.content_rev.get(root as usize).is_none_or(|&r| r > drawn)
                        || s.content_flush > drawn
                        || sig != images;
                    changed.then_some((id, sig))
                })
                .collect();
            self.surfaces_drawn = stale.len() as u32;
            for (id, sig) in stale {
                let (root, w, h, _, _) = self.surfaces[&id];
                self.builder.build_subtree(&self.scene, &mut self.geom, &mut self.text, root, w, h, &mut self.surface_frame);
                self.gpu.render_surface(&self.surface_frame, &mut self.geom, id);
                let e = self.surfaces.get_mut(&id).unwrap();
                (e.3, e.4) = (rev, sig);
            }
        }

        /// The generations of the images `root`'s subtree paints with, folded.
        fn subtree_images(&self, root: u32) -> u64 {
            let s = &self.scene;
            let paints = &s.paints.paints;
            let mut sig = 0u64;
            let mut fold = |p: u32| {
                if let Some(paint) = paints.get(p as usize)
                    && paint.head[0] & 0xff == scene::PAINT_IMAGE
                {
                    let image = paint.head[3];
                    sig = sig.rotate_left(7) ^ ((image as u64) << 40) ^ self.gpu.image_generation(image);
                }
            };
            let mut stack = vec![root];
            while let Some(id) = stack.pop() {
                let i = id as usize;
                if i >= s.len() {
                    continue;
                }
                fold(s.fill[i]);
                fold(s.stroke[i].paint);
                if let Some(t) = &s.text[i] {
                    t.run_paints.iter().for_each(|&p| fold(p));
                }
                stack.extend_from_slice(&s.children[i]);
            }
            sig
        }

        fn build(&mut self) {
            self.render_surfaces();
            if self.built_revision != self.scene.revision {
                let t0 = now();
                self.builder.build(&self.scene, &mut self.geom, &mut self.text, &mut self.frame);
                self.built_revision = self.scene.revision;
                self.last_build_ms = now() - t0;
            } else {
                self.last_build_ms = 0.0;
            }
        }

        fn clear_color(&self) -> [f32; 4] {
            self.scene.viewport.as_ref().map(|v| v.clear).unwrap_or([0.0, 0.0, 0.0, 1.0])
        }

        /// Renders the current scene to the canvas.
        pub fn render(&mut self) -> Result<(), JsValue> {
            self.build();
            let t3 = now();
            self.gpu.refresh_maps3d();
            let t4 = now();
            self.gpu.draw_scenes3d();
            self.scene3d_maps_ms = t4 - t3;
            self.scene3d_draw_ms = now() - t4;
            let t0 = now();
            let tex = match self.gpu.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
                other => return Err(JsValue::from_str(&format!("surface texture unavailable: {other:?}"))),
            };
            let view = tex.texture.create_view(&Default::default());
            let clear = self.clear_color();
            self.gpu.render(&self.frame, &mut self.geom, &view, false, clear, None);
            self.gpu.queue.present(tex);
            self.last_encode_ms = now() - t0;
            self.last_scene3d_set_ms = std::mem::take(&mut self.scene3d_set_ms);
            Ok(())
        }

        /// Renders the scene offscreen and resolves to RGBA8 pixels (row-major,
        /// tightly packed). The promise yields a `Uint8Array`.
        pub fn read_pixels(&mut self) -> js_sys::Promise {
            self.build();
            let (w, h) = self.gpu.size();
            let device = self.gpu.device.clone();
            let tex = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("readback"),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let row = (w * 4).div_ceil(256) * 256;
            let buf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("readback"),
                size: (row * h) as u64,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let view = tex.create_view(&Default::default());
            let (t2, b2) = (tex.clone(), buf.clone());
            let clear = self.clear_color();
            let dither = self.gpu.dither;
            self.gpu.dither = false;
            self.gpu.render(
                &self.frame,
                &mut self.geom,
                &view,
                true,
                clear,
                Some(Box::new(move |enc: &mut wgpu::CommandEncoder| {
                    enc.copy_texture_to_buffer(
                        wgpu::TexelCopyTextureInfo {
                            texture: &t2,
                            mip_level: 0,
                            origin: wgpu::Origin3d::ZERO,
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyBufferInfo {
                            buffer: &b2,
                            layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) },
                        },
                        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                    );
                })),
            );
            self.gpu.dither = dither;
            js_sys::Promise::new(&mut |resolve, reject| {
                let b3 = buf.clone();
                let keep = tex.clone();
                buf.slice(..).map_async(wgpu::MapMode::Read, move |res| {
                    let _ = &keep;
                    if res.is_err() {
                        let _ = reject.call1(&JsValue::NULL, &JsValue::from_str("map failed"));
                        return;
                    }
                    let out = js_sys::Uint8Array::new_with_length(w * h * 4);
                    {
                        let Ok(data) = b3.slice(..).get_mapped_range() else {
                            let _ = reject.call1(&JsValue::NULL, &JsValue::from_str("map range failed"));
                            return;
                        };
                        let mut packed = vec![0u8; (w * h * 4) as usize];
                        for y in 0..h as usize {
                            let src = &data[y * row as usize..y * row as usize + (w * 4) as usize];
                            packed[y * (w * 4) as usize..(y + 1) * (w * 4) as usize].copy_from_slice(src);
                        }
                        out.copy_from(&packed);
                    }
                    b3.unmap();
                    let _ = resolve.call1(&JsValue::NULL, &out);
                });
            })
        }

        /// Resolves once the GPU has finished all submitted work.
        pub fn wait_gpu(&self) -> js_sys::Promise {
            let buf = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("fence"),
                size: 4,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let mut enc = self.gpu.device.create_command_encoder(&Default::default());
            enc.clear_buffer(&buf, 0, None);
            self.gpu.queue.submit([enc.finish()]);
            let cell: Rc<RefCell<Option<wgpu::Buffer>>> = Rc::new(RefCell::new(Some(buf.clone())));
            js_sys::Promise::new(&mut |resolve, _reject| {
                let cell = cell.clone();
                buf.slice(..).map_async(wgpu::MapMode::Read, move |_| {
                    if let Some(b) = cell.borrow_mut().take() {
                        b.unmap();
                        b.destroy();
                    }
                    let _ = resolve.call0(&JsValue::NULL);
                });
            })
        }

        /// [build ms, encode+submit ms, apply ms, prims, ops, layers, passes,
        ///  draws, culled, outlines built this frame, pool textures, pool MiB,
        ///  cached outline segments, prims reused from recorded subtrees,
        ///  prims left on the GPU from the previous build, 3D decode + set ms,
        ///  3D draw CPU ms, 3D map refresh ms, surfaces redrawn, surfaces]
        pub fn stats(&self) -> Vec<f64> {
            vec![
                self.last_build_ms,
                self.last_encode_ms,
                self.last_apply_ms,
                self.frame.prims.len() as f64,
                self.frame.op_count() as f64,
                self.frame.layers.len() as f64,
                self.gpu.last_passes as f64,
                self.gpu.last_draws as f64,
                self.frame.culled as f64,
                self.geom.built_this_frame as f64,
                self.gpu.pool.count() as f64,
                self.gpu.pool.bytes() as f64 / (1024.0 * 1024.0),
                self.geom.segs.len() as f64,
                self.frame.reused as f64,
                self.frame.clean.iter().map(|r| r[1] - r[0]).sum::<u32>() as f64,
                self.last_scene3d_set_ms,
                self.scene3d_draw_ms,
                self.scene3d_maps_ms,
                self.surfaces_drawn as f64,
                self.surfaces.len() as f64,
            ]
        }

        /// Validates user shader `source` (`kind` 0 = fill, 1 = effect) and,
        /// when valid, adds it as program `id` on this device. Its draws are
        /// skipped until `shader_build`; the caller compiles the pipelines
        /// asynchronously first (see `web/src/user-shaders.ts`). Returns the
        /// report `validate_shader` does, as JSON.
        pub fn shader_add(&mut self, id: u32, kind: u32, source: &str) -> String {
            let result = user_shader::compile(kind, source);
            if let Ok(c) = &result {
                self.gpu.user_add(id, kind, &c.wgsl);
            }
            report_json(&result)
        }

        /// Creates program `id`'s pipelines; from the next render it draws.
        pub fn shader_build(&mut self, id: u32) {
            self.gpu.user_build(id);
        }

        pub fn shader_remove(&mut self, id: u32) {
            self.gpu.user_remove(id);
        }

        /// The output formats of a user program's pipelines, in order (WebGPU names).
        pub fn shader_formats(&self, kind: u32) -> Vec<String> {
            self.gpu
                .user_formats(kind)
                .into_iter()
                .map(|f| match f {
                    wgpu::TextureFormat::Rgba16Float => "rgba16float",
                    wgpu::TextureFormat::Bgra8Unorm => "bgra8unorm",
                    _ => "rgba8unorm",
                })
                .map(String::from)
                .collect()
        }

        /// The `GPUDevice` this renderer draws with.
        pub fn gpu_device(&self) -> JsValue {
            self.gpu.device.as_webgpu().map(|d| JsValue::from(d.clone())).unwrap_or(JsValue::NULL)
        }

        /// Names of the built-in effects, in `OP_EFFECTS` index order.
        pub fn effect_names(&self) -> Vec<String> {
            crate::effects::EFFECTS.iter().map(|(n, _)| n.to_string()).collect()
        }

        pub fn adapter_info(&self) -> String {
            self.gpu.adapter_info.clone()
        }

        /// Forces the next render to rebuild the frame program even if no delta
        /// arrived, to measure the full CPU path.
        pub fn invalidate(&mut self) {
            self.built_revision = u64::MAX;
            self.builder.flush();
        }
    }
}

/// Validates a user shader without a device: `kind` 0 = fill, 1 = effect.
/// JSON `{ ok, diagnostics: [{ line, column, length, message }], fields:
/// [{ name, offset, scalar, components, elements, stride, type }], size, wgsl }`;
/// `line` is 1-based in `source`, 0 for a problem outside it.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn validate_shader(kind: u32, source: &str) -> String {
    report_json(&user_shader::compile(kind, source))
}

fn report_json(r: &Result<user_shader::Compiled, Vec<user_shader::Diagnostic>>) -> String {
    fn esc(s: &str) -> String {
        let mut o = String::with_capacity(s.len() + 2);
        o.push('"');
        for c in s.chars() {
            match c {
                '"' => o.push_str("\\\""),
                '\\' => o.push_str("\\\\"),
                c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
                c => o.push(c),
            }
        }
        o.push('"');
        o
    }
    match r {
        Ok(c) => {
            let fields: Vec<String> = c
                .fields
                .iter()
                .map(|f| {
                    format!(
                        "{{\"name\":{},\"offset\":{},\"scalar\":{},\"components\":{},\"elements\":{},\"stride\":{},\"type\":{}}}",
                        esc(&f.name), f.offset, f.scalar, f.components, f.elements, f.stride, esc(&f.ty)
                    )
                })
                .collect();
            format!("{{\"ok\":true,\"diagnostics\":[],\"fields\":[{}],\"size\":{},\"wgsl\":{}}}", fields.join(","), c.size, esc(&c.wgsl))
        }
        Err(d) => {
            let ds: Vec<String> = d
                .iter()
                .map(|d| format!("{{\"line\":{},\"column\":{},\"length\":{},\"message\":{}}}", d.line, d.column, d.length, esc(&d.message)))
                .collect();
            format!("{{\"ok\":false,\"diagnostics\":[{}],\"fields\":[],\"size\":0}}", ds.join(","))
        }
    }
}

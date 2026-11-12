//! The renderer without a browser (feature `native`): the same scene,
//! protocol, frame builder and GPU executor as the WASM `Renderer`, on a
//! native wgpu device, drawing into texture views it is handed. `replay.rs`
//! applies a page's recorded export stream to it.
//!
//! Its body mirrors `lib.rs`'s `api::Renderer` minus the JS glue; the two
//! should become one platform-neutral core.

use std::collections::HashMap;
use std::time::Instant;

use crate::{frame, gpu, paths, protocol, scene, user_shader};

pub use gpu::Gpu;

pub struct NativeRenderer {
    scene: scene::Scene,
    pub gpu: gpu::Gpu,
    builder: frame::FrameBuilder,
    frame: frame::Frame,
    geom: paths::GeomCache,
    text: ms_text::TextEngine,
    built_revision: u64,
    /// Per surface image: root node, size, the scene revision it was drawn at
    /// and the generations of the images it painted with.
    surfaces: HashMap<u32, (u32, u32, u32, u64, u64)>,
    surface_frame: frame::Frame,
    pub last_apply_ms: f64,
    pub last_build_ms: f64,
    pub last_encode_ms: f64,
}

fn ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

impl NativeRenderer {
    /// Creates a renderer on the shared native device (high-performance adapter).
    pub async fn new(width: u32, height: u32) -> Result<NativeRenderer, String> {
        let gpu = gpu::Gpu::new_offscreen(width, height).await?;
        Ok(NativeRenderer {
            scene: scene::Scene::new(),
            gpu,
            builder: Default::default(),
            frame: Default::default(),
            geom: Default::default(),
            text: ms_text::TextEngine::new(),
            built_revision: u64::MAX,
            surfaces: Default::default(),
            surface_frame: Default::default(),
            last_apply_ms: 0.0,
            last_build_ms: 0.0,
            last_encode_ms: 0.0,
        })
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.gpu.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.gpu.queue
    }

    pub fn adapter_info(&self) -> &str {
        &self.gpu.adapter_info
    }

    /// The adapter's PCI vendor id (0x10DE NVIDIA, 0x1002 AMD, 0x8086 Intel, 0x106B Apple).
    pub fn adapter_vendor(&self) -> u32 {
        self.gpu.adapter().map_or(0, |i| i.vendor)
    }

    pub fn size(&self) -> (u32, u32) {
        self.gpu.size()
    }

    /// Names of the built-in effects, in `OP_EFFECTS` index order.
    pub fn effect_names() -> Vec<&'static str> {
        crate::effects::EFFECTS.iter().map(|(n, _)| *n).collect()
    }

    pub fn apply(&mut self, words: &[u32]) -> Result<(), String> {
        let t0 = Instant::now();
        protocol::apply(&mut self.scene, words)?;
        if self.scene.paints.dirty {
            let (p, s) = self.scene.paints.pack();
            self.gpu.upload_paints(&p, &s);
        }
        self.last_apply_ms = ms(t0);
        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.gpu.resize(width, height);
        self.built_revision = u64::MAX;
    }

    pub fn register_font(&mut self, bytes: &[u8], family: &str) -> i32 {
        let id = self.text.register_font(bytes.to_vec(), family).map(|f| f.0 as i32).unwrap_or(-1);
        self.scene.revision += 1;
        self.scene.flush_rev = self.scene.revision;
        self.scene.content_flush = self.scene.revision;
        for t in self.scene.text.iter_mut().flatten() {
            t.rev = self.scene.revision;
        }
        id
    }

    /// Image `id` from premultiplied sRGB-encoded RGBA8 rows.
    pub fn upload_rgba(&mut self, id: u32, width: u32, height: u32, rgba: &[u8], mipmaps: bool) -> Result<(), String> {
        if width == 0 || height == 0 {
            return Err("upload_rgba: empty image".into());
        }
        if rgba.len() < (width * height * 4) as usize {
            return Err(format!("upload_rgba: {} bytes for {width}x{height}", rgba.len()));
        }
        self.surfaces.remove(&id);
        self.gpu.drop_scene3d(id);
        self.gpu.upload_rgba(id, width, height, rgba, mipmaps);
        self.built_revision = u64::MAX;
        Ok(())
    }

    pub fn set_scene3d(&mut self, id: u32, width: u32, height: u32, words: &[u32]) -> Result<(), String> {
        self.surfaces.remove(&id);
        let scene = ms_render3d::decode(words)?;
        self.gpu.set_scene3d(id, width.max(1), height.max(1), scene);
        Ok(())
    }

    pub fn set_surface(&mut self, id: u32, root: u32, width: u32, height: u32) {
        let (w, h) = (width.max(1), height.max(1));
        self.gpu.drop_scene3d(id);
        self.gpu.ensure_surface(id, w, h);
        if !matches!(self.surfaces.get(&id), Some(s) if (s.0, s.1, s.2) == (root, w, h)) {
            self.surfaces.insert(id, (root, w, h, u64::MAX, 0));
        }
    }

    pub fn scene3d_bind(&mut self, scene: u32, tex: u32, image: u32, srgb: bool) {
        self.gpu.scene3d_bind(scene, tex, image, srgb);
    }

    pub fn scene3d_pixels(&mut self, scene: u32, tex: u32, rgba: &[u8], width: u32, height: u32, srgb: bool) {
        self.gpu.scene3d_pixels(scene, tex, rgba, width, height, srgb);
    }

    pub fn free_image(&mut self, id: u32) {
        self.surfaces.remove(&id);
        self.gpu.free_image(id);
    }

    pub fn set_options(&mut self, linear: bool, dither: bool) {
        self.gpu.linear = linear;
        self.gpu.dither = dither;
    }

    /// Validates and adds user program `id`; returns whether it compiled.
    /// Native pipelines are built synchronously by `shader_build`.
    pub fn shader_add(&mut self, id: u32, kind: u32, source: &str) -> bool {
        match user_shader::compile(kind, source) {
            Ok(c) => {
                self.gpu.user_add(id, kind, &c.wgsl);
                true
            }
            Err(_) => false,
        }
    }

    pub fn shader_build(&mut self, id: u32) {
        self.gpu.user_build(id);
    }

    pub fn shader_remove(&mut self, id: u32) {
        self.gpu.user_remove(id);
    }

    pub fn invalidate(&mut self) {
        self.built_revision = u64::MAX;
        self.builder.flush();
    }

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
        for (id, sig) in stale {
            let (root, w, h, _, _) = self.surfaces[&id];
            self.builder.build_subtree(&self.scene, &mut self.geom, &mut self.text, root, w, h, &mut self.surface_frame);
            self.gpu.render_surface(&self.surface_frame, &mut self.geom, id);
            let e = self.surfaces.get_mut(&id).unwrap();
            (e.3, e.4) = (rev, sig);
        }
    }

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
            let t0 = Instant::now();
            self.builder.build(&self.scene, &mut self.geom, &mut self.text, &mut self.frame);
            self.built_revision = self.scene.revision;
            self.last_build_ms = ms(t0);
        } else {
            self.last_build_ms = 0.0;
        }
    }

    /// Draws the current scene into `view`, an `Rgba8Unorm` texture the size
    /// of this renderer, and submits. `extra` records after the frame in the
    /// same submission (a conversion or copy of the result).
    pub fn render_into(&mut self, view: &wgpu::TextureView, extra: Option<Box<dyn FnOnce(&mut wgpu::CommandEncoder)>>) {
        self.build();
        self.gpu.refresh_maps3d();
        self.gpu.draw_scenes3d();
        let t0 = Instant::now();
        let clear = self.scene.viewport.as_ref().map(|v| v.clear).unwrap_or([0.0, 0.0, 0.0, 1.0]);
        self.gpu.render(&self.frame, &mut self.geom, view, true, clear, extra);
        self.last_encode_ms = ms(t0);
    }
}

/// Drops the shared device and its pipelines. Call after the last renderer is
/// dropped and before the process exits: left to thread-local teardown, the
/// device outlives the driver's DLLs and the process faults on exit.
pub fn release_device() {
    gpu::forget_shared_device();
}

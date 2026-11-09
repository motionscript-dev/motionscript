//! wasm-bindgen test entry (feature `wasm`): owns a device and a canvas
//! surface around a [`Renderer3D`], which itself never sees the surface.
//! The scene renders into an offscreen RGBA8 texture that is copied to the
//! canvas (and read back by `read_pixels`).

use crate::{Renderer3D, scene};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

fn now() -> f64 {
    js_sys::Date::now()
}

#[wasm_bindgen]
pub struct R3d {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer3D,
    offscreen: wgpu::Texture,
    decode_ms: f64,
    encode_ms: f64,
}

fn offscreen(device: &wgpu::Device, w: u32, h: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("r3d-offscreen"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

#[wasm_bindgen]
impl R3d {
    pub async fn create(canvas: JsValue, width: u32, height: u32) -> Result<R3d, JsValue> {
        console_error_panic_hook::set_once();
        let target = if canvas.is_instance_of::<web_sys::HtmlCanvasElement>() {
            wgpu::SurfaceTarget::Canvas(canvas.unchecked_into())
        } else {
            wgpu::SurfaceTarget::OffscreenCanvas(canvas.unchecked_into())
        };
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgpu::Backends::BROWSER_WEBGPU;
        let instance = wgpu::Instance::new(desc);
        let surface = instance.create_surface(target).map_err(|e| JsValue::from_str(&format!("surface: {e}")))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("adapter: {e}")))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("ms-render3d"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default().using_resolution(adapter.limits()),
                ..Default::default()
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("device: {e}")))?;
        let (w, h) = (width.max(1), height.max(1));
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_DST,
            format: FORMAT,
            color_space: Default::default(),
            width: w,
            height: h,
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: wgpu::CompositeAlphaMode::PreMultiplied,
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let renderer = Renderer3D::new(&device, &queue, FORMAT);
        let offscreen = offscreen(&device, w, h);
        Ok(R3d { device, queue, surface, config, renderer, offscreen, decode_ms: 0.0, encode_ms: 0.0 })
    }

    /// Decodes a scene stream (`web/src/r3d/encode.ts`) and makes it current.
    pub fn set_scene(&mut self, words: &[u32]) -> Result<(), JsValue> {
        let t0 = now();
        let scene = scene::decode(words).map_err(|e| JsValue::from_str(&e))?;
        self.renderer.set_scene(scene);
        self.decode_ms = now() - t0;
        Ok(())
    }

    /// Uploads straight-alpha RGBA8 pixels (first row at v = 0) as texture
    /// `id`, mipmapped; `srgb` for colour maps.
    pub fn upload_texture(&mut self, id: u32, rgba: &[u8], width: u32, height: u32, srgb: bool) {
        self.renderer.upload_texture(id, rgba, width, height, srgb);
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let (w, h) = (width.max(1), height.max(1));
        if w == self.config.width && h == self.config.height {
            return;
        }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
        self.offscreen.destroy();
        self.offscreen = offscreen(&self.device, w, h);
    }

    fn draw(&mut self, enc: &mut wgpu::CommandEncoder) {
        let view = self.offscreen.create_view(&Default::default());
        self.renderer.render(enc, &view, self.config.width, self.config.height);
    }

    /// Renders the current scene to the canvas.
    pub fn render(&mut self) -> Result<(), JsValue> {
        let t0 = now();
        let tex = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            other => return Err(JsValue::from_str(&format!("surface texture unavailable: {other:?}"))),
        };
        let mut enc = self.device.create_command_encoder(&Default::default());
        self.draw(&mut enc);
        enc.copy_texture_to_texture(
            self.offscreen.as_image_copy(),
            tex.texture.as_image_copy(),
            wgpu::Extent3d { width: self.config.width, height: self.config.height, depth_or_array_layers: 1 },
        );
        self.queue.submit([enc.finish()]);
        self.queue.present(tex);
        self.encode_ms = now() - t0;
        Ok(())
    }

    /// Renders and resolves to tightly packed RGBA8 rows (premultiplied,
    /// sRGB-encoded, like three's canvas). Yields a `Uint8Array`.
    pub fn read_pixels(&mut self) -> js_sys::Promise {
        let (w, h) = (self.config.width, self.config.height);
        let row = (w * 4).div_ceil(256) * 256;
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("r3d-readback"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut enc = self.device.create_command_encoder(&Default::default());
        self.draw(&mut enc);
        enc.copy_texture_to_buffer(
            self.offscreen.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buf,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit([enc.finish()]);
        js_sys::Promise::new(&mut |resolve, reject| {
            let b = buf.clone();
            buf.slice(..).map_async(wgpu::MapMode::Read, move |res| {
                if res.is_err() {
                    let _ = reject.call1(&JsValue::NULL, &JsValue::from_str("map failed"));
                    return;
                }
                let out = js_sys::Uint8Array::new_with_length(w * h * 4);
                {
                    let Ok(data) = b.slice(..).get_mapped_range() else {
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
                b.unmap();
                let _ = resolve.call1(&JsValue::NULL, &out);
            });
        })
    }

    /// Resolves once the GPU has finished all submitted work.
    pub fn wait_gpu(&self) -> js_sys::Promise {
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("r3d-fence"),
            size: 4,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut enc = self.device.create_command_encoder(&Default::default());
        enc.clear_buffer(&buf, 0, None);
        self.queue.submit([enc.finish()]);
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

    /// [decode ms, encode+submit ms, draws, instances, triangles, shadow maps,
    ///  cached geometries, pipelines]
    pub fn stats(&self) -> Vec<f64> {
        let s = self.renderer.stats;
        vec![
            self.decode_ms,
            self.encode_ms,
            s.draws as f64,
            s.instances as f64,
            s.triangles as f64,
            s.shadow_maps as f64,
            s.geometries as f64,
            s.pipelines as f64,
        ]
    }

    /// What the current scene recorded and this renderer skipped.
    pub fn skipped(&self) -> Vec<String> {
        self.renderer.scene().skipped.iter().map(|s| s.to_string()).collect()
    }
}

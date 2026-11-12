//! The native half of `Gpu` (feature `native`): images
//! arrive as pixels, since there is no browser image source to copy from.

use super::Gpu;

impl Gpu {
    /// Uploads (or replaces) image `id` from premultiplied, sRGB-encoded RGBA8
    /// rows, `w * 4` bytes each: what `copy_external_image_to_texture` writes
    /// on the web.
    pub fn upload_rgba(&mut self, id: u32, w: u32, h: u32, rgba: &[u8], mipmaps: bool) {
        let mips = if mipmaps { 32 - w.max(h).max(1).leading_zeros() } else { 1 };
        self.ensure_image(id, w, h, mips);
        let img = self.images[id as usize].as_mut().unwrap();
        img.generation += 1;
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &img.tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: Some(h) },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.build_mips(id);
    }
}

impl Gpu {
    /// The shared device's adapter (its PCI vendor picks the export's encoder).
    pub fn adapter(&self) -> Option<wgpu::AdapterInfo> {
        super::SHARED.with(|s| s.borrow().as_ref().map(|d| d.adapter.get_info()))
    }
}

/// The adapter `WGPU_ADAPTER_NAME` names (a case-insensitive part of its
/// name), for picking a GPU on a machine with several; None when unset.
pub(super) async fn adapter_named(instance: &wgpu::Instance, backends: wgpu::Backends) -> Option<wgpu::Adapter> {
    let want = std::env::var("WGPU_ADAPTER_NAME").ok()?.to_lowercase();
    instance.enumerate_adapters(backends).await.into_iter().find(|a| a.get_info().name.to_lowercase().contains(&want))
}

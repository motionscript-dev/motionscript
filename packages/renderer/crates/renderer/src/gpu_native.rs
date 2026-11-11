//! The native half of `Gpu` (feature `native`, the export sidecar): images
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

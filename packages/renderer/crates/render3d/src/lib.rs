//! `ms-render3d`: a wgpu forward renderer for Motion Script's 3D scene data
//! (core's `Scene3D`), following three.js's conventions and formulas.
//!
//! - [`scene`]: the decoded scene and the decoder for the word stream that
//!   `web/src/r3d/encode.ts` writes from a `Scene3D`.
//! - [`renderer::Renderer3D`]: takes a `wgpu::Device`/`Queue` and draws into a
//!   caller's texture view. It owns no surface, so the 2D render graph can
//!   call it on its own device (the integration seam, docs-3d-renderer.md).
//! - [`geometry`]: three.js r185's primitive generators, ported.
//! - `wasm` (feature): a standalone wasm-bindgen entry for the crate on its own.

mod dfg;
pub mod geometry;
pub mod renderer;
pub mod scene;
#[cfg(feature = "wasm")]
mod wasm;

pub use renderer::{Renderer3D, Shared3D, Stats};
pub use scene::{Scene, decode};

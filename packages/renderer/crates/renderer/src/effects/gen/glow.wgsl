// Generated from web/src/effects/glow.ts by scripts/gen-effect-params.mjs. Do not edit.
fn param_channel() -> f32 { return param(0u); }
fn param_threshold() -> f32 { return param(1u); }
fn param_spread() -> f32 { return param(2u); }
fn param_intensity() -> f32 { return param(3u); }
fn param_tint() -> f32 { return param(4u); }
fn param_original() -> f32 { return param(5u); }
fn param_blend() -> f32 { return param(6u); }
fn param_count() -> f32 { return param(7u); }
fn param_cycles() -> f32 { return param(8u); }
fn param_phase() -> f32 { return param(9u); }
fn param_mirror() -> f32 { return param(10u); }
const PARAM_STOPS: u32 = 11u;
fn param_stops(i: u32) -> f32 { return param(PARAM_STOPS + i); }
const PARAM_COLORS: u32 = 19u;
fn param_colors(i: u32) -> vec4f { return param4(PARAM_COLORS + i * 4u); }

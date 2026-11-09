// Generated from web/src/effects/bitCrush.ts by scripts/gen-effect-params.mjs. Do not edit.
fn param_bits() -> f32 { return param(0u); }
fn param_amount() -> f32 { return param(1u); }
fn param_count() -> f32 { return param(2u); }
const PARAM_PALETTE: u32 = 3u;
fn param_palette(i: u32) -> vec3f { return vec3f(param(PARAM_PALETTE + i * 3u), param(PARAM_PALETTE + i * 3u + 1u), param(PARAM_PALETTE + i * 3u + 2u)); }

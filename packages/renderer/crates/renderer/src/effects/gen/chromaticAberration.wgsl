// Generated from web/src/effects/chromaticAberration.ts by scripts/gen-effect-params.mjs. Do not edit.
const PARAM_RED: u32 = 0u;
fn param_red(i: u32) -> f32 { return param(PARAM_RED + i); }
const PARAM_BLUE: u32 = 20u;
fn param_blue(i: u32) -> f32 { return param(PARAM_BLUE + i); }
fn param_offset() -> vec2f { return param2(40u); }

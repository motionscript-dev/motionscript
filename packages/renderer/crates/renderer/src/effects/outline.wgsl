// outline — a band between a dilated and an
// eroded copy of the alpha, sampled on rings of taps (count bucketed by the
// radius, as the engine bakes it into its program).
// position: 0 outside, 1 inside, 2 center.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn taps_for(radius: f32) -> i32 {
    let wanted = 6.2831855 * radius / 3.0;
    if (wanted <= 12.0) { return 12; }
    if (wanted <= 16.0) { return 16; }
    if (wanted <= 24.0) { return 24; }
    if (wanted <= 32.0) { return 32; }
    return 40;
}

fn effect(p: vec2f) -> vec4f {
    let s = src(p);
    let width = param_width() * u.scale;
    let position = u32(param_position());
    let color = param_color();
    if (width <= 0.0 || color.a <= 0.0) { return s; }
    var r_out = width;
    var r_in = 0.0;
    if (position == 1u) { r_out = 0.0; r_in = width; }
    if (position == 2u) { r_out = width * 0.5; r_in = width * 0.5; }
    let dilating = position != 1u;
    let eroding = position != 0u;
    if (position == 0u && s.a >= 1.0) { return s; }
    if (position == 1u && s.a <= 0.0) { return s; }

    let taps = taps_for(max(r_out, r_in));
    let step = 6.2831855 / f32(taps);
    var dilated = s.a;
    var eroded = s.a;
    for (var i = 0; i < 40; i++) {
        if (i >= taps) { break; }
        let angle = f32(i) * step;
        let dir = vec2f(cos(angle), sin(angle));
        if (dilating) { dilated = max(dilated, src(p + dir * r_out).a); }
        if (eroding) {
            eroded = min(eroded, src(p + dir * r_in).a);
            eroded = min(eroded, src(p + dir * r_in * 0.5).a);
        }
    }
    let ring = clamp(dilated - eroded, 0.0, 1.0);
    let ba = ring * color.a;
    let band = vec4f(color.rgb * ba, ba);
    if (position == 0u) {
        return s + band * (1.0 - s.a);
    }
    return band + s * (1.0 - band.a);
}

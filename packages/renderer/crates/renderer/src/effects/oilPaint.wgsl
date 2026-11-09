// oilPaint — Kuwahara filter.
// The engine bakes the radius into the source; here it is derived from the
// param and u.scale, looped with a capped bound (6).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

const LUMA: vec3f = vec3f(0.2126, 0.7152, 0.0722);

fn effect(p: vec2f) -> vec4f {
    let centre = src(p);
    if (centre.a <= 0.0) {
        return centre;
    }
    // Math.round(min(6, radius * scale)): half rounds up.
    let radius = i32(floor(min(6.0, param_radius() * u.scale) + 0.5));
    var best_mean = centre.rgb / centre.a;
    var best_var = 1e9;
    for (var q = 0; q < 4; q++) {
        let sx = select(-1.0, 1.0, q == 1 || q == 3);
        let sy = select(-1.0, 1.0, q == 2 || q == 3);
        var sum = vec3f(0.0);
        var sum_l = 0.0;
        var sum_l2 = 0.0;
        var n = 0.0;
        for (var y = 0; y <= 6; y++) {
            if (y > radius) { break; }
            for (var x = 0; x <= 6; x++) {
                if (x > radius) { break; }
                let s = src(p + vec2f(f32(x) * sx, f32(y) * sy));
                if (s.a <= 0.0) { continue; }
                let c = s.rgb / s.a;
                let l = dot(c, LUMA);
                sum += c;
                sum_l += l;
                sum_l2 += l * l;
                n += 1.0;
            }
        }
        if (n <= 0.0) { continue; }
        let mean = sum_l / n;
        let variance = sum_l2 / n - mean * mean;
        if (variance < best_var) {
            best_var = variance;
            best_mean = sum / n;
        }
    }
    return vec4f(best_mean * centre.a, centre.a);
}

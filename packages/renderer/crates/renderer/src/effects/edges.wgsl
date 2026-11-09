// edges — Sobel / Prewitt / Laplacian.
// kernel: 0 sobel, 1 prewitt, 2 laplacian (core's option order).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

const LUMA: vec3f = vec3f(0.2126, 0.7152, 0.0722);

fn effect(p: vec2f) -> vec4f {
    let s = max(u.scale, 1.0);
    let c11 = src(p);
    let c00 = src(p + vec2f(-s, -s)).rgb;
    let c01 = src(p + vec2f(0.0, -s)).rgb;
    let c02 = src(p + vec2f(s, -s)).rgb;
    let c10 = src(p + vec2f(-s, 0.0)).rgb;
    let c12 = src(p + vec2f(s, 0.0)).rgb;
    let c20 = src(p + vec2f(-s, s)).rgb;
    let c21 = src(p + vec2f(0.0, s)).rgb;
    let c22 = src(p + vec2f(s, s)).rgb;

    let w = select(1.0, 2.0, param_kernel() < 0.5);
    let gx = (c02 + c12 * w + c22) - (c00 + c10 * w + c20);
    let gy = (c20 + c21 * w + c22) - (c00 + c01 * w + c02);
    let gradient = sqrt(gx * gx + gy * gy);
    let lap = abs(c11.rgb * 4.0 - c01 - c10 - c12 - c21);

    let e = select(lap, gradient, param_kernel() < 1.5);
    let edge0 = select(vec3f(dot(e, LUMA)), e, param_colored() > 0.5);
    let edge = clamp(edge0 * param_strength(), vec3f(0.0), vec3f(1.0));

    let a = max(c11.a, max(edge.r, max(edge.g, edge.b)));
    return vec4f(edge * a, a);
}

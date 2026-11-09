// pixelate — a nearest
// downsample onto a blocks.x × blocks.y grid anchored at the box's top-left
// (each cell takes the pixel at its centre), then an upsample back, nearest
// (solid blocks) or linear (blended, fading out past the grid's edge).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn cell(i: vec2f, n: vec2f, size: vec2f) -> vec4f {
    if (any(i < vec2f(0.0)) || any(i >= ceil(n))) {
        return vec4f(0.0);
    }
    return src(floor(box_origin() + (i + 0.5) * size) + 0.5);
}

fn effect(p: vec2f) -> vec4f {
    // Block counts clamp to [1, the box's logical size], as the engine's do.
    let n = clamp(param_blocks(), vec2f(1.0), max(box_size() / u.scale, vec2f(1.0)));
    let size = box_size() / n;
    let g = (p - box_origin()) / size;
    if (param_sharp_colors() > 0.5) {
        return cell(floor(g), n, size);
    }
    let h = g - 0.5;
    let i = floor(h);
    let f = h - i;
    let top = mix(cell(i, n, size), cell(i + vec2f(1.0, 0.0), n, size), f.x);
    let bottom = mix(cell(i + vec2f(0.0, 1.0), n, size), cell(i + vec2f(1.0), n, size), f.x);
    return mix(top, bottom, f.y);
}

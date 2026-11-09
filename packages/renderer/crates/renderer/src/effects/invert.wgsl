// invert — identity lerped toward
// the channel's full inversion matrix by `strength`.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    // The engine's layer is 8-bit premultiplied: a faint AA fringe it rounds
    // to nothing must stay nothing here, or an alpha invert lights it up.
    return color_matrix(round(src(p) * 255.0) / 255.0, PARAM_MATRIX);
}

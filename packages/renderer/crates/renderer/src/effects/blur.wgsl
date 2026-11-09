// blur — a gaussian of sigma radius / 2, transparent past the edges. The renderer's blur (the packer's `blur`) does the work.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    return blurred(p);
}

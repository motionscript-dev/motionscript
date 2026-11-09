import { component2d, Effects, Fills, Flow, Paint, Shapes, type NodeOf } from "@motionscript/sdk"

/**
 * A flowing plasma fill, colourised by `hue` and paced by `speed`.
 *
 * Time and size come from `FillIn`; `hue`/`speed` are this node's own. Hoisted
 * to module scope because `source` is the shader's compile-cache key — rebuilding
 * the string per frame would compile a program per frame.
 */
const AURORA_FILL = /* wgsl */ `
struct Params { hue: f32, speed: f32 }

fn hue2rgb(h: f32) -> vec3f {
    let p = abs((h * 6.0 + vec3f(5.0, 3.0, 1.0)) % 6.0 - 3.0);
    return clamp(p - 1.0, vec3f(0.0), vec3f(1.0));
}

fn fill(in: FillIn) -> vec4f {
    let uv = vec2f(in.uv.x * in.size.x / in.size.y, 1.0 - in.uv.y);
    let t = in.time * u.speed;
    var n = sin(uv.x * 2.4 + t * 0.9)
          + sin(uv.y * 3.1 - t * 1.3 + uv.x * 1.6)
          + sin((uv.x + uv.y) * 2.0 + t * 0.6);
    n = n / 3.0 * 0.5 + 0.5;
    let h = fract(u.hue / 360.0 + n * 0.4);
    return vec4f(hue2rgb(h) * (0.4 + 0.6 * n), 1.0);
}
`

/**
 * Ripples what lies beneath this node (`backdrop` mode), animated from the
 * renderer's own clock, so the node writes no prop per frame.
 */
const RIPPLE_EFFECT = /* wgsl */ `
struct Params { ripple: f32 }

fn effect(in: EffectIn) -> vec4f {
    let wave = sin(in.uv.y * 30.0 + in.time * 2.4) * u.ripple * 26.0;
    return sample_src_px(in.px + vec2f(wave * in.scale, 0.0));
}
`

/**
 * A card whose fill and its own ripple are two custom WGSL shaders rather than
 * the built-in fill/effect vocabulary — the escape hatch both `Fills.shader` and
 * `Effects.shader` document as sitting at the end of the procedural spectrum.
 *
 * One custom node, two custom shaders: a `shader` **fill** paints the aurora and
 * a `shader` **effect** in `backdrop` mode resamples exactly that paint to
 * ripple it. `hue`/`speed`/`ripple` are ordinary state entries, so a scene can
 * tween them (`card().to({ data: { hue: 40 }, duration: 2 })`) like any other
 * prop — the fill and effect default to bindings over them and recompute
 * reactively.
 */
export const AuroraCard = component2d({
    key: "auroraCard",
    state: {
        ...Paint.state, ...Flow.state, ...Shapes.corners,
        /** Base hue in degrees (0-360). */
        hue: 275,
        /** Animation speed multiplier. */
        speed: 0.8,
        /** Ripple/refraction amount over the aurora. */
        ripple: 0.4,
    },
    defaults: {
        fill: (state) => Fills.shader(AURORA_FILL, {
            uniforms: { hue: state.hue, speed: state.speed },
        }),
        effects: (state) => Effects.shader({
            source: RIPPLE_EFFECT,
            mode: "backdrop",
            uniforms: { ripple: state.ripple },
        }),
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

export type AuroraCard = NodeOf<typeof AuroraCard>

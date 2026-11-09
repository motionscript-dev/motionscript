import { component2d, Fills, Flow, Paint, Shapes, type NodeOf } from "@motionscript/sdk"

/**
 * Concentric rings expanding from the card's centre, one custom `Fills.shader`.
 *
 * Time and size come from `FillIn`; `hue`/`speed`/`rings` are this node's own.
 */
const PULSE_RING_FILL = /* wgsl */ `
struct Params { hue: f32, speed: f32, rings: f32 }

fn hue2rgb(h: f32) -> vec3f {
    let p = abs((h * 6.0 + vec3f(5.0, 3.0, 1.0)) % 6.0 - 3.0);
    return clamp(p - 1.0, vec3f(0.0), vec3f(1.0));
}

fn fill(in: FillIn) -> vec4f {
    let p = vec2f((in.uv.x - 0.5) * in.size.x / in.size.y, in.uv.y - 0.5);
    let dist = length(p);
    let wave = fract(dist * u.rings - in.time * u.speed);
    let ring = smoothstep(0.5, 0.42, abs(wave - 0.5) * 2.0);
    let a = ring * (1.0 - smoothstep(0.0, 0.7, dist));
    return vec4f(hue2rgb(fract(u.hue / 360.0)) * a, a);
}
`

/**
 * This file is not part of `./index`'s barrel and is not in `./nodes`'
 * `NODES` list — it exists only for `ms add pulse-ring` to copy, so a project
 * that installs `@motionscript/shaders` never registers `pulseRing` twice
 * over. See `registry.json`.
 *
 * One custom node, one custom shader: a `shader` **fill** paints the rings.
 * `hue`/`speed`/`rings` are ordinary state entries, so a scene can tween them
 * (`ring().to({ data: { rings: 14 }, duration: 2 })`) like any other prop — the
 * fill defaults to a binding over them and recomputes reactively.
 */
export const PulseRing = component2d({
    key: "pulseRing",
    state: {
        ...Paint.state, ...Flow.state, ...Shapes.corners,
        /** Ring colour, in degrees (0-360). */
        hue: 200,
        /** Animation speed multiplier. */
        speed: 0.6,
        /** How many rings fit between the centre and the edge. */
        rings: 8,
    },
    defaults: {
        fill: (state) => [
            "#12141c",
            Fills.shader(PULSE_RING_FILL, {
                uniforms: { hue: state.hue, speed: state.speed, rings: state.rings },
            }),
        ],
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

export type PulseRing = NodeOf<typeof PulseRing>

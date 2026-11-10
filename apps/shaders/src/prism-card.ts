import { component2d, Fills, Flow, Paint, Shapes, type FillShader, type NodeOf } from "@motionscript/sdk"

const PRISM_SOURCE = /* wgsl */ `
struct Params { hue: f32, spin: f32, bands: f32 }

fn hue2rgb(h: f32) -> vec3f {
    let p = abs((h * 6.0 + vec3f(5.0, 3.0, 1.0)) % 6.0 - 3.0);
    return clamp(p - 1.0, vec3f(0.0), vec3f(1.0));
}

fn fill(in: FillIn) -> vec4f {
    let p = vec2f((in.uv.x - 0.5) * in.size.x / in.size.y, 0.5 - in.uv.y);
    let angle = atan2(p.y, p.x) / 6.2831853 + 0.5;
    let h = fract(u.hue / 360.0 + angle * u.bands + in.time * u.spin * 0.15);
    let vignette = 1.0 - smoothstep(0.0, 0.75, length(p));
    return vec4f(hue2rgb(h) * vignette, 1.0);
}
`

/**
 * A **shader pack** — `Fills.shader`'s structured form, over the bare
 * `(source, { uniforms })` `AuroraCard` uses.
 *
 * The difference is `properties`: each editable value is declared once, by
 * kind (`hue` reads as a colour wheel, `slider` carries real bounds) and by
 * the uniform it writes — so a host can draw a panel for this shader knowing
 * nothing about it beyond the pack itself, and `Fills.shader(PRISM_SHADER,
 * { values })` resolves author-friendly overrides the same way a node's own
 * state entry does, without this file hand-building a `uniforms` record.
 *
 * This module no longer registers it. A pack is data, and registering it from
 * module scope is the same hazard as registering a node type there: a bundler
 * with `sideEffects: false` may drop the module, and the failure — a document
 * naming `"shaderLab.prism"` finding nothing — points nowhere near the cause.
 * A host lists it in its project entry's `shaders` instead, which is what makes
 * it *findable* by id: a registry's `shaderKeys()` lists it and
 * `fillShader('shaderLab.prism')` fetches it back, so a document can
 * reference this shader from a plain `rect` with no `PrismCard` involved.
 *
 * `PrismCard` below does not depend on that — it passes the pack itself to
 * `Fills.shader`, so it draws whether or not anything registered it.
 */
export const PRISM_SHADER: FillShader = {
    id: "shaderLab.prism",
    scope: "fill",
    name: "Prism",
    description: "A spinning spectrum sweep radiating from the shape's centre.",
    source: PRISM_SOURCE,
    properties: {
        hue: { kind: "hue", default: 0, inputs: { value: "hue" } },
        spin: { kind: "slider", default: 1, min: 0, max: 4, step: 0.1, inputs: { value: "spin" } },
        bands: { kind: "slider", default: 6, min: 2, max: 16, step: 1, inputs: { value: "bands" } },
    },
};

/**
 * A card painted by {@link PRISM_SHADER}, read back through its `properties`
 * rather than a hand-built `uniforms` record — `hue`/`spin`/`bands` are
 * ordinary state entries a scene can tween, and the fill defaults to a binding
 * over them so it recomputes reactively, exactly like `AuroraCard`.
 */
export const PrismCard = component2d({
    key: "prismCard",
    state: {
        ...Paint.state, ...Flow.state, ...Shapes.corners,
        /** Base hue offset in degrees (0-360). */
        hue: 0,
        /** Rotation speed multiplier. */
        spin: 1,
        /** How many spectrum repeats fit around the centre. */
        bands: 6,
    },
    defaults: {
        fill: (state) => Fills.shader(PRISM_SHADER, {
            values: { hue: state.hue, spin: state.spin, bands: state.bands },
        }),
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

export type PrismCard = NodeOf<typeof PrismCard>

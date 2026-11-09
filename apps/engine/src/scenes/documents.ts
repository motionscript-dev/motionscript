/**
 * The scenes this server renders, as **documents**.
 *
 * Plain data — no JSX, no build step, no browser — which is what lets a scene
 * be stored, posted to an endpoint or read from a database and rendered as-is.
 * Edit these freely: this app owns them and shares them with nothing.
 */
import type { CompositionDocument, TimedNodeSpec } from '@motionscript/sdk';

export interface SceneDoc {
    /** URL-safe id: what the HTTP API and the react app's picker address. */
    id: string;
    /** Display name. */
    name: string;
    /** One line on what it is meant to prove. */
    description: string;
    /**
     * True for a scene that names a font family. There is no fallback face
     * anywhere in the stack — an unregistered family shapes to nothing — so a
     * host without that font should say so rather than render an empty frame.
     */
    requiresFont?: boolean;
    doc: CompositionDocument;
}

/** The scene root: a `canvas2d` node, a row in `nodes` like any other. */
function root(props: Record<string, unknown>): TimedNodeSpec {
    return { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props };
}

/**
 * The family the text scene names.
 *
 * Node has no system fonts and no fallback face, so this only shapes if a file
 * for it is registered — see `discoverFonts` in `src/render.ts`, which picks up
 * anything in `assets/fonts/`.
 */
export const FONT_FAMILY = 'Inter';

/**
 * Shapes, easing and a stroke dash — the smallest scene that shows the renderer
 * is alive and that a `to` interpolates rather than snapping.
 */
const shapes: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15' }),
        {
            id: 'card', type: 'rect', parentId: null, layerOrder: 0,
            props: {
                width: 520, height: 320, cornerRadius: 32,
                fill: '#161a21', y: 0,
                shadow: { blur: 60, fill: 'black/50', offset: { x: 0, y: 24 } },
            },
        },
        {
            id: 'ring', type: 'polygram', parentId: null, layerOrder: 1,
            props: {
                sides: 5, width: 260, height: 260, cornerRadius: 16,
                stroke: { weight: 12, fill: '#6990dd', dash: 24 },
            },
        },
    ],
    commands: [
        {
            id: 'card-grow', type: 'to', targetId: 'card', at: 0, duration: 1.2,
            easing: { kind: 'out', args: 'quad' },
            args: { width: 760, rotation: 4 },
        },
        {
            id: 'ring-spin', type: 'to', targetId: 'ring', at: 0.2, duration: 1.6,
            easing: { kind: 'inOut', args: 'cubic' },
            args: { rotation: 180, stroke: { dashOffset: 240 } },
        },
        {
            id: 'ring-color', type: 'to', targetId: 'ring', at: 1.8, duration: 0.8,
            args: { stroke: { fill: '#e8617c' }, scale: 1.35 },
        },
    ],
};

/**
 * One variable, four nodes.
 *
 * The v3 idea worth verifying by eye: a single `variableTo` drives every bound
 * prop, so the four bars cannot drift out of step and re-timing the move is one
 * field. If they ever stagger, expressions are not binding to signals.
 */
const variableBars: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15' }),
        {
            id: 'row', type: 'rect', parentId: null, layerOrder: 0,
            props: { flow: 'horizontal', gap: 28, align: 'center', width: 'hug', height: 'hug' },
        },
        ...[0, 1, 2, 3].map((i) => ({
            id: `bar-${i}`,
            type: 'rect',
            parentId: 'row',
            layerOrder: i,
            props: {
                width: 90,
                // Every bar reads the one variable, scaled per index —
                // arithmetic in the expression, not four tweens.
                height: `=80+[k]*${1.4 + i * 0.5}`,
                cornerRadius: 18,
                fill: ['#6990dd', '#7fb2e5', '#e8617c', '#f0a35e'][i],
                opacity: '=0.35+[k]/160',
            },
        })),
    ],
    variables: [
        { id: 'k', name: 'lift', value: 0, lerp: 'number' },
    ],
    commands: [
        {
            id: 'lift', type: 'variableTo', targetId: 'k', at: 0.2, duration: 1.4,
            easing: { kind: 'out', args: { type: 'back', overshoot: 1.6 } },
            args: { value: 100 },
        },
        {
            id: 'drop', type: 'variableTo', targetId: 'k', at: 2.0, duration: 1.0,
            easing: { kind: 'inOut', args: 'quad' },
            args: { value: 20 },
        },
    ],
};

/**
 * Text and a counting number.
 *
 * **Needs a font** — see {@link FONT_FAMILY}. The scene is marked
 * `requiresFont` so the app can say so instead of drawing an empty frame.
 */
const text: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15', flow: 'vertical', gap: 24, align: 'center' }),
        {
            id: 'title', type: 'text', parentId: null, layerOrder: 0,
            props: {
                text: 'motion script', fontFamily: FONT_FAMILY,
                fontSize: 96, fill: 'white', opacity: 0,
            },
        },
        {
            id: 'count', type: 'number', parentId: null, layerOrder: 1, startAt: 0.4,
            props: {
                value: 0, fontFamily: FONT_FAMILY,
                fontSize: 140, fill: '#6990dd', fractionDigits: 0,
            },
        },
    ],
    commands: [
        {
            id: 'title-in', type: 'to', targetId: 'title', at: 0, duration: 0.8,
            easing: { kind: 'out', args: 'quad' },
            args: { opacity: 1, y: -40 },
        },
        {
            id: 'count-up', type: 'countTo', targetId: 'count', at: 0.6, duration: 2,
            easing: { kind: 'out', args: 'cubic' },
            args: { value: 1080 },
        },
    ],
};

/**
 * A custom node from an installed package (`@motionscript/shaders`,
 * `@motionscript/sdk`'s own `NODES` import registers it — see `render.ts`),
 * referenced the same way `rect`/`polygram`/`text` are above: a string in
 * `type`. Its two custom WGSL shaders — a plasma fill and a backdrop ripple —
 * animate from the renderer's own clock; the `to` below only tweens the three
 * plain state entries that steer them.
 */
const auroraDocument: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15' }),
        {
            id: 'aurora', type: 'auroraCard', parentId: null, layerOrder: 0,
            props: { width: 640, height: 400, cornerRadius: 32, hue: 200, speed: 0.5, ripple: 0.2 },
        },
    ],
    commands: [
        {
            id: 'aurora-drift', type: 'to', targetId: 'aurora', at: 0.4, duration: 3,
            easing: { kind: 'inOut', args: 'quad' },
            args: { hue: 20, speed: 1.3, ripple: 0.7 },
        },
    ],
};

/**
 * A custom node this app does not depend on at all — its source was copied
 * into `src/components/pulse-ring.ts` with `ms add pulse-ring`, the same way
 * shadcn/ui copies a component into a project instead of publishing it as a
 * dependency. `project.ts` lists that local copy in its `nodes`; this document reaches it the same way it reaches `auroraCard` — a
 * string in `type` — because the registry does not care how a type got
 * registered, only that it did.
 */
const pulseRingDocument: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15' }),
        {
            id: 'pulse', type: 'pulseRing', parentId: null, layerOrder: 0,
            props: { width: 640, height: 400, cornerRadius: 32, hue: 190, speed: 0.6, rings: 8 },
        },
    ],
    commands: [
        {
            id: 'pulse-drift', type: 'to', targetId: 'pulse', at: 0.4, duration: 3,
            easing: { kind: 'inOut', args: 'quad' },
            args: { hue: 330, speed: 1.6, rings: 14 },
        },
    ],
};

/**
 * A custom node whose *source is a string* — `project.ts`'s
 * `dynamicBadgeSource`, compiled by `@motionscript/browser`'s own
 * `esbuild-wasm` default the moment the bundled entry reaches
 * `createBrowserEngine` inside the page, not by anything in this file or
 * `render.ts`. Reached the same way every other custom node here is — a
 * string in `type` — because a document never knows or cares how its type
 * got registered.
 */
const dynamicDocument: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15' }),
        {
            id: 'badge', type: 'dynamicBadge', parentId: null, layerOrder: 0,
            props: { width: 440, height: 440, count: 6, color: '#6990dd' },
        },
    ],
    commands: [
        {
            id: 'badge-drift', type: 'to', targetId: 'badge', at: 0.4, duration: 3,
            easing: { kind: 'inOut', args: 'quad' },
            args: { count: 14, color: '#e8617c' },
        },
    ],
};

/**
 * `prismCard`'s fill is a registered **shader pack** (`PRISM_SHADER` in
 * `prism-card.ts`) rather than a bare `Fills.shader(source, { uniforms })`
 * call like `auroraCard`/`pulseRing` use — its editable values are declared
 * once, by kind and by the uniform each writes, so a host could draw a panel
 * for it knowing nothing beyond the pack. Nothing about *this* document
 * changes for that: a shader pack is still reached by tweening the node's own
 * state entries.
 */
const prismDocument: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: '#0d0f15' }),
        {
            id: 'prism', type: 'prismCard', parentId: null, layerOrder: 0,
            props: { width: 640, height: 400, cornerRadius: 32, hue: 0, spin: 0.6, bands: 5 },
        },
    ],
    commands: [
        {
            id: 'prism-drift', type: 'to', targetId: 'prism', at: 0.4, duration: 3,
            easing: { kind: 'inOut', args: 'quad' },
            args: { hue: 260, spin: 2.4, bands: 10 },
        },
    ],
};

/** Every demo scene, in the order both apps list them. */
/**
 * A lit box turning inside a `Canvas3D`.
 *
 * The scene the whole 3D path hangs on: a `Node3D` tree recorded into a
 * `Scene3D`, reconciled into a three scene, rasterized by the platform renderer,
 * then uploaded and shaded through the shape's own fill. It is here because the
 * in-process CPU renderer this app used to run on could not draw it **at all** —
 * `upload3DFrame` returned null and warned once — so a server render and a
 * preview were different pictures with nothing to say so.
 *
 * Rotation is a `to` on the node rather than a clock read, so the frame at a
 * given time is the same whether it was played or seeked to.
 */
const view3dDocument: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: 'bg' }),
        {
            id: 'view', type: 'canvas3d', parentId: null, layerOrder: 0,
            props: { width: 760, height: 460, cornerRadius: 24, fill: 'card' },
        },
        {
            id: 'camera', type: 'camera3d', parentId: 'view', layerOrder: 0,
            props: { position: [0, 1.6, 5.5], target: 0, fov: 45 },
        },
        {
            id: 'ambient', type: 'ambient-light3d', parentId: 'view', layerOrder: 1,
            props: { intensity: 0.35 },
        },
        {
            id: 'key', type: 'directional-light3d', parentId: 'view', layerOrder: 2,
            props: { intensity: 2.2, position: [3, 5, 4] },
        },
        {
            id: 'box', type: 'box3d', parentId: 'view', layerOrder: 3,
            props: {
                width: 2, height: 2, depth: 2, cornerRadius: 0.08,
                fill: 'primary', roughness: 0.4, metalness: 0.1,
            },
        },
    ],
    commands: [
        {
            id: 'box-turn', type: 'to', targetId: 'box', at: 0, duration: 3,
            easing: { kind: 'inOut', args: 'quad' },
            args: { rotationY: 360, rotationX: 18 },
        },
    ],
    duration: 3,
};

/**
 * A chime under a fading title, on a bus.
 *
 * Sound is a **node tree**, on the same terms the other two are: a bus groups, a
 * `sound` plays, and when a clip plays is its presence span — the node's
 * `startAt` is what starts it. There is no `play` command to keep in sync with a
 * timeline row.
 *
 * Here for the same reason the 3D scene is: the CPU renderer this app used to
 * run on threw on any audio at all, so nothing in either app exercised the path.
 * The clip is synthesized (`assets/audio/chime.wav`) rather than shipped, so the
 * repo carries no third-party media.
 */
const audioDocument: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root({ fill: 'bg' }),
        {
            id: 'music', type: 'audioBus', parentId: null, layerOrder: 0,
            key: 'music', props: { volume: 0.8 },
        },
        {
            id: 'chime', type: 'sound', parentId: 'music', layerOrder: 0, startAt: 0.2,
            props: { src: 'audio/chime.wav', volume: 0.9 },
        },
        {
            id: 'pulse', type: 'ellipse', parentId: null, layerOrder: 0,
            props: {
                width: 180, height: 180,
                stroke: { weight: 6, fill: 'accent' },
                opacity: 0.9,
            },
        },
        {
            id: 'label', type: 'rect', parentId: null, layerOrder: 1,
            props: { width: 220, height: 8, cornerRadius: 4, fill: 'primary', y: 190, opacity: 0 },
        },
    ],
    commands: [
        {
            id: 'pulse-out', type: 'to', targetId: 'pulse', at: 0.2, duration: 1.4,
            easing: { kind: 'out', args: 'cubic' },
            args: { width: 520, height: 520, opacity: 0 },
        },
        {
            id: 'label-in', type: 'to', targetId: 'label', at: 0.4, duration: 0.8,
            easing: { kind: 'out', args: 'quad' },
            args: { opacity: 1, width: 420 },
        },
    ],
    duration: 3,
};

/**
 * The palette every document below carries.
 *
 * Defined here, beside the documents, because each one now declares it — a theme
 * is part of what a clip looks like, not a setting handed over alongside it.
 */
export const THEME = {
    colors: {
        bg: '#0d0f15',
        card: '#161a21',
        primary: '#6990dd',
        accent: '#e8617c',
    },
};

/**
 * Every demo, each carrying its own palette.
 *
 * `theme` is on the clip rather than passed alongside it because a theme is part
 * of what the clip *looks like* — a document plus a setting a host remembered to
 * hand over is two things that can disagree, and only one of them is the file
 * you saved.
 */
export const SCENE_DOCS: SceneDoc[] = ([
    { id: 'shapes', name: 'Shapes', description: 'Rect, polygram, stroke dash, easing.', doc: shapes },
    { id: 'variables', name: 'Variables', description: 'One variableTo drives four bound props.', doc: variableBars },
    { id: 'text', name: 'Text', description: 'Text fade-in and a counting number.', doc: text, requiresFont: true },
    {
        id: 'aurora', name: 'Aurora (imported)',
        description: 'A custom node + two custom WGSL shaders, imported from @motionscript/shaders.',
        doc: auroraDocument,
    },
    {
        id: 'pulse-ring', name: 'Pulse Ring (ms add)',
        description: 'A custom node copied into this app with `ms add pulse-ring`, not imported.',
        doc: pulseRingDocument,
    },
    {
        id: 'prism', name: 'Prism (shader pack)',
        description: 'A custom node painted by a registered shader pack — properties, not raw uniforms.',
        doc: prismDocument,
    },
    {
        id: 'dynamic-node', name: 'Dynamic node (compiled string)',
        description: 'A custom node whose source is a string, compiled by esbuild-wasm inside the page — not imported anywhere.',
        doc: dynamicDocument,
    },
    {
        id: 'view-3d', name: '3D (WebGL)',
        description: 'A lit box turning in a Canvas3D — the path the CPU renderer could not draw at all.',
        doc: view3dDocument,
    },
    {
        id: 'audio', name: 'Audio (bus + clip)',
        description: 'A synthesized chime on a named bus; a clip plays for as long as it is in the tree.',
        doc: audioDocument,
    },
] as SceneDoc[]).map(entry => ({ ...entry, doc: { ...entry.doc, theme: THEME } }));

export function findSceneDoc(id: string): SceneDoc | undefined {
    return SCENE_DOCS.find(s => s.id === id);
}

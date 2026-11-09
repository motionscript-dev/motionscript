/**
 * This project's entry — the file `motionscript.json` has always declared.
 *
 * Everything an engine needs to open this app's documents, as **values**. That
 * is the whole point of the shape: a node type reached by importing a module for
 * its side effects is something `sideEffects: false` is entitled to delete, and
 * the failure ("unknown node type auroraCard") points nowhere near the cause.
 * This app used to need three separate mechanisms to work around that — an
 * explicit `registerBuiltins()`, a bare `import './components/pulse-ring.js'`,
 * and a `void SHADER_LAB_NODES;` statement whose only job was to not be
 * eliminated. A real value dependency needs none of them.
 */
import type { ProjectDocument } from '@motionscript/sdk';
import { AuroraCard, PrismCard } from '@motionscript/shaders';
import prismShader from './shaders/prism.json' with { type: 'json' };
import { PulseRing } from './components/pulse-ring.js';

/**
 * A node whose source is a **string**, compiled and registered at engine
 * boot instead of imported as a value — `createServerEngine` bundles this
 * entry with real Node `esbuild` (`page-bundle.ts`), same as every
 * component above, but the string itself is compiled *inside the page* by
 * `@motionscript/browser`'s own lazily-loaded `esbuild-wasm` default the
 * moment this array reaches `createBrowserEngine` there — headless never
 * had to do anything special to inherit that. See `scenes/documents.ts`'s
 * `dynamicDocument` for where `"dynamicBadge"` is drawn from.
 */
const dynamicBadgeSource = `
    import { component2d, Graphics2D, Types } from "@motionscript/sdk";

    export default component2d({
        key: "dynamicBadge",
        // A fill entry, so the document's "to" tweens the colour.
        state: { count: 8, color: Types.fill("#6990dd") },
        render: (ctx, state) => {
            const { width, height } = ctx.size;
            const r = Math.min(width, height) / 2;
            const dot = r * 0.24;
            const g = new Graphics2D();
            for (let i = 0; i < state.count; i++) {
                const a = (i / state.count) * Math.PI * 2 + ctx.time.elapsed;
                g.ellipse({
                    x: Math.cos(a) * r * 0.72, y: Math.sin(a) * r * 0.72,
                    width: dot, height: dot,
                });
            }
            ctx.draw(g.fill(state.color));
        },
    });
`;

/**
 * Node types this project's documents may name.
 *
 * An **array**, not the `{ key: Component }` record this used to be — a
 * string source has no field to put an explicit key in (the component it
 * default-exports carries one), and `Registry`/`Engine` only accept a string
 * in the array form. Every component here, the string's included, carries its
 * own `key`.
 */
export const nodes = [AuroraCard, PrismCard, PulseRing, dynamicBadgeSource];

/**
 * Shader packs this project's documents may name, by their document key.
 *
 * Authored as JSON under `src/shaders/` rather than as a TypeScript const,
 * because a pack **is** data — `Registry.addShader` takes `unknown` and normalizes on the
 * way in, so a `.json` file was always a valid pack. Keeping them here rather
 * than self-registered inside the node that draws them is what lets a document
 * reference `"shaderLab.prism"` from a plain `rect`, with no `PrismCard`
 * involved, and what keeps one source of truth for the pack.
 */
export const shaders = {
    'shaderLab.prism': prismShader,
};

export const VIEWPORT = { width: 1280, height: 720 };
export const FPS = 60;

// The palette lives with the documents that declare it.
export { THEME } from './scenes/documents.js';

/**
 * The output the engine opens its page with: the size and frame rate every
 * scene renders at.
 *
 * A composition document carries neither, so they come from the engine's own
 * settings, and the page builds that engine from this entry's `default`. With
 * no `default` it falls back to 1920×1080, so `/health` and `/scenes` would
 * report a size the pictures were not rendered at. It has no tracks because
 * the documents themselves are JSON: the server passes whichever one a request
 * asks for rather than bundling them all into one project and filtering it back
 * down by name. This entry carries **code** (node types and shader packs, the
 * things a document cannot carry) plus this output.
 */
export default {
    kind: 'project',
    name: 'engine-demo',
    viewport: VIEWPORT,
    fps: FPS,
    tracks: [],
} satisfies ProjectDocument;

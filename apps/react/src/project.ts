/**
 * This project's entry — the file `motionscript.json` has always declared.
 *
 * Everything an engine needs to open this app's documents, as **values**. That
 * is the whole point of the shape: a node type reached by importing a module for
 * its side effects is something `sideEffects: false` is entitled to delete, and
 * the failure ("unknown node type auroraCard") points nowhere near the cause.
 * This app used to need three separate mechanisms to work around that — an
 * explicit `registerBuiltins()`, a bare `import './components/pulse-ring'`, and a
 * `void SHADER_LAB_NODES;` statement whose only job was to not be eliminated.
 * A real value dependency needs none of them.
 */
import { AuroraCard, PrismCard } from '@motionscript/shaders';
import prismShader from './shaders/prism.json';
import { PulseRing } from './components/pulse-ring';

/**
 * Node types this project's documents may name, by their `type` string.
 *
 * The keys match each component's own `key`. Re-registering the same component
 * under the same key is a no-op, so naming them here is an assertion that the
 * document keys and the components agree — a rename on either side is a throw at
 * engine construction rather than an "unknown node type" at render.
 */
export const nodes = {
    auroraCard: AuroraCard,
    prismCard: PrismCard,
    pulseRing: PulseRing,
};

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

import { AuroraCard } from "./aurora-card"
import { PrismCard } from "./prism-card"

/**
 * Every node type this package publishes.
 *
 * Each component's `key` is what a document names it by, but a key only
 * reaches a registry when its module is *evaluated* — and this package declares
 * `sideEffects: false`, which licenses a bundler to drop a module nothing
 * imports a value from. A document names a node type by string, so nothing
 * imports the component directly; without this list it would be shaken out
 * and a document naming `"auroraCard"`/`"prismCard"` would report an unknown
 * node type.
 *
 * Referencing the component **value** is what makes that impossible: a data
 * dependency a bundler cannot discard, where a bare `import "./aurora-card"`
 * is exactly what `sideEffects: false` says to drop.
 *
 * `PulseRing` is deliberately absent — it is not part of this package's
 * barrel at all, only its `registry.json` item. See `pulse-ring.ts`.
 */
export const NODES = [AuroraCard, PrismCard];

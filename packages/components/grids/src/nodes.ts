import { PathGrid } from "./path-grid"
import { RadialGrid } from "./radial-grid"
import { RectangularGrid } from "./rectangular-grid"
import { SphereGrid } from "./sphere-grid"

/**
 * Every node type this package publishes.
 *
 * A host registers these by handing the array to an engine —
 * `new Engine(platform, { nodes: NODES })` — which reads each component's key.
 * Defining a component only *declares* that key: nothing is registered by
 * importing a module, so a registry holds exactly what its owner asked for.
 *
 * Listing the component **values** is also what survives bundling: this package
 * declares `sideEffects: false`, and a document names a node type by string, so
 * an import kept only for its side effect is exactly what gets shaken out.
 */
// Typed by name, so the declaration names each component rather than spelling out its type through core.
type KitNode =
  | typeof RectangularGrid
  | typeof RadialGrid
  | typeof PathGrid
  | typeof SphereGrid

export const NODES: KitNode[] = [
  RectangularGrid,
  RadialGrid,
  PathGrid,
  SphereGrid,
]

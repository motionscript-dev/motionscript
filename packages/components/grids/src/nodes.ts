import { PathGrid } from "./path-grid"
import { RadialGrid } from "./radial-grid"
import { RectangularGrid } from "./rectangular-grid"
import { SphereGrid } from "./sphere-grid"

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

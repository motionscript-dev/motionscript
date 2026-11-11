import { DotGridPattern } from "./dot-grid-pattern"
import { GridPattern } from "./grid-pattern"
import { LineGridPattern } from "./line-grid-pattern"

// Typed by name, so the declaration names each component rather than spelling out its type through core.
type KitNode =
    | typeof LineGridPattern
    | typeof DotGridPattern
    | typeof GridPattern

export const NODES: KitNode[] = [
    LineGridPattern,
    DotGridPattern,
    GridPattern,
]

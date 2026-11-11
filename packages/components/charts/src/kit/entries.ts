import { Types, type Element, type EntryOptions, type Node2D, type Type } from "@motionscript/sdk"

/**
 * An entry made fresh for every node: each node gets its own array or box
 * rather than one shared literal, and a host is told no default for it.
 */
export function fresh<T, In = T>(make: () => T, options?: { readonly resolve?: (value: In) => T; readonly kind?: string }): Type<In, T> {
  // A function default is a factory: the component calls it once per node.
  return Types.custom<In, T>(make as unknown as In, options)
}

/**
 * Nodes a `children` builder made with `new`, as the elements it returns. A
 * part built that way can be read in a binding — its own box, or its parent's,
 * which is the component it was built for — where a call would hand back only
 * the element.
 */
export function asParts(nodes: readonly Node2D[]): readonly Element[] {
  return nodes as unknown as readonly Element[]
}

/** The argument every per-series command takes: an index into `series`, offered by name. */
export const SERIES_ARG = Types.custom<number, number, EntryOptions & { readonly min: number; readonly step: number }>(0, { kind: "series", min: 0, step: 1 })

import { PropSlot } from "./slot";

/** @internal */
export type TweenFn<T> = (from: T, to: T, t: number) => T;

/**
 * The slots behind an object's `property`-declared fields, plus the per-field
 * metadata `set()` and `to()` route through.
 *
 * One object rather than three loose maps on the host, because the host is a
 * `Node` and every public field it carries is published API. Grouping them
 * means a node exposes one internal name instead of three, and gives the thing
 * a name a reader can look up.
 *
 * @internal
 */
export interface PropCells {
    /** Field → its live slot. Present for every registered prop. */
    slots: Map<string, PropSlot<any>>;
    /** Field → how it interpolates, for props a numeric lerp cannot cover. */
    tweens?: Map<string, TweenFn<any>>;
    /** Field → external prop value to internal slot value, for fields that need it. */
    mappers?: Map<string, (ext: any, prev?: any) => any>;
}

/** @internal */
export interface PropHost {
    /** See {@link PropCells}. Absent until the first prop is registered, and
     *  cleared by `dispose()`. */
    __cells?: PropCells;
}

/** @internal */
export function getPropSlot(obj: PropHost, name: string): PropSlot<any> | undefined {
    return obj.__cells?.slots.get(name);
}

/** The host's slots, created on first use. @internal */
export function ensureCells(obj: PropHost): PropCells {
    return obj.__cells ??= { slots: new Map() };
}

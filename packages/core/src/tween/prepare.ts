import type { PropSlot } from "@/props/slot";

/** Snapshots the numeric property values on `target` for the keys in `to` and returns a lerp callback writing interpolated values back each frame. The snapshot is taken at call time, so call it immediately before the animation starts. Keys with `undefined` are ignored; `t` must already be eased by the caller. */
/** @internal */
export function prepareNumericTween<T extends object>(
    target: T,
    to: Partial<Record<keyof T, number>>,
): (t: number) => void {
    const keys = (Object.keys(to) as (keyof T)[]).filter((k) => to[k] !== undefined);
    const from = new Array<number>(keys.length);
    const end = new Array<number>(keys.length);
    for (let i = 0; i < keys.length; i++) {
        from[i] = (target as any)[keys[i]] as number;
        end[i] = to[keys[i]] as number;
    }
    return (t: number) => {
        for (let i = 0; i < keys.length; i++) {
            (target as any)[keys[i]] = from[i] + (end[i] - from[i]) * t;
        }
    };
}

/** Like {@link prepareNumericTween}, but writes directly to the backing {@link PropSlot}s, skipping the mapper lookup and `_writeProp` indirection per step. Only valid for numeric props whose `end` is already in stored space: the caller resolves slots, maps the destination and captures `from`/`end` (`cells[i]`, `from[i]`, `end[i]`). The arrays are reused each step, so the cost is one `slot.set(number)` per property with no allocation. */
/** @internal */
export function prepareNumericCellTween(
    cells: PropSlot<number>[],
    from: number[],
    end: number[],
): (t: number) => void {
    return (t: number) => {
        for (let i = 0; i < cells.length; i++) {
            cells[i].set(from[i] + (end[i] - from[i]) * t);
        }
    };
}

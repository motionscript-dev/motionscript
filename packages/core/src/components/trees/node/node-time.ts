/** A node's place on the scene's clock (`node.time`), advanced once per frame by `Node.attach`; consumed by motion sampling, the render context's `elapsed` and anything a node's `tick()` derives from time. `creation` is seeded on the **first** advance, not at construction, so `elapsed` measures time *in the scene* (what entrance animations, a video's playhead and per-node dissolves mean): a node built in the generator's third second reads `elapsed === 0` on its first frame. */
export interface NodeTime {
    /** Seconds since the clip started. */
    readonly total: number;
    /** The clip time at which this node was first advanced. */
    readonly creation: number;
    /** How long this node has existed: `total - creation`. */
    readonly elapsed: number;
}

/**
 * The writable form the runtime advances; nodes hand out {@link NodeTime}, the same shape read-only.
 *
 * @internal
 */
export interface MutableNodeTime {
    total: number;
    creation: number;
    elapsed: number;
    /** Whether {@link advanceNodeTime} has seeded `creation` yet. */
    started: boolean;
}

/** The zeroed holder a node keeps for its lifetime. @internal */
export function createNodeTime(): MutableNodeTime {
    return { total: 0, creation: 0, elapsed: 0, started: false };
}

/** Advance `time` to `total` clip-seconds, seeding `creation` on first tick. @internal */
export function advanceNodeTime(time: MutableNodeTime, total: number): void {
    if (!time.started) {
        time.creation = total;
        time.started = true;
    }
    time.total = total;
    time.elapsed = total - time.creation;
}

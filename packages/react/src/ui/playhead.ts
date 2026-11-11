import { useSyncExternalStore } from "react";

/**
 * The playhead, held outside React: a frame written at clock rate through
 * `useState` would re-render the player's owner faster than the project's frame
 * rate, and nothing in a render depends on it (the controller paints straight
 * onto the canvas). Only components that display it subscribe.
 */
export interface PlayheadStore {
    subscribe(onChange: () => void): () => void;
    getSnapshot(): number;
    /** @internal — written by the player that owns this store. */
    set(frame: number): void;
}

export function createPlayheadStore(): PlayheadStore {
    let frame = 0;
    const listeners = new Set<() => void>();
    return {
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        getSnapshot: () => frame,
        set(next) {
            if (next === frame) return;
            frame = next;
            for (const notify of listeners) notify();
        },
    };
}

/** Subscribe *this* component to the playhead. Takes `{ playhead }` rather than `Player` to avoid an import cycle with `use-motion-player`. */
export function usePlayhead(player: { playhead: PlayheadStore }): number {
    const { playhead } = player;
    return useSyncExternalStore(playhead.subscribe, playhead.getSnapshot, playhead.getSnapshot);
}

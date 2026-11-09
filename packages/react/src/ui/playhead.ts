import { useSyncExternalStore } from "react";

/**
 * The playhead, held outside React.
 *
 * A frame number written at clock rate through `useState` re-renders whoever
 * owns the player, and on a high-refresh display that is faster than the
 * project's own frame rate. Nothing in a render depends on it: the controller
 * paints straight onto the canvas and React is not involved. So the number
 * lives here, and only the components that actually display it subscribe.
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

/**
 * Subscribe *this* component to the playhead.
 *
 * Typed structurally rather than against `Player` so the store and the hook
 * that reads it don't import each other.
 */
export function usePlayhead(player: { playhead: PlayheadStore }): number {
    const { playhead } = player;
    return useSyncExternalStore(playhead.subscribe, playhead.getSnapshot, playhead.getSnapshot);
}

import type { StorageAdapter } from "@/platform/storage-adapter";

/**
 * Bounded because a broken asset must degrade a frame rather than hang an export; four covers the longest real
 * chain (three runtime, its resources, a video frame, an exact image level discovered by that frame's draw).
 */
export const SETTLE_PASSES = 4;

export type SettleOutcome = "settled" | "exhausted" | "superseded";

/**
 * `isCurrent` is checked before every render and after every await, so a seek overtaken by a newer one stops
 * drawing a frame nobody wants.
 */
export async function renderSettled(
    render: () => void,
    adapter: Pick<StorageAdapter, "warmPendingDecodes">,
    isCurrent: () => boolean,
): Promise<SettleOutcome> {
    for (let pass = 0; pass < SETTLE_PASSES; pass++) {
        if (!isCurrent()) return "superseded";
        render();
        const warmed = await adapter.warmPendingDecodes();
        if (!warmed) return "settled";
        if (!isCurrent()) return "superseded";
    }
    return "exhausted";
}

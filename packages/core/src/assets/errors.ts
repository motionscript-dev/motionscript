import type { AssetType } from "./record";

/**
 * A frame reached for an asset that was never loaded: the counterweight to declared asset tracking. A node states what
 * it needs from `Node.declareAssets`; if it misses something the renderer finds nothing at paint. A skipped layer would
 * be a frame that renders *almost* right (a photo missing, a heading in the fallback face), possibly only seconds in and
 * only on a cold load, so throwing turns it into a located failure: caught per scene during precomp as a `BuildError`,
 * and stopping the frame at playback.
 *
 * It means "declared but not loaded, or never declared", and deliberately **not** a *time-varying* miss: a video frame
 * the decode window has not reached is an asset that loaded fine, `warmPendingVideo` settles those, and they paint the
 * nearest decoded frame.
 */
export class AssetNotLoadedError extends Error {
    readonly assetType: AssetType;
    readonly src: string;
    /** The innermost drawing node, stamped by `Node2D.render` on the way out. */
    nodeId?: string;

    constructor(assetType: AssetType, src: string, hint?: string) {
        super(`${assetType} asset "${src}" is not loaded. ` + (hint ?? declareHint(assetType)));
        this.name = "AssetNotLoadedError";
        this.assetType = assetType;
        this.src = src;
    }
}

/** How to declare an asset of `assetType`: the scope method, or a command's sound. */
function declareHint(assetType: AssetType): string {
    if (assetType === "audio") return "Play it from a command (`timeline.sound(...)`), so the asset timeline loads it before this frame draws.";
    return `Declare it from the node's declareAssets() (e.g. assets.${assetType}(...)), so the asset timeline loads it before this frame draws.`;
}

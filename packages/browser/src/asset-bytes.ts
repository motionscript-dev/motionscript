/**
 * Where a source URL's bytes come from: a host's local store, then the network.
 * The renderer's storage adapter reads every asset through it (`loadBytes`).
 *
 * ## Why the web adapter needs this at all
 *
 * The storage adapter addresses every asset by URL and fetches it. That is
 * right for an asset that lives somewhere, and wrong for one whose bytes the
 * host already has in hand — a file the user has just chosen, a render a local
 * model has just produced, a picture whose upload has not finished or cannot
 * start because there is no network. In all three the adapter downloads bytes
 * that never needed to travel.
 *
 * `NodeStorageAdapter` has had the answer since it was written: an injected
 * `AssetLoader`, with an `inline` map consulted ahead of the disk. This is the
 * same seam for the browser.
 *
 * ## Why it is module-level
 *
 * The storage adapter is constructed at several sites *inside* this package —
 * sessions, the exporter, the audio mixer and the still renderer — none of
 * which a host can reach. A constructor argument would
 * therefore cover the preview and leave export and stills on the network,
 * which is the worst of both: the picture a user sees would come from local
 * bytes and the one they render would not.
 *
 * So this is an *injection point*, not a cache. The adapter still owns every
 * decode, every cache, every size ceiling and every eviction rule; all this
 * changes is where the compressed bytes came from. A source that answers `null`
 * — which is what an unregistered URL, an evicted entry or a host with no local
 * store does — leaves the adapter exactly as it was.
 */

/** Local bytes for a source URL, or `null` to go to the network. */
export type AssetByteSource = (src: string) => Promise<Blob | null>;

let source: AssetByteSource | null = null;

/**
 * Installs the byte source for this browsing context, or clears it with `null`.
 *
 * Called once per window that renders. Later calls replace the previous source
 * rather than stacking, because two sources disagreeing about one URL has no
 * sensible answer.
 */
export function setAssetByteSource(next: AssetByteSource | null): void {
    source = next;
}

/**
 * The bytes for `src`, or `null`.
 *
 * Swallows a throwing source on purpose. A host's local store failing is a
 * cache miss, not a render failure — the caller falls through to `fetch`, which
 * is what it would have done had the source never been installed.
 */
export async function localAssetBytes(src: string): Promise<Blob | null> {
    if (!source) return null;
    try {
        return await source(src);
    } catch {
        return null;
    }
}

/**
 * The network's bytes for `url`. A response that is not OK is a failed load,
 * never bytes: a 404 page handed to the font manager marked a family loaded
 * with no face in it.
 */
export async function fetchAssetBytes(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
        const status = response.statusText ? `${response.status} ${response.statusText}` : `${response.status}`;
        throw new Error(`Fetching "${url}" failed: HTTP ${status}`);
    }
    return response.blob();
}

/** The bytes for `src`: the host's local store first, then the network. */
export async function loadAssetBytes(src: string): Promise<Blob> {
    return (await localAssetBytes(src)) ?? fetchAssetBytes(src);
}

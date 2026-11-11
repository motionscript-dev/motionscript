/**
 * Where a source URL's bytes come from: a host's local store, then the network. The renderer's storage adapter reads
 * every asset through it (`loadBytes`). The adapter otherwise fetches every asset by URL, which is wrong for bytes the
 * host already holds (a file just chosen, a local model's render, an upload still in flight or offline).
 *
 * It is module-level because the adapter is constructed at several sites inside this package (sessions, the exporter,
 * the audio mixer, the still renderer) a host cannot reach; a constructor argument would cover the preview and leave
 * export and stills on the network. This is an *injection point*, not a cache: the adapter still owns every decode,
 * cache and eviction rule, and a source answering `null` leaves it exactly as it was.
 */

/** Local bytes for a source URL, or `null` to go to the network. */
export type AssetByteSource = (src: string) => Promise<Blob | null>;

let source: AssetByteSource | null = null;

/** Installs the byte source for this browsing context, or clears it with `null`. Later calls replace the previous source rather than stacking: two sources disagreeing about one URL has no sensible answer. */
export function setAssetByteSource(next: AssetByteSource | null): void {
    source = next;
}

/** The bytes for `src`, or `null`. Swallows a throwing source on purpose: a failing local store is a cache miss, not a render failure, and the caller falls through to `fetch`. */
export async function localAssetBytes(src: string): Promise<Blob | null> {
    if (!source) return null;
    try {
        return await source(src);
    } catch {
        return null;
    }
}

/** The network's bytes for `url`. A non-OK response is a failed load, never bytes (a 404 page handed to the font manager marked a family loaded with no face). */
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

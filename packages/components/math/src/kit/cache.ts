// Imports nothing, so it is testable in bare Node (the rest of the package reaches MathJax's browser adaptor).

export interface BoundedCache<T> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    readonly size: number;
}

/**
 * A least-recently-used memo holding at most `limit` entries. LRU rather than
 * first-in-first-out: an animated `fontSize` inserts a fresh key every frame and
 * would walk every other formula's entry out of a FIFO memo within seconds.
 */
export function createBoundedCache<T>(limit: number): BoundedCache<T> {
    // A plain `Map` is an LRU as long as every read re-inserts.
    const entries = new Map<string, T>();

    return {
        get(key) {
            if (!entries.has(key)) return undefined;
            const value = entries.get(key) as T;
            entries.delete(key);
            entries.set(key, value);
            return value;
        },

        set(key, value) {
            entries.delete(key);
            entries.set(key, value);
            while (entries.size > limit) {
                const coldest = entries.keys().next().value;
                if (coldest === undefined) break;
                entries.delete(coldest);
            }
        },

        get size() {
            return entries.size;
        },
    };
}

/** What `compute` returns, or the error it throws, remembered under `key` so a failure is not re-derived every frame. */
export function remember<T>(cache: BoundedCache<T | Error>, key: string, compute: () => T): T | Error {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let result: T | Error;
    try {
        result = compute();
    } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
    }
    cache.set(key, result);
    return result;
}

/**
 * A parser memoised per `(params, source)`: an unchanged equation is the
 * identical object, and empty text fails as "Empty equation". `read` gets the trimmed text.
 */
export function memoParse<T>(limit: number, read: (text: string, params: readonly string[]) => T): (source: string, params?: readonly string[]) => T | Error {
    const cache = createBoundedCache<T | Error>(limit);
    return (source, params = []) =>
        remember(cache, `${params.join(",")}|${source}`, () => {
            const text = source.trim();
            if (text === "") throw new Error("Empty equation");
            return read(text, params);
        });
}

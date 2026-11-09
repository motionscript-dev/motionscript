import { useEffect, useRef, useState, type DependencyList } from "react";

import type { Engine } from "@motionscript/core";

export interface UseEngineOptions {
    /**
     * Rebuild the engine when any of these change, compared the way
     * `useEffect` compares its own. The default, `[]`, builds it once.
     *
     * Not for the factory's closure: the latest `create` is always the one
     * called, so an inline arrow does not rebuild anything. List only what
     * makes a *different* engine, such as the node types or the wasm URL.
     */
    deps?: DependencyList;
    /** Called when `create` rejects or throws. Defaults to `console.error`. */
    onError?: (error: unknown) => void;
}

function logError(error: unknown) {
    console.error("Could not start the MotionScript engine.", error);
}

/**
 * Builds an engine once, hands it to you when it is ready, and disposes it
 * when it is no longer wanted.
 *
 * ```tsx
 * const engine = useEngine(() => createBrowserEngine());
 * const player = useMotionPlayer({ engine, document: doc });
 * ```
 *
 * `null` until it arrives, which {@link useMotionPlayer} accepts. Nothing in
 * this package imports a platform, so what to build is the factory's job: the
 * browser's `createBrowserEngine`, a headless one, or a test double.
 *
 * Disposal covers the cases a hand-written effect gets wrong: an unmount while
 * the wasm was still loading (StrictMode does this on every mount in
 * development) frees the engine the moment it lands, and a change in `deps`
 * disposes the old one and returns `null` until the new one is ready.
 *
 * Call it once and hand the engine down. A second call is a second wasm module
 * and a second GL stack. Anything that must be true before a player sees the
 * engine, such as `setManifest`, belongs in `create`, not in an effect beside it.
 */
export function useEngine<E extends Engine = Engine>(
    create: () => E | Promise<E>,
    options: UseEngineOptions = {},
): E | null {
    const { deps = [], onError } = options;
    const [engine, setEngine] = useState<E | null>(null);
    const createRef = useRef(create);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        createRef.current = create;
        onErrorRef.current = onError;
    });

    useEffect(() => {
        let live = true;
        let built: E | null = null;

        new Promise<E>(resolve => resolve(createRef.current()))
            .then(next => {
                built = next;
                if (!live) {
                    next.dispose();
                    return;
                }
                setEngine(next);
            })
            .catch(error => {
                if (live) (onErrorRef.current ?? logError)(error);
            });

        return () => {
            live = false;
            built?.dispose();
            setEngine(null);
        };
        // The caller's list, not ours: it is what makes a different engine.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    return engine;
}

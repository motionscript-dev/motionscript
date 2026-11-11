import { useEffect, useRef, useState, type DependencyList } from "react";

import type { Engine } from "@motionscript/core";

export interface UseEngineOptions {
    /**
     * Rebuild the engine when any of these change, compared as `useEffect` does.
     * The default, `[]`, builds it once. List only what makes a *different*
     * engine (node types, the wasm URL): the latest `create` is always the one
     * called, so its closure is not a dependency.
     */
    deps?: DependencyList;
    /** Called when `create` rejects or throws. Defaults to `console.error`. */
    onError?: (error: unknown) => void;
}

function logError(error: unknown) {
    console.error("Could not start the MotionScript engine.", error);
}

/**
 * Builds an engine once, `null` until it arrives, and disposes it when it is no
 * longer wanted. What to build is the factory's job: nothing here imports a
 * platform.
 *
 * ```tsx
 * const engine = useEngine(() => createBrowserEngine());
 * const player = useMotionPlayer({ engine, document: doc });
 * ```
 *
 * An unmount while the factory was still pending (StrictMode does this on every
 * dev mount) frees the engine the moment it lands; a change in `deps` disposes
 * the old one and returns `null` until the new one is ready.
 *
 * Call it once and hand the engine down: a second call is a second wasm module
 * and renderer. Anything that must hold before a player sees the engine, such as
 * `setManifest`, belongs in `create`, not in an effect beside it.
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

import type { EasingFunction } from "./type";

/**
 * Descriptions of engine-built easings, by function.
 *
 * Every engine easing is an anonymous closure, so `fn.name` is `""` and cannot
 * tell two of them apart. A constructor that knows what it built records a short,
 * deterministic description here, which is what a cache key can be built from.
 */
const descriptions = new WeakMap<EasingFunction, string>();
const identities = new WeakMap<EasingFunction, string>();
let identityCounter = 0;

/** Record what `ease` is, and hand it back. @internal */
export function describeEase<F extends EasingFunction>(ease: F, description: string): F {
    descriptions.set(ease, description);
    return ease;
}

/** What an engine-built ease was recorded as, or `undefined` for any other function. @internal */
export function easeDescription(ease: EasingFunction): string | undefined {
    return descriptions.get(ease);
}

/**
 * A string that is equal for two easings exactly when they are the same ease.
 *
 * An engine easing keys by its description, so building the same one twice (a
 * document rebuilt from the same row) gives the same key. A function the engine
 * did not build keys by its own identity: a different function is always a
 * different key, which may over-report a change but never hides one.
 *
 * @internal
 */
export function easeKey(ease: EasingFunction): string {
    const described = descriptions.get(ease);
    if (described !== undefined) return described;
    let id = identities.get(ease);
    if (id === undefined) {
        id = `fn#${identityCounter++}`;
        identities.set(ease, id);
    }
    return id;
}

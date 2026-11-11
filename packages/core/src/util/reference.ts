/**
 * A callable reference that acts as both getter and setter.
 * - `ref()` → returns the current value (throws if not yet assigned)
 * - `ref(value)` → sets the current value
 */
export interface Reference<T> {
    (): T;
    (node: T | null): void;
    /** Phantom (never assigned or called): puts `T` in a *contravariant* position, which makes {@link RefTarget} safe: the zero-arg getter `(): T` is assignable to any `(x) => void`, so a slot typed as just the setter would accept a `Reference` of an unrelated node type. @internal */
    readonly __accepts?: (node: T) => void;
}

/**
 * A slot that can *receive* a `T`: a `Reference<T>`, or one declared as any **supertype** of `T`. The widening is
 * deliberate: the framework only writes into a ref (`props.ref(this)`) and the author only reads, so a `Rect` into a
 * `Reference<Node2D>` is sound. The opposite direction stays an error (a `Reference<Rect>` on a `Text` would type reads
 * as a `Rect`). A plain setter function is accepted too, for React-style callback refs.
 */
export type RefTarget<T> = {
    (node: T | null): void;
    readonly __accepts?: (node: T) => void;
};

/** Creates a typed reference holder, like React's `createRef` but one overloaded function rather than a `{ current }` object. */
export function createRef<T>(): Reference<T> {
    let current: T | null = null;

    function ref(): T;
    function ref(node: T | null): void;
    function ref(node?: T | null): T | void {
        if (node !== undefined) {
            current = node;
        } else {
            if (current === null) {
                throw new Error("Reference not assigned yet");
            }
            return current;
        }
    }

    return ref;
}

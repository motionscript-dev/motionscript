/**
 * Retiring an export: it keeps working, warns once in development, and names the release that removes it.
 * Pair it with a `@deprecated … Remove in X.Y.Z.` doc comment naming the same release; editors read that, and
 * `scripts/check-deprecations.mjs` fails CI once the package reaches it. A constant or type takes the comment
 * alone. A component's retired prop stays for good under its spec's `deprecated`, since saved documents set it.
 */

export interface Deprecation {
    /** The name callers import, as the warning prints it. */
    readonly name: string;
    /** What to write instead, as code: `"seriesPaint(series).fill"`. */
    readonly use: string;
    /** The release that removes it: the next major (`"1.0.0"`, or the next minor while on 0.x). */
    readonly removeIn: string;
}

const warned = new Set<string>();

/** `process` is absent in a browser that loads the ES modules unbundled; a bundler replaces the whole read. */
function isProduction(): boolean {
    return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
}

/** The sentence a deprecation warns with. */
export function deprecationMessage(notice: Deprecation): string {
    return `[motionscript] ${notice.name} is deprecated and will be removed in ${notice.removeIn}; use ${notice.use} instead.`;
}

/**
 * Warn about `notice` once per name, in development only. For a use `deprecate` cannot wrap: a deprecated
 * option read inside a function that otherwise stays.
 */
export function warnDeprecated(notice: Deprecation): void {
    if (isProduction() || warned.has(notice.name)) return;
    warned.add(notice.name);
    console.warn(deprecationMessage(notice));
}

/**
 * `fn`, unchanged in what it does and how it is typed, warning on its first call that `notice.use` replaces it.
 * A class is not a function here: wrapping one would break `new` and `instanceof`.
 */
export function deprecate<F extends (...args: never[]) => unknown>(fn: F, notice: Deprecation): F {
    const wrapped = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
        warnDeprecated(notice);
        return fn.apply(this, args) as ReturnType<F>;
    };
    Object.defineProperty(wrapped, "name", { value: notice.name });
    return wrapped as unknown as F;
}

/** Forget what has been warned, so a test can see the same warning again. @internal */
export function resetDeprecationWarnings(): void {
    warned.clear();
}

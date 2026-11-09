/**
 * The ambient capabilities a dynamic node's compiled source is denied.
 *
 * ## What this is, and what it very deliberately is not
 *
 * A dynamic node's compiled JS is evaluated with `new Function` **in the
 * host's own realm**, and that is forced by the architecture rather than
 * chosen: the node it produces has to be a live class that satisfies
 * `instanceof` against the host's own already-loaded `core`, and participate
 * in the same per-frame reactive `property` graph. A live class instance
 * cannot cross a worker or cross-origin iframe boundary, so the usual "run it
 * in another realm" answer is closed off by what the renderer is, not by how
 * much effort is spent on it.
 *
 * What *is* possible in one realm is taking the dangerous names out of scope.
 * Every identifier below becomes a parameter of the `new Function` factory
 * bound to `undefined`, so `fetch(...)` inside a compiled node is a call on
 * `undefined` rather than a network request. Under `"use strict"` — which the
 * factory already sets — a bare `this` is `undefined` too, so the usual back
 * door is shut.
 *
 * **This is hardening, not a sandbox.** A determined script can still reach
 * the real global object through the intrinsics: `({}).constructor.constructor`
 * is `Function`, and `Function("return globalThis")()` walks straight back
 * out. Closing that would mean freezing or poisoning `Object.prototype`,
 * `Function` and every async/generator constructor, which breaks the engine
 * itself — it subclasses, it writes prototypes, it builds objects constantly.
 * So the honest security boundary is not this file. It is whatever gate the
 * *host* puts in front of calling `Registry.addNodeFromSource` at all — a
 * compiled node's source is not evaluated until something upstream decides
 * it should be.
 *
 * This file's job is to make the easy paths closed, the accidents impossible,
 * and the escape require obvious intent that a reviewer would notice.
 */

/**
 * Names bound to `undefined` in every dynamic node module's scope.
 *
 * Grouped by what they'd be used for, because the list is only auditable if
 * you can see what each entry is keeping out. Adding a browser API here is
 * cheap; leaving one out is the bug.
 *
 * This engine's `Registry` only ever evaluates a dynamic node inside a
 * browser-realm page (a real browser tab, or headless's own Playwright page —
 * never bare Node), so this list is scoped to that one realm rather than also
 * covering Node globals (`process`, `require`, `global`) that never apply
 * here.
 */
export const DENIED_GLOBALS: readonly string[] = [
    // Reaching the global object, and from it everything else.
    "globalThis",
    "window",
    "self",
    "top",
    "parent",
    "frames",

    // Evaluating more code.
    //
    // `eval` is missing on purpose and cannot be added: strict mode forbids it
    // as a binding name, so naming it here makes `new Function` throw
    // "Unexpected eval or arguments in strict mode" and *every* dynamic node
    // stops linking. It stays reachable, which is one more reason this file is
    // not the security boundary — see the module note above.
    "Function",
    "importScripts",

    // The DOM: reading the page, and `document.cookie`.
    "document",
    "navigator",
    "location",
    "history",
    "screen",
    "customElements",

    // Anywhere to send what was found. (`navigator.sendBeacon` needs
    // `navigator`, which is already denied above.)
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Request",
    "Response",
    "Headers",

    // Anywhere to read a credential from.
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches",
    "cookieStore",
    "crypto",

    // Other threads and other documents.
    "Worker",
    "SharedWorker",
    "ServiceWorker",
    "MessageChannel",
    "BroadcastChannel",
    "postMessage",

    // Things that ask the user for something, or leave the page.
    "alert",
    "confirm",
    "prompt",
    "open",
    "print",
    "Notification",
];

/**
 * Names strict mode refuses to bind, and which would therefore break linking
 * for every dynamic node rather than protecting anything.
 *
 * Checked rather than trusted: adding one to the list above is an easy
 * mistake that fails at *evaluation* time, on whichever node happens to
 * compile first, with an error naming neither the list nor the culprit.
 */
const UNBINDABLE = new Set(["eval", "arguments"]);

const illegal = DENIED_GLOBALS.filter((name) => UNBINDABLE.has(name));
if (illegal.length > 0) {
    throw new Error(
        `DENIED_GLOBALS cannot contain ${illegal.join(", ")}: strict mode forbids ` +
            `binding those names, so no dynamic node would link at all. See the note in this file.`,
    );
}

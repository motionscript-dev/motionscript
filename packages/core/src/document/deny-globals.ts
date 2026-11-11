/**
 * Hardening, not a sandbox. A dynamic node's compiled JS runs under `new Function` in the host's own realm,
 * which the architecture forces: the node must be a live class satisfying `instanceof` against the host's
 * loaded `core`, and that cannot cross a worker or iframe boundary. Each name below becomes a factory
 * parameter bound to `undefined` (and strict-mode `this` is `undefined`), closing the easy paths.
 *
 * A determined script still reaches the global object through the intrinsics (`({}).constructor.constructor`
 * is `Function`); closing that would mean poisoning `Object.prototype` and `Function`, which breaks the engine
 * itself. The real security boundary is whatever gate the host puts in front of `Registry.addNodeFromSource`.
 */

/**
 * Grouped by what each would be used for, so the list is auditable; leaving one out is the bug. Scoped to a
 * browser-realm page (a tab, or headless's Playwright page), not Node globals.
 */
export const DENIED_GLOBALS: readonly string[] = [
    // Reaching the global object, and from it everything else.
    "globalThis",
    "window",
    "self",
    "top",
    "parent",
    "frames",

    /**
     * Evaluating more code. `eval` is missing on purpose: strict mode forbids it as a binding name, so naming it
     * would make `new Function` throw and every dynamic node stop linking. It stays reachable, one more reason
     * this file is not the security boundary.
     */
    "Function",
    "importScripts",

    // The DOM: reading the page, and `document.cookie`.
    "document",
    "navigator",
    "location",
    "history",
    "screen",
    "customElements",

    /** Anywhere to send what was found (`navigator.sendBeacon` needs `navigator`, already denied above). */
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
 * Names strict mode refuses to bind: they would break linking for every dynamic node rather than protect
 * anything. Checked rather than trusted, because adding one fails at evaluation, on whichever node compiles
 * first, naming neither the list nor the culprit.
 */
const UNBINDABLE = new Set(["eval", "arguments"]);

const illegal = DENIED_GLOBALS.filter((name) => UNBINDABLE.has(name));
if (illegal.length > 0) {
    throw new Error(
        `DENIED_GLOBALS cannot contain ${illegal.join(", ")}: strict mode forbids ` +
            `binding those names, so no dynamic node would link at all. See the note in this file.`,
    );
}

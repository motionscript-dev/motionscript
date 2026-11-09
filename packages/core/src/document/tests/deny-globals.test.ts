import { describe, expect, it } from "vitest";

import { DENIED_GLOBALS } from "../deny-globals";

describe("DENIED_GLOBALS", () => {
    it("covers the DOM, network, storage, other-thread and UI-interrupt categories", () => {
        // A cheap regression check for "adding a browser API here is cheap;
        // leaving one out is the bug" — not exhaustive, just the load-bearing
        // ones each category exists to keep out.
        for (const name of [
            "window", "document", "fetch", "XMLHttpRequest", "localStorage",
            "indexedDB", "Worker", "postMessage", "alert",
        ]) {
            expect(DENIED_GLOBALS).toContain(name);
        }
    });

    it("never contains eval or arguments", () => {
        // Strict mode forbids binding either as a `new Function` parameter
        // name — see the module's own load-time assertion, which this
        // duplicates at the test level so a regression fails loudly here too,
        // not just as "every dynamic node stops linking" somewhere else.
        expect(DENIED_GLOBALS).not.toContain("eval");
        expect(DENIED_GLOBALS).not.toContain("arguments");
    });

    it("binds cleanly as new Function parameters under strict mode", () => {
        // The thing this list is actually for: every name resolves to the
        // function's own `undefined` argument rather than the real global.
        const factory = new Function(
            ...DENIED_GLOBALS,
            `"use strict"; return typeof window === "undefined" && typeof fetch === "undefined";`,
        );
        expect(factory()).toBe(true);
    });

    it("lists every name once, and each is an identifier a function can bind", () => {
        expect(new Set(DENIED_GLOBALS).size).toBe(DENIED_GLOBALS.length);
        for (const name of DENIED_GLOBALS) expect(name).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    });

    it("binds every name under strict mode one at a time, so linking never fails on a single one", () => {
        for (const name of DENIED_GLOBALS) {
            expect(() => new Function(name, '"use strict"; return 1;'), name).not.toThrow();
        }
    });

    // The module throws at load if `eval` or `arguments` is ever listed.
    // The check runs once, on an array literal in the module, and is not exported,
    // so a test cannot make it fail without editing the list.
    it.todo("throws at load when the list names eval or arguments (needs the check exported)");
});

import { describe, expect, it } from "vitest";

import {
    assertRegistryItem,
    interpolate,
    resolveItemUrl,
    splitNamespacedName,
    type ComponentsConfig,
} from "./protocol";

/**
 * The half of a registry client that has no transport.
 *
 * Kept separate from `fetch.ts` so the URL-resolution rules are tested with no
 * network — and so a future non-CLI client (an in-browser editor) could reuse
 * them and be guaranteed to reach the same URL for a given name.
 */

const DEFAULT = "https://motionscript.dev/r";

const config: ComponentsConfig = {
    project: "src/project.ts",
    aliases: { components: "@/components" },
    paths: { components: "src/components" },
    registries: {
        "@acme": {
            url: "https://registry.acme.dev/{name}.json",
            headers: { Authorization: "Bearer ${ACME_TOKEN}" },
        },
        "@labs": "https://labs.example.com/r/{name}.json",
        "@local": "../my-registry/r/{name}.json",
    },
};

describe("splitNamespacedName", () => {
    it("splits a namespaced name", () => {
        expect(splitNamespacedName("@acme/gauge")).toEqual({
            namespace: "@acme",
            itemName: "gauge",
        });
    });

    it("leaves a bare name alone", () => {
        expect(splitNamespacedName("line-chart")).toBeNull();
    });

    it("keeps a slash in the item name", () => {
        // A registry is free to organise its items in folders; only the first
        // segment is the namespace.
        expect(splitNamespacedName("@acme/charts/gauge")?.itemName).toBe("charts/gauge");
    });
});

describe("resolveItemUrl", () => {
    it("resolves a bare name against the default registry", () => {
        expect(resolveItemUrl("line-chart", config, DEFAULT)).toEqual({
            url: "https://motionscript.dev/r/line-chart.json",
            itemName: "line-chart",
        });
    });

    it("does not double a slash on a base that has one", () => {
        expect(resolveItemUrl("code", null, "https://motionscript.dev/r/").url).toBe(
            "https://motionscript.dev/r/code.json",
        );
    });

    it("substitutes into a namespaced registry's template", () => {
        const target = resolveItemUrl("@acme/gauge", config, DEFAULT);
        expect(target.url).toBe("https://registry.acme.dev/gauge.json");
        expect(target.itemName).toBe("gauge");
    });

    it("accepts a registry given as a bare URL string", () => {
        expect(resolveItemUrl("@labs/thing", config, DEFAULT).url).toBe(
            "https://labs.example.com/r/thing.json",
        );
    });

    it("resolves a local path registry, which is how one is tested unpublished", () => {
        expect(resolveItemUrl("@local/thing", config, DEFAULT).url).toBe(
            "../my-registry/r/thing.json",
        );
    });

    it("expands ${VAR} in headers against the supplied lookup", () => {
        const target = resolveItemUrl("@acme/gauge", config, DEFAULT, (key) =>
            key === "ACME_TOKEN" ? "s3cret" : undefined,
        );
        expect(target.headers).toEqual({ Authorization: "Bearer s3cret" });
    });

    it("leaves an unset ${VAR} written out rather than emptying it", () => {
        // An empty Authorization header reads as "this registry needs no auth"
        // and fails as a 401 with nothing to go on. The literal survives so the
        // error names the variable that was not set.
        const target = resolveItemUrl("@acme/gauge", config, DEFAULT);
        expect(target.headers).toEqual({ Authorization: "Bearer ${ACME_TOKEN}" });
    });

    it("refuses a namespace that is not configured", () => {
        expect(() => resolveItemUrl("@nope/thing", config, DEFAULT)).toThrow(
            /Unknown registry namespace "@nope"/,
        );
    });

    it("refuses a registry URL with no {name} placeholder", () => {
        const broken: ComponentsConfig = {
            ...config,
            registries: { "@bad": "https://example.com/registry.json" },
        };
        expect(() => resolveItemUrl("@bad/thing", broken, DEFAULT)).toThrow(/\{name\}/);
    });
});

describe("interpolate", () => {
    it("expands every occurrence", () => {
        expect(interpolate("${A}/${B}/${A}", (k) => k.toLowerCase())).toBe("a/b/a");
    });

    it("leaves anything that is not a ${VAR} alone", () => {
        expect(interpolate("$NOT {this} ${}", () => "x")).toBe("$NOT {this} ${}");
    });
});

describe("assertRegistryItem", () => {
    it("accepts an item with files", () => {
        expect(() =>
            assertRegistryItem({ name: "x", type: "registry:component", files: [] }, "x"),
        ).not.toThrow();
    });

    it.each([null, 42, {}, { files: "nope" }])("rejects %s", (data) => {
        expect(() => assertRegistryItem(data, "gauge")).toThrow(/Malformed registry item for "gauge"/);
    });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as component from "../component";
import * as textDefaults from "../components/builtins/text/text-defaults";
import * as metrics from "../util/metrics";
import * as numberFormat from "../components/builtins/text/number-format";
import * as numberPattern from "../components/builtins/text/number-pattern";
import * as orbit from "../attributes/render3d/orbit";
import * as shapeOutline from "../components/builtins/geometry/shape-outline";

/**
 * `@motionscript/core/component` is machinery for writing a component, kept off
 * the main barrel. It is a re-export file and nothing else: each name it carries
 * lives beside whatever owns it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../component.ts"), "utf8");

/** The modules it passes through whole. */
const MODULES = {
    "@/components/builtins/text/text-defaults": textDefaults,
    "@/util/metrics": metrics,
    "@/components/builtins/text/number-format": numberFormat,
    "@/components/builtins/text/number-pattern": numberPattern,
    "@/attributes/render3d/orbit": orbit,
    "@/components/builtins/geometry/shape-outline": shapeOutline,
} as const;

/** The file with its comments removed, so what is left is code. */
function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the component subpath", () => {
    it("re-exports the six modules the contract lists wholesale", () => {
        const exported = [...code(source).matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)].map((m) => m[1]);
        expect(exported.sort()).toEqual(Object.keys(MODULES).sort());
    });

    it("defines nothing of its own: every line of code is a re-export", () => {
        const lines = code(source).split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
        for (const line of lines) expect(line).toMatch(/^export\s+(type\s+)?(\*|\{[^}]*\})\s*from\s*["'][^"']+["'];?$/);
    });

    it("carries exactly the names those modules export, no more and no fewer", () => {
        const expected = new Set(Object.values(MODULES).flatMap((module) => Object.keys(module)));
        expect(new Set(Object.keys(component))).toEqual(expected);
        expect(expected.size).toBeGreaterThan(20);
    });

    it("passes each name through as the very same value", () => {
        for (const module of Object.values(MODULES)) {
            for (const [name, value] of Object.entries(module)) {
                if (name in component) expect((component as Record<string, unknown>)[name], name).toBe(value);
            }
        }
    });

    it("has no name two of its modules both export, which `export *` would drop", () => {
        const seen = new Map<string, string>();
        for (const [path, module] of Object.entries(MODULES)) {
            for (const name of Object.keys(module)) {
                expect(seen.get(name), `${name} in both ${seen.get(name)} and ${path}`).toBeUndefined();
                seen.set(name, path);
            }
        }
    });

    it("carries the text defaults, and none of the class-era helpers", () => {
        expect(component).toHaveProperty("hostTextFamily");
        for (const name of ["at", "hold", "sequence", "together", "compose", "drive", "asCommand", "declarePaints"]) {
            expect(component, name).not.toHaveProperty(name);
        }
    });
});

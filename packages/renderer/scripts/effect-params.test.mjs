// The built-in effects' three halves agree: core's spec, the port's layout
// (web/src/effects/<type>.ts) and the pass (crates/renderer/src/effects/<type>.wgsl).
//
//   node --test scripts/effect-params.test.mjs
//
// Needs core's built dist (`pnpm build:lib` at the repository root).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeEffect, effectDescriptors } from "@motionscript/core";
import { generate } from "./gen-effect-params.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORTS = `${root}web/src/effects`;
const WGSL = `${root}crates/renderer/src/effects`;
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Core effects the renderer handles outside the port table. */
const NOT_PORTED = { motionBlur: "the adapter resolves it against velocity", shader: "user WGSL (user_shader.rs)" };
/** Ports with no core effect spec: media adjustments an image fill carries. */
const MEDIA = ["alpha", "colorMatrix", "exposure"];

const { layout } = await import(pathToFileURL(`${PORTS}/_pack.ts`).href);
const ports = await Promise.all(readdirSync(PORTS).filter((f) => f.endsWith(".ts") && !f.startsWith("_")).sort()
    .map(async (f) => (await import(pathToFileURL(`${PORTS}/${f}`).href)).default));
const passes = readdirSync(WGSL).filter((f) => f.endsWith(".wgsl") && !f.startsWith("_")).map((f) => f.slice(0, -5)).sort();

test("the generated accessors are current", async () => {
    for (const [type, text] of await generate()) {
        assert.equal(read(`${WGSL}/gen/${type}.wgsl`), text, `${type}: run node scripts/gen-effect-params.mjs`);
    }
});

test("every pass has a port and every port a pass", () => {
    assert.deepEqual(ports.map((p) => p.type).sort(), passes);
});

test("every core effect has a port, or a reason it has none", () => {
    const missing = effectDescriptors().map((d) => d.type).filter((t) => !passes.includes(t) && !(t in NOT_PORTED));
    assert.deepEqual(missing, []);
    assert.deepEqual(passes.filter((t) => !describeEffect(t)), MEDIA);
});

for (const port of ports) {
    test(`${port.type}: the pass reads every field by name, and nothing by position`, () => {
        const body = read(`${WGSL}/${port.type}.wgsl`);
        for (const f of layout(port.spec)) {
            const name = snake(f.name);
            assert.match(body, new RegExp(`\\b(param_${name}\\(|PARAM_${name.toUpperCase()}\\b)`), `${f.name} is never read`);
        }
        assert.doesNotMatch(body, /\bparam[24]?\(/, "a positional param() read");
    });

    const spec = describeEffect(port.type);
    if (spec) {
        test(`${port.type}: every spec parameter reaches the pass or the packer`, () => {
            const fields = Object.entries(port.spec.params);
            const used = new Set([
                ...fields.map(([name]) => name),
                ...fields.flatMap(([, f]) => (f === "param" ? [] : f.uses ?? [])),
                ...(port.spec.uses ?? []),
            ]);
            const params = spec.params.map((p) => p.name);
            assert.deepEqual(params.filter((p) => !used.has(p)), [], "parameters the port ignores");
            assert.deepEqual([...used].filter((p) => !params.includes(p) && fields.every(([n]) => n !== p)), [], "uses naming no parameter");
        });
    }

    test(`${port.type}: its cases pack within the pass's ${64} floats`, { skip: port.type === "ascii" && "bakes an atlas on a canvas" }, () => {
        for (const effect of port.cases()) port.pack(effect);
    });
}

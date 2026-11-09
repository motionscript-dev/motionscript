// Generates each built-in effect's WGSL parameter accessors from its port's
// layout (web/src/effects/<type>.ts, `definePort`), into
// crates/renderer/src/effects/gen/<type>.wgsl, which build.rs prepends to the
// effect's own file. The pass reads `param_<name>()` (an array field also gets
// `PARAM_<NAME>`, its offset, and `param_<name>(i)`), so the packer and the
// shader agree by name, never by position.
//
//   node scripts/gen-effect-params.mjs          # write
//   node scripts/gen-effect-params.mjs --check  # exit 1 when the output is stale
//
// Needs core's built dist (`pnpm build:lib` at the repository root). Imports the
// ports directly, under Node's TypeScript type stripping.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORTS = `${root}web/src/effects`;
const OUT = `${root}crates/renderer/src/effects/gen`;

const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const u = (n) => `${n}u`;

/** The accessor source for one laid-out field. */
function accessors(f) {
    const fn = `param_${snake(f.name)}`;
    if (typeof f.type === "string") {
        const read = {
            f32: `param(${u(f.offset)})`,
            vec2f: `param2(${u(f.offset)})`,
            vec3f: `vec3f(param(${u(f.offset)}), param(${u(f.offset + 1)}), param(${u(f.offset + 2)}))`,
            vec4f: `param4(${u(f.offset)})`,
        }[f.type];
        return [`fn ${fn}() -> ${f.type} { return ${read}; }`];
    }
    const { of } = f.type;
    const width = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 }[of];
    const k = width === 1 ? `PARAM_${snake(f.name).toUpperCase()} + i` : `PARAM_${snake(f.name).toUpperCase()} + i * ${u(width)}`;
    const read = {
        f32: `param(${k})`,
        vec2f: `param2(${k})`,
        vec3f: `vec3f(param(${k}), param(${k} + 1u), param(${k} + 2u))`,
        vec4f: `param4(${k})`,
    }[of];
    return [
        `const PARAM_${snake(f.name).toUpperCase()}: u32 = ${u(f.offset)};`,
        `fn ${fn}(i: u32) -> ${of} { return ${read}; }`,
    ];
}

/** Every port's generated file, by effect type. */
export async function generate() {
    const { layout } = await import(pathToFileURL(`${PORTS}/_pack.ts`).href);
    const out = new Map();
    for (const file of readdirSync(PORTS).filter((f) => f.endsWith(".ts") && !f.startsWith("_")).sort()) {
        const port = (await import(pathToFileURL(`${PORTS}/${file}`).href)).default;
        const lines = [
            `// Generated from web/src/effects/${file} by scripts/gen-effect-params.mjs. Do not edit.`,
            ...layout(port.spec).flatMap(accessors),
        ];
        out.set(port.type, `${lines.join("\n")}\n`);
    }
    return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const files = await generate();
    if (process.argv.includes("--check")) {
        const stale = [];
        const have = new Set(readdirSync(OUT).filter((f) => f.endsWith(".wgsl")));
        for (const [type, text] of files) {
            have.delete(`${type}.wgsl`);
            let current = null;
            try { current = readFileSync(`${OUT}/${type}.wgsl`, "utf8").replace(/\r\n/g, "\n"); } catch {}
            if (current !== text) stale.push(type);
        }
        stale.push(...[...have].map((f) => `${f} (no port)`));
        if (stale.length) {
            console.error(`stale effect params: ${stale.join(", ")}. Run node scripts/gen-effect-params.mjs`);
            process.exit(1);
        }
    } else {
        rmSync(OUT, { recursive: true, force: true });
        mkdirSync(OUT, { recursive: true });
        for (const [type, text] of files) writeFileSync(`${OUT}/${type}.wgsl`, text);
        console.log(`wrote ${files.size} files to crates/renderer/src/effects/gen`);
    }
}

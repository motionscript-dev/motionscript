// Validates WGSL fills and effects with the renderer's own naga (the WASM in
// web/pkg, `pnpm build:wasm` first), without a browser or a GPU.
//
//   node scripts/validate-wgsl.mjs fill a.wgsl b.wgsl
//   node scripts/validate-wgsl.mjs effect - < shader.wgsl
//   node scripts/validate-wgsl.mjs --json fill a.wgsl     # the full report
//
// Exits 1 when any source has a diagnostic.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initSync, validate_shader } from "../web/pkg/ms_renderer.js";

const args = process.argv.slice(2);
const json = args[0] === "--json" ? args.shift() : null;
const [scope, ...files] = args;
if (scope !== "fill" && scope !== "effect") {
    console.error("usage: validate-wgsl.mjs [--json] fill|effect <file|-> ...");
    process.exit(2);
}
initSync({ module: readFileSync(fileURLToPath(new URL("../web/pkg/ms_renderer_bg.wasm", import.meta.url))) });

let failed = false;
for (const file of files.length ? files : ["-"]) {
    const source = readFileSync(file === "-" ? 0 : file, "utf8");
    const report = JSON.parse(validate_shader(scope === "fill" ? 0 : 1, source));
    delete report.wgsl;
    if (json) console.log(JSON.stringify({ file, ...report }));
    else if (report.ok) console.log(`${file}: ok (Params ${report.size} bytes: ${report.fields.map((f) => `${f.name}: ${f.type}`).join(", ") || "none"})`);
    for (const d of report.diagnostics) if (!json) console.log(`${file}:${d.line}:${d.column}: ${d.message}`);
    failed ||= !report.ok;
}
process.exit(failed ? 1 : 0);

// prepack: refuses to pack the package without its build. The WASM needs Rust,
// so a release whose `pnpm build` skipped this package would ship an empty dist/.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const required = ["dist/index.js", "dist/index.d.ts", "dist/ms_renderer_bg.wasm", "dist/browser/index.js", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"];
const missing = required.filter((f) => !existsSync(root + f));
if (missing.length > 0) {
    console.error(`@motionscript/renderer is missing ${missing.join(", ")}: run \`pnpm --filter @motionscript/renderer build\` first.`);
    process.exit(1);
}

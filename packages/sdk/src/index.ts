/**
 * `@motionscript/sdk` — the published, friendly name over `@motionscript/core`.
 *
 * The curation lives in `@motionscript/core`'s own `"./sdk"` subpath
 * (`packages/core/src/sdk/index.ts`), not here: a hand-curated copy in a
 * different package than the classes it names is exactly the "two
 * definitions that can silently disagree" shape this codebase avoids
 * elsewhere. This file exists so the published package name and its own
 * versioning stay stable — only its implementation is a passthrough.
 */
export * from "@motionscript/core/sdk";

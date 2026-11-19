---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

**`deprecate(fn, { name, use, removeIn })`** (core, sdk): retires an exported function while its callers keep working. It returns the same function, which warns once, in development, what replaces it and which release takes it out; `warnDeprecated(notice)` warns the same way where there is nothing to wrap. CI checks that a kit's `@deprecated` export names that release and is dropped before it ships.

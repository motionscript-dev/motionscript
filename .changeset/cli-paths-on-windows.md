---
"@motionscript/cli": patch
---

`ms add` writes the same lock on Windows as everywhere else. A file's `target` in `motionscript.lock.json` is now always written with forward slashes (`src/components/gauge.ts`), so a lock committed from Windows reads the same on every machine; a lock that already holds backslashes still reads on Windows. A local registry given as a Windows path (`--registry C:\registry`) resolves an item to `C:\registry\gauge.json` instead of `C:\registry/gauge.json`, which is the `url` the lock records and the path an error names.

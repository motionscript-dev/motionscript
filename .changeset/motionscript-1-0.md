---
"@motionscript/core": major
"@motionscript/sdk": major
"@motionscript/charts": major
"@motionscript/math": major
---

**Breaking:** Motionscript 1.0, the first stable release, and a clean start: nothing a 0.x engine wrote is read.

- The document format starts again at 1 and `DOCUMENT_MIGRATIONS` is empty. A document without `formatVersion` reads as format 1; a `formatVersion` below 1 is invalid.
- The 0.x prop aliases are gone: `canvas3d.ambientIntensity`, `canvas3d.ambientColor`, `canvas3d.keyIntensity` and `canvas3d.keyColor` (and the same on `axes3d`), `line3d.stroke` written as one `LineStroke3D`, and each chart's `style` written before every text had its own field, with `migrateChartStyle`.
- The versioned component API (`@motionscript/sdk/v1`, `@motionscript/sdk/v1/component` and each kit's `/v1` path) is stable under semver from here: it changes only in a major release.

Migration: none. Documents and components written for a 0.x engine are not supported; make them again on 1.0.

---
"@motionscript/core": patch
---

`@motionscript/core/experimental` is deprecated. It duplicates the stable authoring surface: import the factories, `Types`, `provides`, `commandsFor` and the modules from `@motionscript/sdk` instead, where `TextStyle` is `Typeface` and `Corners` is `Shapes.corners` and `Shapes.rect`. The subpath keeps working until the next major.

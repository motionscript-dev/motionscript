---
"@motionscript/math": patch
---

`to` and `morphTo` on a `Latex` node that is not in a tree run their duration and write nothing, as every other command does. They used to write `latex` on the loose node when driven directly; a document could not reach this, since the validator rejects a command that runs before its target is present.

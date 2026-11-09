---
"@motionscript/code": patch
---

A `code` node draws the listing its props describe until its first command starts.

- The structure, highlight and in-flight transitions the listing commands own live outside the props, and only a command that had started wrote them, so before the first one a frame showed whatever the last evaluation left: the end of every command. A listing appended to at 1 s drew the new rows from 0 s, and a `highlight` at 0.8 s, as in the README's own example, dimmed the listing from 0 s, jumped to full brightness when it started, then faded back. A seek back past an edit or a highlight also left it drawn mid-transition. Until a command applies, all three are now derived from the props, so a frame is the same however the playhead reached it, and a highlight still selects the tokens it was built against when a later edit returns the source to the same text.
- The README says what the host supplies: a monospaced face under `fontFamily` (`Fira Mono` by default) in the engine's asset manifest, without which the listing draws no text or falls back to another registered face.

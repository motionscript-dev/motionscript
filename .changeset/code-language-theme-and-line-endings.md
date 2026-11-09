---
"@motionscript/code": patch
---

A `code` node reports what it cannot highlight, follows its `language` and `theme`, reads Windows line endings, and diffs long edits within a budget.

- An unknown language, a grammar whose import is rejected and an unknown theme name each logged nothing and fell back silently. Each now logs one `[Code]` warning per name, with the import's reason where there is one. `''`, `text` and `plaintext` mean plain text and stay silent.
- A tweened or bound `theme` or `language` left the old colours once any listing command had run, because only `set()` re-tokenized. The listing now re-derives from `code`, `language` and `theme` on every read, and a theme-only change keeps the token ids a highlight names.
- `\r\n` and a lone `\r` are line breaks, in `code`, in the text a command brings in and in `to({ code })`; they used to survive as a character at the end of each line. `normalizeSource` is exported from the engine barrel.
- The kit's own commands (`append`, `prepend`, `insert`, `remove`, `replace`, `highlight`, `resetHighlight`, `to`) run their duration and write nothing on a node that is not in a tree.
- Aligning the lines of an edit was quadratic (741 ms for 1,000 lines). Lines equal at either end and lines that occur once on both sides now anchor the alignment, and only the runs between anchors are compared, within `LINE_ALIGN_CELLS` per run and `EDIT_ALIGN_CELLS` per edit; a larger run leaves and enters as whole rows. `pnpm bench` measures it.

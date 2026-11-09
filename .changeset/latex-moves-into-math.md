---
"@motionscript/math": minor
---

`@motionscript/math` is a new kit, and the `Latex` node now lives in it. Import it from there:

```diff
- import { Latex, NODES } from "@motionscript/latex";
+ import { Latex, NODES } from "@motionscript/math";
```

- The node, its `latex` key, its props, `morphTo` and the helpers (`buildLatexPath`, `LatexError`, `defaultLatexMorph`) are unchanged, so a document that names `latex` needs no edit. `ms add latex` now copies a node that imports `@motionscript/math`.
- `@motionscript/math/kit` holds what a copied node imports rather than copies, and `@motionscript/math/tex` the typeset-math half alone.
- `@motionscript/latex` and `@motionscript/plot` are no longer released. Their published versions stay on npm as they are.

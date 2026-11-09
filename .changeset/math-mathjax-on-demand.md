---
"@motionscript/math": minor
---

MathJax loads only when a scene typesets a formula.

- MathJax and its font are a module of their own, imported once by `loadMathJax()`. A formula node, and a graph, point, brace or angle whose label is written between dollar signs, declares the `math:mathjax` loader (`MATHJAX_LOADER`), which a host waits for before layout; a scene without one never downloads or parses MathJax.
- Code that typesets outside a scene awaits `loadMathJax()` first. Before then `buildLatexPath` throws `LatexNotLoaded`, `latexPartNames` returns nothing, and `mathJaxLoaded()` says whether it has arrived.

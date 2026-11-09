---
"@motionscript/math": patch
---

A formula MathJax cannot typeset now throws a `LatexError`, the same in a browser and in Node.

MathJax does not throw on malformed TeX; it typesets an error box. In a browser `buildLatexPath` then returned no tokens for `\fra`, `\frac{a`, `{` or `\badcommand{x}`, so nothing was drawn and nothing was reported, while the DOM-free adaptor returned one wide token that drew as a filled bar. Both now detect MathJax's error node and throw `LatexError`, which carries the `latex` source and MathJax's `reason`. `\require` is an error too, since only the listed TeX packages are loaded. A `Latex` node whose formula cannot be typeset keeps throwing on every read instead of reading as blank after the first.

---
"@motionscript/math": patch
---

`\mathbb`, `\mathcal`, `\mathfrak`, `\mathscr`, `\mathsf` and `\mathtt` typeset.

Their glyphs live in font files MathJax loads asynchronously the first time a formula needs one, which the synchronous typesetter cannot wait for, so `buildLatexPath`, the `Latex` constructor and a morph to such a formula threw `MathJax retry`, in a browser and in Node. Those six files are now bundled and set up on the font before anything is typeset. The package depends on `@mathjax/mathjax-newcm-font` directly (it was already installed through `@mathjax/src`), and its browser build grows by about 525 KB minified, 219 KB gzipped. Characters in MathJax's other on-demand ranges, such as accented Latin in `\text{é}`, still throw.

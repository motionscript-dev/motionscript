---
"@motionscript/geography": minor
---

`@motionscript/geo` and the data-only `@motionscript/geography` are one package, `@motionscript/geography`, which holds `GeoBorder` and the outlines it draws (`@motionscript/geography/data/*`, unchanged on disk). Documents are untouched: the node's key is still `geoBorder`. Update the dependency, the imports, and any `@motionscript/geo` specifier a copied component carries; `ms add geo-border` copies the new specifier.

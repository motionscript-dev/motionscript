---
"@motionscript/geography": patch
---

- **`GeoGlobe`** (`geoGlobe`): the whole world on an orthographic sphere, turned with `turnTo` (the shorter way to a longitude and latitude) and `spin` (any number of degrees). Ocean and rim are `fill` and `stroke`; `land`, `coast`, `graticule` (every `graticuleStep` degrees) and `highlightFill` over the countries in `highlight` are its own paints, each with a command to tween it (`landTo`, `coastTo`, `graticuleTo`, `highlightFillTo`). `GEO_WORLD` lists every country file, for a world `GeoBorder` too.
- **`GeoBorder` draws a selection once all its files have landed**, keyed on those files alone: a world selection no longer refits as each of its 252 files arrives, nor when another node's file lands.
- **A polygon two selected regions both carry is filled once** (Guadeloupe in `FR` and `GP`), and its coast stays in `borders: "outline"`.
- `geoOutlines` (a selection simplified, before projection), `geoGlobeGeometry`, and the path helpers `geoChunks`, `geoChunkPath` and `geoChoice` are exported for components that draw geography.

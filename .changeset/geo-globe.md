---
"@motionscript/geography": patch
---

- **`GeoGlobe`** (`geoGlobe`) and **`GeoGlobe3d`** (`geoGlobe3d`): the whole world painted on a sphere, a 2D node square-on in its box and the same globe as a node of a 3D scene. The land is a picture on the sphere, so a pattern or a gradient turns with the countries, and every land part fills against one 360° square (a `grid` lines up across countries). `turnTo` takes the shorter way to a longitude and latitude and `spin` turns any number of degrees. `fill` is the ocean (and `geoGlobe`'s `stroke` its rim); `land`, `coast`, `graticule` (every `graticuleStep` degrees, cut where it crosses land) and `highlightFill` over the countries in `highlight` are its own paints, each with a command to tween it. `shading` is `flat` or `lit`, and `farSide: "shown"` makes a glass globe of a translucent ocean. `GEO_WORLD` lists every country file, for a world `GeoBorder` too.
- **`GeoBorder` draws a selection once all its files have landed**, keyed on those files alone: a world selection no longer refits as each of its 252 files arrives, nor when another node's file lands.
- **A polygon two selected regions both carry is filled once** (Guadeloupe in `FR` and `GP`), and its coast stays in `borders: "outline"`.
- `geoOutlines` (a selection simplified, before projection), `geoWorldMap` (on an equirectangular map), the globe's scene builder `drawGlobe` with its paints `globeState`, and the path helpers `geoChunks`, `geoChunkPath` and `geoChoice` are exported for components that draw geography.

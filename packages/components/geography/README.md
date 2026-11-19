# @motionscript/geography

Geography for [Motion Script](https://motionscript.dev): `GeoBorder`, country and
state outlines by ISO 3166 code, and `GeoGlobe`/`GeoGlobe3d`, the world on a
sphere. Hand `NODES` to the engine through your project entry, and a document
can name `geoBorder`, `geoGlobe` and `geoGlobe3d`:

```ts
// src/project.ts
import { NODES } from '@motionscript/geography';

export const nodes = NODES;
```

`GeoBorder` draws nothing until a data source is registered; see
[its docs page](https://motionscript.dev/docs/components/geography/geo-border).

This package is written against [`@motionscript/sdk`](https://github.com/motionscript-dev/motionscript/tree/main/packages/sdk), which it
takes as a peer dependency.

## Install

```bash
npm install @motionscript/geography @motionscript/sdk
```

| Entry | What |
| --- | --- |
| `@motionscript/geography` | The public surface: the three nodes, `NODES`, and the data-source setup (`geoRegistry`, `geoUrlSource`, `geoLoaderSource`, `GeoSource`, `GeoDefinition`, `GeoShape`). A name leaves it only after a deprecation, in the next major (the next minor while on 0.x). |
| `@motionscript/geography/kit` | Everything (`src/unstable.ts`): the border and globe modules, the file cache, the geometry and the globe's scene, which a copied node imports. **Unstable**: any release may change it. |
| `@motionscript/geography/data/*` | The data files (see [The data](#the-data)). |

## GeoBorder

- **`start` and `end` draw the borders on and leave the fill whole.** Each
  border is cut to the part of `[start, end]` that falls inside it; the fill and
  the overlay are never trimmed, so draw the outline on with `progressTo` and
  fade the land in with `fillTo`.
- **The fill is one shape measured against the node's box.** Every part fills
  together, with the box as the fill's bounds, so a `grid` or a gradient runs on
  across borders and islands and does not move when the selection or its
  `detail` changes; a square box gives a grid square cells.
- **Fill and stroke are separate geometry.** The fill is each kept polygon; the
  stroke draws each arc once, so a border two selected regions share is stroked
  once, and `stroke.align` is forced to the centre. `clipSelf` is the layout box,
  not the outline.
- **`detail` never refits.** The files store a simplification bucket per point,
  `detail` is a draw-time threshold over it, and the projection is fitted at full
  detail and cached apart from it, so tweening `detail` does not move the drawing.
- **`iso` is a list of codes**, as an array or text split on spaces, commas and
  semicolons, upper-cased. A code is `AB` or `AB-XYZ`; one that is not, or that no
  loaded file has, draws nothing and warns once. A bare country code draws the
  country, or at `level: "state"` its first-level subdivisions (minus `remote`
  ones when `frame` is `"mainland"`); a subdivision code is always itself.
- **Drawing never throws.** A node declares each file it needs as the asset
  `geo:<key>` (gate `render`: layout does not wait for it, but an export loads the
  files before the frame that needs them); a missing or failed file draws nothing.
- **A selection draws once all its files have landed**, and is cached on the
  state of those files alone, so a file another node loads never refits it.
- **A polygon two selected regions both carry is kept once.** A country's file
  also holds territories that have codes of their own (Guadeloupe in `FR`,
  Svalbard in `NO`); selecting both would fill it twice and drop its coast from
  `borders: "outline"` as a shared border.

## GeoGlobe and GeoGlobe3d

The whole world (`GEO_WORLD`, every country file) painted on a sphere, turned
so `longitude`/`latitude` faces the viewer. `geoGlobe` is a 2D node: the sphere
is its box's inscribed circle, seen square-on, so it drops onto any board.
`geoGlobe3d` is the same globe as a node of a `canvas3d` scene, `radius` scene
units across, facing +z before its own rotation tilts it.

- **Paints:** `fill` is the ocean, `land` and `coast` the countries (`borders`
  picks every border or the coasts alone), `graticule` the parallels and
  meridians every `graticuleStep` degrees, cut where they cross land, and
  `highlightFill` the countries in `highlight`. `geoGlobe`'s `stroke` is its rim.
  `start`/`end` draw the coast and the graticule on, each along its own length.
- **The land is a picture on the sphere**, painted once (4096 × 2048,
  equirectangular), so a grid or a gradient turns with the countries. Every
  land part fills against one 360° square, so a `grid` has square cells in
  degrees and lines up across countries; its cells narrow toward the poles,
  as the parallels do. A fill's pixels and a line's `weight` are screen pixels
  at the middle of a `geoGlobe`, and thousandths of a scene unit on a
  `geoGlobe3d`, as for every 3D line.
- **Looks:** `shading: "flat"` shows every colour exactly as set; `"lit"`
  shades the ball under a light. `farSide: "shown"` sees through a translucent
  ocean to the far side, a glass globe; `"hidden"` keeps it out of sight even
  with no ocean at all.
- **Commands:** `landTo`, `coastTo`, `graticuleTo` and `highlightFillTo` tween
  its own paints, as `fillTo` does the ocean. `turnTo` takes the shorter way
  round to a longitude and latitude, either of which may be left out; `spin`
  turns it by any number of degrees, positive the way the Earth turns.
- **Cost:** the picture and the lines are built once and kept while their
  paints are unchanged, so turning only turns the sphere. A paint tween paints
  the picture again each frame. It loads all 252 country files (about 6 MB),
  and like `GeoBorder` draws once they have landed.

### Data sources

The files are this package's own `data/` (see [The data](#the-data)); the kit
reads them only through their format
(`v1/index`, `v1/countries/<ISO2>`, `v1/states/<ISO2>`, where `v1/states/US`
holds every `US-…` unit). The registry is process-wide, shared by every engine,
session and node:

```ts
import { geoRegistry, geoUrlSource } from '@motionscript/geography';

geoRegistry.use(geoUrlSource('/geo')); // serves the *contents of* @motionscript/geography/data
geoRegistry.define({ 'XX-ATLANTIS': { shape: geojsonPolygon, name: 'Atlantis' } });
```

- **Sources are asked in registration order; the first non-null answer wins.**
  `null` means "not here" and a throw means "could not tell"; neither is cached
  for good, and `loadGeoFile` never rejects. `geoUrlSource` treats HTTP 404 and 400
  as absent. `geoLoaderSource(load)` wraps text, bytes or parsed JSON (for example
  `fs.readFile`). With no source registered nothing loads and `GeoBorder` draws
  nothing.
- **A defined shape wins over every source** and needs none. It is GeoJSON in
  lon/lat, wound either way round, and is simplified by `detail` like any other.
- **Decoded files are never freed** while the process lives (`clearGeoFiles`
  exists for tests), and `geoLoader(key)` returns one function per key, so any
  number of nodes declare the same loader.

## The data

The package also ships the outlines `GeoBorder` draws: country and first-level
subdivision outlines keyed by ISO 3166 code, as small JSON files derived from
[Natural Earth](https://www.naturalearthdata.com/) v5.1.2 (public domain; see
`CREDITS.md`). They are in `data/` and exported as `./data/*`, read by path from
`node_modules` or served from a static host. The kit's code does not import
them.

### The data is generated, never edited

`data/` and `.cache/` are gitignored. `scripts/generate.mjs` removes `data/v1/`
and writes it whole, from three Natural Earth GeoJSON files pinned in
`sources.lock.json` (tag, URL, sha256, size). A downloaded or cached file that
does not match the lock is refused, and a file is cached only after it matches.
The lock changes only through `--update-lock`. To change what a code draws, change
the generator or its tables (`scripts/lib/*.mjs`) and regenerate.

```bash
pnpm --filter @motionscript/geography generate  # network on first run, ~8 GB heap
pnpm --filter @motionscript/geography verify    # checks data/v1/
pnpm --filter @motionscript/geography test      # vitest, then node --test over scripts/tests
node scripts/fixture.mjs <out-dir>              # cut this package's test fixture from data/
node --max-old-space-size=8192 scripts/generate.mjs --update-lock   # re-pin sources
```

`prepack` (before `npm pack` and `publish`) generates `data/` when it is missing,
then runs `verify`. This package's committed fixture is `components/geography/src/border/tests/fixtures/v1/`.

### Layout and keys

```
data/v1/index.json                  every listed region: [code, name, nameNl, parent|null, first 0|1]
data/v1/countries/<ISO2>.json       one country per file
data/v1/states/<prefix>.json        every subdivision whose code starts with <prefix> (US-CA is in states/US)
```

- **Countries** are ISO 3166-1 alpha-2 codes from Natural Earth's de facto
  worldview, plus `XK` (Kosovo) and two user-assigned codes: `XS` Somaliland and
  `XN` Northern Cyprus. Territories the default file folds into a parent (`GF`,
  `RE`, `SJ`, ...) are countries of their own while the parent keeps its geometry.
- **Subdivisions** are ISO 3166-2 codes (`US-CA`, `FR-IDF`, `GB-ENG`), filed by the
  code's prefix, never by `adm0_a3` (which files Crimea under Russia and Puerto
  Rico outside the US). First-level regions of FR, GB, IT, ES and PH are built from
  Natural Earth's second-level units.
- **Unlisted features** (placeholders such as `SY-X01`, codeless `-99` units) are in
  the files so a state map has no holes, and absent from `index.json`.
- **A feature** has `code`, `name`, `nameNl`, `parent`, `first`, `listed`, optional
  `remote`, `area` (steradians), `mainland` (polygon indices, or `null` when all),
  `areas` and `polygons` (rings of arc references; `~i` is arc `i` reversed).

### Invariants

- **One topology.** Every country and subdivision is stitched and quantised
  together (1e6 steps, one `transform` for every file), so a border two regions
  share is one arc with one global id (`arcIds`) in every file that uses it, and
  simplifies identically on both sides. The renderer relies on it to stroke the
  border once.
- **Simplification is stored, not applied.** Each arc point is a triple
  `x, y, bucket` (the first `x`, `y` absolute, the rest deltas). The bucket is
  `clamp(round(-2 * log2(weight)), 1, 254)` of the point's spherical triangle area,
  0 for an arc's first and last point (so no detail setting can open a ring), and
  255 for a non-positive weight. `GeoBorder`'s `detail` is a draw-time threshold
  over the bucket, so one set of files serves every detail.
- **No file is over 1.5 MiB**, so any one can be fetched alone (`verify`).
- **The format is in the path.** A change in meaning or removal of a field is a new
  `data/v<N>/`, with `FORMAT` in `scripts/generate.mjs` and `scripts/verify.mjs` and
  `GEO_DATA_FORMAT` in this package's `src/border/format.ts` moving together; adding
  a field is compatible with the kit's decoder, which ignores unknown ones.
- **`verify` checks structure and coverage, not provenance**: arc and index
  integrity, endpoints, size, and minimum counts (249 countries, the 50 US states
  and DC, FR, GB, IT, ES, CA, DE and AU first-level regions). It does not compare
  the data with the lock or the generator.

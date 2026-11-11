# @motionscript/geography

Geography for [Motion Script](https://motionscript.dev): `GeoBorder`, country and
state outlines by ISO 3166 code. Hand `NODES` to the engine through your
project entry, and a document can name `geoBorder`:

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

## GeoBorder

- **`start` and `end` trim the fill and the overlay as well as the outline.**
  Each path is cut to the part of `[start, end]` that falls inside it, so a
  filled border drawn on with `end` from 0 to 1 grows as partial polygons, each
  closed by a straight chord, and a stroke-only one grows as a line. There is no
  way to trim the stroke alone.
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

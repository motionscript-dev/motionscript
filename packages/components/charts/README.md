# @motionscript/charts

Animated data charts for [Motion Script](https://motionscript.dev): a line chart
(which is also the area chart), a bar chart, a pie chart, a radar chart and a
radial chart, built from one shared kit (plot panel, value axis, legend, number
formatting) and dressed by one `style` entry. Written against
[`@motionscript/sdk`](https://github.com/motionscript-dev/motionscript/tree/main/packages/sdk), which it takes as a peer dependency.

```ts
import { NODES } from '@motionscript/charts';

export const nodes = NODES; // [LineChart, BarChart, PieChart, RadarChart, RadialChart]
```

Importing registers nothing; the host hands `NODES` to the engine (see
[`packages/components/CLAUDE.md`](https://github.com/motionscript-dev/motionscript/blob/main/packages/components/CLAUDE.md) for the registration and import rules every kit shares).

## Install

```bash
npm install @motionscript/charts @motionscript/sdk
```

## Exports

| Path | Source | What |
|---|---|---|
| `@motionscript/charts` | `src/index.ts` | the five chart barrels, `src/engine.ts` and `NODES` |
| `@motionscript/charts/kit` | `src/engine.ts` | the shared kit (`src/kit/*`, including `kit/style`, `kit/polar` and `PieLegend`) and all of `@motionscript/sdk/component` |

Each chart folder (`line-chart/`, `bar-chart/`, `pie-chart/`, `radar-chart/`,
`radial-chart/`) has an `index.ts` barrel with the node, its parts and its pure
helpers (`resolveXScale`, `barSpans`, `pieArcs`, ...). The charts and their parts
(`ChartLine`, `ChartBars`, `PieRing`, `VerticalAxis`, ...) are components
(`component2d`); only the charts are registered node types, so a document cannot
name a part. A chart tells a host its key, entries and commands; where it is
shelved and the box it is seeded at are the host's to keep. `lineChartDomains` and
`barChartDomain` give the axes as drawn, and `isSliceSelected` whether a pie slice
is out.

The style kit exports `CHART_STYLE_FAMILY` (`"chart"`), `CHART_STYLE_PRESETS`,
`CHART_PALETTE_DEFAULT` and the shared field groups (`CHART_COLORS`,
`CHART_TEXT`, `CARTESIAN_GRID`, `CHART_LEGEND`).

## Nodes

| Key | Made for (w x h) | Data props | Commands |
|---|---|---|---|
| `lineChart` | 760 x 460 | `data`, `xField`, `series`, `stack`, `xAxis`, `yAxis`, `region` | `enter`, `spotlightRegion`, `clearRegion`, `zoomTo`, `resetZoom`, `showSeries`/`hideSeries`/`spotlightSeries` |
| `barChart` | 760 x 460 | `data`, `categoryField`, `series`, `orientation`, `stack`, `valueAxis`, `categoryAxis` | `enter`, `showSeries`/`hideSeries`/`spotlightSeries`, `spotlightCategory`, `clearCategory` |
| `pieChart` | 680 x 480 | `data`, `categoryField`, `valueField`, `labelMode`, `centerLabel`, `centerCaption` | `enter`, `revealCenter`, `selectSlice`/`deselectSlice`/`selectOnlySlice`/`clearSelection` |
| `radarChart` | 680 x 480 | `data`, `categoryField`, `series`, `min`, `max` | `enter`, `showSeries`/`hideSeries`/`spotlightSeries` |
| `radialChart` | 560 x 560 | `data`, `categoryField`, `valueField`, `max`, `centerLabel`, `centerCaption` | `enter`, `revealCenter`, `selectRing`, `clearSelection` |

Every command takes the duration its row (or call) gives, and eases out unless
given an easing. Arguments: `seriesIndex`, `sliceIndex`, `categoryIndex`,
`ringIndex` (each 0 when left out), and for `spotlightRegion` and `zoomTo` a
`region` of `{ x?: [min, max], y?: [min, max] }`.

`lineChart` draws a line or an area chart: `style.area` of `none`, `solid` or
`gradient` fills under each line. `pieChart` draws a donut once `style.innerRadius`
is above 0.

## Styling

Each chart has one look entry, `style`, and nothing else about colour or type:
no `theme`, no `showLegend`. Its fields come in groups, written grouped and read
flat (`state.style.fontSize`):

| Group | Fields | On |
|---|---|---|
| colors | `palette`, `foreground`, `muted`, `gridColor`, `background` | every chart (`gridColor` is the radial's track colour; a pie has none) |
| text | `fontFamily`, `fontSize`, `fontWeight` | every chart |
| grid | `grid`, `gridWidth`, `gridDashed`, `axisLine`, `showXAxis`, `showYAxis` | line, bar |
| grid | `gridShape`, `gridLevels`, `gridWidth`, `spokes`, `spokeLabels` | radar |
| marks | the chart's own: `strokeWidth`, `curve`, `dots`, `area`, `barRadius`, `innerRadius`, `sweep`, ... | every chart |
| labels | `values` (line, bar), `labelPlacement` (pie), `ringLabels` (radial) | |
| legend | `legend` (`bottom`, `top`, `right`, `none`), `swatch` (`square`, `circle`, `line`) | every chart |

A chart takes only the fields it draws. A style is a partial laid over the chart's
previous style, and a key the chart does not have is dropped, so one style dresses
every chart in the family.

`CHART_STYLE_PRESETS` (`midnight`, `paper`, `ember`, `neon`, `ocean`, `sunset`,
`pastel`, `mono`) are colour-only partials. Spread one into a style and add to it:

```ts
import { CHART_STYLE_PRESETS } from '@motionscript/charts';

const props = {
  // ...data, series
  style: { ...CHART_STYLE_PRESETS.paper, fontSize: 32, area: 'gradient' },
};
```

Restyle with a `to` command, which tweens colours, sizes and weights and steps
everything else at the midpoint:

```ts
{ id: 'restyle', type: 'to', targetId: 'chart', at: 3, duration: 1,
  args: { style: CHART_STYLE_PRESETS.ember } }
```

Fields marked read-once below (`legend`, `showXAxis`, `showYAxis`, `values`,
`labelPlacement`, `spokeLabels`) shape which parts are built; a `to` of them
steps rather than tweens, and a document edit rebuilds the node.

## Rules worth knowing

- **The kit stays an import.** A copy of `line-chart` takes only `line-chart/*` and
  rewrites its kit imports to `@motionscript/charts` (`registry.json`): a second
  copy of `VerticalAxis` would render as nothing, with no error. The kit includes
  `kit/polar` and `PieLegend`, which the pie, radar and radial charts reach for, so
  a copy of any chart reaches only the kit.
- **Resting state is the finished chart.** `enter` arms every part on its first
  frame: every piece of a component command is built run to its end, and a beat
  ahead of the playhead writes nothing, so the first frame writes what each later
  beat moves from. `duration` is the whole entrance: a beat with nothing to do (no
  legend, no series) holds its share.
- **A part's command has no duration of its own.** The charts pass every part the
  duration and easing it moves with; called directly, a part's command takes the
  duration it is given, and a part's own frames ease out unless given an easing.
- **Some props are read once, at construction**: the series list (count, labels,
  `enabled`), `orientation`, `showCenter`, axis captions, the bar chart's category
  captions, the pie's and radial's label and legend-row counts, `labelMode`, `gap`,
  `centerLabel`, `centerCaption`, and the style fields `legend`, `showXAxis`,
  `showYAxis`, `values`, `labelPlacement`, `spokeLabels`. A `set` or `to` of them
  changes nothing; a document edit re-instantiates the node, which does refresh
  them. `data`, scales, ticks, every other style field, `region`, `stack`, `weights`
  and `pops` are live.
- **Non-finite cells plot as 0.** `num()` returns a cell only when it is a finite
  number, so a numeric string, `NaN`, `Infinity` and a missing cell all read 0.
- **`grid` is literal.** It names the lines drawn, not an axis: a horizontal bar
  chart that wants rules along its value axis sets `grid: 'vertical'`.
- **x units on the line chart.** `xAxis.range`, `xAxis.ticks` and a region's `x`
  are in the x scale's own units: the number (numeric column), UTC epoch
  milliseconds (time column) or the row index (ordinal column), chosen from the
  column by `resolveXScale` (dates via `parseInstant`).
- **`zoomTo` remembers the resting domain once** (`home`, a private entry its
  frames write) and `resetZoom`'s frames clear it, so the pair is order dependent
  and a seek back before a zoom forgets it again: a `resetZoom` with no earlier
  `zoomTo`, and a `zoomTo` naming neither axis, write nothing for their duration.
  A zoom keeps the tick count so each marker slides.
- **A `to` of an axis `range` or `ticks` tweens from the domain as drawn**
  (`lerpAxisEntry`): an auto side is held mid-move as an `AxisDomainBlend`, which
  the chart settles against its data, so a rescale from an auto axis is continuous.
  A restated range without ticks spreads explicit ticks across it; one side of an
  auto axis restated alone leaves the other to the data.
- **Pie angles** are radians clockwise from 12 o'clock. A radial's `startAngle` and
  `sweep` are degrees, `startAngle` clockwise from 12 o'clock.
- **Centre text needs a hole.** A pie shows `centerLabel` and `centerCaption` only
  with `style.innerRadius` above 0; a radial's hole is `style.innerRadius` too.

## Development

```bash
pnpm --filter @motionscript/charts build
pnpm --filter @motionscript/charts test
```

Tests sit beside the code (`*.test.ts`); `src/document.test.ts` runs the commands
through a compiled document, and `src/tests/harness.ts` supplies the attach, measure
and record helpers.

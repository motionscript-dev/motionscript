# @motionscript/charts

Animated data charts for [Motion Script](https://motionscript.dev): a line chart,
a bar chart and a pie chart, built from one shared kit (plot panel, value axis,
legend, number formatting, theme resolution). Written against
[`@motionscript/sdk`](https://github.com/motionscript-dev/motionscript/tree/main/packages/sdk), which it takes as a peer dependency.

```ts
import { NODES } from '@motionscript/charts';

export const nodes = NODES; // [LineChart, BarChart, PieChart]
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
| `@motionscript/charts` | `src/index.ts` | the three chart barrels, `src/engine.ts` and `NODES` |
| `@motionscript/charts/kit` | `src/engine.ts` | the shared kit (`src/kit/*`) and all of `@motionscript/sdk/component` |

Each chart folder (`line-chart/`, `bar-chart/`, `pie-chart/`) has an `index.ts`
barrel with the node, its parts, its theme (`DEFAULT_*_THEME`, `resolve*Theme`,
`lerp*Theme`) and its pure helpers (`resolveXScale`, `barSpans`, `pieArcs`, ...).
The charts and their parts (`ChartLine`, `ChartBars`, `PieRing`, `VerticalAxis`, ...)
are components (`component2d`); only the charts are registered node types, so a
document cannot name a part. A chart tells a host its key, entries and commands;
where it is shelved and the box it is seeded at are the host's to keep. `lineChartDomains` and `barChartDomain` give the axes as drawn, and
`isSliceSelected` whether a pie slice is out.

## Nodes

| Key | Made for (w x h) | Data props | Commands |
|---|---|---|---|
| `lineChart` | 760 x 460 | `data`, `xField`, `series`, `xAxis`, `yAxis`, `region` | `enter`, `spotlightRegion`, `clearRegion`, `zoomTo`, `resetZoom`, `showSeries`/`hideSeries`/`spotlightSeries` |
| `barChart` | 760 x 460 | `data`, `categoryField`, `series`, `valueAxis`, `stacked` | `enter`, `showSeries`/`hideSeries`/`spotlightSeries`, `spotlightCategory`, `clearCategory` |
| `pieChart` | 680 x 480 | `data`, `categoryField`, `valueField` | `enter`, `revealCenter`, `selectSlice`/`deselectSlice`/`selectOnlySlice`/`clearSelection` |

Every command takes the duration its row (or call) gives, and eases out unless
given an easing. Arguments: `seriesIndex`, `sliceIndex`, `categoryIndex` (each 0
when left out), and for `spotlightRegion` and `zoomTo` a `region` of
`{ x?: [min, max], y?: [min, max] }`.

## Rules worth knowing

- **The kit stays an import.** A copy of `line-chart` takes only `line-chart/*` and
  rewrites its kit imports to `@motionscript/charts` (`registry.json`): a second
  copy of `VerticalAxis` would render as nothing, with no error.
- **Resting state is the finished chart.** `enter` arms every part on its first
  frame: every piece of a component command is built run to its end, and a beat
  ahead of the playhead writes nothing, so the first frame writes what each later
  beat moves from. `duration` is the whole entrance: a beat with nothing to do (no
  legend, no series) holds its share.
- **A part's command has no duration of its own.** The charts pass every part the
  duration and easing it moves with; called directly, a part's command takes the
  duration it is given, and a part's own frames ease out unless given an easing.
- **Some props are read once, at construction**: the series list (count, labels,
  `enabled`), `showLegend`, `showValues`, `showCenter`, axis captions, text styles and
  paddings, the bar chart's category captions, the pie's label and legend-row counts,
  `labelMode`, `labelPlacement`, `gap`, `centerLabel`, `centerCaption`. A `set` or `to`
  of them changes nothing; a document edit re-instantiates the node, which does
  refresh them. `data`, scales, ticks, theme paints, `region`, `stacked`, `weights`
  and `pops` are live.
- **Non-finite cells plot as 0.** `num()` returns a cell only when it is a finite
  number, so a numeric string, `NaN`, `Infinity` and a missing cell all read 0.
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
- **Pie angles** are radians clockwise from 12 o'clock; `startAngle` is degrees.

## Development

```bash
pnpm --filter @motionscript/charts build
pnpm --filter @motionscript/charts test
```

Tests sit beside the code (`*.test.ts`); `src/document.test.ts` runs the commands
through a compiled document, and `src/tests/harness.ts` supplies the attach, measure
and record helpers.

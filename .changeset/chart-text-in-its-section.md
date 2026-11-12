---
"@motionscript/charts": patch
---

**Breaking:** a chart's text fields sit in the style group of the part they label, so a host draws each beside it rather than in one text section: axis text in a new `axes` group with `axisStroke`, `showXAxis` and `showYAxis` (which leave `grid`), `valueText` (and a pie's or radial's other labels) in `labels`, `legendText` in `legend`, a radar's `spokeText` in `grid`. The kit exports `CARTESIAN_AXES` and `VALUE_TEXT` in place of `CARTESIAN_TEXT` and `LEGEND_TEXT` (`CHART_LEGEND` now holds `legendText`), and the radar's `RADAR_TEXT` is folded into `RADAR_GRID`.

Migration: no stored document is affected; field names and values are unchanged. Code that spread `CARTESIAN_TEXT`, `LEGEND_TEXT` or `RADAR_TEXT` into a style spreads `CARTESIAN_AXES`, `VALUE_TEXT`, `CHART_LEGEND` or `RADAR_GRID` instead.

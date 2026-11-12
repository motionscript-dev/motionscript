---
"@motionscript/core": patch
"@motionscript/sdk": patch
"@motionscript/charts": patch
---

**Breaking:** every run of text a chart draws gets its own text style, the palette becomes `seriesFills`, and a chart has a background for the whole chart beside one for its grid.

- **`Types.typography(textStyle)`** (core, sdk): one text style as an entry (face, size, weight, style, spacing, paint). A partial is laid over the default or the value it replaces, so `{ fill }` recolours and keeps the rest; it tweens key by key. `describe()` reports `kind: "typography"` with its default.
- **Chart text** (charts): `foreground`, `muted`, `fontFamily`, `fontSize` and `fontWeight` are gone. Line and bar charts have `xLabelText`, `xTitleText`, `yLabelText`, `yTitleText`, `valueText` and `legendText`; a pie `labelText`, `valueText`, `centerText` and `legendText`; a radar `spokeText`; a radial `labelText` and `centerText`. Spacing that followed the one size now follows the text it sits beside.
- **Series fills**: `palette` is `seriesFills` (group `series`), each entry a fill that may stack paints.
- **Backgrounds**: `background` (group `background`) paints behind the whole chart on every chart; line, bar and radar charts add `gridBackground` for the plot (inside the web on a radar). A line or bar chart's old `background`, which painted the plot, is now `gridBackground`.
- **Bar corners**: `barRadius` is `barCornerRadius`, a `Types.cornerRadius` read as for a bar standing up (top pair at the far end, bottom pair at the base), with `barCornerStyle` (rounded or angled) beside it. `barWidth` reports itself as a percentage.
- Each chart's `migrate` hook (`migrateChartStyle`) carries a stored style across: the palette, the two inks and the shared type become the new fields as each chart derived them, a plot background becomes `gridBackground`, and a `barRadius` keeps rounding only the far end.

Migration: a stored document needs nothing done to it. Each chart's `migrate` hook converts its stored `style` (and a `to` command's) as the document opens: `palette` to `seriesFills`, `foreground`, `muted` and the font fields to the text fields as the chart derived them (titles 1.1× and a weight heavier, values as before), a line, bar or radar chart's `background` to `gridBackground`, and a number `barRadius` to `barCornerRadius` with only the top pair rounded. Code that sets these fields by hand, or a host that reads a chart's stored `style`, uses the new names; `migrateChartStyle(layout)` converts a style object the same way.

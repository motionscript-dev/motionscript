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

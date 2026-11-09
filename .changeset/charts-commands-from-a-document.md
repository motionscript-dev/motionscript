---
"@motionscript/charts": patch
"@motionscript/core": patch
"@motionscript/sdk": patch
---

Every chart command runs from a document.

- Thirteen of the twenty chart commands returned a composition of seekable parts rather than a `Command`, so a document naming one failed to compile with `TypeError: made.at is not a function`: `enter` on all three charts, `showSeries`, `hideSeries` and `spotlightSeries` on the line and bar charts, and `selectSlice`, `deselectSlice`, `selectOnlySlice` and `clearSelection` on the pie. So did `zoomTo` with a region naming neither axis, and `resetZoom` before any zoom. Each now returns a `Command` that lasts the duration it was given. A line or bar `enter` without a legend, whose beats end before that, holds its last frame for the rest of it.
- `@motionscript/sdk/component` gains `asCommand(part, duration?)`, which makes a composition built with `at`, `sequence`, `together`, `hold`, `compose` or `drive` the `Command` a `@command()` method returns. A part that ends before `duration` holds its last frame, and one that runs longer is played faster, so the command always ends where the part does.
- A line chart's first `zoomTo` from an auto axis tweens. It started from the unset range and ticks, which the axis tween steps at the midpoint, so the first zoom cut halfway through and only later ones moved. A zoom, and `resetZoom`, now start from the range and ticks the axis draws.

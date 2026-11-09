---
"@motionscript/charts": patch
"@motionscript/code": patch
"@motionscript/math": patch
"@motionscript/geography": patch
"@motionscript/audio": patch
---

Component kit fixes.

- Charts: a bar chart maps its columns across the plot panel as laid out (and takes the line chart's top headroom), so a column ends on its marker's grid line. A pie chart's wedges, labels and legend follow `data` and the palette once they are set. A restated value-axis or y/x-axis `range` or `ticks` in `to()` rescales continuously from the axis as drawn, instead of cutting at the midpoint. Without a legend (or without series) the entrance keeps that beat's share, so the call-out and legend land where the slot lays them out. A constant line series gets a scale with width, a `NaN` or infinite cell reads as 0, and tick captions gain decimals when the step is finer than 0.1.
- Code: the compiled highlighter is cached per style object, so two styles sharing a name no longer colour alike. A `CodeRanges` chain serialises as its ranges, so a stored `highlight` target selects what it did before it was saved.
- LaTeX: seeking from inside a morph to a time before it restores the source formula instead of leaving the last morph frame.
- Geo: custom border rings are wound for d3, so a GeoJSON counter-clockwise ring draws as the small region it encloses; a great-circle path between antipodal points runs over the north pole instead of wherever rounding lands.
- Audio: bottom-aligned waveform bars stand on the floor of the box instead of hanging from the top.
- `Code` and `Latex` take an optional props bag, so `new Registry({ nodes: NODES })` and `createBrowserEngine({ nodes: NODES })` type-check without a cast.

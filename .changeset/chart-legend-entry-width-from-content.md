---
"@motionscript/charts": patch
---

A chart legend's entries now open and close from their own width. A series that started hidden stayed zero-width for the whole `showSeries` move and snapped open at the end, and a `hideSeries` that was seeked to straight away (a scrub or an export) collapsed at zero width, while the same hide played from before shrank from the measured width. An entry's width is now measured from its caption and swatch at any reveal, so playing and seeking give the same frame, and a fully shown entry is laid out exactly as before.

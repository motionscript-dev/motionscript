---
"@motionscript/code": minor
---

`Code` can mark whole rows, beside dimming what is outside a range.

- `highlightRows` (`target`, `color`, `radius`) lays a band behind every line a range touches, across the block and under the text. A second call slides and resizes the band onto its new rows; several ranges give a band each, and one with no counterpart fades. A band is tied to its lines, so it moves with them through an `append`, `insert` or `remove`.
- `resetRowHighlight` fades the bands out.
- `drawCode` takes the bands as optional fields of its state (`rowBands`, `rowsEdit`, `boxW`), so a caller that draws a listing itself is unaffected.

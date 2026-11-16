---
"@motionscript/renderer": patch
---

- **Large, detailed paths scale smoothly.** A `scaleTo` on a map of tens of thousands of points keeps its outlines: one made only of lines is built once for every scale, a curved one built for a larger scale also serves smaller ones, and reaching a new power of two of scale builds only the bands the shader reads. In a 120k-point test map, CPU time per scaling frame went from 42 ms to under 1 ms.
- **Thin strokes keep their authored width** unless they run round the renderer's own rect or ellipse, or along horizontal and vertical lines only. Those still sit on whole device pixels; any other stroke glides while scaling, where it used to step between 1 and 2 px. A stroke thinner than a device pixel fades with its coverage, where it used to draw 1 px wide.
- When the geometry cache is full it evicts the least recently used outlines, where it used to drop everything and rebuild the frame.
- `stats()` reports `banded`, the band sets built in the last frame.

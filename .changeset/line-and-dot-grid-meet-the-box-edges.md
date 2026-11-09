---
"@motionscript/patterns": patch
---

`LineGridPattern` and `DotGridPattern` now put a line (or a dot column and row) on every edge of their box, whatever the number of cells. This changes how existing scenes with an odd `divisions × subdivisions` look: the lattice was centred on the box, so `divisions: 1` drew a single line through the middle and `divisions: 3` drew three lines with none on the edges, where a grid of `divisions: 4` has always drawn five. The lattice now starts at the near edge, and with an odd `divisions` and an even `subdivisions` (such as `3` and `2`) the major lines are the division lines, edges included, rather than the middle ones. A grid with an even `divisions`, and `GridPattern`'s world-anchored lattice, are drawn exactly as before.

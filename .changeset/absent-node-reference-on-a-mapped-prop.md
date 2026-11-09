---
"@motionscript/core": patch
---

A reference to a node that is not there yet no longer crashes a clip when the prop it feeds goes through a mapper.

`padding: "=[card.padding]"` (and `cornerRadius`, `cornerStyle`, `pivot`, `align`, a colour, and every other prop that resolves loose input) on a node reading a card that enters later made the build throw `Cannot read properties of undefined` at time 0, because the absent node's `undefined` was handed to the prop's mapper. The prop now holds what a node built without it holds, its default, until the card is in the tree, and follows the card while it is. A prop with no mapper still reads `undefined`, as before. `Canvas3D`'s colour props (`ambientColor`, `keyColor` and the grid colours) were left `undefined` in that case and now take their default colour.

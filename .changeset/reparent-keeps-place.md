---
"@motionscript/core": patch
"@motionscript/sdk": patch
"@motionscript/react": patch
---

A host can keep a node looking exactly as it does when it moves it to another parent, as a design tool does. `reparentPlacementAt(root, path, parentPath, offsets)` (the player's `reparentPlacement`) carries `x`/`y` values the node takes under its parent now, its own and its moves' destinations, to the ones that put its centre at the same place under the new parent, and gives the turn to add to its rotation and the factor to scale it by so the two parents' own turn and scale, cameras included, are undone. It works through a freeform parent's padding and alignment and a parent's own coordinates, and answers `null` for a parent that arranges its children in a run or a grid. `flowOps.freeSlot` says where a freeform arrangement puts one more item.

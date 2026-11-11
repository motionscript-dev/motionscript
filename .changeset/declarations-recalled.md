---
"@motionscript/core": patch
---

Editing a node whose own commands animate what its asset declaration reads no longer re-runs that declaration on every frame the commands cover. A sweep after an edit takes back what an owner declared on a frame when every slot it read there holds what it held, so moving a 3D component with a build-in command costs about 10 ms per edit instead of re-running its whole `render` a few hundred times (about 215 ms for a 19-tile board). A declaration that read anything else runs again as before.

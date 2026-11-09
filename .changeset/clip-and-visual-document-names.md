---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/browser": minor
"@motionscript/react": minor
---

**Breaking:** the engine no longer has a "scene" in its document API. Its unit is a clip document on a project track, so the names that said "scene" now say what the thing is. The old names stay exported as deprecated aliases until 1.0, so code written against them still builds; move to the names below.

| Before | After |
|---|---|
| `SceneDocument` (`StillDocument \| CompositionDocument`) | `VisualDocument` |
| `SceneTimeline` | `ClipTimeline` |
| `SceneEffect` (the union of effects a node can carry) | `NodeEffect` |
| `integrateSpeedToSceneTime` | `integrateSpeedToClipTime` |
| `sourceTimeAtSceneElapsed` | `sourceTimeAtClipElapsed` |
| `Sound.sceneDurationFor` | `Sound.clipDurationFor` |
| `AudioSink.syncTo(sceneTime)` (parameter name) | `AudioSink.syncTo(clipTime)` |

`ClipDocument` is now `VisualDocument | AudioDocument`, as before. The document types, the 3D `Scene3D` and its `scene3d` settings are unchanged: that is a 3D scene, not this.

Two messages changed with the names: `assertValidDocument` now throws `Invalid clip document:` (was `Invalid scene document:`), and the JSX runtime's error for a value that is not a node class reads `JSX element must be a Node class`.

The built-in `Canvas2D`, `Provider` and `ThemeProvider` moved from `nodes/scene/` to `nodes/root/` inside core. That directory was never an export path, so no import from the package changes.

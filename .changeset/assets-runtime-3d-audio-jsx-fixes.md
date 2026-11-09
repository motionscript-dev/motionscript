---
"@motionscript/core": patch
"@motionscript/browser": patch
---

Fixes across 3D, audio, asset loading, the session and the JSX runtime.

- A string shader or post-effect uniform is a texture only when it looks like an asset path. A colour uniform such as `uTint: 'tomato'` made declaring the scene's assets throw `Image asset not found`.
- `lookAt`, a camera's `target` and a light's `target` tween with `to()`. They had no tween, so a `to` moved the other props and left these where they started. An unset `target` tweens from the origin; an unset `lookAt` holds until the end, since "do not aim" has no midpoint.
- A `Canvas3D` with no 3D children records an empty scene instead of a default camera and rig, so a viewport holding only 2D children skips the 3D pass and no longer creates a WebGL context.
- A looping `Sound` repeats its trimmed region. `AudioRequest` carries the loop's `trimEnd`, a loop with a `trimEnd` and no cut runs open instead of playing once, and the live device and the offline mix set `loopStart` and `loopEnd` to the region (a seek into the middle of a loop is folded into it too), so the trim no longer wraps the whole buffer.
- An audio curve's ease is part of its key. Every engine easing is an anonymous closure, so editing only an ease left the request unchanged and the device kept playing the old sound. Easings record a description, and the same ease built twice keys the same.
- A failed audio fetch is caught, reported once, and not started again on every sync, instead of being an unhandled rejection. A layout-gated loader is no longer disposed and loaded again when the frame leaves its window.
- `AssetNotLoadedError` names `assets.video(...)` for a video, `assets.loader(...)` for a loader and `declareAudio()` for audio.
- `Engine.setManifest` reaches a live session's controller: a font or image added after open is known to clips already built, and tracks that failed for want of it are built again. `session.replace` keeps the `fps` and `viewport` the session was opened with instead of throwing on the document it is already playing.
- The JSX automatic runtime keeps `key`: `<Rect key="card" />` lowers to `jsx(Rect, {}, "card")`, and `jsx` now takes the third argument.

---
"@motionscript/core": minor
"@motionscript/browser": minor
"@motionscript/headless": minor
"@motionscript/react": minor
---

One frame/time conversion and one `FrameSpec`, and fixes to browser playback and export.

- Core exports `clipFrameToTime`, `clipTimeToFrame`, `frameSpecAtTime`, `FrameSpec` and `DEFAULT_OUTPUT`. The conversion is tolerant of float error: a time within a few ulps of a whole frame is that frame. The playback controller, `Session.seek`, track placement and the evaluator all use it. Before, `currentFrame` read one frame early for 2 to 6 percent of frames (frame 123 at 60 fps), so a document swap after `seek(123)` repainted frame 122, and `trackFrameCount` gained a frame when a length on a boundary landed an ulp high (4.15 s at 60 fps counted 250, not 249).
- `FrameSpec` is declared once, in core, and re-exported by `@motionscript/browser` and `@motionscript/headless`; the browser's `DEFAULT_OUTPUT` and the React hook's fallback are core's defaults. The React playhead reads the frame the clock reports through the same conversion.
- `WebTicker` no longer stalls a looping host: the end of a run is read again after listeners and tick callbacks have run, a final tick always fires, and a finished run pauses itself. `play` is synchronous, as `Ticker.play` is typed, so a `pause` or `seek` in the same turn works; a rejected `AudioContext.resume()` pauses and logs.
- A supersampled export draws into a canvas that is a whole multiple of the output, so an odd-sized viewport is no longer stretched by about 1 percent.
- `StillRenderer.toBytes`, `toBlob` and `toDataURL` throw before any frame has been drawn onto the surface, instead of encoding blank pixels.

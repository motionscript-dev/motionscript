---
"@motionscript/browser": patch
---

Stills and exports render the frame, theme and scale they were asked for.

- Overlapping `session.image()` calls each return their own frame. They shared one renderer, so every image held the last frame drawn; the engine's exporter now queues them.
- `exportVideo` applies the document's `theme`, and takes a `theme` option for a document that carries none, as `exportScreenshot` and `StillRenderer` do. A themed document exported on its own drew its tokens black, or in whatever theme was last set globally. `renderTimeline` and `drawFrameAt` take the same `theme` and apply it themselves.
- `RenderStillOptions.scale`, and so `session.image({ scale })`, applies to that call only. It used to become the renderer's scale, so the next call without one drew at it too.
- An export rejects with `NothingToDrawError` at the first frame whose every track failed to build, the same error a still of that frame throws. It used to encode a black video and log nothing. The error is exported from both packages and carries the `frame` and each track's failure. A track that built is drawable even when one of its nodes failed to declare its assets or audio; a still used to refuse it.

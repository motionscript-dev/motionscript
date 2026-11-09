---
---

A scene with more than about 128 text labels no longer re-shapes every label on every frame.

- The shaped-text cache was a 256-entry LRU, and each label takes two entries (one to measure it, one to draw it). Past 128 labels, a frame asked for more runs than the cache held, in the same order every time, so each entry was evicted just before it was needed again and nothing hit: 200 animated labels rendered at about 9 fps at 1080p, three quarters of each frame spent in paragraph layout. `ParagraphShapeCache` now treats its limit as a soft size. An entry the current or previous render pass used is never evicted for it, so the cache grows to hold what a frame needs and shrinks back once later passes stop using an entry; the same 200 labels render at about 60 fps.
- `ParagraphShapeCache.endPass()` marks the end of a render pass, and `SkiaRenderContext` calls it after each one. A second constructor argument, `ceiling` (default 16,384), bounds the cache for a consumer that measures text without ever ending a pass.

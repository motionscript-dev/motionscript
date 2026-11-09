---
"@motionscript/browser": patch
"@motionscript/core": patch
"@motionscript/headless": patch
---

A still, a screenshot or an export refuses a font family the manifest does not describe.

- A text node naming a family with no manifest entry was shaped against the fallback face, with a console warning, and the frame was returned as if it were the document's. Described later, the same document draws differently, so a frame stored or encoded in the meantime was the wrong one. `StorageAdapter` now throws `AssetNotLoadedError` (`assetType: "font"`, `src` the family) for it when its `DecodePolicy` is `"exact"`, which every still, screenshot and export sets while it draws. Nothing is remembered of the refusal, so a renderer handed a manifest that describes the family loads it on the next render.
- A preview is unchanged: an undescribed family draws in the fallback face, with the warning, until a manifest describes it. The warning is no longer printed for a still or an export, which now fail instead.
- A text node that names no family at all is refused by `requireFontFamily`, as before.
- `renderImage` and `renderVideo` in `@motionscript/headless` reject with the page's error for such a document, where they used to return a frame with no text in it.

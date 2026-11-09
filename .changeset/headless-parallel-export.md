---
"@motionscript/headless": patch
"@motionscript/browser": patch
"@motionscript/core": patch
---

The headless engine can export a video across several pages at once, and an export can render a range of frames.

- `@motionscript/headless`: `renderVideo({ concurrency })` cuts the timeline into that many contiguous runs of frames, renders and encodes each in a page of its own (one Chromium, one bundle), and joins them with `concatVideoSegments` without re-encoding. Every segment gets the same codec, bitrate and hardware acceleration and begins on a key frame; the audio is mixed once over the whole timeline with `mixTimelineAudio`. The default of 1 exports in one page as before. The added pages stay open for the next export. Segments that still cannot be joined fall back to a one-page export, with the reason on stderr.
- `@motionscript/headless`: `renderVideo` also takes `supersample`, `codec`, `bitrate`, `hardwareAcceleration` and `includeAudio`, which reach the browser exporter, and `parseConcurrency` is exported beside the other option parsers. The page bridge has `countFrames()` and `concatSegments()`, and a bundle without them is `BRIDGE_INCOMPATIBLE`.
- `@motionscript/headless`: `renderVideo` sends the document into the page as its JSON text (a caller may pass the text itself), because Playwright carries a 5000-node object in about 1.4 s and its text in about 0.2 s. The page exports through `exportVideo` without opening a session, whose controller discovered every track on frame 0 only for the exporter to discover them again.
- `@motionscript/core`: `ExportVideoRequest` (so `session.export`) takes `frames: { start, end }`, a `FrameRange` with `end` excluded.
- `@motionscript/skia-render` and `@motionscript/browser`: `renderTimeline` and `exportVideo` take `frames` too. A range renders those frames alone, timestamped from 0, discovers only the tracks they touch, and is always silent: it is one segment of a split export. A range that is empty or leaves the timeline throws a `RangeError` before anything is encoded.

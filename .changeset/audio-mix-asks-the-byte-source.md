---
"@motionscript/browser": patch
---

An export's audio mix asks the host's byte source before the network.

`mixAudio`, and so `exportVideo` and `mixTimelineAudio`, fetched every audio source from the network, while previews, stills and the rest of an export read bytes through `setAssetByteSource` first. A host holding a recording locally (one not yet uploaded, or with no network) exported silence or failed where the preview played. The source is now asked with the address the catalog resolves, as `WebStorageAdapter` does, and a `null` falls through to `fetch` as before.

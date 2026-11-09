---
"@motionscript/browser": patch
---

A failed asset fetch fails instead of loading empty bytes. `WebStorageAdapter` read a response's body whatever its status, so a 404 for a font file reached the font manager, which registered nothing, and the family still counted as loaded: its text drew nothing, on every frame, and nothing reported it. A missing image or audio file failed later, in a decoder, with a message that never named the address. A response that is not OK now rejects the load with `Fetching "<url>" failed: HTTP <status>`, which reaches the host the way any failed load does: a seek, a still or an export rejects, and a prefetch logs it. Nothing is cached, so the next load tries again.

- A font family registers once every one of its files has arrived, so a family missing a weight is not registered half-way and a retry does not register the rest a second time.
- `mixAudio`, which mixes every export's soundtrack, checks the status the same way.
- A render through `@motionscript/headless` of a document whose font is missing from `assetsDir` now fails naming the file, instead of drawing its text empty.

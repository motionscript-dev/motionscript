---
"@motionscript/browser": patch
"@motionscript/core": patch
---

A `Video` whose file holds no audio track is a silent video, not a failed load.

- A `Video` declares its own sound for the same `src` as its picture. For a file with no audio track (a screen recording, say) the decode fails, and the asset manager reported `audio "…" could not be loaded: Unable to decode audio data`, which a host shows as its preview having stopped, and `mixAudio` rejected, which fails an export.
- `AudioClip` and `AudioRequest` take `optional`, and `Video` declares its clips so. A source only optional requests want is silence when it cannot be fetched or decoded: the manager says nothing and `mixAudio` leaves those requests out and renders the rest.
- A `sound` that names such a file is still a failure, reported once and rejecting the mix, because there the sound is the whole of what was asked for. That includes a request that starts wanting a source that had already failed quietly.
- A source that failed quietly is kept across a document swap instead of being fetched whole again on every edit; one that was reported is still tried afresh.
- `optional` is not part of a request's id.

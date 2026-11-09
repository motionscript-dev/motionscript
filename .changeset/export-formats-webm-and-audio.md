---
"@motionscript/browser": minor
---

Export to WebM, and audio alone to WAV, MP3 or M4A.

- `exportVideo({ format: 'webm' })` writes VP9 video and Opus audio (resampled to 48 kHz) into a WebM. `'mp4'` stays the default. A `video.codec` the container cannot hold, such as `'avc'` in a WebM, falls back to the format's default with a warning, as an unavailable encoder already did. `'vp8'` is accepted.
- `exportAudio({ document, format })` mixes the timeline's audio and encodes it alone, without rendering a frame: `'wav'` (16-bit PCM, the default), `'mp3'` (a WASM build of LAME, loaded on first use from a `blob:` worker) or `'m4a'` (AAC). A timeline with nothing playing throws `NoAudioError` rather than writing a silent file.
- `session.export({ encode: { format } })` takes any of the five formats and routes an audio one to `exportAudio`.
- `concatVideoSegments` joins WebM segments into a WebM, with one Opus track over the joined timeline, and refuses segments in different containers with `ConcatMismatchError`.
- `EXPORT_FORMATS` names each format's kind (`'video'` or `'audio'`), file extension and MIME type, for a host naming and saving the file.

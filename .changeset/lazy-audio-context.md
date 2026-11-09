---
"@motionscript/browser": patch
---

Opening a session no longer creates an `AudioContext`. `WebAudioSink` creates its context on first use (the first play, or the first sound to decode), and `WebTicker` accepts a getter for its context, called on the first `play`. A new AudioContext opens the audio device, 50–65 ms on a desktop, which every project open paid before anything played.

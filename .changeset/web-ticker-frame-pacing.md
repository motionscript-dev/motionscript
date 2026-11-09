---
"@motionscript/browser": patch
---

`WebTicker` no longer drops frames during playback. The audio clock moves in bursts (8 to 21 ms per animation frame at 48 kHz on a 60 Hz display), and the playhead read straight off it skipped up to a third of the frames: the playhead now steps by animation-frame time, pulled toward the audio clock every frame, and listeners hear each project frame.

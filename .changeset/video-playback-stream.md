---
"@motionscript/renderer": patch
"@motionscript/core": patch
---

Video fills play. While playing, the renderer decoded no video frames at all, so a video showed the frame it was paused on (or nothing) for the whole play; pausing then decoded every frame the play had asked for at once, each with a decoder of its own starting from the previous key frame, which could freeze the page. Each video is now read off one forward decode stream: consecutive frames cost one decode each (a 720p clip with a key frame every five seconds exports about 3.5 times faster), a step back or a jump past a key frame opens a new stream there, and while playing a few frames ahead of the playhead stay decoded. Pausing settles the frame left on screen.

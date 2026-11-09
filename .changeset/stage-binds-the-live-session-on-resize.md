---
"@motionscript/react": patch
---

`MotionStage` no longer throws `Cannot read properties of undefined (reading 'MakeWebGLCanvasSurface')` by mounting its canvas on a session its player has already disposed. Two paths led there:

- A viewport change. The player's size moved a commit before its new session arrived, in the commit that disposed the old one, so the stage resized its canvas and mounted it on the disposed session. The canvas is now sized from the session's own viewport.
- A replayed effect: a Suspense boundary revealed again after something beside the player suspended, or StrictMode's dev replay, re-runs the stage's effects with the session it last rendered, after the player's cleanup disposed it. The stage now skips a session its player disposed.

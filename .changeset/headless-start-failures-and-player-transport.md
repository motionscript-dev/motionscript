---
"@motionscript/headless": patch
"@motionscript/react": patch
---

Start-up failures in the headless engine are reported and cleaned up, and the React player's transport keeps the clock and its state in step.

- `@motionscript/headless`: a project entry that throws while it loads now rejects `start()` at once with `START_FAILED` and the cause, instead of waiting 60 seconds for `BRIDGE_TIMEOUT`. The page entry imports the project dynamically, so the throw is a rejection the entry already handles.
- `@motionscript/headless`: a `start()` that fails closes the Chromium it launched, so a retry no longer leaks the first browser, and a `close()` that lands while the engine is booting ends the boot with `CLOSED` instead of letting it finish on a closed engine.
- `@motionscript/react`: `seek()` then `play()` in one batch while already playing left the clock paused with `isPlaying` still `true`. `play()` and `pause()` now drive the controller as well as the state.
- `@motionscript/react`: a session rebuild while playing (a different engine, viewport size or fps) used to park the new session with a seek that paused it. A player that was playing now resumes once the park has landed, unless a newer seek or a pause came first. The README and CLAUDE.md say which changes rebuild the session.

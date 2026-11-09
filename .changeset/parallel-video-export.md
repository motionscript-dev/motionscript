---
"@motionscript/browser": minor
---

`exportVideoParallel` renders one export across several renderers and joins it into one file without re-encoding. Lanes are `localLane()` (this page) and `messagePortLane(port)` (another window or process, answered by `serveExportLane`). Each lane renders key-frame-aligned frame ranges of the whole project, so layered timelines split too; the run starts on one lane and adds the next only while that raises throughput, mixes the audio once while frames render, streams each range as soon as it can be joined, and reports progress by frames drawn. `createSegmentJoiner` joins segments incrementally, and `concatVideoSegments` now runs on it.

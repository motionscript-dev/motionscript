---
"@motionscript/core": minor
"@motionscript/react": minor
---

A host can ask what a node holds before any command has acted on it.

- `PlaybackController.getNodeInitialProps(nodeId)`, and the React player's method of the same name, return a document node's props as it arrived (or as built, for one that has not arrived yet). The answer is the same at every frame and is given while the node is off screen, where `getNodeState`/`getNodeProps` describe the node at the frame showing.
- `ClipTimeline.baselineProps(id)` is the read underneath it. A bound prop is read through its binding.

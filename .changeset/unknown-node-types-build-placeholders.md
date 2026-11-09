---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/headless": minor
---

**Breaking:** a node type the engine does not know no longer fails its whole track. The row builds as an empty placeholder that keeps its id, its placement and its children and draws nothing itself; every command aimed at it, and any command its target's type does not publish, is skipped. The rest of the clip builds and plays.

- Each is still reported in `buildErrors`, now with a `code`: `"unknown-node-type"` with the row's `nodeId`, or `"unknown-command"` with its `commandId`. The track does not count as failed, so a headless render of a document naming an unregistered type draws everything else instead of rejecting.
- `missingNodeOf(node)` tells a host a live node is a placeholder, and which type and props its row authored.
- `new Registry({ strict: true })`, or `strict: true` on an engine, fails the build as before. `Registry.instantiate` still throws for an unknown type.

Migration: a host that relied on the failure to notice a missing type reads `buildErrors` for those codes, validates with `validateDocument(doc, { registry })`, or opens with `strict: true`. Stored documents need no change.

---
"@motionscript/core": patch
"@motionscript/charts": patch
---

Fixes in document validation, the clip timeline and the expression language.

- `validateDocument` reports tree and command issues at the row's place in the document. A malformed row earlier in `nodes` or `commands` used to shift every later path by one.
- The parts a command writes on a node's own children (a chart's ring, legend or bars) are restored to what they were built with before the command starts and after a seek back, so a frame no longer depends on how the playhead arrived. The chart legend's per-series reveal is now one slot, so the timeline can restore it.
- A child that enters before its parent is baselined once the parent has mounted it, so it keeps what it inherits (a text style, for example) instead of the pre-attach values.
- A row that an animated `removeChildAt` takes out of its parent is back in place before the command starts, in a fresh build and after a scrub alike.
- An unknown `targetId` is one error naming it for every node-scoped command (`to`, `set`, `save`, `moveTo`, component commands). Global-table commands used to be skipped silently, and named ones blamed the node type.
- Instant `removeChildAt` detaches the removed subtree, as `remove()` and `clear()` do.
- Expressions: `toString`, `constructor`, `__proto__` and the other `Object.prototype` names are unknown functions and constants rather than a `TypeError`, in the shared parser and the plot kit (and `alignmentOps.resolve` rejects them as `isKey` does). A blank string operand is `NaN`, not `0`. `step` and `smoothstep` propagate `NaN`, and `smoothstep` with equal edges is a step at the edge. Arity errors say "1 argument". `renameRefs` hands its callback the trimmed reference name.

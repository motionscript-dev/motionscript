---
"@motionscript/core": minor
"@motionscript/charts": minor
---

`text`, `number`, `richtext`, `lineChart`, `barChart` and `pieChart` are leaves: they declare `allowedChildren: []`, so a child added to one throws ("It takes no children."), whether through `add`, a `children` prop or a document row whose `parentId` names it. Text never laid a child out or drew one, so a document that nested a node under it drew it nowhere; it now fails to build. A chart used to splice its `children` prop in beside its axes and plot; it no longer takes one. `describe` reports `holds: []` and `parentIssue` a `leaf` issue for a host that wants to offer the type only where it works.

A component with a `children` builder keeps building its own parts under `allowedChildren: []`: the rule applies to the `children` an author passes in, and those are now checked before the builder runs.

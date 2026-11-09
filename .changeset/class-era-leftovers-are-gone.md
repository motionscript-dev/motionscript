---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/charts": minor
---

What was left of the class authoring system is gone. Each piece existed to write or extend a node class, and a node type is a component now; no built-in, kit or host used them.

Removed from `@motionscript/core`:

- the registration functions `property`, `node`, `command` and `withdraw`, and the thirteen typed property helpers (`fillProperty`, `strokeProperty`, `shadowProperty`, `effectsProperty`, `colorProperty`, `cornerRadiusProperty`, `cornerStyleProperty`, `pathProperty`, `insetsProperty`, `alignmentProperty`, `vector2Property`, `sizeProperty`, `textProperty`) with their `AttributePropOptions` type. A component declares its entries with `Types`. `getPropertyMeta`, `getNodeDescriptor`, `getCommandMeta` and the metadata types stay;
- `TextSelection`, `TextSelectionHost`, `TextSelectionProps`, `TextRange`, `SelectionOverrides` and `normalizeRanges`: the component `Text` has no selection API, so nothing could make one. Style a range with `runs`;
- `AudioScope` and the `declareAudio` hook on `Node`: sound plays from commands (`timeline.sound`). `busPathOf` and `busPathTo` take a function answering a node's span instead of an `AudioScope`;
- the `Node.tick` hook and the `Node2D` hooks `beforeRender`, `afterRender`, `renderStroke`, `clipPathSelf`, `resolveSizeInput` and `constraints`, which only a subclass could reach;
- `NodeTypeRecord.withdrawn` and `CommandMeta.withdrawn`. `PropertyMeta.withdrawn` stays, deprecated: nothing sets it.

Removed from `@motionscript/core/component`, and so from `@motionscript/sdk/component` and `@motionscript/charts/kit`, which re-export it: the seekable composition `at`, `hold`, `sequence` and `together`, with the `Seekable` and `Placed` types. A component command returns timeline pieces.

Removed from `@motionscript/sdk`: `TextSelection`, `TextSelectionProps`, `TextRange`, `SelectionOverrides`, `AudioScope` and `AudioClip`.

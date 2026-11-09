---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/audio": minor
"@motionscript/charts": minor
"@motionscript/code": minor
"@motionscript/geography": minor
"@motionscript/grids": minor
"@motionscript/math": minor
"@motionscript/patterns": minor
---

Node types are components: one spec object handed to `component2d`, `component3d` or `componentAudio`, with no classes, decorators or JSX.

- **Writing a node type.** A component is one object literal: `key`, `state` (literals and `Types`), `defaults`, `commands`, `children`, `allowedChildren`/`allowedParents`, `provide`, `load`, and its tree's own fields (`measure`, `layout`, `render` for 2D). Behaviour comes from modules you spread in and call: `Paint`, `Flow`, `Shapes`, `Typeface`, `TextLayout`, `Aim`, `Material`, `View3D`. ADR 0007 and the custom-node docs cover it.
- **Building nodes in code** uses calls: `Rect({ fill: 'tomato', children: [Text({ text: 'Hi' })] })`, or `new Rect({...})` for the node itself.
- **Every built-in and every kit node is a component**, under the same document key. Code that tested `instanceof` a class now uses the component's `.is`, or `instanceof X.node`. Changed members:
  - `SurfacePlot3d.valueAt` and `FunctionPlot.valueAt` are now the functions `surfaceValueAt` and `curveValue`.
  - A system's `coordinates` is replaced by `planeMap`/`axesMap`/`systemMap`.
  - `PieChart.isSelected` is replaced by `isSliceSelected`.
  - `ItemGrid` is a kit module (`ItemGrid.isGrid`, `ItemGrid.define`), not a base class.
- **The sdk no longer exports the class surface:**
  - the decorators: `node`, `property` and every `*Property`, `command`, `withdraw`, `driveCommand`;
  - the authoring bases: `PaintNode`, `ShapeNode`, `TextBase`, `Mesh3DBase`, `Canvas3DBase` and the `*Base` geometry classes;
  - `asCommand`, `compose`, `drive` and `declarePaints` from `@motionscript/sdk/component`;
  - the `jsx-runtime` and `jsx-dev-runtime` subpaths.
  - `Node`, `Node2D`, `Node3D` and `NodeAudio` remain as types.
- **Editor metadata leaves the engine.** The kits no longer declare `parentKey`, `forkable`, `layout`, `seed`, `within`, `beside` or `closed`; a host keeps those in its own configs. `describe()` now reports `holds`, the trees a type takes children from, and the placement checks use it, so a 2D viewport of your own that takes 3D children places them.
- A command called from code with no argument runs, and a refused child is told what its parent takes (`allowedChildren`) or where it goes (`allowedParents`).

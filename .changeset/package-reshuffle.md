---
"@motionscript/grids": minor
"@motionscript/geography": minor
"@motionscript/patterns": minor
"@motionscript/core": minor
"@motionscript/sdk": minor
---

Package reshuffle.

- `@motionscript/layout-grid` is now `@motionscript/grids` (`@motionscript/grids/kit`, and `packages/components/grids`), and its `LayoutGrid` base class is `ItemGrid` (`ItemGridProps`, `ITEM_GRID_TYPES`). `RectangularGrid`, `RadialGrid`, `PathGrid` and `SphereGrid` keep their names and document keys. Update the dependency, the imports, and any `@motionscript/layout-grid/kit` specifier a copied component carries.
- `@motionscript/geo-data` is now `@motionscript/geography`. The data format on disk (`data/v1/…`) is unchanged, so `@motionscript/geo` reads it as before and a host that serves `@motionscript/geo-data/data` serves `@motionscript/geography/data` the same way.
- `@motionscript/ui` is removed: its `Switch`, `Button`, `Window` and `Cursor` nodes, and the `ControlNode` base class, no longer ship. They are plain nodes over `@motionscript/sdk`, so a project that needs one writes its own and shapes it to taste.
- `@motionscript/patterns` is new. It holds the pattern nodes (`LineGridPattern`, `DotGridPattern`, `GridPattern`, `ViewportPattern`) that `@motionscript/core` and `@motionscript/sdk` no longer ship.

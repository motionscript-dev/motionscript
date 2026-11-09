---
"@motionscript/core": minor
---

Core no longer ships its JSX runtime: its `./jsx/jsx-runtime` and `./jsx/jsx-dev-runtime` subpaths are gone, and so are the `jsx`, `jsxs`, `Fragment` and `JSX` the root barrel re-exported. Build a tree with calls (`Rect({ children: [Text({ text: "hi" })] })`), as a component does. Nothing in the engine uses decorator syntax any more either, so no consumer needs `experimentalDecorators` on core's account.

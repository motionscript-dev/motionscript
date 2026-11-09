---
"@motionscript/react": patch
---

`react` and `react-dom` peer on `^18.2.0 || ^19.0.0`, where they asked for `^19.2.3`. The package uses only hooks React 18 already has (`useSyncExternalStore` among them), so a React 18 app installs it without a peer warning.

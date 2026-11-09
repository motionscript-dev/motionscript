---
"@motionscript/react": minor
---

`useEngine` builds an engine, hands it over when it is ready and disposes it when it is not wanted.

Every React host was writing the same effect: hold the engine in state, build it asynchronously, dispose it if the component unmounted while the wasm was loading (StrictMode does this on every mount in development) and again on cleanup. `useEngine(create, { deps, onError })` is that effect. It returns `null` until the engine arrives, which `useMotionPlayer` already accepts.

```tsx
const engine = useEngine(() => createBrowserEngine({ wasmUrl: '/canvaskit.wasm' }));
const player = useMotionPlayer({ engine, document: scene });
```

The package still imports no platform: what to build is the factory you pass, so it works with `createBrowserEngine`, a headless engine or a test double. `deps` rebuilds the engine when something that makes a different one changes (the node types, say), disposing the old one first; the factory itself is read through a ref, so an inline arrow does not rebuild anything. `onError` replaces the default `console.error` when the factory rejects or throws. Anything that must hold before a player sees the engine, such as `setManifest`, goes in the factory.

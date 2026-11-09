---
"@motionscript/browser": patch
---

3D renders its settings from the first frame, and installs itself without relying on module side effects.

- The first 3D frame of a session, and the first after an `antialias` change, drew without the scene's tone mapping, shadows or `studio` environment, because they were written before the renderer existed. The renderer is now made before a scene syncs, so the same scene gives the same pixels on every frame. `Canvas3DRendererHost` gains `prepare(three, { antialias })`, which the backend calls first, and a scene's settings go to the host its backend was built with rather than whichever one is registered.
- After an `antialias` change, a `studio` environment kept a texture from the replaced renderer and metal drew dark on every later frame. The environment is now generated per renderer.
- `@motionscript/browser` registered 3D when its root module was evaluated, while declaring `sideEffects: false`. A bundler honouring the flag, such as rolldown under Vite 8, could drop both calls, and `Canvas3D` then drew its 2D parts only, with no error. Every `WebRenderContext` now installs the WebGL renderer and core's three loader when it is built, so each engine session, still renderer and export carries 3D with it, and importing the package registers nothing.

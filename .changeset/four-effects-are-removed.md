---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

The `texture`, `displace`, `godRays` and `trails` effects are removed.

- `Effects.texture`, `Effects.displace`, `Effects.godRays` and `Effects.trails` are gone, and so are the same four on `Adjustments` (`godRays`, `texture`, `displace`) and their option and effect types: `TextureOptions`, `TextureEffect`, `DisplaceOptions`, `DisplaceEffect`, `DisplaceChannel`, `GodRaysOptions`, `GodRaysEffect`, `TrailsOptions`, `TrailsEffect`.
- A document that still holds one of these effects builds, and the effect draws nothing: the renderer has no handler for the type and skips it.
- `trails` also leaves the list of effects a media fill cannot carry. `motionBlur` is unchanged.
- No effect declares an image any more, so `EffectData.declare` has no implementation in the library.

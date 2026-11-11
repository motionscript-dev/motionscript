---
"@motionscript/core": patch
"@motionscript/sdk": patch
"@motionscript/browser": patch
"@motionscript/headless": patch
---

**Breaking:** the deprecated shims and dead exports are gone. Core drops the `SceneDocument`, `SceneEffect`, `SceneTimeline`, `integrateSpeedToSceneTime` and `sourceTimeAtSceneElapsed` aliases, `Sound.sceneDurationFor`, the `Precomp*` aliases of the asset-timeline names, `ImageFilters` and `VideoFilters` (use `Adjustments` and `VideoAdjustments`), `PropertyMeta.withdrawn`, `AssetTimelineOptions.lifespans`, and the unused `opacity` and `blend` of per-shape descriptors (`ShapeState`). The `filters` prop of image and video fills is removed too: write the grade as `preset: { adjustments }`. Documents move to format 3, and opening one that carries `filters` on a media fill moves it into `preset.adjustments`. Also removed as unused: `sampleParam`, `IDENTITY_AFFINE3`, `neutralPreset`, `resolveMediaPreset`'s second argument, `paramAtDistance`, `arcPointFunction`, `segmentChord`, `isStyleOnlySegment`, `withTransformDescriptor`, `easeKey`, `isParentNode`, `AudioParams`, `ResolvedSoundProps`, `StarProps`, `RotatedBoxProps`, `ModelView3DProps` and `NumberNodeFormat`. In headless, `Semaphore`, `withDeadline`, `toRenderError` and `cleanPageErrorMessage` were internal and are deleted.

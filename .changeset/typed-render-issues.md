---
"@motionscript/core": patch
"@motionscript/browser": patch
"@motionscript/headless": patch
---

Render issues are typed, and exports report them.

- `takeRenderIssues()` returns `RenderIssue`s (`kind`: `missing`, `shader`, `params`, `gpu`, `device-lost` or `crashed`, with `feature`, `nodeId` and `message`); a bare string still reads as a `shader` issue. The playback controller records them in `buildErrors` with `issue` set, once per kind, feature and node.
- Exports and stills hand them to a new `onIssue` callback (`exportVideo`, `exportVideoParallel`, `session.export`, `session.image`, `StillRenderer.render`), since they never read `buildErrors`. A `device-lost` or `crashed` issue fails the render with `RenderBackendError` instead (`retryable` for a lost device), rather than encoding frames drawn on a dead GPU.
- The headless page logs every issue as a `[render issue]` warning, which `onPageMessage` receives.

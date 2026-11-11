// @motionscript/headless: render Motion Script projects from Node by driving the **browser** engine in a headless page,
// so a server export and a user's preview are the same code (an in-process rasterizer could not draw `Canvas3D` and
// threw on audio).
//
//     const engine = createServerEngine({ projectRoot: './my-project' });
//     const still = await engine.renderImage({ document, frame: 'last' });
//     const video = await engine.renderVideo({ document });
//
// The entry is a **file** (a module such as `src/project.ts` exporting the `nodes` and `shaders` its documents name, and
// optionally a default project): node types are classes, which do not survive a process boundary, so the entry is
// bundled into the page. Documents are data and arrive per request.

export { MotionScriptServerEngine, createServerEngine } from './server-engine.js';
export type { ServerEngineOptions, ServerImageOptions, ServerImage, ServerVideoOptions } from './server-engine.js';

export { bundlePage } from './page-bundle.js';
export type { BundleOptions, BuiltBundle } from './page-bundle.js';

export type {
    Bridge,
    ScreenshotRequest,
    ScreenshotResult,
    ExportRequest,
    ConcatRequest,
    ConcatResult,
} from './page-bridge.js';

export {
    EngineError,
    isEngineError,
    type EngineErrorCode,
} from './errors.js';

export {
    parseFrameSelector,
    toFrameSpec,
    type FrameSelector,
    type FrameSpec,
    type ParsedFrame,
} from './frame.js';

// Option parsers, for a service validating a request body at the edge: each
// throws INVALID_OPTION naming the value it refused. The engine itself does not
// call them.
export {
    parseBitrate,
    parseCodec,
    parseConcurrency,
    parseImageFormat,
    parseScale,
    parseSupersample,
    parseTimeout,
    type ResolvedImageFormat,
    type VideoCodec,
    type ImageFormat,
} from './validate.js';

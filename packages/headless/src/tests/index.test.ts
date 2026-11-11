import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import type {
    Bridge,
    BuiltBundle,
    BundleOptions,
    ConcatRequest,
    ConcatResult,
    EngineErrorCode,
    ExportRequest,
    FrameSelector,
    FrameSpec,
    ImageFormat,
    ParsedFrame,
    ResolvedImageFormat,
    ScreenshotRequest,
    ScreenshotResult,
    ServerEngineOptions,
    ServerImage,
    ServerImageOptions,
    ServerVideoOptions,
    VideoCodec,
} from '../index.js';

/** Every type the barrel must carry. Missing one is a compile error, which `pnpm typecheck` reports. */
export type ListedTypes = [
    ServerEngineOptions, ServerImageOptions, ServerImage, ServerVideoOptions, BundleOptions, BuiltBundle, Bridge,
    ScreenshotRequest, ScreenshotResult, ExportRequest, ConcatRequest, ConcatResult, EngineErrorCode,
    FrameSelector, FrameSpec, ParsedFrame, ResolvedImageFormat, VideoCodec, ImageFormat,
];

describe('the package barrel', () => {
    it('exports exactly the values the spec lists', () => {
        expect(Object.keys(barrel).sort()).toEqual([
            'EngineError',
            'MotionScriptServerEngine',
            'bundlePage',
            'createServerEngine',
            'isEngineError',
            'parseBitrate',
            'parseCodec',
            'parseConcurrency',
            'parseFrameSelector',
            'parseImageFormat',
            'parseScale',
            'parseSupersample',
            'parseTimeout',
            'toFrameSpec',
        ]);
    });

    it.each(['serveFile', 'splitFrames'])(
        'does not export %s, which is internal',
        (name) => {
            expect(barrel).not.toHaveProperty(name);
        },
    );

    it('is the only entry the package exposes', () => {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
        const { exports } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
        expect(Object.keys(exports)).toEqual(['.']);
    });
});

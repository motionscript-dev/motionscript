import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MotionScriptServerEngine } from '../server-engine.js';
import {
    BARE_ENTRY,
    BOOT_TIMEOUT_MS,
    DEFAULT_PROJECT,
    mp4Tracks,
    pageMessages,
    scratchProject,
    slidingSquareClip,
    toneWav,
    videoOrSkip,
    type Mp4Track,
    type ScratchProject,
} from './headless.fixtures.js';

/**
 * `renderVideo({ concurrency })` through a real headless Chromium: each split
 * export is compared with the same document exported in one page. One engine
 * serves every case, so the pages a split adds are booted once.
 *
 * At scale 5 (160 by 120), for the reason `render.test.ts` gives: a hardware
 * H.264 encoder can have a minimum frame size and hang below it.
 */

const SCALE = 5;
const TONE_SECONDS = 3;

/** The sliding square held for `seconds`, at the default project's size and rate. */
function squareFor(seconds: number) {
    return {
        kind: 'project' as const,
        name: 'split',
        fps: DEFAULT_PROJECT.fps,
        viewport: DEFAULT_PROJECT.viewport,
        tracks: [{ id: 'main', duration: seconds, clip: slidingSquareClip() }],
    };
}

/** {@link squareFor} with `tone.wav` playing under it from the start. */
function squareWithTone(seconds: number) {
    const project = squareFor(seconds);
    const sound = {
        kind: 'audio' as const,
        nodes: [{ id: 's', type: 'sound', parentId: null, layerOrder: 0, props: { src: 'tone.wav' } }],
        commands: [],
    };
    return { ...project, tracks: [...project.tracks, { id: 'tone', duration: seconds, clip: sound }] };
}

function trackOf(bytes: Uint8Array, handler: string): Mp4Track | undefined {
    return mp4Tracks(bytes).find((track) => track.handler === handler);
}

describe('a split export', () => {
    let project: ScratchProject;
    let engine: MotionScriptServerEngine;
    const messages = pageMessages();
    const stderr: string[] = [];

    beforeAll(async () => {
        project = scratchProject('split');
        project.writeEntry(BARE_ENTRY);
        const tone = toneWav(TONE_SECONDS);
        project.writeAsset('tone.wav', tone);
        engine = new MotionScriptServerEngine({
            projectRoot: project.dir,
            cacheDir: project.cacheDir,
            softwareRender: true,
            onPageMessage: messages.onPageMessage,
            manifest: {
                image: {},
                video: {},
                audio: { 'tone.wav': { src: '/tone.wav', duration: TONE_SECONDS, sizeBytes: tone.length } },
                font: {},
            },
        });
        await engine.start();
        const write = process.stderr.write.bind(process.stderr);
        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array, ...rest: never[]) => {
            stderr.push(String(chunk));
            return write(chunk, ...rest);
        }) as typeof process.stderr.write);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        vi.restoreAllMocks();
        await engine?.close();
        project?.remove();
    });

    it('has the frames and the length of the same export in one page, with a key frame at every seam', { timeout: 60_000 }, async (context) => {
        const document = squareFor(3);
        const whole = await videoOrSkip(context, engine.renderVideo({ document, scale: SCALE }));
        const split = await videoOrSkip(context, engine.renderVideo({ document, scale: SCALE, concurrency: 4 }));

        const one = trackOf(whole, 'vide')!;
        const joined = trackOf(split, 'vide')!;
        expect(one.samples).toBe(30);
        expect(joined.samples).toBe(one.samples);
        expect(joined.seconds).toBeCloseTo(one.seconds, 6);
        expect(joined.seconds).toBeCloseTo(3, 6);
        // 30 frames over four pages are 8, 8, 7 and 7, and each page's encoder begins on a key frame.
        expect(joined.keyFrames).toEqual(expect.arrayContaining([0, 8, 16, 23]));
        expect(mp4Tracks(split).map((track) => track.handler)).toEqual(['vide']);
        expect(stderr.filter((line) => line.includes('in one page instead'))).toEqual([]);
    });

    it('carries one audio track mixed over the whole timeline, as long as the one-page export\'s', { timeout: 60_000 }, async (context) => {
        const document = squareWithTone(1);
        const whole = await videoOrSkip(context, engine.renderVideo({ document, scale: SCALE }));
        const split = await videoOrSkip(context, engine.renderVideo({ document, scale: SCALE, concurrency: 3 }));

        expect(mp4Tracks(split).map((track) => track.handler)).toEqual(['vide', 'soun']);
        const one = trackOf(whole, 'soun')!;
        const joined = trackOf(split, 'soun')!;
        expect(joined.samples).toBe(one.samples);
        expect(joined.seconds).toBeCloseTo(one.seconds, 3);
        expect(joined.seconds).toBeCloseTo(1, 1);
        // A tone, not silence: AAC spends far fewer bytes on a silent track than on this one.
        expect(Math.abs(joined.bytes - one.bytes) / one.bytes).toBeLessThan(0.1);

        const video = trackOf(split, 'vide')!;
        expect(video.samples).toBe(trackOf(whole, 'vide')!.samples);
        expect(video.keyFrames).toEqual(expect.arrayContaining([0, 4, 7]));
        expect(stderr.filter((line) => line.includes('in one page instead'))).toEqual([]);
    });

    it('is silent under includeAudio: false', { timeout: 60_000 }, async (context) => {
        const split = await videoOrSkip(context, engine.renderVideo({
            document: squareWithTone(1), scale: SCALE, concurrency: 2, includeAudio: false,
        }));

        expect(mp4Tracks(split).map((track) => track.handler)).toEqual(['vide']);
    });
});

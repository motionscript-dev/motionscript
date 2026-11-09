import { describe, it, expect, vi } from 'vitest';
import { AssetManager } from '@/assets/manager';
import type { AudioRequest } from '@/attributes/audio/request';
import {
    FakeStorageAdapter,
    FakeAudioSink,
    asStorage,
    makeAssetTimelineResult,
    makeTrackAssets,
    makeAssetTrack,
    makeImageRecord,
    makeLoaderRecord,
    makeAudioRequest,
} from '@/runtime/runtime.fixtures';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(precomp = makeAssetTimelineResult({ tracks: [] })) {
    const storage = new FakeStorageAdapter();
    const audio = new FakeAudioSink();
    const mgr = new AssetManager(precomp, asStorage(storage), audio);
    return { mgr, storage, audio };
}

describe('AssetManager.loadAt', () => {
    const assets = new Map([
        ['a', makeAssetTrack({ cacheAt: 0, record: makeImageRecord({ src: 'a', endFrame: 10 }) })],
        ['b', makeAssetTrack({ cacheAt: 20, record: makeImageRecord({ src: 'b', endFrame: 30 }) })],
        ['c', makeAssetTrack({ cacheAt: 0, record: makeImageRecord({ src: 'c', endFrame: 2 }) })],
    ]);

    it('loads only assets whose [cacheAt, endFrame] window contains the frame', async () => {
        const { mgr, storage } = setup(makeAssetTimelineResult({ assets, tracks: [] }));
        await mgr.loadAt(5);
        expect(storage.loadAssetCalls.map((c) => c.key)).toEqual(['a']);
    });

    it('loads an asset whose cacheAt window has just opened', async () => {
        const { mgr, storage } = setup(makeAssetTimelineResult({ assets, tracks: [] }));
        await mgr.loadAt(25); // a: endFrame 10 < 25 (out); b: cacheAt20<=25, endFrame30>=25 (in); c: out
        expect(storage.loadAssetCalls.map((c) => c.key)).toEqual(['b']);
    });

    it('resolves with no work when nothing is in range', async () => {
        const { mgr, storage } = setup(makeAssetTimelineResult({ assets, tracks: [] }));
        await mgr.loadAt(15); // a out (10<15), b not yet (20>15), c out
        expect(storage.loadAssetCalls).toHaveLength(0);
    });
});

describe('AssetManager.prefetch', () => {
    it('fires loads for in-window assets without awaiting', () => {
        const assets = new Map([
            ['a', makeAssetTrack({ cacheAt: 0, record: makeImageRecord({ src: 'a', endFrame: 10 }) })],
        ]);
        const { mgr, storage } = setup(makeAssetTimelineResult({ assets, tracks: [] }));
        mgr.prefetch(5);
        expect(storage.loadAssetCalls.map((c) => c.key)).toEqual(['a']);
    });

    it('swallows load rejections (logs instead of throwing)', async () => {
        const assets = new Map([
            ['a', makeAssetTrack({ cacheAt: 0, record: makeImageRecord({ src: 'a', endFrame: 10 }) })],
        ]);
        const { mgr, storage } = setup(makeAssetTimelineResult({ assets, tracks: [] }));
        storage.loadShouldReject = true;
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => mgr.prefetch(5)).not.toThrow();
        await flush();
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

describe('AssetManager loaders', () => {
    it('runs a loader callback when its window opens and awaits it in loadAt', async () => {
        const load = vi.fn(async () => () => { });
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 0, discardAt: 10, record: makeLoaderRecord({ src: 'L', load }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(5);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('does not run a loader before its cacheAt window', async () => {
        const load = vi.fn(async () => () => { });
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 20, discardAt: 30, record: makeLoaderRecord({ src: 'L', load }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(5);
        expect(load).not.toHaveBeenCalled();
    });

    it('runs a loader at most once across repeated in-window frames', async () => {
        const load = vi.fn(async () => () => { });
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 0, discardAt: 100, record: makeLoaderRecord({ src: 'L', load }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(1);
        await mgr.loadAt(2);
        mgr.prefetch(3);
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('disposes a loaded loader once the frame leaves its window', async () => {
        const dispose = vi.fn();
        const load = vi.fn(async () => dispose);
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 0, discardAt: 10, record: makeLoaderRecord({ src: 'L', load }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(5);
        expect(dispose).not.toHaveBeenCalled();

        await mgr.loadAt(50); // past discardAt → evicted
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('runs all disposers on dispose()', async () => {
        const dispose = vi.fn();
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 0, discardAt: 10, record: makeLoaderRecord({ src: 'L', load: async () => dispose }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(5);
        mgr.dispose();
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});

describe('AssetManager layout gates', () => {
    // `loadRecords` loads a gate whatever frame is drawn; the next `loadAt` used to
    // dispose it for being outside its window, so it loaded again every other frame.
    it('keeps a layout-gated loader resident when the frame is outside its window', async () => {
        const dispose = vi.fn();
        const load = vi.fn(async () => dispose);
        const record = makeLoaderRecord({ src: 'G', load });
        const assets = new Map([
            ['G', makeAssetTrack({ cacheAt: 20, discardAt: 30, record })],
        ]);
        const precomp = makeAssetTimelineResult({
            assets,
            tracks: [makeTrackAssets({ layoutGates: ['G'] })],
        });
        const { mgr } = setup(precomp);

        await mgr.loadRecords([record]);
        expect(mgr.isReady('G')).toBe(true);

        await mgr.loadAt(5); // before the window: used to dispose
        await mgr.loadRecords([record]);
        await mgr.loadAt(5);

        expect(dispose).not.toHaveBeenCalled();
        expect(mgr.isReady('G')).toBe(true);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('still disposes an ordinary loader outside its window', async () => {
        const dispose = vi.fn();
        const record = makeLoaderRecord({ src: 'L', load: async () => dispose });
        const assets = new Map([['L', makeAssetTrack({ cacheAt: 0, discardAt: 10, record })]]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [makeTrackAssets()] }));

        await mgr.loadAt(5);
        await mgr.loadAt(50);
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});

describe('AssetManager.loadRecords and isReady', () => {
    it('loads every record it is given whatever the frame, stored assets through the adapter and loaders directly', async () => {
        const load = vi.fn(async () => () => { });
        const image = makeImageRecord({ src: 'a.png', startFrame: 500, endFrame: 600 });
        const loader = makeLoaderRecord({ src: 'L', load });
        const { mgr, storage } = setup();

        await mgr.loadRecords([image, loader]);

        // The key a stored asset loads under is its record's src.
        expect(storage.loadAssetCalls.map((c) => [c.key, c.record])).toEqual([['a.png', image]]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('resolves with no work for an empty list', async () => {
        const { mgr, storage } = setup();
        await mgr.loadRecords([]);
        expect(storage.loadAssetCalls).toEqual([]);
    });

    it('answers isReady from the adapter for a stored asset and from the loader state for a loader', async () => {
        const { mgr, storage } = setup();
        const record = makeLoaderRecord({ src: 'L', load: async () => () => { } });

        expect(mgr.isReady('a.png')).toBe(false);
        expect(mgr.isReady('L')).toBe(false);

        await mgr.loadRecords([makeImageRecord({ src: 'a.png' }), record]);

        expect(mgr.isReady('a.png')).toBe(true);
        expect(mgr.isReady('L')).toBe(true);
        expect(storage.loaded.has('a.png')).toBe(true);
        expect(mgr.isReady('never-asked')).toBe(false);
    });

    it('counts a loader that resolved nothing as loaded: it is keeping its result on purpose', async () => {
        const load = vi.fn(async () => undefined);
        const { mgr } = setup();
        const record = makeLoaderRecord({ src: 'quiet', load: load as never });

        await mgr.loadRecords([record]);
        expect(mgr.isReady('quiet')).toBe(true);

        await mgr.loadRecords([record]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('is not ready once a loader has been disposed for leaving its window', async () => {
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 0, discardAt: 10, record: makeLoaderRecord({ src: 'L', load: async () => () => { } }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(5);
        expect(mgr.isReady('L')).toBe(true);
        await mgr.loadAt(50);
        expect(mgr.isReady('L')).toBe(false);
    });

    it('runs a loader at most once for concurrent loadRecords calls', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const load = vi.fn(async () => { await gate; return () => { }; });
        const record = makeLoaderRecord({ src: 'L', load });
        const { mgr } = setup();

        const first = mgr.loadRecords([record]);
        const second = mgr.loadRecords([record]);
        release();
        await Promise.all([first, second]);

        expect(load).toHaveBeenCalledTimes(1);
    });
});

describe('AssetManager with a loader that rejects', () => {
    function failingLoader() {
        let calls = 0;
        const load = vi.fn(async () => {
            calls++;
            if (calls === 1) throw new Error('parse failed');
            return () => { };
        });
        const record = makeLoaderRecord({ src: 'L', load });
        const assets = new Map([['L', makeAssetTrack({ cacheAt: 0, discardAt: 100, record })]]);
        return { load, record, precomp: makeAssetTimelineResult({ assets, tracks: [] }) };
    }

    it('rejects loadAt with the loader\'s error, so a blocking seek hears about it', async () => {
        const { precomp } = failingLoader();
        const { mgr } = setup(precomp);
        await expect(mgr.loadAt(5)).rejects.toThrow('parse failed');
    });

    it('rejects loadRecords the same way', async () => {
        const { record } = failingLoader();
        const { mgr } = setup();
        await expect(mgr.loadRecords([record])).rejects.toThrow('parse failed');
    });

    it('records no disposer for it, so it is not ready and the next call tries again', async () => {
        const { load, precomp } = failingLoader();
        const { mgr } = setup(precomp);

        await expect(mgr.loadAt(5)).rejects.toThrow();
        expect(mgr.isReady('L')).toBe(false);

        await mgr.loadAt(6);
        expect(load).toHaveBeenCalledTimes(2);
        expect(mgr.isReady('L')).toBe(true);
    });

    it('shares one rejection between callers that arrived while it was in flight', async () => {
        let fail!: (error: Error) => void;
        const load = vi.fn(() => new Promise<never>((_, reject) => { fail = reject; }));
        const record = makeLoaderRecord({ src: 'L', load: load as never });
        const { mgr } = setup();

        const a = mgr.loadRecords([record]);
        const b = mgr.loadRecords([record]);
        fail(new Error('boom'));

        await expect(a).rejects.toThrow('boom');
        await expect(b).rejects.toThrow('boom');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('logs it from prefetch instead of throwing, and does not leave an unhandled rejection', async () => {
        const seen: unknown[] = [];
        const handler = (reason: unknown) => { seen.push(reason); };
        process.on('unhandledRejection', handler);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            const { precomp } = failingLoader();
            const { mgr } = setup(precomp);

            expect(() => mgr.prefetch(5)).not.toThrow();
            await flush();
            await flush();

            expect(errSpy).toHaveBeenCalledTimes(1);
            expect(String(errSpy.mock.calls[0][0])).toContain('loader failed for L');
        } finally {
            process.off('unhandledRejection', handler);
            errSpy.mockRestore();
        }
        expect(seen).toEqual([]);
    });
});

describe('AssetManager.setPrecomp', () => {
    it('keeps a loaded loader\'s disposer and does not load it again for the new precomp', async () => {
        const dispose = vi.fn();
        const load = vi.fn(async () => dispose);
        const record = makeLoaderRecord({ src: 'L', load });
        const withLoader = () => makeAssetTimelineResult({
            assets: new Map([['L', makeAssetTrack({ cacheAt: 0, discardAt: 100, record })]]),
            tracks: [],
        });
        const { mgr } = setup(withLoader());

        await mgr.loadAt(5);
        mgr.setPrecomp(withLoader());
        await mgr.loadAt(6);

        expect(load).toHaveBeenCalledTimes(1);
        expect(dispose).not.toHaveBeenCalled();
        expect(mgr.isReady('L')).toBe(true);
    });

    it('still disposes a kept loader when the new precomp\'s window has passed it', async () => {
        const dispose = vi.fn();
        const record = makeLoaderRecord({ src: 'L', load: async () => dispose });
        const make = (discardAt: number) => makeAssetTimelineResult({
            assets: new Map([['L', makeAssetTrack({ cacheAt: 0, discardAt, record })]]),
            tracks: [],
        });
        const { mgr } = setup(make(100));

        await mgr.loadAt(5);
        mgr.setPrecomp(make(10));
        await mgr.loadAt(50);

        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('keeps an audio fetch in flight across a swap, so an unchanged source is not fetched twice', async () => {
        const req = makeAudioRequest({ id: 'r', src: 'long.mp3', startAt: 0, endAt: 100 });
        const precomp = () => makeAssetTimelineResult({
            fps: 10, tracks: [makeTrackAssets({ audioRequests: [{ ...req }] })],
        });
        const storage = new FakeStorageAdapter();
        let resolveFetch!: (data: ArrayBuffer) => void;
        storage.fetchAudioData = (src: string) => {
            storage.fetchAudioCalls.push(src);
            return new Promise<ArrayBuffer>((resolve) => { resolveFetch = resolve; });
        };
        const audio = new FakeAudioSink();
        const mgr = new AssetManager(precomp(), asStorage(storage), audio);

        mgr.syncAudio(0);
        mgr.setPrecomp(precomp());
        mgr.syncAudio(0);

        expect(storage.fetchAudioCalls).toEqual(['long.mp3']);

        resolveFetch(new ArrayBuffer(8));
        await flush();
        expect(audio.appendCalls.map((c) => c.src)).toEqual(['long.mp3']);
    });

    it('forces a reschedule and a re-retain after a swap, even when the window is the same', () => {
        const req = makeAudioRequest({ id: 'r', src: 's1', startAt: 0, endAt: 1 });
        const precomp = () => makeAssetTimelineResult({
            fps: 10, tracks: [makeTrackAssets({ audioRequests: [{ ...req }] })],
        });
        const { mgr, audio } = setup(precomp());

        mgr.syncAudio(0);
        mgr.syncAudio(0);
        expect(audio.scheduleCalls).toHaveLength(1);

        mgr.setPrecomp(precomp());
        mgr.syncAudio(0);
        expect(audio.scheduleCalls).toHaveLength(2);
        expect(audio.retainCalls).toHaveLength(2);
    });

    it('measures against the new precomp\'s layout gates', async () => {
        const dispose = vi.fn();
        const record = makeLoaderRecord({ src: 'G', load: async () => dispose });
        const assets = new Map([['G', makeAssetTrack({ cacheAt: 20, discardAt: 30, record })]]);
        const gated = makeAssetTimelineResult({ assets, tracks: [makeTrackAssets({ layoutGates: ['G'] })] });
        const ungated = makeAssetTimelineResult({ assets, tracks: [makeTrackAssets()] });
        const { mgr } = setup(gated);

        await mgr.loadRecords([record]);
        await mgr.loadAt(5);
        expect(dispose).not.toHaveBeenCalled();

        mgr.setPrecomp(ungated);
        await mgr.loadAt(5);
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});

describe('a source only an optional request wants', () => {
    /** A manager over `requests` whose every audio fetch rejects, as a file with no audio track decodes. */
    function failing(requests: ReturnType<typeof makeAudioRequest>[]) {
        const storage = new FakeStorageAdapter();
        storage.fetchAudioData = (src: string) => {
            storage.fetchAudioCalls.push(src);
            return Promise.reject(new Error('Unable to decode audio data'));
        };
        const onError = vi.fn();
        const precomp = (reqs = requests) =>
            makeAssetTimelineResult({ fps: 10, tracks: [makeTrackAssets({ audioRequests: reqs })] });
        const mgr = new AssetManager(precomp(), asStorage(storage), new FakeAudioSink(), onError);
        return { mgr, storage, onError, precomp };
    }
    const picture = makeAudioRequest({ id: 'v', src: 'screen.mp4', startAt: 0, endAt: 100, optional: true });
    const asked = makeAudioRequest({ id: 's', src: 'screen.mp4', startAt: 0, endAt: 100 });

    it('is silence when it cannot be decoded: nothing is reported', async () => {
        const { mgr, onError } = failing([picture]);
        mgr.syncAudio(0);
        await flush();
        expect(onError).not.toHaveBeenCalled();
    });

    it('is not fetched again while it is still wanted', async () => {
        const { mgr, storage } = failing([picture]);
        mgr.syncAudio(0);
        await flush();
        mgr.syncAudio(0);
        mgr.syncAudio(1);
        await flush();
        expect(storage.fetchAudioCalls).toEqual(['screen.mp4']);
    });

    it('is still a failure when a request that asked for the sound wants it too', async () => {
        const { mgr, onError } = failing([picture, asked]);
        mgr.syncAudio(0);
        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].message).toBe(
            'audio "screen.mp4" could not be loaded: Unable to decode audio data',
        );
    });

    it('is reported once when a request that asks for the sound arrives after it failed quietly', async () => {
        const { mgr, onError, precomp } = failing([picture]);
        mgr.syncAudio(0);
        await flush();
        expect(onError).not.toHaveBeenCalled();

        mgr.setPrecomp(precomp([picture, asked]));
        mgr.syncAudio(0);
        await flush();
        mgr.syncAudio(0);
        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('AssetManager.dispose', () => {
    it('stays quiet about an audio fetch that fails after it was disposed', async () => {
        const req = makeAudioRequest({ id: 'r', src: 'late.mp3', startAt: 0, endAt: 100 });
        const storage = new FakeStorageAdapter();
        let failFetch!: (error: Error) => void;
        storage.fetchAudioData = (src: string) => {
            storage.fetchAudioCalls.push(src);
            return new Promise<ArrayBuffer>((_, reject) => { failFetch = reject; });
        };
        const onError = vi.fn();
        const mgr = new AssetManager(
            makeAssetTimelineResult({ fps: 10, tracks: [makeTrackAssets({ audioRequests: [req] })] }),
            asStorage(storage), new FakeAudioSink(), onError,
        );

        mgr.syncAudio(0);
        mgr.dispose();
        failFetch(new Error('404'));
        await flush();

        expect(onError).not.toHaveBeenCalled();
    });

    it('can be called twice: each disposer runs once and the second call finds nothing left', async () => {
        const dispose = vi.fn();
        const assets = new Map([
            ['L', makeAssetTrack({ cacheAt: 0, discardAt: 10, record: makeLoaderRecord({ src: 'L', load: async () => dispose }) })],
        ]);
        const { mgr } = setup(makeAssetTimelineResult({ assets, tracks: [] }));

        await mgr.loadAt(5);
        mgr.dispose();
        mgr.dispose();

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(mgr.isReady('L')).toBe(false);
    });
});

describe('AssetManager.syncAudio', () => {
    function precompWith(requests: ReturnType<typeof makeAudioRequest>[], startFrame = 0, fps = 10) {
        return makeAssetTimelineResult({
            fps,
            tracks: [makeTrackAssets({ startFrame, audioRequests: requests })],
        });
    }

    it('schedules and retains a request that falls within the look-ahead window', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 0, endAt: 1 });
        const { mgr, audio, storage } = setup(precompWith([req]));

        mgr.syncAudio(0);

        expect(audio.scheduleCalls).toHaveLength(1);
        expect(audio.scheduleCalls[0][0].src).toBe('s1');
        expect(audio.retainCalls).toHaveLength(1);
        expect([...audio.retainCalls[0]]).toEqual(['s1']);
        // Not yet cached → triggers a fetch.
        expect(storage.fetchAudioCalls).toEqual(['s1']);
    });

    it('rewrites request timing into project seconds by its track’s start', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 1, endAt: 2 });
        // Track starts at frame 10 (= 1s at 10fps), so project start = 1 + 1 = 2s.
        const { mgr, audio } = setup(precompWith([req], 10, 10));
        mgr.syncAudio(20); // currentTime = 2s
        const scheduled = audio.scheduleCalls[0][0];
        expect(scheduled.startAt).toBeCloseTo(2, 6);
        expect(scheduled.endAt).toBeCloseTo(3, 6);
    });

    it('rewrites a request’s bus spans into project seconds with it', () => {
        const stop = { id: 'bus:mix', volume: 1, pan: 0, mute: false, startAt: 0.5, endAt: 3 };
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 1, endAt: 2, bus: [stop] });
        const { mgr, audio } = setup(precompWith([req], 10, 10));
        mgr.syncAudio(20);
        const scheduled = audio.scheduleCalls[0][0];
        // The bus and the clip share one clock, so a bus curve lines up with what plays through it.
        expect(scheduled.bus?.map((s) => [s.startAt, s.endAt])).toEqual([[1.5, 4]]);
        // The track's own copy is left in clip seconds.
        expect(req.bus?.[0].startAt).toBe(0.5);
    });

    it('gives requests on a bus that moved distinct ids, so the device re-anchors it', () => {
        const at = (startAt: number) => makeAudioRequest({
            id: 'r', src: 's1', startAt: 1, endAt: 2,
            bus: [{ id: 'bus:mix', volume: 1, pan: 0, mute: false, startAt, endAt: 3 }],
        });
        const first = setup(precompWith([at(0)]));
        first.mgr.syncAudio(0);
        const moved = setup(precompWith([at(0.5)]));
        moved.mgr.syncAudio(0);
        expect(first.audio.scheduleCalls[0][0].id).not.toBe(moved.audio.scheduleCalls[0][0].id);
    });

    it('offsets each track by its own start', () => {
        const req = makeAudioRequest({ id: 'r', src: 's1', startAt: 0, endAt: 1 });
        const precomp = makeAssetTimelineResult({
            fps: 10,
            tracks: [
                makeTrackAssets({ id: 'a', startFrame: 0, audioRequests: [{ ...req }] }),
                makeTrackAssets({ id: 'b', startFrame: 5, audioRequests: [{ ...req }] }),
            ],
        });
        const { mgr, audio } = setup(precomp);
        mgr.syncAudio(0);
        // The same clip at two starts is two playbacks, not a duplicate.
        expect(audio.scheduleCalls[0].map((r) => r.startAt).sort()).toEqual([0, 0.5]);
    });

    it('excludes requests that have already ended', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 0, endAt: 1 });
        const { mgr, audio } = setup(precompWith([req]));
        mgr.syncAudio(50); // currentTime = 5s, request ended at 1s
        expect(audio.scheduleCalls).toHaveLength(0);
    });

    it('excludes requests more than 10s beyond the current time', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 100, endAt: 101 });
        const { mgr, audio } = setup(precompWith([req]));
        mgr.syncAudio(0);
        expect(audio.scheduleCalls).toHaveLength(0);
    });

    it('does not fetch audio data already cached on the device', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 0, endAt: 1 });
        const { mgr, audio, storage } = setup(precompWith([req]));
        audio.seed('s1');
        mgr.syncAudio(0);
        expect(storage.fetchAudioCalls).toHaveLength(0);
    });

    it('does not reschedule when the active window is unchanged', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 0, endAt: 1 });
        const { mgr, audio } = setup(precompWith([req]));
        mgr.syncAudio(0);
        mgr.syncAudio(0); // identical window
        expect(audio.scheduleCalls).toHaveLength(1);
        expect(audio.retainCalls).toHaveLength(1);
    });

    it('stops removed audio when a swap leaves the window empty', () => {
        const req = makeAudioRequest({ id: 'r1', src: 's1', startAt: 0, endAt: 1 });
        const { mgr, audio } = setup(precompWith([req]));
        mgr.syncAudio(0);

        mgr.setPrecomp(precompWith([]));
        mgr.syncAudio(0);

        expect(audio.scheduleCalls).toHaveLength(2);
        expect(audio.scheduleCalls[1]).toEqual([]);
        expect(audio.retainCalls).toHaveLength(2);
        expect([...audio.retainCalls[1]]).toEqual([]);

        mgr.syncAudio(0);
        expect(audio.scheduleCalls).toHaveLength(2);
        expect(audio.retainCalls).toHaveLength(2);
    });

    it('reschedules and re-retains when the window changes', () => {
        const r1 = makeAudioRequest({ id: 'r1', src: 's1', startAt: 0, endAt: 1 });
        const r2 = makeAudioRequest({ id: 'r2', src: 's2', startAt: 20, endAt: 21 });
        const { mgr, audio } = setup(precompWith([r1, r2]));
        mgr.syncAudio(0);   // window = [r1] (r2 too far ahead)
        mgr.syncAudio(150); // window = [r2] (r1 ended, r2 now near)
        expect(audio.scheduleCalls).toHaveLength(2);
        expect(audio.scheduleCalls[1][0].src).toBe('s2');
        expect(audio.retainCalls).toHaveLength(2);
    });

    it('deduplicates identical requests emitted by overlapping tracks', () => {
        const shared = makeAudioRequest({ id: 'dup', src: 's1', startAt: 0, endAt: 1 });
        const precomp = makeAssetTimelineResult({
            fps: 10,
            tracks: [
                makeTrackAssets({ id: 'a', startFrame: 0, audioRequests: [{ ...shared }] }),
                makeTrackAssets({ id: 'b', startFrame: 0, audioRequests: [{ ...shared }] }),
            ],
        });
        const { mgr, audio } = setup(precomp);
        mgr.syncAudio(0);
        expect(audio.scheduleCalls[0]).toHaveLength(1);
    });

    it.each([
        ['effects', { effects: [{ type: 'gain', value: 2 }] }, { effects: [{ type: 'gain', value: 0.5 }] }],
        ['a volume ramp', { volume: { keys: [{ at: 0, value: 1 }] } }, { volume: { keys: [{ at: 0, value: 0.5 }] } }],
        ['speed', { speed: 1 }, { speed: 2 }],
        ['a transition', { transitionOut: { duration: 1 } }, { transitionOut: { duration: 2 } }],
    ] as const)('gives requests differing only by %s distinct ids (so an edit reschedules)', (_, over, other) => {
        // Two clips identical but for one of these must NOT collapse to one
        // playback identity — otherwise the edit keeps the stale source.
        const a = makeAudioRequest({ id: 'a', src: 's1', startAt: 0, endAt: 1, ...(over as Partial<AudioRequest>) });
        const b = makeAudioRequest({ id: 'b', src: 's1', startAt: 0, endAt: 1, ...(other as Partial<AudioRequest>) });
        const { mgr, audio } = setup(precompWith([a, b]));
        mgr.syncAudio(0);
        // Both scheduled (distinct stable ids), not deduped to one.
        expect(audio.scheduleCalls[0]).toHaveLength(2);
        const ids = audio.scheduleCalls[0].map((r) => r.id);
        expect(new Set(ids).size).toBe(2);
    });

    // A rejected fetch had no catch: an unhandled rejection, and `finally`
    // forgetting the fetch meant every later sync started it again.
    describe('a source that fails to load', () => {
        function failing(onError = vi.fn()) {
            const req = makeAudioRequest({ id: 'r1', src: 'gone.mp3', startAt: 0, endAt: 100 });
            const storage = new FakeStorageAdapter();
            storage.fetchAudioData = (src: string) => {
                storage.fetchAudioCalls.push(src);
                return Promise.reject(new Error('404'));
            };
            const audio = new FakeAudioSink();
            const mgr = new AssetManager(precompWith([req]), asStorage(storage), audio, onError);
            return { mgr, storage, audio, onError, req };
        }

        it('is reported once and not fetched again on later syncs', async () => {
            const { mgr, storage, onError } = failing();

            mgr.syncAudio(0);
            await flush();
            mgr.syncAudio(1);
            await flush();
            mgr.syncAudio(2);
            await flush();

            expect(storage.fetchAudioCalls).toEqual(['gone.mp3']);
            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0].message).toMatch(/gone\.mp3.*404/);
        });

        it('is not an unhandled rejection', async () => {
            const seen: unknown[] = [];
            const handler = (reason: unknown) => { seen.push(reason); };
            process.on('unhandledRejection', handler);
            try {
                const { mgr } = failing();
                mgr.syncAudio(0);
                await flush();
                await flush();
            } finally {
                process.off('unhandledRejection', handler);
            }
            expect(seen).toEqual([]);
        });

        it('is tried again after a new precomp, since the source may have changed', async () => {
            const { mgr, storage, req } = failing();
            mgr.syncAudio(0);
            await flush();

            mgr.setPrecomp(precompWith([req]));
            mgr.syncAudio(0);
            await flush();

            expect(storage.fetchAudioCalls).toEqual(['gone.mp3', 'gone.mp3']);
        });

        it('is tried again once nothing asks for it and it is wanted later', async () => {
            const near = makeAudioRequest({ id: 'a', src: 'gone.mp3', startAt: 0, endAt: 1 });
            const later = makeAudioRequest({ id: 'b', src: 'gone.mp3', startAt: 50, endAt: 51 });
            const storage = new FakeStorageAdapter();
            storage.fetchAudioData = (src: string) => {
                storage.fetchAudioCalls.push(src);
                return Promise.reject(new Error('404'));
            };
            const mgr = new AssetManager(precompWith([near, later]), asStorage(storage), new FakeAudioSink(), vi.fn());

            mgr.syncAudio(0);
            await flush();
            mgr.syncAudio(200); // 20 s in: neither is in the window
            mgr.syncAudio(450); // 45 s in: `later` is
            await flush();

            expect(storage.fetchAudioCalls).toEqual(['gone.mp3', 'gone.mp3']);
        });
    });

    it('gives requests differing only by a loop out-point distinct ids', () => {
        const a = makeAudioRequest({ id: 'a', src: 's1', startAt: 0, endAt: 5, loop: true, trimEnd: 1 });
        const b = makeAudioRequest({ id: 'b', src: 's1', startAt: 0, endAt: 5, loop: true, trimEnd: 2 });
        const { mgr, audio } = setup(precompWith([a, b]));
        mgr.syncAudio(0);
        expect(new Set(audio.scheduleCalls[0].map((r) => r.id)).size).toBe(2);
    });
});

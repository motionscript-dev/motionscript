import { describe, it, expect } from 'vitest';
import { ManifestAssetCatalog } from '@/assets/catalog';
import { Fills } from '@/attributes/shape/fill/chain';
import type { CompositionDocument, TimedNodeSpec } from '@/document/types';
import { createAssetTimelineProfile, type AssetTimelineResult } from '@/runtime/asset-timeline';
import { comp, node, precompFor, probeRegistry, project, still, track } from '@/runtime/document.fixtures';
import { FakeAssetCatalog, asCatalog } from '@/runtime/runtime.fixtures';

const probe = (id = 'p') => node(id, 'probe', { width: 10, height: 10 });
const box = (id = 'b') => node(id, 'rect', { width: 10, height: 10 });
const picture = (src: string, size = 512, id = 'pic') =>
    node(id, 'rect', { width: size, height: size, fill: Fills.image(src) });

/** Intrinsic sizes, which image and video lead times scale with until decode size follows the draw. */
const mediaCatalog = (size = 512) => new ManifestAssetCatalog({
    image: { 'img.png': { src: 'img.png', width: size, height: size, sizeBytes: 0 } },
    video: { 'clip.mp4': { src: 'clip.mp4', width: size, height: size, duration: 10, sizeBytes: 0 } },
    audio: {},
    font: {},
});

/** A clip holding one plain rect for `seconds`. */
const hold = (seconds: number) => comp([box()], [seconds]);

/** A `sound` row of `a.mp3`, present (and so playing) from `at` until `until`. */
const playing = ({ at, until, loop }: { at?: number; until?: number; loop?: boolean } = {}): TimedNodeSpec => ({
    ...node('s', 'sound', { src: 'a.mp3', ...(loop && { loop }) }),
    ...(at !== undefined && { startAt: at }),
    ...(until !== undefined && { endAt: until }),
});

/** Two intervals, so a pass over it yields between them and can be caught parked. */
const twoSteps = (nodes = [probe()]) => comp(nodes, [
    { target: 'p', args: { opacity: 0.5 }, duration: 1 },
    { target: 'p', args: { opacity: 1 }, duration: 1 },
]);

/** A hug row whose middle child, a picture, is removed mid-clip: layout that changes shape. */
function removingRow(label: string): CompositionDocument {
    return comp([
        node('row', 'rect', { width: 'hug', height: 'fill', flow: 'horizontal', gap: 24, align: 'centerLeft' }),
        node('first', 'rect', { width: 120, height: 120 }, 'row', 0),
        node('label', 'text', { text: label, fontFamily: 'Inter' }, 'first', 0),
        { ...node('mid', 'rect', { width: 120, height: 120, fill: Fills.image('mid.png') }, 'row', 1), endAt: 0.5 },
        node('last', 'rect', { width: 120, height: 120 }, 'row', 2),
    ], [1]);
}

/** A box through several legs of tweening. */
function movingBox(distance: number): CompositionDocument {
    return comp([node('box', 'rect', { width: 80, height: 80, x: 0, y: 0 })], [
        { target: 'box', args: { x: distance }, duration: 0.5 },
        { target: 'box', args: { y: distance, rotation: 45 }, duration: 0.5 },
        { target: 'box', args: { x: 0, y: 0, rotation: 0 }, duration: 0.5 },
    ]);
}

/** Three tracks of distinct lengths, laid end to end: 10, 15 and 10 frames. */
const trio = () => project([
    track('a', removingRow('A')),
    track('b', movingBox(200), { startAt: 1 }),
    track('c', removingRow('B'), { startAt: 2.5 }),
]);

describe('AssetTimeline – timeline accounting', () => {
    it('takes each track’s length and start from the document', () => {
        const result = precompFor(project([
            track('a', hold(0.3)),
            track('b', hold(0.7), { startAt: 0.3 }),
            track('bg', still(box()), { duration: 1 }),
        ])).run();

        expect(result.tracks.map((t) => t.frameCount)).toEqual([3, 7, 10]);
        expect(result.tracks.map((t) => t.startFrame)).toEqual([0, 3, 0]);
    });

    it('totals frames and duration by the furthest track', () => {
        const result = precompFor(project([track('a', hold(0.3)), track('b', hold(0.7), { startAt: 0.3 })])).run();
        expect(result.totalFrames).toBe(10);
        expect(result.totalDuration).toBeCloseTo(1.0, 6);
        expect(result.fps).toBe(10);
    });

    it('reports an undiscovered track’s declared span, and nothing else', () => {
        const result = precompFor(project([
            track('a', still(picture('a.png')), { duration: 0.3 }),
            track('b', hold(0.9), { startAt: 0.3 }),
            track('c', hold(0.5), { startAt: 1.2 }),
        ])).result();

        expect(result.tracks.map((t) => t.discovered)).toEqual([false, false, false]);
        expect(result.tracks.map((t) => t.frameCount)).toEqual([3, 9, 5]);
        expect(result.tracks.map((t) => t.startFrame)).toEqual([0, 3, 12]);
        expect(result.totalFrames).toBe(17);
        expect(result.assets.size).toBe(0);
        expect(result.complete).toBe(false);
    });

    /**
     * An edited track is re-discovered, and until it is, every boundary stays
     * put: were its span to collapse, the frame the host is parked on would
     * resolve into a different track and the canvas would cut to it.
     */
    it('moves no boundary while an edited track is discovered again', () => {
        const a = track('a', hold(0.3));
        const c = track('c', hold(0.5), { startAt: 1.2 });
        const precomp = precompFor(project([a, track('b', hold(0.9), { startAt: 0.3 }), c]));
        precomp.run();

        const edited = comp([node('b', 'rect', { width: 20, height: 10 })], [0.9]);
        const after = precomp.setProject(project([a, track('b', edited, { startAt: 0.3 }), c]));

        expect(after.tracks.map((t) => t.discovered)).toEqual([true, false, true]);
        expect(after.complete).toBe(false);
        expect(after.tracks.map((t) => t.startFrame)).toEqual([0, 3, 12]);
        expect(after.totalFrames).toBe(17);
    });
});

describe('AssetTimeline – audio capture', () => {
    it('collects the audio requests a track’s nodes emit', () => {
        const result = precompFor(project([track('a', comp([playing()], [0.3]))])).run();
        expect(result.tracks[0].audioRequests.map((r) => r.id)).toEqual(['s|a.mp3|0|0']);
    });

    it('keeps each track’s audio separate', () => {
        const result = precompFor(project([
            track('a', comp([node('s', 'sound', { src: 'a.mp3' })], [0.2])),
            track('b', comp([node('s', 'sound', { src: 'b.mp3' })], [0.2]), { startAt: 0.2 }),
        ])).run();
        expect(result.tracks.map((t) => t.audioRequests.map((r) => r.src))).toEqual([['a.mp3'], ['b.mp3']]);
    });

    it('clamps a clip that outlasts the track to the track boundary', () => {
        const result = precompFor(project([track('a', comp([playing({ at: 0, until: 5 })], [0.4]))])).run();
        expect(result.tracks[0].audioRequests).toHaveLength(1);
        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.4);
    });

    it('clamps an unbounded (looping) clip to the track boundary', () => {
        const result = precompFor(project([track('a', comp([playing({ at: 0, loop: true })], [0.4]))])).run();
        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.4);
    });

    it('cuts audio off where the track does, even inside a longer clip', () => {
        const result = precompFor(project([track('a', comp([playing({ at: 0, until: 5 })], [2]), { duration: 0.4 })])).run();
        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.4);
    });

    it('drops a clip that starts at or after the track ends', () => {
        const result = precompFor(project([track('a', comp([playing({ at: 1, until: 2 })], [0.4]))])).run();
        expect(result.tracks[0].audioRequests).toHaveLength(0);
    });

    it('leaves a clip that fits within the track untouched', () => {
        const result = precompFor(project([track('a', comp([playing({ at: 0.1, until: 0.5 })], [1]))])).run();
        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.5);
    });
});

describe('AssetTimeline – open audio', () => {
    // An OPEN request is started but never stopped or trimmed; it outlives its
    // track and ends at min(start + mediaDuration, projectTotal).
    // A clip nothing cuts, of a source `mediaDuration` long.
    const bed = (mediaDuration = 10) => ({ assets: asCatalog(new FakeAssetCatalog({ 'a.mp3': mediaDuration })) });

    it('lets an open bed continue past its track and end at the media length', () => {
        // a 0.4s + b 0.4s → project total 0.8s; a bed of 0.6s from a's start ends at 0.6s.
        const result = precompFor(project([
            track('a', comp([playing()], [0.4])),
            track('b', hold(0.4), { startAt: 0.4 }),
        ]), bed(0.6)).run();

        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.6);
    });

    it('clamps an open bed to the project total when the media is longer', () => {
        const result = precompFor(project([
            track('a', comp([playing()], [0.4])),
            track('b', hold(0.4), { startAt: 0.4 }),
        ]), bed(5)).run();

        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.8);
    });

    it('runs an open looped bed to the project total', () => {
        const result = precompFor(project([
            track('a', comp([playing({ loop: true })], [0.4])),
            track('b', hold(0.4), { startAt: 0.4 }),
        ]), bed()).run();

        expect(result.tracks[0].audioRequests[0].endAt).toBeCloseTo(0.8);
    });

    it('accounts for the track’s start when resolving a bed it opens', () => {
        // Opened in b (at 0.4s) with 0.2s of media → absolute end 0.6s, stored
        // clip-local as 0.6 - 0.4 = 0.2.
        const result = precompFor(project([
            track('a', hold(0.4)),
            track('b', comp([playing()], [0.4]), { startAt: 0.4 }),
        ]), bed(0.2)).run();

        expect(result.tracks[1].audioRequests[0].endAt).toBeCloseTo(0.2);
    });

    it('re-resolves an open bed when an edit changes the total', () => {
        const a = track('a', comp([playing()], [0.4]));
        const precomp = precompFor(project([a, track('b', hold(0.4), { startAt: 0.4 })]), bed(5));
        expect(precomp.run().tracks[0].audioRequests[0].endAt).toBeCloseTo(0.8);

        // b grows to 1s → total 1.4s. a's pass is kept, so this also proves the
        // open marker survived into it rather than being resolved once.
        const grown = precomp.setProject(project([a, track('b', hold(1), { startAt: 0.4 })]));
        expect(grown.totalDuration).toBeCloseTo(1.4);
        expect(grown.tracks[0].audioRequests[0].endAt).toBeCloseTo(1.4);
    });

    it('resolves an open bed against the whole project before later tracks are discovered', () => {
        const precomp = precompFor(project([
            track('a', comp([playing()], [0.3])),
            track('b', hold(0.7), { startAt: 0.3 }),
            track('c', hold(0.5), { startAt: 1 }),
        ]), bed(60));

        const first = precomp.ensureCovering(0);
        expect(first.tracks.map((t) => t.discovered)).toEqual([true, false, false]);
        expect(first.tracks[0].audioRequests[0].endAt).toBeCloseTo(1.5, 6);
        expect(precomp.run().tracks[0].audioRequests[0].endAt).toBeCloseTo(1.5, 6);
    });
});

describe('AssetTimeline – asset windows (image)', () => {
    it('computes lead time and a backward-scrub tail for an image', () => {
        const result = precompFor(project([
            track('a', still(picture('img.png')), { startAt: 0.5, duration: 1 }),
        ]), { assets: mediaCatalog() }).run();
        const image = result.assets.get('img.png')!;

        expect(image.record).toMatchObject({ type: 'image', startFrame: 5, endFrame: 14 });
        // 512×512×4 = 1 MB → 2 frames of lead; cacheAt = startFrame − lead.
        expect(image.cacheAt).toBe(3);
        // Tail = endFrame + 30.
        expect(image.discardAt).toBe(44);
    });

    it('clamps cacheAt to 0 when the lead reaches before frame 0', () => {
        const image = precompFor(project([track('a', still(picture('hero.png')), { duration: 0.4 })]))
            .run().assets.get('hero.png')!;
        expect(image.cacheAt).toBe(0);
        expect(image.record.startFrame).toBe(0);
    });

    it('leads an image by its intrinsic size, however large it is drawn', () => {
        const grows = comp([picture('img.png', 100)], [{ target: 'pic', args: { width: 800, height: 600 }, duration: 1 }]);
        const result = precompFor(project([track('a', grows, { startAt: 5 })]), { assets: mediaCatalog(2048) }).run();
        const image = result.assets.get('img.png')!;
        // Records carry no size: picking one is the draw's job.
        expect(result.tracks[0].assetRecords.get('img.png')).not.toHaveProperty('width');
        expect(image.record).not.toHaveProperty('width');
        // 2048 x 2048 x 4 = 16 MB, so 32 frames of lead.
        expect(image.cacheAt).toBe(50 - 32);
    });

    it('merges an image several tracks use into one window over all of them', () => {
        const result = precompFor(project([
            track('a', still(picture('img.png', 100)), { duration: 0.5 }),
            track('b', still(picture('img.png', 300)), { startAt: 2, duration: 0.5 }),
        ])).run();

        expect(result.assets.get('img.png')!.record).toMatchObject({ startFrame: 0, endFrame: 24 });
    });
});

describe('AssetTimeline – missing assets surface as build errors', () => {
    it('records a build error against its track when an image src is absent from the manifest', () => {
        const assets = asCatalog(new FakeAssetCatalog({}, new Set(['gone.png'])));
        const result = precompFor(project([track('broken', still(picture('gone.png')))]), { assets }).run();

        expect(result.buildErrors).toHaveLength(1);
        expect(result.buildErrors[0].trackId).toBe('broken');
        expect(result.buildErrors[0].message).toContain('gone.png');
        // The broken asset must not leak a window onto the timeline.
        expect(result.assets.has('gone.png')).toBe(false);
    });

    it('names the node and the prop it was reading, and keeps the track’s other assets', () => {
        const assets = asCatalog(new FakeAssetCatalog({}, new Set(['gone.png'])));
        const result = precompFor(project([
            track('broken', still(picture('gone.png'), picture('ok.png', 64, 'fine')), { duration: 0.5 }),
        ]), { assets }).run();

        expect(result.buildErrors).toEqual([expect.objectContaining({ trackId: 'broken', nodeId: 'pic', prop: 'pic.fill' })]);
        expect([...result.assets.keys()]).toEqual(['ok.png']);
    });

    it('records a build error when an audio src is absent from the manifest', () => {
        const assets = asCatalog(new FakeAssetCatalog({}, new Set(['gone.mp3'])));
        const result = precompFor(project([
            track('broken-audio', comp([node('s', 'sound', { src: 'gone.mp3' })], [0.3])),
        ]), { assets }).run();

        expect(result.buildErrors).toHaveLength(1);
        expect(result.buildErrors[0].trackId).toBe('broken-audio');
        expect(result.buildErrors[0].message).toContain('gone.mp3');
    });

    it('does not error for a present image src', () => {
        expect(precompFor(project([track('a', still(picture('ok.png')))])).run().buildErrors).toHaveLength(0);
    });

    it('records a track that throws and carries on with the rest', async () => {
        const result = await precompFor(project([
            track('a', movingBox(100)),
            track('bad', still(node('x', 'nope')), { duration: 0.5 }),
            track('c', movingBox(150), { startAt: 1.5 }),
        ])).runAsync({ budgetMs: 0 });

        expect(result.complete).toBe(true);
        expect(result.buildErrors).toHaveLength(1);
        expect(result.buildErrors[0]).toMatchObject({ trackId: 'bad' });
        expect(result.buildErrors[0].message).toContain('nope');
        // The throwing track is still discovered — its span is the document's —
        // and the one after it was discovered normally.
        expect(result.tracks.map((t) => t.discovered)).toEqual([true, true, true]);
        expect(result.tracks[1].frameCount).toBe(5);
        expect(result.tracks[2].frameCount).toBe(15);
    });

    it('records an audio owner that throws and declares every other', () => {
        const assets = asCatalog(new FakeAssetCatalog({}, new Set(['gone.mp3'])));
        const result = precompFor(project([
            track('a', comp([node('bad', 'sound', { src: 'gone.mp3' }), node('ok', 'sound', { src: 'ok.mp3' })], [0.3])),
        ]), { assets }).run();

        expect(result.buildErrors.map((e) => e.message)).toEqual([expect.stringContaining('gone.mp3')]);
        expect(result.tracks[0].audioRequests.map((r) => r.src)).toEqual(['ok.mp3']);
    });
});

describe('AssetTimeline – asset windows (font, video, loader)', () => {
    it('caches fonts from frame 0 and never discards them', () => {
        const result = precompFor(project([
            track('a', still(node('t', 'text', { text: 'hi', fontFamily: 'Inter', fontWeight: 700 })), { startAt: 2, duration: 1 }),
        ])).run();
        const font = result.assets.get('Inter')!;

        expect(font.record).toMatchObject({ type: 'font', startFrame: 20 });
        expect(font.cacheAt).toBe(0);
        expect(font.discardAt).toBeNull();
        expect(result.tracks[0].layoutGates).toEqual(['Inter']);
    });

    it('gives video a heavier lead than the same-sized image, and a discard tail', () => {
        const result = precompFor(project([track('a', still(
            node('v', 'rect', { width: 512, height: 512, fill: Fills.video('clip.mp4') }),
            picture('img.png'),
        ), { startAt: 2, duration: 0.6 })]), { assets: mediaCatalog() }).run();
        const video = result.assets.get('clip.mp4')!;
        const image = result.assets.get('img.png')!;

        expect(video.record).toMatchObject({ type: 'video', startFrame: 20, endFrame: 25 });
        // An image of 1 MB leads by 2 frames; a video by double that plus a second.
        expect(image.cacheAt).toBe(18);
        expect(video.cacheAt).toBe(6);
        expect(video.discardAt).toBe(25 + 30);
    });

    it('emits a loader track keyed by the requested key, deduped across samples', () => {
        const load = async () => () => { };
        const { registry } = probeRegistry((assets) => assets.loader('lang:java', load));
        const result = precompFor(project([track('a', comp([probe()], [0.5]))]), { registry }).run();
        const loader = result.assets.get('lang:java')!;

        expect(loader.record.type).toBe('loader');
        // One entry however often it is declared, with a backward-scrub tail.
        expect([...result.assets.keys()]).toEqual(['lang:java']);
        expect(loader.cacheAt).toBe(0);
        expect(typeof loader.discardAt).toBe('number');
    });
});

describe('AssetTimeline – discovery', () => {
    it('discovers a track once, however often a frame asks for it', () => {
        const { registry, log } = probeRegistry();
        const precomp = precompFor(project([
            track('a', comp([probe()], [0.5])),
            track('b', comp([probe()], [0.5]), { startAt: 1 }),
        ]), { registry });

        precomp.ensureCovering(0);
        const onePass = log.declares;
        precomp.ensureCovering(3);
        expect(log.declares).toBe(onePass);
        expect(precomp.discoveredCount).toBe(1);

        precomp.run();
        expect(log.declares).toBe(2 * onePass);
    });

    it('produces exactly what run() produces when yielding between every frame', async () => {
        const sync = precompFor(trio()).run();
        // budgetMs 0 yields after every frame — the most adversarial
        // interleaving the time-sliced driver can produce.
        const streamed = await precompFor(trio()).runAsync({ budgetMs: 0 });

        // Includes asset windows sampled off each tree, so this also asserts each
        // tree evolved identically across suspensions.
        expect(streamed).toEqual(sync);
        expect(streamed.complete).toBe(true);
        expect(sync.assets.has('mid.png')).toBe(true);
    });

    it('publishes each track as it lands, with exact spans from the first', async () => {
        const published: AssetTimelineResult[] = [];
        const final = await precompFor(trio()).runAsync({ budgetMs: 0, onProgress: (r) => published.push(r) });

        expect(published.map((r) => r.tracks.map((t) => t.discovered))).toEqual([
            [true, false, false],
            [true, true, false],
            [true, true, true],
        ]);
        expect(published.map((r) => r.complete)).toEqual([false, false, true]);
        expect(published.map((r) => r.totalFrames)).toEqual([35, 35, 35]);
        expect(final.totalFrames).toBe(35);
    });

    it('discovers the earliest-starting track first, wherever it is listed', async () => {
        const order: string[] = [];
        await precompFor(project([
            track('late', hold(0.5), { startAt: 2 }),
            track('early', hold(0.5)),
            track('mid', hold(0.5), { startAt: 1 }),
        ])).runAsync({
            budgetMs: 0,
            onProgress: (r) => {
                for (const t of r.tracks) if (t.discovered && !order.includes(t.id)) order.push(t.id);
            },
        });
        expect(order).toEqual(['early', 'mid', 'late']);
    });

    it('cancelling between tracks stops before the next one is even started', async () => {
        const { registry, log } = probeRegistry();
        let cancelled = false;
        const result = await precompFor(project([
            track('a', hold(0.3)),
            track('b', comp([probe()], [0.5]), { startAt: 0.3 }),
            track('c', comp([probe()], [0.5]), { startAt: 0.8 }),
        ]), { registry }).runAsync({
            budgetMs: 0,
            isCancelled: () => cancelled,
            onProgress: () => { cancelled = true; },
        });

        expect(result.tracks.map((t) => t.discovered)).toEqual([true, false, false]);
        expect(result.complete).toBe(false);
        expect(log.declares).toBe(0);
    });

    it('cancelling mid-track abandons it undiscovered, where it was', async () => {
        let cancelled = false;
        const { registry, log } = probeRegistry((_t, call) => { if (call === 3) cancelled = true; });
        // A fill tween every frame of it, so it is declared every frame of it.
        const long = comp([probe()], Array.from({ length: 50 }, (_, i) => ({
            target: 'p', args: { fill: i % 2 ? '#ff0000' : '#0000ff' }, duration: 0.1,
        })));
        const result = await precompFor(project([
            track('a', hold(0.2)),
            track('b', long, { startAt: 0.2 }),
            track('c', hold(0.5), { startAt: 6 }),
        ]), { registry }).runAsync({ budgetMs: 0, isCancelled: () => cancelled });

        expect(result.tracks.map((t) => t.discovered)).toEqual([true, false, false]);
        expect(result.complete).toBe(false);
        // Stopped at the first yield after the cancel, not after fifty tweens.
        expect(log.declares).toBeLessThan(10);
    });

    it('collects a per-phase timing breakdown when a profile is injected', async () => {
        const profile = createAssetTimelineProfile();
        const result = await precompFor(trio(), {}, { profile }).runAsync({ budgetMs: 0 });

        expect(result.timings).toHaveLength(3);
        expect(result.timings?.[1]).toMatchObject({ trackId: 'b', trackIndex: 1, frameCount: 15 });
        // Every phase the pass walks is accounted for, and parked time is excluded —
        // budgetMs 0 yields between every frame, so a leak there would dwarf the total.
        const t = result.timings![1]!;
        expect(Object.keys(t.phases).sort()).toEqual(['audio', 'build', 'declare', 'evaluate']);
        expect(t.totalMs).toBeGreaterThanOrEqual(0);
        expect(t.totalMs).toBeLessThan(1000);
    });
});

describe('AssetTimeline.setProject', () => {
    it('re-discovers only the track whose clip changed, carrying the rest', () => {
        const a = track('a', hold(0.3));
        const c = track('c', hold(0.5), { startAt: 1 });
        const precomp = precompFor(project([a, track('b', hold(0.7), { startAt: 0.3 }), c]));
        const first = precomp.run();

        const next = precomp.setProject(project([a, track('b', hold(1.1), { startAt: 0.3 }), c]));
        expect(next.tracks.map((t) => t.discovered)).toEqual([true, false, true]);
        // A carried pass is the same pass, only re-stamped.
        expect(next.tracks[0].assetRecords).toBe(first.tracks[0].assetRecords);
        expect(next.tracks[2].assetRecords).toBe(first.tracks[2].assetRecords);

        const done = precomp.run();
        expect(done.tracks.map((t) => t.frameCount)).toEqual([3, 11, 5]);
        expect(done.complete).toBe(true);
    });

    it('moves a kept pass’s asset windows with its track', () => {
        const { registry, log } = probeRegistry();
        const a = track('a', hold(0.3));
        const b = still(picture('b.png', 100), probe());
        const precomp = precompFor(project([a, track('b', b, { startAt: 0.3, duration: 0.4 })]), { registry });
        expect(precomp.run().assets.get('b.png')!.record.startFrame).toBe(3);
        const declared = log.declares;

        const moved = precomp.setProject(project([a, track('b', b, { startAt: 0.6, duration: 0.4 })]));
        expect(moved.assets.get('b.png')!.record).toMatchObject({ startFrame: 6, endFrame: 9 });
        expect(moved.complete).toBe(true);
        expect(log.declares).toBe(declared);
    });

    it('carries every survivor’s pass across an insert, leaving only the newcomer to discover', () => {
        const { registry, log } = probeRegistry();
        const a = track('a', comp([probe()], [0.4]));
        const b = track('b', comp([probe()], [0.6]), { startAt: 0.4 });
        const precomp = precompFor(project([a, b]), { registry });
        precomp.run();
        const declared = log.declares;

        const next = precomp.setProject(project([a, track('mid', hold(0.3), { startAt: 0.2 }), b]));
        expect(next.tracks.map((t) => t.discovered)).toEqual([true, false, true]);
        expect(next.complete).toBe(false);
        expect(log.declares).toBe(declared);

        const done = precomp.run();
        expect(done.complete).toBe(true);
        expect(done.totalFrames).toBe(10);
        expect(log.declares).toBe(declared);
    });

    it('keeps both passes across a reorder, which moves no track', () => {
        const { registry, log } = probeRegistry();
        const a = track('a', comp([probe()], [0.4]));
        const b = track('b', comp([probe()], [0.6]), { startAt: 0.4 });
        const precomp = precompFor(project([a, b]), { registry });
        precomp.run();
        const declared = log.declares;

        const next = precomp.setProject(project([b, a]));
        expect(next.tracks.map((t) => t.id)).toEqual(['b', 'a']);
        expect(next.tracks.map((t) => t.startFrame)).toEqual([4, 0]);
        expect(next.complete).toBe(true);
        expect(log.declares).toBe(declared);
    });

    it('forgets a removed track and everything it declared', () => {
        const a = track('a', still(picture('a.png')), { duration: 0.5 });
        const precomp = precompFor(project([a, track('b', still(picture('b.png')), { duration: 0.5 })]));
        precomp.run();

        const next = precomp.setProject(project([a]));
        expect(next.tracks.map((t) => t.id)).toEqual(['a']);
        expect([...next.assets.keys()]).toEqual(['a.png']);
        expect(next.complete).toBe(true);
    });
});

describe('AssetTimeline.runAsync against a moving document', () => {
    it('never lands a pass for a track the document has since dropped', async () => {
        const { registry } = probeRegistry();
        const a = track('a', twoSteps([probe(), picture('a.png', 100)]));
        const b = track('b', hold(0.3));
        const precomp = precompFor(project([a, b]), { registry });

        const done = precomp.runAsync({ budgetMs: 0 });
        precomp.setProject(project([b, track('d', hold(0.7))]));
        const final = await done;

        expect(final.tracks.map((t) => t.id)).toEqual(['b', 'd']);
        expect(final.complete).toBe(true);
        expect(final.assets.has('a.png')).toBe(false);
    });

    it('discovers a track the document gained mid-pass, rather than leaving it pending', async () => {
        const { registry } = probeRegistry();
        const a = track('a', twoSteps());
        const precomp = precompFor(project([a]), { registry });

        const done = precomp.runAsync({ budgetMs: 0 });
        const reconciled = precomp.setProject(project([a, track('c', hold(0.5), { startAt: 2 })]));
        // Pending the instant it arrives…
        expect(reconciled.tracks[1].discovered).toBe(false);
        // …and the pass already running is what fills it in.
        const final = await done;

        expect(final.complete).toBe(true);
        expect(final.tracks.map((t) => t.discovered)).toEqual([true, true]);
    });

    it('keeps a synchronous re-discovery from being overwritten by the parked pass', async () => {
        const { registry, log } = probeRegistry();
        const precomp = precompFor(project([track('b', twoSteps())]), { registry });

        const done = precomp.runAsync({ budgetMs: 0 });
        // The editing case: the very track being discovered in the background is
        // replaced, and the host discovers the new clip synchronously for its frame.
        precomp.setProject(project([track('b', comp([probe('p'), probe('q')], [0.9]))]));
        const replaced = precomp.ensureCovering(0);
        expect(replaced.tracks[0].discovered).toBe(true);
        const declared = log.declares;

        const final = await done;
        expect(final.tracks[0].frameCount).toBe(9);
        // Nothing clobbered the new pass and made the loop discover it again.
        expect(log.declares).toBe(declared);
    });
});

describe('AssetTimeline.learn', () => {
    const discovered = () => {
        const precomp = precompFor(project([
            track('a', hold(0.5)),
            track('b', still(picture('img.png')), { startAt: 0.5, duration: 1 }),
        ]));
        return { precomp, before: precomp.run() };
    };

    it('widens a discovered track by what its draw found missing, on the project timeline', () => {
        const { precomp, before } = discovered();
        const learned = precomp.learn('b', 'pic', { type: 'image', src: 'late.png' }, 3);

        expect(learned.tracks[1].assetRecords.get('late.png')).toMatchObject({ startFrame: 3, endFrame: 3 });
        expect(learned.assets.get('late.png')!.record).toMatchObject({ startFrame: 8, endFrame: 8 });
        // A result already handed out is left as it was.
        expect(before.tracks[1].assetRecords.has('late.png')).toBe(false);
        expect(precomp.learn('b', 'pic', { type: 'image', src: 'late.png' }, 4).tracks[1].assetRecords.get('late.png'))
            .toMatchObject({ startFrame: 3, endFrame: 4 });
    });

    it('leaves a track alone that is not discovered, or not there', () => {
        const precomp = precompFor(project([track('b', still(picture('img.png')), { duration: 1 })]));
        expect(precomp.learn('b', 'pic', { type: 'image', src: 'late.png' }, 3).assets.has('late.png')).toBe(false);
        precomp.run();
        expect(precomp.learn('nope', 'pic', { type: 'image', src: 'late.png' }, 3).assets.has('late.png')).toBe(false);
    });
});

describe('AssetTimeline – one key, several holders', () => {
    const videoRect = (id: string, trims: { trimStart: number; trimEnd: number }, span: { startAt: number; endAt?: number }) => ({
        ...node(id, 'rect', { width: 64, height: 64, fill: Fills.video('clip.mp4', trims) }),
        ...span,
    });
    const fontText = (id: string, weight: number, startAt: number) => ({
        ...node(id, 'text', { text: 'hi', fontFamily: 'Inter', fontWeight: weight }),
        startAt,
    });

    it('lets the owner that starts first speak for a video\'s trims within a track', () => {
        const clip = comp([
            videoRect('late', { trimStart: 0, trimEnd: 4 }, { startAt: 2 }),
            videoRect('early', { trimStart: 2, trimEnd: 6 }, { startAt: 1 }),
        ], [3]);
        const record = precompFor(project([track('a', clip)]), { assets: mediaCatalog(64) }).run().assets.get('clip.mp4')!.record;

        expect(record).toMatchObject({ type: 'video', startFrame: 10, endFrame: 29, trimStart: 2, trimEnd: 6 });
    });

    it('lets the owner that starts first speak for a font\'s weight within a track', () => {
        const clip = comp([fontText('late', 700, 2), fontText('early', 300, 1)], [3]);
        const record = precompFor(project([track('a', clip)])).run().assets.get('Inter')!.record;

        expect(record).toMatchObject({ type: 'font', fontWeight: 300, startFrame: 10 });
    });

    it('lets the first holder speak across tracks, even when a later track starts earlier on the timeline', () => {
        const withTrims = (trimStart: number, trimEnd: number) =>
            still(videoRect('v', { trimStart, trimEnd }, { startAt: 0 }));
        const result = precompFor(project([
            track('first', withTrims(1, 3), { startAt: 2, duration: 1 }),
            track('second', withTrims(2, 9), { startAt: 0, duration: 1 }),
        ]), { assets: mediaCatalog(64) }).run();

        expect(result.assets.get('clip.mp4')!.record).toMatchObject({
            startFrame: 0, endFrame: 29, trimStart: 1, trimEnd: 3,
        });
    });

    it('lets the first holder speak for a font\'s weight across tracks', () => {
        const heavy = still(node('t', 'text', { text: 'hi', fontFamily: 'Inter', fontWeight: 900 }));
        const light = still(node('t', 'text', { text: 'hi', fontFamily: 'Inter', fontWeight: 100 }));
        const result = precompFor(project([
            track('heavy', heavy, { startAt: 1, duration: 1 }),
            track('light', light, { startAt: 0, duration: 1 }),
        ])).run();

        expect(result.assets.get('Inter')!.record).toMatchObject({ fontWeight: 900, startFrame: 0, endFrame: 19 });
    });

    it('lets the first holder\'s loader function speak across tracks', () => {
        const slow = async () => () => { };
        const fast = async () => () => { };
        // The probes of the two tracks declare in discovery order: the first track's, then the second's.
        const { registry } = probeRegistry((assets, call) => assets.loader('lang:ts', (call === 0 ? slow : fast) as never));
        const result = precompFor(project([
            track('a', comp([probe('p')], [0.5])),
            track('b', comp([probe('p')], [0.5])),
        ]), { registry }).run();

        const record = result.assets.get('lang:ts')!.record;
        expect(record.type === 'loader' && record.load).toBe(slow);
    });
});

describe('AssetTimeline – lead times', () => {
    const lead = (catalog: ReturnType<typeof mediaCatalog>, startAt = 20) =>
        precompFor(project([track('a', still(
            node('v', 'rect', { width: 64, height: 64, fill: Fills.video('clip.mp4') }),
            node('pic', 'rect', { width: 64, height: 64, fill: Fills.image('img.png') }),
        ), { startAt, duration: 1 })]), { assets: catalog }).run().assets;

    it('leads a source the catalog reports no size for by two frames, and a video by double that plus a second', () => {
        const assets = lead(mediaCatalog(0));
        // Starts on frame 200 at 10 fps.
        expect(assets.get('img.png')!.cacheAt).toBe(200 - 2);
        expect(assets.get('clip.mp4')!.cacheAt).toBe(200 - (2 * 2 + 10));
    });

    it('caps an image\'s and a video\'s lead at 120 frames, however large the decode', () => {
        const assets = lead(mediaCatalog(8192));
        expect(assets.get('img.png')!.cacheAt).toBe(200 - 120);
        expect(assets.get('clip.mp4')!.cacheAt).toBe(200 - 120);
    });

    it('floors the lead at zero for an asset needed from the first frame', () => {
        const assets = lead(mediaCatalog(8192), 0);
        expect(assets.get('img.png')!.cacheAt).toBe(0);
        expect(assets.get('clip.mp4')!.cacheAt).toBe(0);
    });
});

describe('AssetTimeline – the published asset map', () => {
    const build = () => precompFor(project([
        track('a', still(picture('img.png')), { duration: 1 }),
        track('b', hold(0.5), { startAt: 1 }),
    ]), { assets: mediaCatalog() });

    it('is the same map until something in it changes', () => {
        const precomp = build();
        const first = precomp.run();

        expect(precomp.result().assets).toBe(first.assets);
        expect(precomp.ensureCovering(0).assets).toBe(first.assets);
        expect(precomp.run().assets).toBe(first.assets);
    });

    it('keeps an unchanged key\'s entry when another key changes, and replaces the map', () => {
        const precomp = build();
        const first = precomp.run();
        const entry = first.assets.get('img.png');

        const learned = precomp.learn('a', 'pic', { type: 'image', src: 'late.png' }, 3);

        expect(learned.assets).not.toBe(first.assets);
        expect(learned.assets.get('img.png')).toBe(entry);
        expect(first.assets.has('late.png')).toBe(false);
    });

    it('is the same map again after a document that changes nothing is taken', () => {
        const precomp = build();
        const first = precomp.run();
        const same = precomp.setProject(project([
            track('a', still(picture('img.png')), { duration: 1 }),
            track('b', hold(0.5), { startAt: 1 }),
        ]));

        expect(same.assets).toBe(first.assets);
    });
});

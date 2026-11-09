import { describe, it, expect } from 'vitest';
import { AssetDeclaration } from '@/assets/scope';
import { AssetCatalog, ManifestAssetCatalog } from '@/assets/catalog';
import type { AssetManifest } from '@/assets/manifest';
import { Video } from "@/components/builtins/media/media";
import { Registry } from '@/document/registry';
import { advanceNodeTime, type MutableNodeTime } from '@/components/trees/node/node-time';
import { laidOut, recorded } from '@/components/trees/tests/recording-context.fixtures';
import { comp, node, precompFor, project, track } from '@/runtime/document.fixtures';

const VIDEO_SRC = 'clip.mp4';

function makeCatalog(): AssetCatalog {
    const manifest: AssetManifest = {
        image: {},
        audio: {},
        video: { [VIDEO_SRC]: { width: 800, height: 600, duration: 5, sizeBytes: 0, src: VIDEO_SRC } },
        font: {},
    };
    return new ManifestAssetCatalog(manifest);
}

/** What `video` declares for its picture. */
function declare(video: Video): ReadonlyMap<string, unknown> {
    const declaration = new AssetDeclaration(makeCatalog());
    video.declareAssets(declaration);
    return declaration.declarations;
}

/**
 * The audio a `video` row of these props schedules when its row starts at
 * `start`: it plays from its `play` command, and a row with none gets one per
 * segment, or one over its span while it plays.
 */
const soundOf = (props: Record<string, unknown>, start = 0) =>
    precompFor(project([track('a', comp([{ ...node('v', 'video', props), startAt: start }], [], 20))]), { registry: new Registry(), assets: makeCatalog() })
        .run().tracks[0].audioRequests;

describe("Video audio and picture", () => {
    it("schedules the video's own audio track", () => {
        const requests = soundOf({ width: 200, height: 100, src: VIDEO_SRC });

        expect(requests).toHaveLength(1);
        expect(requests[0].src).toBe(VIDEO_SRC);
    });

    it("registers no audio when muted", () => {
        expect(soundOf({ width: 200, height: 100, src: VIDEO_SRC, muted: true })).toHaveLength(0);
    });

    it("registers no audio when not playing", () => {
        expect(soundOf({ width: 200, height: 100, src: VIDEO_SRC, playing: false })).toHaveLength(0);
    });

    it("declares the picture as a video record", () => {
        const declared = declare(new Video({ width: 200, height: 100, src: VIDEO_SRC }));

        expect((declared.get(VIDEO_SRC) as { type: string } | undefined)?.type).toBe('video');
    });

    it("declares nothing without a src", () => {
        expect(declare(new Video({ width: 200, height: 100 })).size).toBe(0);
        expect(soundOf({ width: 200, height: 100 })).toHaveLength(0);
    });
});

/**
 * A schedule is the only way to express a **pause**, which is why the property
 * pinned down below is the one that cannot be got from `playing`: a paused
 * stretch consumes no source, so the clip resumes where it stopped.
 *
 * Both halves are checked against the same schedule, because keeping them in
 * step is the entire reason the feature is shaped this way. The picture is read
 * through the drawn fill's `timestamp`; the sound through the requests its
 * row schedules.
 */
describe("Video with a playback schedule", () => {
    /** The source time the picture is showing at `elapsed` seconds of node life. */
    function frameAt(video: Video, elapsed: number): number | null | undefined {
        if (!video.mounted) laidOut(video, { x: 0, y: 0, width: 200, height: 100 });
        const clock = video.time as MutableNodeTime;
        // `creation` is seeded on the node's *first* advance, so a node taken
        // straight to 10s would read `elapsed === 0` — see `advanceNodeTime`.
        // Seeding at zero is what the runtime does on the frame a node appears.
        if (!clock.started) advanceNodeTime(clock, 0);
        advanceNodeTime(clock, elapsed);
        const fills = recorded(video).graphics
            .flatMap((g) => g.ops() as readonly { kind: string; fills?: readonly { type: string; timestamp?: number | null }[] }[])
            .flatMap((op) => (op.kind === 'fill' ? op.fills ?? [] : []));
        return fills.find((fill) => fill.type === 'video')?.timestamp;
    }

    /** Plays 0–2s, pauses until 5s, then runs on. */
    const PAUSED = [
        { at: 0, from: 0, duration: 2 },
        { at: 5, from: 2, duration: Infinity },
    ];

    it("holds the frame it paused on rather than the clip's first", () => {
        const video = new Video({ width: 200, height: 100, src: VIDEO_SRC, segments: PAUSED });

        expect(frameAt(video, 1)).toBeCloseTo(1);
        // Paused. Two seconds of source have been consumed and none since — the
        // behaviour `playing: false` cannot produce, since it holds `trimStart`.
        expect(frameAt(video, 3)).toBeCloseTo(2);
        expect(frameAt(video, 4.9)).toBeCloseTo(2);
        // Resumed: it carries on from 2s of source, not from 5s.
        expect(frameAt(video, 6)).toBeCloseTo(3);
    });

    it("holds the first frame before the schedule starts", () => {
        const video = new Video({
            width: 200, height: 100, src: VIDEO_SRC,
            segments: [{ at: 2, from: 0, duration: Infinity }],
        });

        expect(frameAt(video, 1)).toBeCloseTo(0);
        expect(frameAt(video, 3)).toBeCloseTo(1);
    });

    it("advances at the segment's own rate", () => {
        const video = new Video({
            width: 200, height: 100, src: VIDEO_SRC,
            segments: [{ at: 0, from: 0, duration: 2, speed: 2 }, { at: 2, from: 4, duration: Infinity }],
        });

        expect(frameAt(video, 1)).toBeCloseTo(2);
        expect(frameAt(video, 3)).toBeCloseTo(5);
    });

    it("clamps at the clip's out point", () => {
        const video = new Video({
            width: 200, height: 100, src: VIDEO_SRC, trimEnd: 3,
            segments: [{ at: 0, from: 0, duration: Infinity }],
        });

        expect(frameAt(video, 10)).toBeCloseTo(3);
    });

    it("is the same frame however the playhead reached it", () => {
        // The property everything else rests on. Scrubbing straight to 6s must
        // give the frame a playthrough gives, or an export matches neither.
        const scrubbed = new Video({ width: 200, height: 100, src: VIDEO_SRC, segments: PAUSED });
        expect(frameAt(scrubbed, 6)).toBeCloseTo(3);

        const played = new Video({ width: 200, height: 100, src: VIDEO_SRC, segments: PAUSED });
        for (const t of [0, 1, 2, 3, 4, 5]) frameAt(played, t);
        expect(frameAt(played, 6)).toBeCloseTo(3);
    });

    it("schedules one audio clip per segment, cut where the picture is reading", () => {
        const requests = soundOf({ width: 200, height: 100, src: VIDEO_SRC, segments: PAUSED });

        expect(requests).toHaveLength(2);
        const [first, second] = requests;
        // The played stretch: source 0–2, laid down at the second it begins.
        expect(first.startAt).toBeCloseTo(0);
        expect(first.trimStart).toBeCloseTo(0);
        // The resume: source 2 onward, and it starts at 5s — the pause is silent
        // rather than the sound running on underneath a frozen picture.
        expect(second.startAt).toBeCloseTo(5);
        expect(second.trimStart).toBeCloseTo(2);
    });

    it("places segments on the node's own clock, which starts as it enters", () => {
        const requests = soundOf({ width: 200, height: 100, src: VIDEO_SRC, segments: PAUSED }, 3);
        expect(requests.map((r) => r.startAt)).toEqual([3, 8]);
    });

    it("carries each segment's own gain", () => {
        const requests = soundOf({
            width: 200, height: 100, src: VIDEO_SRC, volume: 1,
            segments: [{ at: 0, from: 0, duration: 1 }, { at: 2, from: 1, duration: 1, volume: 0.2 }],
        });

        expect(requests[0].volume).toBeCloseTo(1);
        // Ducked on the resume — one command, rather than a play plus a tween.
        expect(requests[1].volume).toBeCloseTo(0.2);
    });

    it("stays silent when muted, schedule or no", () => {
        expect(soundOf({
            width: 200, height: 100, src: VIDEO_SRC, muted: true, segments: PAUSED,
        })).toHaveLength(0);
    });

    it("leaves an unscheduled video exactly as it was", () => {
        // The default path: no segments, so `playing`/`timestamp` mean what they
        // always meant and every existing scene renders unchanged.
        const requests = soundOf({ width: 200, height: 100, src: VIDEO_SRC });

        expect(requests).toHaveLength(1);
        expect(requests[0].trimStart ?? 0).toBeCloseTo(0);
    });
});

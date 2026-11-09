import { describe, it, expect } from 'vitest';
import { placeTracks, spansCovering, totalFramesOf, trackFrameCount } from '@/runtime/placement';
import type { Track } from '@/document/project';
import type { StillDocument } from '@/document/types';
import { Registry } from '@/document/registry';
import { Rect } from "@/components/builtins/geometry/geometry";
import {
    FPS as DOC_FPS,
    comp,
    evaluatorFor,
    node,
    probeRegistry,
    project,
    track as clipTrack,
} from '@/runtime/document.fixtures';
import { FakeRenderContext } from '@/runtime/runtime.fixtures';
import { generated } from "@/components/factory/tests/generated.fixtures";

const FPS = 30;
const still: StillDocument = { kind: 'still', nodes: [] };
const track = (id: string, duration: number, startAt?: number): Track => ({ id, clip: still, duration, startAt });

describe('trackFrameCount', () => {
    it('rounds a length up to cover its last partial frame', () => {
        expect(trackFrameCount(1, FPS)).toBe(30);
        expect(trackFrameCount(1.01, FPS)).toBe(31);
    });

    it('gives a still one frame rather than none', () => {
        expect(trackFrameCount(0, FPS)).toBe(1);
        expect(trackFrameCount(Number.NaN, FPS)).toBe(1);
    });

    it('gives an unbounded length one frame, not an endless track', () => {
        expect(trackFrameCount(Infinity, FPS)).toBe(1);
        expect(trackFrameCount(-Infinity, FPS)).toBe(1);
    });

    it('gives a length that is not a number one frame, whatever it looks like', () => {
        for (const bad of ['2', '', null, undefined, {}, [3], true]) {
            expect(trackFrameCount(bad as unknown as number, FPS), String(bad)).toBe(1);
        }
    });

    it('gives a negative length one frame', () => {
        expect(trackFrameCount(-2, FPS)).toBe(1);
    });

    it('does not take a length on a frame boundary for one frame more because of float error', () => {
        // 123 frames at 60 fps is 2.05 s; 2.05 * 60 is 122.99999999999999 in floating point.
        expect(trackFrameCount(123 / 60, 60)).toBe(123);
        expect(trackFrameCount(0.3, 10)).toBe(3);
    });

    it('gives a track with an unbounded duration a one-frame span', () => {
        expect(placeTracks([track('a', Infinity, 1)], FPS)).toEqual([{ id: 'a', index: 0, startFrame: 30, endFrame: 30 }]);
    });
});

describe('placeTracks', () => {
    it('places each track at its own start, rounded to the nearest frame', () => {
        expect(placeTracks([track('a', 1), track('b', 0.5, 2.01)], FPS)).toEqual([
            { id: 'a', index: 0, startFrame: 0, endFrame: 29 },
            { id: 'b', index: 1, startFrame: 60, endFrame: 74 },
        ]);
    });

    it('rounds a start rather than flooring or ceiling it', () => {
        // 0.6 and 2.4 frames: a floor would put the first a frame early, a ceiling the second a frame late.
        const [a, b] = placeTracks([track('a', 1, 0.02), track('b', 1, 0.08)], FPS);
        expect(a.startFrame).toBe(1);
        expect(b.startFrame).toBe(2);
    });

    it('clamps a negative start to zero', () => {
        expect(placeTracks([track('a', 1, -1)], FPS)[0].startFrame).toBe(0);
    });

    it('does not move a track when a neighbour changes length', () => {
        const before = placeTracks([track('a', 1), track('b', 1, 2)], FPS);
        const after = placeTracks([track('a', 3), track('b', 1, 2)], FPS);
        expect(after[1]).toEqual(before[1]);
    });

    it('takes the length from the furthest track, not the sum', () => {
        expect(totalFramesOf(placeTracks([track('a', 1), track('b', 1, 0.5)], FPS))).toBe(45);
    });

    it('counts a gap toward the total, since the project runs through it', () => {
        expect(totalFramesOf(placeTracks([track('a', 1), track('b', 1, 2)], FPS))).toBe(90);
    });
});

describe('spansCovering', () => {
    it('returns every span over a frame, back to front', () => {
        const spans = placeTracks([track('bg', 3), track('a', 1), track('b', 1, 2)], FPS);
        expect(spansCovering(spans, 10).map(s => s.id)).toEqual(['bg', 'a']);
        expect(spansCovering(spans, 70).map(s => s.id)).toEqual(['bg', 'b']);
    });

    it('returns nothing over a gap', () => {
        const spans = placeTracks([track('a', 1), track('b', 1, 2)], FPS);
        expect(spansCovering(spans, 45)).toEqual([]);
    });
});

describe('StateEvaluator over placed tracks', () => {
    const probe = () => node('p', 'probe', { width: 10, height: 10 });
    const clip = () => comp([probe()], [{ target: 'p', args: { opacity: 0.5 }, duration: 1 }]);

    /** The local frame each probe drew at `frame`, in the order they drew. */
    function drawnAt(doc: ReturnType<typeof project>, frame: number) {
        const { registry, log } = probeRegistry();
        const evaluator = evaluatorFor(doc, { registry });
        evaluator.stateAt(frame);
        evaluator.render(new FakeRenderContext());
        return {
            drawn: log.renderTimes.map(t => Math.round(t * DOC_FPS)),
            active: evaluator.activeTrackIds,
            current: evaluator.currentTrackId,
        };
    }

    it('draws every covering track in list order, each on its own clock', () => {
        // Listed late-start first: paint order is the list, not the start.
        const doc = project([clipTrack('b', clip(), { startAt: 0.4 }), clipTrack('a', clip())]);
        expect(drawnAt(doc, 6)).toEqual({ drawn: [2, 6], active: ['b', 'a'], current: 'a' });
    });

    it('draws nothing between two tracks', () => {
        const doc = project([
            clipTrack('a', clip(), { duration: 0.2 }),
            clipTrack('b', clip(), { startAt: 0.8, duration: 0.2 }),
        ]);
        const { drawn, active } = drawnAt(doc, 5);
        expect(drawn).toEqual([]);
        expect(active).toEqual([]);
    });

    it('keeps the last track there was as current over a hole', () => {
        const evaluator = evaluatorFor(project([
            clipTrack('a', clip(), { duration: 0.2 }),
            clipTrack('b', clip(), { startAt: 0.8, duration: 0.2 }),
        ]), { registry: probeRegistry().registry });
        evaluator.stateAt(9);
        expect(evaluator.currentTrackId).toBe('b');
        evaluator.stateAt(5);
        expect(evaluator.currentTrackId).toBe('b');
    });

    /** A hole is a gap the author left; past the end is an overrun, which holds the last frame. */
    it('holds the final stack past the end rather than treating it as a hole', () => {
        const doc = project([
            clipTrack('a', clip(), { duration: 0.4 }),
            clipTrack('b', clip(), { startAt: 0.4, duration: 0.4 }),
        ]);
        const { drawn, active, current } = drawnAt(doc, 20);
        expect(active).toEqual(['b']);
        expect(drawn).toHaveLength(1);
        expect(current).toBe('b');
    });

    it('does not build a track it is not going to draw', () => {
        let built = 0;
        class Counted extends generated(Rect) {
            constructor(props: ConstructorParameters<typeof Rect>[0]) {
                super(props);
                built++;
            }
        }
        const registry = new Registry({ nodes: { counted: Counted as never } });
        const evaluator = evaluatorFor(project([
            clipTrack('a', comp([node('c', 'rect')], [0.2])),
            clipTrack('b', comp([node('c', 'counted')], [0.2]), { startAt: 0.8 }),
        ]), { registry });

        evaluator.stateAt(1);
        evaluator.stateAt(5);
        expect(built).toBe(0);
        evaluator.stateAt(8);
        expect(built).toBe(1);
    });
});

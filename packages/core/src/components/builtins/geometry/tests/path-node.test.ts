import { describe, it, expect } from 'vitest';
import { Path } from "@/components/builtins/geometry/geometry";
import { PathCommand } from '@/render/descriptors/path';
import { attached } from '@/components/trees/node/node.fixtures';
import { recorded } from '@/components/trees/tests/recording-context.fixtures';
import type { TweenStepper } from '@/tween/stepper';

const square = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
const triangle = 'M 0 0 L 10 0 L 5 10 Z';

/** Play a Command to completion, mirroring the playback advance loop. */
function runTween(step: TweenStepper, duration: number, steps: number): void {
    const dt = duration / steps;
    step.seek(0);
    // Feed frames until it finishes; the final advance crosses `duration` and
    // the stepper snaps to t=1 exactly.
    let done = false;
    while (!done) done = step.advance(dt);
}

describe('Path – data is a reactive property', () => {
    it('exposes the constructor data value', () => {
        const path = attached(new Path({ data: square }));
        expect(path.data).toBe(square);
    });

    it('defaults data to an empty string', () => {
        const path = new Path({});
        expect(path.data).toBe('');
    });

    it('updates data via set()', () => {
        const path = attached(new Path({ data: square }));
        path.set({ data: triangle });
        expect(path.data).toBe(triangle);
    });
});

describe('Path – animating data (morph)', () => {
    it('morphs data from the source toward the target during the tween', () => {
        const path = attached(new Path({ data: square }));
        const step = (path as any)._prepareStep({ data: triangle }, 1);

        // Midway, data should be a command array (an in-between morph), not a string.
        step.seek(0.5);
        const mid = path.data;
        expect(Array.isArray(mid)).toBe(true);
        const moves = (mid as PathCommand[]).filter((c) => c.type === 'M');
        expect(moves).toHaveLength(1);
    });

    it('lands exactly on the target shape at the end of the tween', () => {
        const path = attached(new Path({ data: square }));
        const step = path.to({ data: { data: triangle }, duration: 1 })._stepper();
        runTween(step, 1, 10);
        // The string-snap path restores the exact target at t=1.
        expect(path.data).toBe(triangle);
    });

    it('keeps the source shape at t=0', () => {
        const path = attached(new Path({ data: square }));
        const step = (path as any)._prepareStep({ data: triangle }, 1);
        step.seek(0);
        expect(path.data).toBe(square);
    });

    it('accepts a command array as the animation target', () => {
        const path = attached(new Path({ data: square }));
        const target: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 10, y: 0 },
            { type: 'L', x: 5, y: 10 },
            { type: 'Z' },
        ];
        const step = (path as any)._prepareStep({ data: target }, 1);
        step.seek(0.5);
        expect(Array.isArray(path.data)).toBe(true);
    });
});

describe('Path – centring', () => {
    const arch = 'M 0 0 C 0 100 100 100 100 0';

    /** The silhouette op's state, as the renderer receives it (filled, so it is drawn). */
    function pathState(node: Path): { centerBounds?: readonly number[] } {
        node.set({ fill: 'red' });
        const op = recorded(node).graphics
            .flatMap((g) => g.ops() as readonly { kind: string; state: unknown }[])
            .find((candidate) => candidate.kind === 'path');
        return (op?.state ?? {}) as { centerBounds?: readonly number[] };
    }

    it('centres on the tight box it hugs, not the control-point bounds', () => {
        const path = attached(new Path({ data: arch }));
        const size = path.measure({}, undefined as never);
        const [minX, minY, maxX, maxY] = pathState(path).centerBounds!;
        // The ink of the arch is 100 x 75, and so is the frame it is centred in.
        expect(size).toEqual({ width: 100, height: 75 });
        expect([maxX - minX, maxY - minY]).toEqual([100, 75]);
        expect(minY).toBe(0);
        expect(maxY).toBe(75);
    });

    it('follows a morph, whose data is a command array', () => {
        const path = attached(new Path({ data: square }));
        path.set({ data: [{ type: 'M', x: 5, y: 5 }, { type: 'L', x: 25, y: 5 }, { type: 'L', x: 25, y: 45 }] });
        expect(pathState(path).centerBounds).toEqual([5, 5, 25, 45]);
    });

    it('leaves an empty path to the renderer', () => {
        expect(pathState(attached(new Path({}))).centerBounds).toBeUndefined();
    });
});

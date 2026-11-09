import { describe, expect, it } from 'vitest';
import {
    defaultCodePhases,
    makeAnim,
    moveProgress,
    phasesFor,
    resolveTokenStates,
    sampleCurve,
    smoothstep,
    windowProgress,
    type AnimToken,
    type CodeTransition,
    type StructuralTransition,
} from '../transitions';
import { makeIdLine, makeIdToken, type IdLine } from '../tokens';

/**
 * The arithmetic of an edit in flight: when each part of it happens, how far
 * through that part a frame is, and what opacity a token is drawn at.
 */

describe('phasesFor', () => {
    it('removes first, reflows, then adds, overlapping a little, for an edit that does both', () => {
        expect(phasesFor(true, true)).toEqual({ out: [0, 0.38], move: [0.1, 0.68], in: [0.52, 1] });
    });

    it('spends the whole duration reflowing and adding when nothing is removed', () => {
        expect(phasesFor(false, true)).toEqual({ out: null, move: [0, 0.55], in: [0.38, 1] });
    });

    it('spends the whole duration removing and then closing up when nothing is added', () => {
        expect(phasesFor(true, false)).toEqual({ out: [0, 0.45], move: [0.22, 1], in: null });
    });

    it('only reflows an edit that neither adds nor removes', () => {
        expect(phasesFor(false, false)).toEqual({ out: null, move: [0, 1], in: null });
    });

    it('always has a move window that starts before it ends, inside 0..1', () => {
        for (const removed of [true, false]) {
            for (const added of [true, false]) {
                const { out, move, in: entering } = phasesFor(removed, added);
                for (const window of [out, move, entering]) {
                    if (!window) continue;
                    expect(window[0]).toBeGreaterThanOrEqual(0);
                    expect(window[1]).toBeLessThanOrEqual(1);
                    expect(window[0]).toBeLessThan(window[1]);
                }
            }
        }
    });

    it('is what a phase strategy defaults to', () => {
        expect(defaultCodePhases).toBe(phasesFor);
    });
});

describe('windowProgress', () => {
    it('is 0 before the window, 1 after it, and linear inside', () => {
        const window: [number, number] = [0.2, 0.6];
        expect(windowProgress(window, 0)).toBe(0);
        expect(windowProgress(window, 0.2)).toBe(0);
        expect(windowProgress(window, 0.4)).toBeCloseTo(0.5);
        expect(windowProgress(window, 0.5)).toBeCloseTo(0.75);
        expect(windowProgress(window, 0.6)).toBe(1);
        expect(windowProgress(window, 1)).toBe(1);
    });

    it('counts a missing window as complete, so a phase an edit does not have never holds it back', () => {
        expect(windowProgress(null, 0)).toBe(1);
        expect(windowProgress(null, 0.5)).toBe(1);
    });

    it('is a step for a window of no width', () => {
        expect(windowProgress([0.5, 0.5], 0.49)).toBe(0);
        expect(windowProgress([0.5, 0.5], 0.5)).toBe(0);
        expect(windowProgress([0.5, 0.5], 0.51)).toBe(1);
    });

    it('clamps a progress outside 0..1', () => {
        expect(windowProgress([0, 1], -1)).toBe(0);
        expect(windowProgress([0, 1], 2)).toBe(1);
    });
});

describe('smoothstep', () => {
    it('is 0 and 1 at the ends and half at the middle', () => {
        expect(smoothstep(0)).toBe(0);
        expect(smoothstep(1)).toBe(1);
        expect(smoothstep(0.5)).toBe(0.5);
    });

    it('starts and ends slowly', () => {
        expect(smoothstep(0.25)).toBeCloseTo(0.15625);
        expect(smoothstep(0.75)).toBeCloseTo(0.84375);
        expect(smoothstep(0.1)).toBeLessThan(0.1);
        expect(smoothstep(0.9)).toBeGreaterThan(0.9);
    });
});

describe('moveProgress', () => {
    it('is 1 for a settled frame, with no edit in flight', () => {
        expect(moveProgress(null)).toBe(1);
    });

    it('is the smoothstep of the progress through the move window', () => {
        const phases = phasesFor(true, true);
        // The move window is [0.10, 0.68]: its middle is 0.39.
        expect(moveProgress({ phases, progress: 0 })).toBe(0);
        expect(moveProgress({ phases, progress: 0.1 })).toBe(0);
        expect(moveProgress({ phases, progress: 0.39 })).toBeCloseTo(0.5);
        expect(moveProgress({ phases, progress: 0.68 })).toBe(1);
        expect(moveProgress({ phases, progress: 1 })).toBe(1);
    });

    it('eases rather than running straight through the window', () => {
        const phases = phasesFor(false, false);
        expect(moveProgress({ phases, progress: 0.25 })).toBeCloseTo(smoothstep(0.25));
        expect(moveProgress({ phases, progress: 0.25 })).toBeLessThan(0.25);
    });
});

describe('sampleCurve', () => {
    it('holds the first value before the first key and the last after the last', () => {
        expect(sampleCurve([0.2, 0.8], [1, 0.4], 0)).toBe(1);
        expect(sampleCurve([0.2, 0.8], [1, 0.4], 0.2)).toBe(1);
        expect(sampleCurve([0.2, 0.8], [1, 0.4], 0.8)).toBe(0.4);
        expect(sampleCurve([0.2, 0.8], [1, 0.4], 1)).toBe(0.4);
    });

    it('interpolates linearly between two keys', () => {
        expect(sampleCurve([0, 1], [1, 0.4], 0.5)).toBeCloseTo(0.7);
        expect(sampleCurve([0, 1], [0.4, 1], 0.25)).toBeCloseTo(0.55);
    });

    it('interpolates inside the segment p falls in, across several', () => {
        const keys = [0, 0.5, 1];
        const values = [0, 1, 0.5];
        expect(sampleCurve(keys, values, 0.25)).toBeCloseTo(0.5);
        expect(sampleCurve(keys, values, 0.5)).toBe(1);
        expect(sampleCurve(keys, values, 0.75)).toBeCloseTo(0.75);
    });

    it('takes a key that is a step: two keys at the same place', () => {
        const keys = [0, 0.5, 0.5, 1];
        const values = [1, 1, 0, 0];
        expect(sampleCurve(keys, values, 0.49)).toBe(1);
        expect(sampleCurve(keys, values, 0.51)).toBe(0);
    });

    it('is the one value of a curve with one key', () => {
        expect(sampleCurve([0.5], [0.3], 0)).toBe(0.3);
        expect(sampleCurve([0.5], [0.3], 1)).toBe(0.3);
    });
});

describe('makeAnim', () => {
    it('carries a token id with the curve of the opacity it takes', () => {
        const curve = { keys: [0, 1], values: [1, 0.4] };
        expect(makeAnim(7, curve)).toEqual({ id: 7, opacity: [1, 0.4], opacityKeys: [0, 1] });
    });
});

describe('resolveTokenStates', () => {
    const lines: IdLine[] = [makeIdLine([makeIdToken('a'), makeIdToken('b')]), makeIdLine([makeIdToken('c')])];
    const [a, b, c] = lines.flatMap((line) => line.tokens);

    const dimmed = (id: number, from: number, to: number, progress: number): CodeTransition => ({
        kind: 'dim',
        tokens: [makeAnim(id, { keys: [0, 1], values: [from, to] })] satisfies AnimToken[],
        progress,
    });

    it('has no state for a listing under no highlight and in no transition', () => {
        expect(resolveTokenStates(lines, [], null, new Set()).size).toBe(0);
    });

    it('holds the persistent dim: 1 inside the highlighted set and the dim outside', () => {
        const states = resolveTokenStates(lines, [], 0.3, new Set([a.id]));
        expect(states.get(a.id)).toEqual({ opacity: 1 });
        expect(states.get(b.id)).toEqual({ opacity: 0.3 });
        expect(states.get(c.id)).toEqual({ opacity: 0.3 });
        expect(states.size).toBe(3);
    });

    it('dims everything when the highlighted set is empty', () => {
        const states = resolveTokenStates(lines, [], 0.5, new Set());
        expect([...states.values()]).toEqual([{ opacity: 0.5 }, { opacity: 0.5 }, { opacity: 0.5 }]);
    });

    it('lets a dim transition overwrite its tokens by sampling its curve at its progress', () => {
        const states = resolveTokenStates(lines, [dimmed(b.id, 1, 0.2, 0.5)], 0.3, new Set([a.id]));
        expect(states.get(b.id)?.opacity).toBeCloseTo(0.6);
        // The tokens the transition does not name keep the persistent dim.
        expect(states.get(a.id)).toEqual({ opacity: 1 });
        expect(states.get(c.id)).toEqual({ opacity: 0.3 });
    });

    it('gives a token of a transition a state even when nothing is persistently dimmed', () => {
        const states = resolveTokenStates(lines, [dimmed(c.id, 0.4, 1, 0.25)], null, new Set());
        expect(states.size).toBe(1);
        expect(states.get(c.id)?.opacity).toBeCloseTo(0.55);
    });

    it('lets a later transition overwrite an earlier one on a shared token', () => {
        const states = resolveTokenStates(lines, [dimmed(a.id, 1, 0, 0), dimmed(a.id, 0.5, 0.5, 1)], null, new Set());
        expect(states.get(a.id)).toEqual({ opacity: 0.5 });
    });

    it('stacks transitions on different tokens', () => {
        const states = resolveTokenStates(lines, [dimmed(a.id, 1, 0, 1), dimmed(b.id, 0, 1, 1)], null, new Set());
        expect(states.get(a.id)).toEqual({ opacity: 0 });
        expect(states.get(b.id)).toEqual({ opacity: 1 });
    });

    it('leaves a structural transition out of it: it moves tokens and does not dim them', () => {
        const structural: StructuralTransition = {
            kind: 'structural',
            from: lines,
            to: lines,
            removedIds: new Set(),
            addedIds: new Set(),
            enteringLineIds: new Set(),
            fromColorById: new Map(),
            phases: phasesFor(false, false),
            progress: 0.5,
            layoutKey: null,
            fromLayout: null,
            toLayout: null,
        };
        expect(resolveTokenStates(lines, [structural], null, new Set()).size).toBe(0);
        expect(resolveTokenStates(lines, [structural], 0.3, new Set()).size).toBe(3);
    });
});

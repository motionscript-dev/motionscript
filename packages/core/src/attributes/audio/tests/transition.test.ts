import { describe, it, expect, vi } from 'vitest';
import { transitionGainAt, transitionKey, transitionSpans } from '@/attributes/audio/transition';

const linear = { kind: 'linear' } as const;

describe('transitionGainAt', () => {
    it('fades in over the first seconds and out over the last, 1 between', () => {
        const gain = (t: number) => transitionGainAt(t, 10, { duration: 2, curve: linear }, { duration: 4, curve: linear });
        expect(gain(0)).toBe(0);
        expect(gain(1)).toBeCloseTo(0.5);
        expect(gain(5)).toBe(1);
        expect(gain(8)).toBeCloseTo(0.5);
        expect(gain(10)).toBe(0);
    });

    it('defaults to equal power, whose in and out sum to constant power', () => {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const out = transitionGainAt(t, 1, undefined, { duration: 1 });
            const into = transitionGainAt(t, 1, { duration: 1 });
            expect(out * out + into * into).toBeCloseTo(1);
        }
        expect(transitionGainAt(0.5, 1, { duration: 1 })).toBeCloseTo(Math.SQRT1_2);
    });

    it('reads an eased curve as entering, and plays it backwards to leave', () => {
        const quad = { kind: 'in', args: 'quad' } as const;
        expect(transitionGainAt(0.5, 4, { duration: 1, curve: quad })).toBeCloseTo(0.25);
        expect(transitionGainAt(3.5, 4, undefined, { duration: 1, curve: quad })).toBeCloseTo(0.25);
    });

    it('shrinks both in proportion when together they overrun the clip', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        expect(transitionSpans(2, { duration: 3 }, { duration: 1 })).toEqual({ in: 1.5, out: 0.5 });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('has no end to leave from on an open clip', () => {
        expect(transitionSpans(Infinity, { duration: 1 }, { duration: 1 })).toEqual({ in: 1, out: 0 });
        expect(transitionGainAt(100, Infinity, undefined, { duration: 1 })).toBe(1);
    });
});

describe('transitionKey', () => {
    it('tells shapes and lengths apart', () => {
        const keys = [
            transitionKey(undefined),
            transitionKey({ duration: 1 }),
            transitionKey({ duration: 2 }),
            transitionKey({ duration: 1, curve: linear }),
        ];
        expect(new Set(keys).size).toBe(keys.length);
        expect(transitionKey({ duration: 1 })).toBe(transitionKey({ duration: 1, curve: 'equalPower' }));
    });
});

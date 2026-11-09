import { describe, it, expect } from 'vitest';
import { resolveStroke, strokeOps } from '@/attributes/shape/stroke/stroke';

describe('stroke end caps', () => {
    it('leaves both ends following `cap` when unset', () => {
        const stroke = resolveStroke({ cap: 'round' });
        expect(stroke.startCap).toBeUndefined();
        expect(stroke.endCap).toBeUndefined();
    });

    it('resolves each end on its own', () => {
        const stroke = resolveStroke({ cap: 'butt', startCap: 'round', endCap: 'square' });
        expect(stroke).toMatchObject({ cap: 'butt', startCap: 'round', endCap: 'square' });
    });

    it('carries an end from previous when unspecified', () => {
        const previous = resolveStroke({ startCap: 'round' });
        expect(resolveStroke({ weight: 4 }, previous).startCap).toBe('round');
    });

    it('snaps at the midpoint of a tween, like `cap`', () => {
        const [from] = strokeOps.resolve({ endCap: 'butt' });
        const [to] = strokeOps.resolve({ endCap: 'round' });
        expect(strokeOps.lerp([from], [to], 0.4)[0].endCap).toBe('butt');
        expect(strokeOps.lerp([from], [to], 0.6)[0].endCap).toBe('round');
    });

    it('takes a marker on either end, and never on `cap`', () => {
        const stroke = resolveStroke({ cap: 'arrow' as never, startCap: 'dot', endCap: 'triangle' });
        expect(stroke).toMatchObject({ cap: 'butt', startCap: 'dot', endCap: 'triangle' });
    });

    it('sizes a marker by `capScale`, four weights long unless told', () => {
        expect(resolveStroke({ endCap: 'arrow' }).capScale).toBe(4);
        expect(resolveStroke({ capScale: 6 }).capScale).toBe(6);
        expect(resolveStroke({ capScale: -2 }).capScale).toBe(0);
        expect(resolveStroke({ weight: 3 }, resolveStroke({ capScale: 6 })).capScale).toBe(6);
    });

    it('tweens `capScale` and snaps the marker itself', () => {
        const [from] = strokeOps.resolve({ endCap: 'triangle', capScale: 2 });
        const [to] = strokeOps.resolve({ endCap: 'stealth', capScale: 6 });
        const mid = strokeOps.lerp([from], [to], 0.25)[0];
        expect(mid.capScale).toBe(3);
        expect(mid.endCap).toBe('triangle');
    });
});

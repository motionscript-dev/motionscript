import { describe, it, expect, vi } from 'vitest';
import {
    ramp,
    hold,
    isRamp,
    resolveRamp,
    sampleRamp,
    staticValue,
    lerpParam,
    equalsParam,
    paramKey,
    integrateSpeedToClipTime,
    sourceTimeAtClipElapsed,
    type Ramp,
} from '@/attributes/audio/ramp';
import { clipDurationOf, clipTimeAtSource, sourceTimeAtClip } from '@/attributes/audio/schedule';
import { easeIn, easeInOut, easeOut } from '@/tween/ease/constants';
import { curveEase } from '@/tween/ease/curve';

describe('ramp builders', () => {
    it('places segments before a bare hold from the start and after it from the end', () => {
        expect(ramp(0, 1, 0.5).hold().ramp(1, 0, 1).keys).toEqual([
            { at: 0, value: 0 },
            { at: 0.5, value: 1 },
            { before: 1, value: 1 },
            { before: 0, value: 0 },
        ]);
    });

    it('places a chain with no bare hold from the start', () => {
        expect(ramp(1, 0.3, 0.5).hold(2.5).ramp(0.3, 1, 0.5).keys).toEqual([
            { at: 0, value: 1 },
            { at: 0.5, value: 0.3 },
            { at: 3, value: 0.3 },
            { at: 3.5, value: 1 },
        ]);
    });

    it('continues a segment with no `from` from the one before', () => {
        expect(hold(1).ramp(0, 1, 1).keys).toEqual([{ at: 1, value: 0 }, { at: 2, value: 1 }]);
    });

    it('is immutable', () => {
        const base = ramp(0, 1, 0.5);
        base.hold(1);
        expect(base.keys).toHaveLength(2);
    });

    it('stores an engine-built ease as its spec', () => {
        expect(ramp(0, 1, 1, { ease: easeInOut('cubic') }).keys[1]).toEqual({ at: 1, value: 1, ease: { kind: 'inOut', args: 'cubic' } });
        expect(ramp(0, 1, 1, { ease: easeOut({ type: 'back', overshoot: 2 }) }).keys[1].ease)
            .toEqual({ kind: 'out', args: { type: 'back', overshoot: 2 } });
        const points = [{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 1, y: 1 }];
        expect(ramp(0, 1, 1, { ease: curveEase(points) }).keys[1].ease).toEqual({ kind: 'custom', args: points });
        expect(ramp(0, 1, 1, { ease: { kind: 'in', args: 'quad' } }).keys[1].ease).toEqual({ kind: 'in', args: 'quad' });
    });

    it('refuses an ease it cannot store', () => {
        expect(() => ramp(0, 1, 1, { ease: (t) => t * t })).toThrow(TypeError);
    });

    it('round-trips through JSON', () => {
        const built = ramp(0, 1, 0.5, { ease: easeIn('quad') }).hold().ramp(1, 0, 1);
        const parsed = JSON.parse(JSON.stringify(built)) as Ramp;
        expect(isRamp(parsed)).toBe(true);
        expect(parsed).toEqual({ keys: built.keys });
        for (const t of [0, 0.25, 0.5, 2, 4.5, 5]) {
            expect(sampleRamp(parsed, t, 5, 0)).toBeCloseTo(sampleRamp(built, t, 5, 0));
        }
        expect(paramKey(parsed)).toBe(paramKey(built));
        expect(equalsParam(parsed, built)).toBe(true);
    });
});

describe('resolveRamp and sampleRamp', () => {
    const fade: Ramp = { keys: [{ at: 0, value: 0 }, { at: 0.5, value: 1 }, { before: 1, value: 1 }, { before: 0, value: 0 }] };

    it('anchors `before` keys to the end of whatever length the clip has', () => {
        expect(resolveRamp(fade, 5).map((k) => k.time)).toEqual([0, 0.5, 4, 5]);
        expect(resolveRamp(fade, 3).map((k) => k.time)).toEqual([0, 0.5, 2, 3]);
        expect(sampleRamp(fade, 4.5, 5, 1)).toBeCloseTo(0.5);
        expect(sampleRamp(fade, 2.5, 3, 1)).toBeCloseTo(0.5);
    });

    it('holds the first value before the first key and the last after it', () => {
        const r: Ramp = { keys: [{ at: 1, value: 0.2 }, { at: 2, value: 0.8 }] };
        expect(sampleRamp(r, 0, 10, 1)).toBe(0.2);
        expect(sampleRamp(r, 9, 10, 1)).toBe(0.8);
    });

    it('eases the segment arriving at a key', () => {
        const r: Ramp = { keys: [{ at: 0, value: 0 }, { at: 1, value: 1, ease: { kind: 'in', args: 'quad' } }] };
        expect(sampleRamp(r, 0.5, 1, 0)).toBeCloseTo(0.25);
        expect(resolveRamp(r, 1)[1].linear).toBe(false);
    });

    it('jumps where two keys share a time', () => {
        const r: Ramp = { keys: [{ at: 0, value: 1 }, { at: 1, value: 1 }, { at: 1, value: 0 }] };
        expect(sampleRamp(r, 1.5, 2, 1)).toBe(0);
    });

    it('clamps to the clip and sorts keys whose anchors cross, with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const keys = resolveRamp({ keys: [{ at: 0, value: 0 }, { at: 2, value: 1 }, { before: 1, value: 1 }, { before: 0, value: 0 }] }, 1.5);
        expect(keys.map((k) => k.time)).toEqual([0, 0.5, 1.5, 1.5]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('falls back with no keys', () => {
        expect(sampleRamp({ keys: [] }, 1, 2, 0.7)).toBe(0.7);
    });
});

describe('Param helpers', () => {
    it('staticValue reads the start of a ramp', () => {
        expect(staticValue(2)).toBe(2);
        expect(staticValue(ramp(0.3, 1, 1))).toBeCloseTo(0.3);
        expect(staticValue({ keys: [{ before: 0, value: 0.4 }] })).toBe(0.4);
    });

    it('lerpParam lerps numbers and hard-cuts a ramp', () => {
        expect(lerpParam(0, 10, 0.5)).toBeCloseTo(5);
        const r = ramp(0, 1, 1);
        expect(lerpParam(2, r, 0.4)).toBe(2);
        expect(lerpParam(2, r, 0.6)).toBe(r);
    });

    it('equalsParam and paramKey compare ramps by shape', () => {
        expect(equalsParam(ramp(0, 1, 1), ramp(0, 1, 1))).toBe(true);
        expect(equalsParam(ramp(0, 1, 1), ramp(0, 1, 2))).toBe(false);
        expect(equalsParam(2, ramp(0, 1, 1))).toBe(false);
        const keys = [
            paramKey(ramp(0, 1, 1)),
            paramKey(ramp(0, 1, 1, { ease: easeIn('quad') })),
            paramKey(ramp(0, 1, 1, { ease: easeInOut('quad') })),
            paramKey(ramp(0, 1, 1, { ease: easeInOut('cubic') })),
        ];
        expect(new Set(keys).size).toBe(keys.length);
        expect(paramKey(ramp(0, 1, 1, { ease: easeInOut('cubic') }))).toBe(paramKey(ramp(0, 1, 1, { ease: easeInOut('cubic') })));
    });
});

describe('speed', () => {
    it('a constant 2× ramp halves the clip time', () => {
        expect(integrateSpeedToClipTime(ramp(2, 2, 4), 4)).toBeCloseTo(2, 2);
        expect(integrateSpeedToClipTime(ramp(0.5, 0.5, 4), 4)).toBeCloseTo(8, 2);
    });

    it('the source-time inverse round-trips with the forward integral', () => {
        const speed = ramp(1, 2, 4);
        const total = integrateSpeedToClipTime(speed, 4);
        const half = sourceTimeAtClipElapsed(speed, 4, total / 2);
        expect(integrateSpeedToClipTime(speed, 4, half)).toBeCloseTo(total / 2, 2);
        expect(sourceTimeAtClipElapsed(speed, 4, total)).toBeCloseTo(4, 1);
    });

    it('answers a device scheduling a long clip without walking it from zero each time', () => {
        const speed = ramp(1, 2, 60);
        const total = integrateSpeedToClipTime(speed, 60);
        // ∫ 1/(1 + τ/60) dτ over 60 s = 60 ln 2.
        expect(total).toBeCloseTo(60 * Math.LN2, 3);
        const started = performance.now();
        for (let s = 0; s < total; s += 1 / 200) sourceTimeAtClipElapsed(speed, 60, s);
        expect(performance.now() - started).toBeLessThan(250);
        expect(sourceTimeAtClipElapsed(speed, 60, 30 * Math.LN2)).toBeCloseTo(60 * (Math.SQRT2 - 1), 2);
    });

    it('scalar and ramp speeds share one pair of conversions', () => {
        expect(clipTimeAtSource(2, 4)).toBe(2);
        expect(sourceTimeAtClip(2, 4, 1)).toBe(2);
        expect(clipTimeAtSource(0, 4)).toBe(4);
        expect(sourceTimeAtClip(ramp(2, 2, 4), 4, 1)).toBeCloseTo(2, 2);
    });

    it('clipDurationOf places a speed ramp on the trimmed source, not the whole file', () => {
        // A ramp anchored to the out-point: the last 2 source seconds play at 2×.
        const speed: Ramp = { keys: [{ before: 2, value: 1 }, { before: 2, value: 2 }] };
        expect(clipDurationOf({ trimStart: 1, trimEnd: 7, speed }, 20)).toBeCloseTo(4 + 1, 2);
        expect(clipDurationOf({ trimStart: 1, speed: 2 }, 9)).toBe(4);
    });
});

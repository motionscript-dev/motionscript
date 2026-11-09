import { describe, it, expect } from 'vitest';
import { linear, easeIn, easeOut, easeInOut, type StandardEase } from '@/tween/ease/constants';

function endpoints(fn: (t: number) => number, atOne = 1) {
    expect(fn(0)).toBeCloseTo(0, 5);
    expect(fn(1)).toBeCloseTo(atOne, 5);
}

describe('linear', () => {
    it('is identity in [0,1]', () => {
        expect(linear()(0)).toBe(0);
        expect(linear()(0.5)).toBe(0.5);
        expect(linear()(1)).toBe(1);
    });
    it('clamps below 0 and above 1', () => {
        expect(linear()(-0.5)).toBe(0);
        expect(linear()(2)).toBe(1);
    });
});

describe('easeIn(quad) / easeOut(quad)', () => {
    it('endpoints', () => {
        endpoints(easeIn('quad'));
        endpoints(easeOut('quad'));
    });
    it('easeIn(quad)(0.5) < 0.5', () => {
        expect(easeIn('quad')(0.5)).toBeLessThan(0.5);
    });
    it('easeOut(quad)(0.5) > 0.5', () => {
        expect(easeOut('quad')(0.5)).toBeGreaterThan(0.5);
    });
    it('clamps to [0,1] range', () => {
        expect(easeIn('quad')(-1)).toBe(0);
        expect(easeOut('quad')(2)).toBe(1);
    });
});

describe('easeOut(quart)', () => {
    it('endpoints', () => endpoints(easeOut('quart')));
    it('decelerates strongly (f(0.5) > easeOut(quad)(0.5))', () => {
        expect(easeOut('quart')(0.5)).toBeGreaterThan(easeOut('quad')(0.5));
    });
});

describe('easeInOut(quad)', () => {
    it('endpoints', () => endpoints(easeInOut('quad')));
    it('symmetric around 0.5', () => {
        expect(easeInOut('quad')(0.5)).toBeCloseTo(0.5, 5);
        expect(easeInOut('quad')(0.25)).toBeCloseTo(1 - easeInOut('quad')(0.75), 5);
    });
});

describe('easeOut(back)', () => {
    it('endpoints (default overshoot)', () => endpoints(easeOut('back')));
    it('overshoots above 1 before reaching endpoint', () => {
        const fn = easeOut('back');
        let overshot = false;
        for (let t = 0; t <= 1; t += 0.02) {
            if (fn(t) > 1.01) overshot = true;
        }
        expect(overshot).toBe(true);
    });
});

describe('easeIn(back)', () => {
    it('endpoints', () => endpoints(easeIn('back')));
    it('dips below 0 before settling', () => {
        const fn = easeIn('back');
        let dipped = false;
        for (let t = 0; t <= 1; t += 0.02) {
            if (fn(t) < -0.01) dipped = true;
        }
        expect(dipped).toBe(true);
    });
});

describe('easeInOut(back)', () => {
    it('endpoints', () => endpoints(easeInOut('back')));
    it('midpoint is ~0.5', () => {
        expect(easeInOut('back')(0.5)).toBeCloseTo(0.5, 5);
    });
});

describe('elastic eases', () => {
    it('endpoints for easeOut(elastic)', () => endpoints(easeOut('elastic')));
    it('endpoints for easeIn(elastic)', () => endpoints(easeIn('elastic')));
    it('endpoints for easeInOut(elastic)', () => endpoints(easeInOut('elastic')));

    it('oscillates somewhere in the middle', () => {
        const fn = easeOut('elastic');
        let above1 = false;
        for (let t = 0; t <= 1; t += 0.01) {
            if (fn(t) > 1.001) above1 = true;
        }
        expect(above1).toBe(true);
    });
});

describe('config object overrides', () => {
    it('back honors custom overshoot', () => {
        const mild = easeOut({ type: 'back', overshoot: 0.5 });
        const wild = easeOut({ type: 'back', overshoot: 4 });
        expect(Math.max(...Array.from({ length: 50 }, (_, i) => wild(i / 49))))
            .toBeGreaterThan(Math.max(...Array.from({ length: 50 }, (_, i) => mild(i / 49))));
    });

    it('elastic honors custom amplitude/period', () => {
        const fn = easeOut({ type: 'elastic', amplitude: 2, period: 0.5 });
        endpoints(fn);
    });
});

const FAMILIES: StandardEase[] = [
    'sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce',
];
const DIRECTIONS = { easeIn, easeOut, easeInOut } as const;

describe('every family in every direction', () => {
    const cases = FAMILIES.flatMap((family) =>
        (Object.keys(DIRECTIONS) as (keyof typeof DIRECTIONS)[]).map((direction) => [family, direction] as const));

    it.each(cases)('%s %s starts at 0 and ends at 1', (family, direction) => {
        const ease = DIRECTIONS[direction](family);
        expect(ease(0)).toBeCloseTo(0, 6);
        expect(ease(1)).toBeCloseTo(1, 6);
    });

    it.each(cases)('%s %s clamps its input to [0, 1]', (family, direction) => {
        const ease = DIRECTIONS[direction](family);
        expect(ease(-3)).toBe(ease(0));
        expect(ease(7)).toBe(ease(1));
    });
});

/**
 * Reference values at t = 0.25, 0.5 and 0.75, one family per row. They are
 * hand-checked against the closed forms in the comments, so a change to a
 * constant or a formula fails here by name instead of drifting a curve.
 */
describe('reference values', () => {
    const expected: Record<StandardEase, { in: number[]; out: number[]; inOut: number[] }> = {
        // 1 - cos(t * pi / 2)
        sine: {
            in: [0.0761204674887, 0.292893218813, 0.617316567635],
            out: [0.382683432365, 0.707106781187, 0.923879532511],
            inOut: [0.146446609407, 0.5, 0.853553390593],
        },
        quad: {
            in: [0.0625, 0.25, 0.5625],
            out: [0.4375, 0.75, 0.9375],
            inOut: [0.125, 0.5, 0.875],
        },
        // t ** 3
        cubic: {
            in: [0.015625, 0.125, 0.421875],
            out: [0.578125, 0.875, 0.984375],
            inOut: [0.0625, 0.5, 0.9375],
        },
        quart: {
            in: [0.00390625, 0.0625, 0.31640625],
            out: [0.68359375, 0.9375, 0.99609375],
            inOut: [0.03125, 0.5, 0.96875],
        },
        // t ** 5
        quint: {
            in: [0.0009765625, 0.03125, 0.2373046875],
            out: [0.7626953125, 0.96875, 0.9990234375],
            inOut: [0.015625, 0.5, 0.984375],
        },
        // 2 ** (10 * (t - 1))
        expo: {
            in: [0.00552427172802, 0.03125, 0.176776695297],
            out: [0.823223304703, 0.96875, 0.994475728272],
            inOut: [0.015625, 0.5, 0.984375],
        },
        // 1 - sqrt(1 - t * t)
        circ: {
            in: [0.0317541634481, 0.133974596216, 0.338562172234],
            out: [0.661437827766, 0.866025403784, 0.968245836552],
            inOut: [0.0669872981078, 0.5, 0.933012701892],
        },
        // t * t * ((s + 1) * t - s), s = 1.70158; in-out scales s by 1.525
        back: {
            in: [-0.0641365625, -0.0876975, 0.1825903125],
            out: [0.8174096875, 1.0876975, 1.0641365625],
            inOut: [-0.09968184375, 0.5, 1.09968184375],
        },
        // amplitude 1, period 0.3 (0.45 in-out)
        elastic: {
            in: [-0.00552427172802, -0.015625, 0.0883883476483],
            out: [0.911611652352, 1.015625, 1.00552427173],
            inOut: [0.0119694444237, 0.5, 0.988030555576],
        },
        // 1 - bounceOut(1 - t), with the 7.5625 / 2.75 steps
        bounce: {
            in: [0.02734375, 0.234375, 0.52734375],
            out: [0.47265625, 0.765625, 0.97265625],
            inOut: [0.1171875, 0.5, 0.8828125],
        },
    };

    it.each(FAMILIES)('%s', (family) => {
        const at = [0.25, 0.5, 0.75];
        at.forEach((t, i) => {
            expect(easeIn(family)(t)).toBeCloseTo(expected[family].in[i], 9);
            expect(easeOut(family)(t)).toBeCloseTo(expected[family].out[i], 9);
            expect(easeInOut(family)(t)).toBeCloseTo(expected[family].inOut[i], 9);
        });
    });

    it('scales back\'s in-out overshoot by 1.525 and leaves easeIn alone', () => {
        // The explicit value goes through the same scaling: overshoot 1 becomes 1.525.
        expect(easeInOut({ type: 'back', overshoot: 1 })(0.25)).toBeCloseTo(-0.0328125, 9);
        expect(easeIn({ type: 'back', overshoot: 1 })(0.75)).toBeCloseTo(0.5625 * (2 * 0.75 - 1), 9);
    });

    it('defaults the elastic period to 0.45 in-out and 0.3 otherwise', () => {
        expect(easeInOut('elastic')(0.25)).toBeCloseTo(0.0119694444237, 9);
        // Asking for 0.3 explicitly is a different curve from the in-out default.
        expect(easeInOut({ type: 'elastic', period: 0.3 })(0.25)).toBeCloseTo(-0.0078125, 9);
        expect(easeIn({ type: 'elastic', period: 0.3 })(0.5)).toBe(easeIn('elastic')(0.5));
    });

    it('uses quad when no family is given', () => {
        expect(easeIn()(0.5)).toBe(easeIn('quad')(0.5));
        expect(easeOut({})(0.5)).toBe(easeOut('quad')(0.5));
        expect(easeInOut({ overshoot: 3 })(0.25)).toBe(easeInOut('quad')(0.25));
    });
});

describe('what an ease does not guard against', () => {
    // `elastic` computes asin(1 / amplitude), so an amplitude under 1 or a
    // period of 0 makes every value strictly between the ends NaN.
    it.todo('keeps an elastic ease finite for any amplitude and period it accepts');
    // A family nothing defines is looked up when the ease is first called,
    // not when it is made, so a typo fails on the first frame of a build.
    it.todo('refuses an unknown family when the ease is created');
});

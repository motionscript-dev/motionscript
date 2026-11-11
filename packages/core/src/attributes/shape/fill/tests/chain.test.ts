import { describe, it, expect } from 'vitest';
import { Fills, resolveChainFill } from '@/attributes/shape/fill/chain';

describe('Fills builders', () => {
    it('color produces a single solid fill', () => {
        expect([...Fills.color('red')]).toEqual([{ type: 'solid', color: 'red' }]);
    });

    it('color carries opacity and blend options', () => {
        expect([...Fills.color('red', { opacity: 0.3, blend: 'overlay' })]).toEqual([
            { type: 'solid', color: 'red', opacity: 0.3, blend: 'overlay' },
        ]);
    });

    it('image produces an image fill with common options merged', () => {
        expect([...Fills.image('@/attributes/shape/fill/bg.jpg', { blend: 'overlay', opacity: 0.2 })]).toEqual([
            { type: 'image', src: '@/attributes/shape/fill/bg.jpg', blend: 'overlay', opacity: 0.2 },
        ]);
    });

    it('omits undefined option keys so props stay minimal', () => {
        expect([...Fills.color('red')]).toEqual([{ type: 'solid', color: 'red' }]);
        expect(Object.keys([...Fills.color('red')][0])).toEqual(['type', 'color']);
    });

    it('linearGradient pulls gradient fields out of options', () => {
        expect([...Fills.linearGradient(['red', 'blue'], { opacity: 0.5, start: { x: 0, y: 0 } })]).toEqual([
            { type: 'linear-gradient', colors: ['red', 'blue'], start: { x: 0, y: 0 }, opacity: 0.5 },
        ]);
    });
});

describe('FillChain', () => {
    it('appends fills in order while staying immutable', () => {
        const base = Fills.image('@/attributes/shape/fill/bg.jpg', { opacity: 0.2 });
        const extended = base.color('red', { opacity: 0.3 });
        expect(base.list).toHaveLength(1);
        expect(extended.list).toHaveLength(2);
        expect(extended.list[1]).toEqual({ type: 'solid', color: 'red', opacity: 0.3 });
    });

    it('matches the example from the request', () => {
        const chain = Fills.image('@/attributes/shape/fill/background.jpg', { blend: 'overlay', opacity: 0.2 })
            .color('red', { opacity: 0.3 });
        expect([...chain]).toEqual([
            { type: 'image', src: '@/attributes/shape/fill/background.jpg', blend: 'overlay', opacity: 0.2 },
            { type: 'solid', color: 'red', opacity: 0.3 },
        ]);
    });

    it('is iterable for spreading into an array', () => {
        const arr = [...Fills.color('red').color('blue')];
        expect(arr).toHaveLength(2);
        expect(arr[0]).toEqual({ type: 'solid', color: 'red' });
    });

    it('toJSON returns the raw fill list', () => {
        const chain = Fills.color('red');
        expect(chain.toJSON()).toBe(chain.list);
    });
});

describe('resolveChainFill', () => {
    it('returns [] for undefined', () => {
        expect(resolveChainFill(undefined)).toEqual([]);
    });

    it('unwraps a FillChain to its list', () => {
        const chain = Fills.color('red');
        expect(resolveChainFill(chain)).toBe(chain.list);
    });

    it('passes a plain array through (as a flat copy)', () => {
        const arr = [{ type: 'solid', color: 'red' } as const];
        expect(resolveChainFill(arr)).toEqual(arr);
    });

    it('wraps a single fill into an array', () => {
        expect(resolveChainFill({ type: 'solid', color: 'red' })).toEqual([{ type: 'solid', color: 'red' }]);
    });

    it('wraps a plain string fill into an array', () => {
        expect(resolveChainFill('red')).toEqual(['red']);
    });

    it('flattens a FillChain used as an array element', () => {
        expect(resolveChainFill(['#e8c584', Fills.image('bg.jpg')])).toEqual([
            '#e8c584',
            { type: 'image', src: 'bg.jpg' },
        ]);
    });

    it('flattens a multi-layer FillChain element in place', () => {
        const chain = Fills.image('bg.jpg', { opacity: 0.2 }).color('red');
        expect(resolveChainFill(['#e8c584', chain, 'blue'])).toEqual([
            '#e8c584',
            { type: 'image', src: 'bg.jpg', opacity: 0.2 },
            { type: 'solid', color: 'red' },
            'blue',
        ]);
    });

    it('treats spread and element forms equivalently', () => {
        const spread = resolveChainFill(['#e8c584', ...Fills.image('bg.jpg')]);
        const element = resolveChainFill(['#e8c584', Fills.image('bg.jpg')]);
        expect(spread).toEqual(element);
    });

    it('flattens the plain array a nested chain serializes to', () => {
        const live = ['#e8c584', Fills.image('bg.jpg')];
        expect(resolveChainFill(JSON.parse(JSON.stringify(live)))).toEqual(resolveChainFill(live));
    });
});

describe('Fills builders – the rest of the roster', () => {
    const one = (chain: ReturnType<typeof Fills.color>) => {
        const list = [...chain];
        expect(list).toHaveLength(1);
        return list[0];
    };

    it('conicGradient pulls stops, centre and start angle out of options', () => {
        expect(one(Fills.conicGradient(['red', 'blue'], {
            stops: [0, 0.8], center: { x: 1, y: 1 }, startAngle: 30, opacity: 0.5, blend: 'screen', space: 'global',
        }))).toEqual({
            type: 'conic-gradient', colors: ['red', 'blue'], stops: [0, 0.8], center: { x: 1, y: 1 }, startAngle: 30,
            opacity: 0.5, blend: 'screen', space: 'global',
        });
    });

    it('conicGradient with no options carries only its colours', () => {
        expect(one(Fills.conicGradient(['red', 'blue']))).toEqual({ type: 'conic-gradient', colors: ['red', 'blue'] });
    });

    it('radialGradient pulls stops, centre and radius out of options', () => {
        expect(one(Fills.radialGradient(['red', 'blue'], {
            stops: [0.1, 0.9], center: { x: -1, y: 0 }, radius: 40, opacity: 0.2,
        }))).toEqual({
            type: 'radial-gradient', colors: ['red', 'blue'], stops: [0.1, 0.9], center: { x: -1, y: 0 }, radius: 40, opacity: 0.2,
        });
    });

    it('radialGradient with no options carries only its colours', () => {
        expect(one(Fills.radialGradient(['red', 'blue']))).toEqual({ type: 'radial-gradient', colors: ['red', 'blue'] });
    });

    it('linearGradient keeps its stops and end, and the cross-cutting options beside them', () => {
        expect(one(Fills.linearGradient(['red', 'blue'], { stops: [0, 1], end: { x: 1, y: 1 }, blend: 'multiply', space: 'parent' })))
            .toEqual({
                type: 'linear-gradient', colors: ['red', 'blue'], stops: [0, 1], end: { x: 1, y: 1 }, blend: 'multiply', space: 'parent',
            });
    });

    it('noise pulls size, density, colour and seed out of options', () => {
        expect(one(Fills.noise({ size: { x: 2, y: 2 }, density: 0.3, color: 'red', seed: 7, opacity: 0.6 }))).toEqual({
            type: 'noise', size: { x: 2, y: 2 }, density: 0.3, color: 'red', seed: 7, opacity: 0.6,
        });
    });

    it('noise with no options is just its type', () => {
        expect(one(Fills.noise())).toEqual({ type: 'noise' });
    });

    it('fractalNoise pulls every field of the field out of options', () => {
        const options = {
            basis: 'ridged' as const, octaves: 5, frequency: 2, lacunarity: 2.5, gain: 0.4, seed: 3,
            offset: { x: 1, y: 2 }, angle: 15, colors: ['black', 'white'], stops: [0, 1], contrast: 1.5,
            opacity: 0.8, blend: 'overlay' as const,
        };
        expect(one(Fills.fractalNoise(options))).toEqual({ type: 'fractalNoise', ...options });
    });

    it('fractalNoise with no options is just its type', () => {
        expect(one(Fills.fractalNoise())).toEqual({ type: 'fractalNoise' });
    });

    it('stripe pulls gap, stroke width, angle and colour out of options', () => {
        expect(one(Fills.stripe({ gap: 6, strokeWidth: 2, angle: 30, color: 'red', blend: 'multiply' }))).toEqual({
            type: 'stripe', gap: 6, strokeWidth: 2, angle: 30, color: 'red', blend: 'multiply',
        });
    });

    it('stripe with no options is just its type', () => {
        expect(one(Fills.stripe())).toEqual({ type: 'stripe' });
    });

    it('dotGrid pulls radius, spacing, offset and colour out of options', () => {
        expect(one(Fills.dotGrid({ radius: 1.5, spacing: 24, offset: { x: 4, y: 4 }, color: 'muted', opacity: 0.4 }))).toEqual({
            type: 'dotGrid', radius: 1.5, spacing: 24, offset: { x: 4, y: 4 }, color: 'muted', opacity: 0.4,
        });
    });

    it('dotGrid with no options is just its type', () => {
        expect(one(Fills.dotGrid())).toEqual({ type: 'dotGrid' });
    });

    it('grid pulls divisions, subdivisions, offset, widths and colour out of options', () => {
        expect(one(Fills.grid({
            divisions: 8, subdivisions: 4, offset: { x: 1, y: 1 }, strokeWidth: 2, subdivisionWidth: 1, color: 'border', space: 'global',
        }))).toEqual({
            type: 'grid', divisions: 8, subdivisions: 4, offset: { x: 1, y: 1 }, strokeWidth: 2, subdivisionWidth: 1,
            color: 'border', space: 'global',
        });
    });

    it('grid with no options is just its type', () => {
        expect(one(Fills.grid())).toEqual({ type: 'grid' });
    });

    it('video plays by default, and carries its source', () => {
        expect(one(Fills.video('clip.mp4'))).toEqual({ type: 'video', src: 'clip.mp4', playing: true });
    });

    it('video lets playing be turned off, which is not the same as unset', () => {
        expect(one(Fills.video('clip.mp4', { playing: false }))).toMatchObject({ playing: false });
    });

    it('video pulls placement and playback out of options, and the common options beside them', () => {
        expect(one(Fills.video('clip.mp4', {
            fit: 'fit', zoom: 1.2, anchor: 'topCenter', crop: { bottom: 0.1 },
            timestamp: 2, trimStart: 1, trimEnd: 9, playStart: 0.5, speed: 2, loop: 'reverse', duration: 8,
            opacity: 0.7, blend: 'screen', space: 'parent',
        }))).toEqual({
            type: 'video', src: 'clip.mp4', playing: true,
            fit: 'fit', zoom: 1.2, anchor: 'topCenter', crop: { bottom: 0.1 },
            timestamp: 2, trimStart: 1, trimEnd: 9, playStart: 0.5, speed: 2, loop: 'reverse', duration: 8,
            opacity: 0.7, blend: 'screen', space: 'parent',
        });
    });

    it('video forwards a preset unresolved', () => {
        const preset = { adjustments: [], intensity: 0.5 } as never;
        expect(one(Fills.video('clip.mp4', { preset }))).toMatchObject({ type: 'video', preset });
    });

    it('video keeps a null timestamp, which hands the playhead back', () => {
        expect(one(Fills.video('clip.mp4', { timestamp: null }))).toMatchObject({ timestamp: null });
    });

    it('chains the new builders in order, appending without touching the chain they started from', () => {
        const base = Fills.grid({ divisions: 2 });
        const chain = base.dotGrid().stripe().noise();
        expect(base.list).toHaveLength(1);
        expect(chain.list.map((f) => (f as { type: string }).type)).toEqual(['grid', 'dotGrid', 'stripe', 'noise']);
    });
});

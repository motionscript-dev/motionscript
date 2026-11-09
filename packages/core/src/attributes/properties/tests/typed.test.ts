import { describe, it, expect } from 'vitest';
import { declareMembers, getPropertyMeta } from '@/attributes/properties/decorator';
import {
    alignmentProperty,
    audioEffectsProperty,
    audioParamProperty,
    effectsProperty,
    fillProperty,
    flowProperty,
    insetsProperty,
    optionalVector3Property,
    quaternionProperty,
} from '@/attributes/properties/typed';
import { audioEffectsOps } from '@/attributes/audio/effects/registry';
import { audioParamOps } from '@/attributes/audio/ramp';
import { alignmentOps } from '@/attributes/layout/alignment';
import { insetsOps } from '@/attributes/layout/insets';
import { flowOps } from '@/layout/ops';
import { quaternionOps } from '@/render3d/vector3';
import { fillOps } from '@/attributes/shape/fill/registry';
import { Fills } from '@/attributes/shape/fill/chain';
import { Effects, effectsOps } from '@/attributes/shape/effects/chain';
import { Rect, type RectProps } from "@/components/builtins/geometry/geometry";
import { Node2D } from '@/components/trees/2d/node2d';
import type { Fill } from '@/attributes/shape/fill/chain';
import type { Effect } from '@/attributes/shape/effects/chain';
import { attached } from '@/components/trees/node/node.fixtures';
import { generated } from "@/components/factory/tests/generated.fixtures";

/** Read the single property entry a registration made on a throwaway class. */
function metaFor(register: (target: object, key: string) => void, key = 'p') {
    class Host { }
    register(Host.prototype, key);
    return getPropertyMeta(new Host())[0];
}

describe('attribute-typed properties', () => {
    it('fillProperty registers the canonical fill mapper/tween pair', () => {
        const meta = metaFor(fillProperty(), 'glow');
        expect(meta.key).toBe('glow');
        expect(meta.options?.mapper).toBe(fillOps.resolve);
        expect(meta.options?.tween).toBe(fillOps.lerp);
        expect(meta.default).toEqual([]);
    });

    it('gives each declaration its own default array', () => {
        const a = metaFor(fillProperty(), 'a');
        const b = metaFor(effectsProperty(), 'b');
        expect(a.default).not.toBe(b.default);
        expect(a.default).toEqual([]);
    });

    it('takes a default in the loose author-facing form', () => {
        expect(metaFor(fillProperty({ default: 'red' })).default).toBe('red');
        expect(metaFor(insetsProperty({ default: 12 })).default).toBe(12);
        expect(metaFor(alignmentProperty({ default: 'topLeft' })).default).toBe('topLeft');
    });

    it('lets mapper/tween be overridden per declaration', () => {
        const mapper = (v: Fill) => fillOps.resolve(v);
        const tween = fillOps.lerp;
        const meta = metaFor(fillProperty({ mapper, tween }));
        expect(meta.options?.mapper).toBe(mapper);
        expect(meta.options?.tween).toBe(tween);
    });

    it('carries a default for every attribute kind', () => {
        expect(metaFor(effectsProperty()).default).toEqual([]);
        expect(metaFor(insetsProperty()).default).toBe(0);
        expect(metaFor(alignmentProperty()).default).toBe('center');
    });
});

describe('attribute-typed props on a real node', () => {
    interface CardProps extends RectProps {
        glow: Fill;
        fx: Effect;
    }

    class Card extends generated(Rect) {
        declare glow: Fill;
        declare fx: Effect;
    }

    declareMembers(Card, {
        glow: fillProperty({ default: 'red' }),
        fx: effectsProperty(),
    });

    it('resolves the declared default through the mapper', () => {
        const card = new Card({});
        expect(card.glow).toEqual([{ type: 'solid', color: [1, 0, 0, 1], opacity: undefined, blend: undefined }]);
        expect(card.fx).toEqual([]);
    });

    it('maps loose author input on assignment, exactly like `fill`', () => {
        const card = new Card({});
        card.glow = Fills.color('blue');
        card.set({ fill: 'blue' });
        expect(card.glow).toEqual(card.fill);
    });

    it('accepts the prop through the constructor', () => {
        const card = new Card({ glow: 'lime', fx: Effects.blur(4) } satisfies Partial<CardProps> as never);
        expect((card.glow as any)[0].type).toBe('solid');
        expect((card.fx as any)[0]).toMatchObject({ type: 'blur' });
    });

    it('supports reactive bindings like any other prop', () => {
        const card = new Card({});
        let colour = 'red';
        card.glow = (() => colour) as unknown as Fill;
        expect((card.glow as any)[0].color).toEqual([1, 0, 0, 1]);
    });

    it('tweens with the attribute lerp via to()', () => {
        const card = attached(new Card({ glow: '#000000' } satisfies Partial<CardProps> as never));
        const step = card.to({ data: { glow: '#ffffff' } satisfies Partial<CardProps> as never, duration: 1 })._stepper();
        step.seek(0);
        let done = false;              // prime to the first yield
        while (!done) done = step.advance(0.5);
        expect((card.glow as any)[0].color).toEqual([1, 1, 1, 1]);
    });

    it('inherits through getPropertyMeta alongside the base class props', () => {
        const keys = getPropertyMeta(new Card({})).map(m => m.key);
        expect(keys).toEqual(expect.arrayContaining(['fill', 'stroke', 'glow', 'fx']));
        // base-class props come first
        expect(keys.indexOf('fill')).toBeLessThan(keys.indexOf('glow'));
    });

    it('works on a bare Node2D subclass too', () => {
        class Blob extends Node2D {
            declare paint: Fill;
        }

        declareMembers(Blob, {
            paint: fillProperty({ default: 'red' }),
        });
        expect((new Blob({}).paint as any)[0].type).toBe('solid');
    });
});

/**
 * Every typed property is `property` with an attribute's own ops value filled in.
 * The table pins which pair, which control kind and which default each one carries,
 * so the next typed property has to say so here as well.
 */
describe('each typed property registers its ops pair, kind and default', () => {
    type Row = {
        name: string;
        register: (opts?: any) => (target: object, key: string) => void;
        mapper: unknown;
        tween: unknown;
        kind: string | undefined;
        fallback: unknown;
    };

    const rows: Row[] = [
        { name: 'fillProperty', register: fillProperty, mapper: fillOps.resolve, tween: fillOps.lerp, kind: 'fills', fallback: [] },
        { name: 'effectsProperty', register: effectsProperty, mapper: effectsOps.resolve, tween: effectsOps.lerp, kind: 'effects', fallback: [] },
        { name: 'insetsProperty', register: insetsProperty, mapper: insetsOps.resolve, tween: insetsOps.lerp, kind: 'insets', fallback: 0 },
        { name: 'alignmentProperty', register: alignmentProperty, mapper: alignmentOps.resolve, tween: alignmentOps.lerp, kind: 'alignment', fallback: 'center' },
        { name: 'flowProperty', register: flowProperty, mapper: undefined, tween: flowOps.lerp, kind: undefined, fallback: 'freeform' },
        { name: 'quaternionProperty', register: quaternionProperty, mapper: undefined, tween: quaternionOps.lerp, kind: 'quaternion', fallback: { x: 0, y: 0, z: 0, w: 1 } },
        { name: 'audioParamProperty', register: audioParamProperty, mapper: undefined, tween: audioParamOps.lerp, kind: 'audioParam', fallback: 0 },
        { name: 'audioEffectsProperty', register: audioEffectsProperty, mapper: audioEffectsOps.resolve, tween: audioEffectsOps.lerp, kind: 'audioEffects', fallback: [] },
    ];

    it('covers all eight', () => {
        expect(rows).toHaveLength(8);
        expect(new Set(rows.map((r) => r.name)).size).toBe(8);
    });

    it.each(rows)('$name', ({ register, mapper, tween, kind, fallback }) => {
        const meta = metaFor(register(), 'p');
        expect(meta.key).toBe('p');
        expect(meta.options?.mapper).toBe(mapper);
        expect(meta.options?.tween).toBe(tween);
        expect(meta.editor?.kind).toBe(kind);
        expect(meta.default).toEqual(fallback);
    });

    it.each(rows)('$name leaves the options object off when it has neither a mapper nor a tween', ({ register, mapper, tween }) => {
        const meta = metaFor(register(), 'p');
        expect(meta.options === undefined).toBe(mapper === undefined && tween === undefined);
    });

    it.each(rows)('$name honours an explicit default of undefined, so the prop is absent', ({ register }) => {
        const meta = metaFor(register({ default: undefined }), 'p');
        expect(meta.default).toBeUndefined();
        // A plain call, and an options object that does not name the key, still fall back.
        expect(metaFor(register({}), 'p').default).not.toBeUndefined();
    });

    it.each(rows)('$name lets a caller replace the kind a host draws', ({ register }) => {
        expect(metaFor(register({ kind: 'special' }), 'p').editor?.kind).toBe('special');
    });

    it.each(rows)('$name gives each declaration its own default value', ({ register, fallback }) => {
        if (typeof fallback !== 'object') return;
        expect(metaFor(register(), 'a').default).not.toBe(metaFor(register(), 'b').default);
    });

    // `flow` (and `width`/`height`) state no kind, so a descriptor reads `text` for them.
    it.todo('gives flowProperty a declared kind');
    // The typed properties take no editor hints (min, max, step, unit, options).
    it.todo('lets a typed property carry the editor hints a plain property does');
});

describe('the explicit-undefined default on a real node', () => {
    class Lamp extends Node2D {
        declare tint: Fill | undefined;
        declare glow: Fill;
    }

    declareMembers(Lamp, {
        tint: fillProperty({ default: undefined }),
        glow: fillProperty({ default: 'black' }),
    });

    it('keeps an optional attribute absent instead of folding it onto the fallback', () => {
        const lamp = new Lamp({});
        expect(lamp.tint).toBeUndefined();
        expect((lamp.glow as any)[0].color).toEqual([0, 0, 0, 1]);
    });
});

describe('the typed properties without a test of their own, on a real node', () => {
    class Part extends Node2D {
        declare arrangement: unknown;
        declare turn: unknown;
        declare level: unknown;
        declare chain: unknown;
    }

    declareMembers(Part, {
        arrangement: flowProperty(),
        turn: quaternionProperty(),
        level: audioParamProperty(),
        chain: audioEffectsProperty(),
    });

    /** `to()` the prop and read it halfway through. */
    function halfway(node: Part, key: string, target: unknown): unknown {
        const step = attached(node).to({ data: { [key]: target }, duration: 1 })._stepper();
        step.seek(0.5);
        return (node as unknown as Record<string, unknown>)[key];
    }

    it('flowProperty defaults to freeform and tweens through a blend', () => {
        const part = new Part({});
        expect(part.arrangement).toBe('freeform');
        const mid = halfway(part, 'arrangement', 'horizontal');
        expect(mid).not.toBe('freeform');
        expect(mid).not.toBe('horizontal');
        expect(mid).toBeTypeOf('object');
        expect(flowOps.lerp('freeform', 'horizontal', 1)).toBe('horizontal');
    });

    it('quaternionProperty starts at the identity and slerps the short way', () => {
        const part = new Part({});
        expect(part.turn).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        const quarter = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
        const mid = halfway(part, 'turn', quarter) as { x: number; y: number; z: number; w: number };
        expect(mid.y).toBeCloseTo(Math.sin(Math.PI / 8), 9);
        expect(mid.w).toBeCloseTo(Math.cos(Math.PI / 8), 9);
        expect(Math.hypot(mid.x, mid.y, mid.z, mid.w)).toBeCloseTo(1, 9);
    });

    it('audioParamProperty defaults to a flat 0 and lerps numbers', () => {
        const part = new Part({});
        expect(part.level).toBe(0);
        expect(halfway(part, 'level', 1)).toBe(0.5);
    });

    it('audioEffectsProperty defaults to an empty chain', () => {
        expect(new Part({}).chain).toEqual([]);
    });
});

describe('optionalVector3Property', () => {
    const declared = (unset: 'origin' | 'snap') => metaFor(optionalVector3Property(unset), 'target');

    it('is a vector3 control that defaults to unset', () => {
        const meta = declared('origin');
        expect(meta.default).toBeUndefined();
        expect(meta.editor?.kind).toBe('vector3');
    });

    it('keeps an unset input unset and resolves a set one', () => {
        const mapper = declared('origin').options!.mapper!;
        expect(mapper(undefined)).toBeUndefined();
        expect(mapper([1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 });
        expect(mapper(0)).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('tweens from the origin when told an unset start means the origin', () => {
        const tween = declared('origin').options!.tween!;
        expect(tween(undefined, { x: 4, y: 8, z: 12 }, 0.5)).toEqual({ x: 2, y: 4, z: 6 });
    });

    it('holds an unset start and swaps at the end when told to snap', () => {
        const tween = declared('snap').options!.tween!;
        expect(tween(undefined, { x: 4, y: 8, z: 12 }, 0.5)).toBeUndefined();
        expect(tween(undefined, { x: 4, y: 8, z: 12 }, 1)).toEqual({ x: 4, y: 8, z: 12 });
    });

    it('leaves the start alone when the tween ends unset, and lerps two set values either way', () => {
        for (const unset of ['origin', 'snap'] as const) {
            const tween = declared(unset).options!.tween!;
            expect(tween({ x: 1, y: 1, z: 1 }, undefined, 0.5)).toEqual({ x: 1, y: 1, z: 1 });
            expect(tween({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5)).toEqual({ x: 1, y: 2, z: 3 });
        }
    });
});

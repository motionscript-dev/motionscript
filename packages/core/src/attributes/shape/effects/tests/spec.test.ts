import { describe, it, expect } from 'vitest';
import { Effects } from '@/attributes/shape/effects/chain';
import { describeEffect, effectDescriptors, effectSpec, effectTypes, equalsEffect, lerpEffect } from '@/attributes/shape/effects/registry';
import type { NodeEffect } from '@/attributes/shape/effects/union';
import builderDefaults from './fixtures/builder-defaults.json';
import lerpEquals from './fixtures/lerp-equals.json';

/**
 * The specs replaced hand-written builders, `lerp`s and `equals`es. The two
 * fixtures were recorded from those before the change, so a saved document, a
 * default or a tween that moved would show here.
 */

/** The arguments the fixtures were recorded with, per builder. */
const ARGS: Record<string, unknown[]> = {
    blur: [undefined, 3, { radius: 2, mode: 'backdrop', clip: true }],
    directionalBlur: [{ radius: 5 }, 7],
    pixelate: [8, { blocks: { x: 3, y: 4 } }],
    grayscale: [0.5, { amount: 1 }],
    curves: [{ points: [[0, 0], [1, 1]] }, { points: [[0, 0.1]], channel: 'red' }],
    colorAdjustment: [{}, { brightness: 0.2, mode: 'backdrop' }],
    lut: [{ table: [0, 0, 0], size: 2 }],
    shader: [
        { source: 'fn effect(p: vec2f) -> vec4f { return src(p); }' },
        { source: 'fn effect(in: EffectIn) -> vec4f { return vec4f(1.0); }', blendMode: 'screen' },
    ],
};
const DEFAULT_ARGS = [undefined, 3, { mode: 'backdrop' }, { clip: true, mode: 'foreground' }];

type Builder = (arg: unknown) => { list: NodeEffect[] };
const build = (name: string, arg: unknown): NodeEffect | { error: string } => {
    try {
        return ((Effects as unknown as Record<string, Builder>)[name])(arg).list[0];
    } catch (e) {
        return { error: String((e as Error).message) };
    }
};

const revive = (value: unknown) =>
    JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Float32Array ? { f32: Array.from(v) } : v)), (_k, v) => (v && typeof v === 'object' && 'f32' in v ? new Float32Array(v.f32) : v));

describe('effect specs keep what the hand-written builders made', () => {
    it.each(Object.entries(builderDefaults))('%s builds the same effects, keys in the same order', (name, recorded) => {
        const args = ARGS[name] ?? DEFAULT_ARGS;
        const built = args.map((arg) => build(name, arg));
        expect(JSON.stringify(built, null, 2)).toBe(JSON.stringify(recorded, null, 2));
    });

    it.each(Object.entries(lerpEquals))('%s lerps and compares as before', (_name, recorded) => {
        const { a, b, lerp, equals } = revive(recorded) as { a: NodeEffect; b: NodeEffect; lerp: unknown[]; equals: boolean[] };
        const lerped = [0, 0.25, 0.5, 0.75, 1].map((t) => revive(lerpEffect(a, b, t)));
        expect(lerped).toEqual(lerp);
        expect([equalsEffect(a, b), equalsEffect(a, structuredClone(a)), equalsEffect(b, JSON.parse(JSON.stringify(b)))])
            .toEqual(equals);
    });
});

describe('effect descriptors', () => {
    const descriptors = effectDescriptors();

    it('describes every registered effect type, in order', () => {
        expect(descriptors.map((d) => d.type)).toEqual(effectTypes());
        expect(describeEffect('nope')).toBeUndefined();
    });

    it('is plain JSON', () => {
        expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
    });

    it('hands out copies', () => {
        describeEffect('blur')!.params[0].name = 'changed';
        expect(describeEffect('blur')!.params[0].name).toBe('radius');
    });

    it.each(descriptors.map((d) => [d.type, d] as const))('%s: each default is what the builder writes', (type, d) => {
        const required = Object.fromEntries(
            d.params.filter((p) => p.required).map((p) => [p.name, p.default ?? (p.kind === 'table' ? new Float32Array(24) : p.kind === 'points' ? [[0, 0]] : p.kind === 'text' ? 'x' : 2)]),
        );
        const effect = build(type, required) as unknown as Record<string, unknown>;
        for (const p of d.params) {
            if (p.default === undefined || p.required) continue;
            // An optional field the builder leaves out means its default.
            if (p.optional && effect[p.name] === undefined) continue;
            expect(JSON.parse(JSON.stringify(effect[p.name])), p.name).toEqual(p.default);
        }
        if (d.defaultMode) expect(effect.mode).toBe(d.defaultMode);
    });

    it.each(descriptors.map((d) => [d.type, d] as const))('%s: params match the effect type\'s fields', (type, d) => {
        const spec = effectSpec(type)!;
        expect(d.params.map((p) => p.name)).toEqual(Object.keys(spec.params));
        const orders = d.params.map((p) => p.order).sort((x, y) => x - y);
        expect(orders).toEqual(d.params.map((_, i) => i));
        for (const p of d.params) {
            if (p.kind === 'enum') expect(p.options?.length, p.name).toBeGreaterThan(0);
            if (p.default !== undefined && p.options && typeof p.default !== 'object') expect(p.options).toContain(p.default);
            if (typeof p.default === 'number') {
                if (p.min !== undefined) expect(p.default, p.name).toBeGreaterThanOrEqual(p.min);
                if (p.max !== undefined) expect(p.default, p.name).toBeLessThanOrEqual(p.max);
            }
        }
        expect(d.params.filter((p) => p.inline).length).toBeLessThanOrEqual(1);
    });
});

import { describe, it, expect } from 'vitest';
import { lerpEffect } from '@/attributes/shape/effects/registry';
import type { ShaderEffect } from '@/attributes/shape/effects/implementations/shader';

const a: ShaderEffect = {
    type: 'shader',
    source: 'fn effect(in: EffectIn) -> vec4f { return vec4f(1.0); }',
    mode: 'foreground',
    blendMode: 'screen',
    shaderId: 'pack-a',
    uniforms: { u_amount: 0 },
};
const b: ShaderEffect = {
    type: 'shader',
    source: 'fn effect(in: EffectIn) -> vec4f { return vec4f(0.0); }',
    mode: 'backdrop',
    blendMode: 'multiply',
    shaderId: 'pack-b',
    uniforms: { u_amount: 10 },
};

const at = (t: number) => lerpEffect(a, b, t) as ShaderEffect;

describe('shader effect lerp', () => {
    it('keeps the source program before the midpoint', () => {
        for (const t of [0, 0.25, 0.49]) {
            expect(at(t)).toMatchObject({ source: a.source, mode: 'foreground', blendMode: 'screen', shaderId: 'pack-a' });
        }
    });

    it('takes the destination program from the midpoint on, ending on it', () => {
        for (const t of [0.5, 0.75, 1]) {
            expect(at(t)).toMatchObject({ source: b.source, mode: 'backdrop', blendMode: 'multiply', shaderId: 'pack-b' });
        }
        expect(at(1)).toEqual(b);
    });

    it('still interpolates the uniform values', () => {
        expect(at(0.25).uniforms).toEqual({ u_amount: 2.5 });
    });

    it('drops the source pack id when the destination has none', () => {
        const { shaderId: _id, ...bare } = b;
        expect(lerpEffect(a, bare, 1)).not.toHaveProperty('shaderId');
    });
});

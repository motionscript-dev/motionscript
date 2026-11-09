import { describe, it, expect, vi } from 'vitest';
import { resolveFill, lerpFill, canLerpFill, declareFill, fillOps } from '@/attributes/shape/fill/registry';
import { Fills } from '@/attributes/shape/fill/chain';
import { shaderFill, type ShaderFillResolved } from '@/attributes/shape/fill/implementations/shader';
import type { FillResolved } from '@/attributes/shape/fill/union';
import type { AssetScope } from '@/assets/scope';

const SRC_A = 'struct Params { amount: f32 }\nfn fill(in: FillIn) -> vec4f { return vec4f(u.amount); }';
const SRC_B = 'struct Params { amount: f32 }\nfn fill(in: FillIn) -> vec4f { return vec4f(1.0 - u.amount); }';

const fill = (source: string, extra: Record<string, unknown> = {}): FillResolved =>
    resolveFill({ type: 'shader', source, ...extra } as never);

describe('shader fill', () => {
    it('resolves a WGSL fill with its contract, and one in a retired language with neither', () => {
        expect((fill(SRC_A) as ShaderFillResolved).contract).toBe(1);
        expect((fill(SRC_A, { contract: 3 }) as ShaderFillResolved).contract).toBe(3);
        expect(shaderFill.equals(fill(SRC_A) as ShaderFillResolved, fill(SRC_A, { contract: 2 }) as ShaderFillResolved)).toBe(false);
        // What a migrated document carries; the renderer reports it rather than drawing it.
        const retired = fill(SRC_A, { language: 'sksl' }) as ShaderFillResolved;
        expect(retired.language).toBe('sksl');
        expect('contract' in retired).toBe(false);
    });

    it('defaults the language to WGSL and uniforms to an empty record', () => {
        const resolved = fill(SRC_A) as ShaderFillResolved;

        expect(resolved).toMatchObject({ type: 'shader', source: SRC_A, language: 'wgsl', uniforms: {} });
        // Omitted rather than an empty array, so the resolved shape stays minimal
        // and comparable like every other fill's optional fields.
        expect(resolved.textures).toBeUndefined();
    });

    it('normalises the positional uniform array older shader effects use', () => {
        const resolved = fill(SRC_A, {
            uniforms: [{ name: 'u_amount', value: 0.5 }, { name: 'u_tint', value: [1, 0, 0, 1] }],
        }) as ShaderFillResolved;

        expect(resolved.uniforms).toEqual({ u_amount: 0.5, u_tint: [1, 0, 0, 1] });
    });

    it('flattens a nested colour-array uniform', () => {
        const resolved = fill(SRC_A, { uniforms: { u_colors: [[1, 0, 0, 1], [0, 0, 1, 1]] } }) as ShaderFillResolved;

        expect(resolved.uniforms.u_colors).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
    });

    it('carries uniforms/textures and the cross-cutting options through the chain', () => {
        const [resolved] = fillOps.resolve(
            Fills.shader(SRC_A, {
                uniforms: { u_amount: 0.4 },
                textures: [{ name: 'u_photo', src: '/cat.jpg' }],
                opacity: 0.5,
                blend: 'screen',
                space: 'global',
            }),
        ) as ShaderFillResolved[];

        expect(resolved).toMatchObject({
            type: 'shader',
            uniforms: { u_amount: 0.4 },
            textures: [{ name: 'u_photo', src: '/cat.jpg' }],
            opacity: 0.5,
            blend: 'screen',
            space: 'global',
        });
    });

    // The source is the compile-cache key, so tweening it would compile a
    // program per frame — it snaps, exactly as an image fill's `src` does.
    it('snaps the source at the tween midpoint while uniforms and opacity interpolate', () => {
        const a = fill(SRC_A, { uniforms: { u_amount: 0 }, opacity: 0 });
        const b = fill(SRC_B, { uniforms: { u_amount: 1 }, opacity: 1 });
        const at = (t: number) => lerpFill(a, b, t) as ShaderFillResolved;

        expect(at(0.25).source).toBe(SRC_A);
        expect(at(0.75).source).toBe(SRC_B);
        expect(at(0.25).uniforms.u_amount).toBeCloseTo(0.25);
        expect(at(0.75).uniforms.u_amount).toBeCloseTo(0.75);
        expect(at(0.25).opacity).toBeCloseTo(0.25);
    });

    it('snaps the texture list, a discrete set of bindings', () => {
        const a = fill(SRC_A, { textures: [{ name: 'u_t', src: '/a.jpg' }] });
        const b = fill(SRC_A, { textures: [{ name: 'u_t', src: '/b.jpg' }] });
        const at = (t: number) => lerpFill(a, b, t) as ShaderFillResolved;

        expect(at(0.25).textures).toEqual([{ name: 'u_t', src: '/a.jpg' }]);
        expect(at(0.75).textures).toEqual([{ name: 'u_t', src: '/b.jpg' }]);
    });

    it('interpolates vector uniforms component-wise', () => {
        const a = fill(SRC_A, { uniforms: { u_p: [0, 10] } });
        const b = fill(SRC_A, { uniforms: { u_p: [10, 0] } });

        expect((lerpFill(a, b, 0.5) as ShaderFillResolved).uniforms.u_p).toEqual([5, 5]);
    });

    it('keeps a uniform only one endpoint declares, rather than zeroing it mid-tween', () => {
        const a = fill(SRC_A, { uniforms: { u_amount: 1, u_only_a: 7 } });
        const b = fill(SRC_A, { uniforms: { u_amount: 0 } });

        const mid = (lerpFill(a, b, 0.5) as ShaderFillResolved).uniforms;
        expect(mid.u_amount).toBeCloseTo(0.5);
        expect(mid.u_only_a).toBe(7);
    });

    it('preserves type/blend/space across a lerp, which lerp() itself must not return', () => {
        const from = fill(SRC_A, { blend: 'multiply', space: 'parent' });
        const to = fill(SRC_A, { blend: 'multiply', space: 'parent' });

        expect(lerpFill(from, to, 0.5)).toMatchObject({ type: 'shader', blend: 'multiply', space: 'parent' });
        // `FillResult` omits both; returning them here would be reassembled over.
        expect(shaderFill.lerp(from as never, to as never, 0.5)).not.toHaveProperty('type');
        expect(shaderFill.lerp(from as never, to as never, 0.5)).not.toHaveProperty('blend');
    });

    // The ragged-array branch: a fill with no counterpart fades against a copy of
    // itself, which routes back into our own lerp as a same-type self-pair.
    it('fades out against itself when the target array is shorter', () => {
        const out = fillOps.lerp([fill(SRC_A, { uniforms: { u_amount: 0.5 } })], [], 0.25) as ShaderFillResolved[];

        expect(out).toHaveLength(1);
        expect(out[0].source).toBe(SRC_A);
        expect(out[0].uniforms.u_amount).toBe(0.5);
        expect(out[0].opacity).toBeCloseTo(0.75);
    });

    it('cross-fades against another fill type rather than throwing', () => {
        expect(canLerpFill(fill(SRC_A), resolveFill('red'))).toBe(false);

        const out = fillOps.lerp([resolveFill('red')], [fill(SRC_A)], 0.25);
        // Outgoing beneath, incoming on top.
        expect(out.map((f) => f.type)).toEqual(['solid', 'shader']);
        expect(out[0].opacity).toBeCloseTo(0.75);
        expect(out[1].opacity).toBeCloseTo(0.25);
    });

    // Two sources are interpolatable as far as the array logic is concerned (same
    // type, same blend), so they take the in-place path — and hard-cut inside it.
    it('hard-cuts between two different sources instead of stacking two layers', () => {
        const out = fillOps.lerp([fill(SRC_A)], [fill(SRC_B)], 0.4) as ShaderFillResolved[];

        expect(out).toHaveLength(1);
        expect(out[0].source).toBe(SRC_A);
        expect((fillOps.lerp([fill(SRC_A)], [fill(SRC_B)], 0.6)[0] as ShaderFillResolved).source).toBe(SRC_B);
    });

    it('equals ignores uniform key order but not values, source or textures', () => {
        const base = fill(SRC_A, { uniforms: { u_a: 1, u_b: [2, 3] } }) as ShaderFillResolved;
        const reordered = fill(SRC_A, { uniforms: { u_b: [2, 3], u_a: 1 } }) as ShaderFillResolved;

        expect(shaderFill.equals(base, reordered)).toBe(true);
        expect(shaderFill.equals(base, fill(SRC_A, { uniforms: { u_a: 2, u_b: [2, 3] } }) as ShaderFillResolved)).toBe(false);
        expect(shaderFill.equals(base, fill(SRC_B, { uniforms: { u_a: 1, u_b: [2, 3] } }) as ShaderFillResolved)).toBe(false);
        expect(shaderFill.equals(
            fill(SRC_A, { textures: [{ name: 'u_t', src: '/a.jpg' }] }) as ShaderFillResolved,
            fill(SRC_A, { textures: [{ name: 'u_t', src: '/b.jpg' }] }) as ShaderFillResolved,
        )).toBe(false);
    });

    it('declares each texture', () => {
        const image = vi.fn();
        declareFill(
            fill(SRC_A, { textures: [{ name: 'u_a', src: '/cat.jpg' }, { name: 'u_b', src: '/bird.jpg' }] }),
            { image } as unknown as AssetScope,
        );

        expect(image).toHaveBeenCalledWith('/cat.jpg');
        expect(image).toHaveBeenCalledWith('/bird.jpg');
    });

    it('declares nothing when the fill has no textures', () => {
        const image = vi.fn();
        declareFill(fill(SRC_A), { image } as unknown as AssetScope);

        expect(image).not.toHaveBeenCalled();
    });
});

describe('shader fill textures', () => {
    const textures = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `u_t${i}`, src: `/t${i}.jpg` }));
    const resolved = (list: unknown) => (fill(SRC_A, { textures: list }) as ShaderFillResolved).textures;

    it('keeps up to four, without a word', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(resolved(textures(4))).toEqual(textures(4));
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('keeps the first four of more, and warns once that the rest are ignored', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(resolved(textures(7))).toEqual(textures(4));
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toBe('[shader] A shader fill declares more than 4 textures; the rest are ignored.');
        } finally {
            warn.mockRestore();
        }
    });

    it('drops an entry with no name, no source or no body', () => {
        const kept = { name: 'u_ok', src: '/ok.jpg' };
        expect(resolved([
            { name: '', src: '/a.jpg' }, { name: 'u_b', src: '' }, { name: 'u_c' }, { src: '/d.jpg' }, null, undefined, kept,
        ])).toEqual([kept]);
    });

    it('does not count a dropped entry against the cap of four', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const list = [{ name: '', src: '/x.jpg' }, ...textures(4), { name: 'bad' }];
            expect(resolved(list)).toEqual(textures(4));
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('leaves the textures unset when every entry is malformed', () => {
        expect(resolved([{ name: '' }, null])).toBeUndefined();
    });

    it('leaves the textures unset for an empty list or none', () => {
        expect(resolved([])).toBeUndefined();
        expect(resolved(undefined)).toBeUndefined();
    });

    it('copies the entries it keeps, dropping any extra field', () => {
        const input = { name: 'u_a', src: '/a.jpg', extra: 1 };
        const [kept] = resolved([input])!;
        expect(kept).toEqual({ name: 'u_a', src: '/a.jpg' });
        expect(kept).not.toBe(input);
    });

    it('declares only the textures it kept', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const image = vi.fn();
            declareFill(fill(SRC_A, { textures: [{ name: '' }, ...textures(6)] }), { image } as unknown as AssetScope);
            expect(image.mock.calls.map((call) => call[0])).toEqual(['/t0.jpg', '/t1.jpg', '/t2.jpg', '/t3.jpg']);
        } finally {
            warn.mockRestore();
        }
    });
});

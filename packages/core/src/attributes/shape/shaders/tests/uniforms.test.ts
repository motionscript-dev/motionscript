import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    lerpUniformRecord,
    normalizeUniforms,
    uniformRecordsEqual,
} from '@/attributes/shape/shaders/uniforms';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    warn.mockRestore();
});

describe('normalizeUniforms', () => {
    it('accepts the record form and sorts keys, so the resolved shape is canonical', () => {
        const a = normalizeUniforms({ u_z: 1, u_a: 2 });
        const b = normalizeUniforms({ u_a: 2, u_z: 1 });

        expect(Object.keys(a)).toEqual(['u_a', 'u_z']);
        expect(Object.keys(b)).toEqual(['u_a', 'u_z']);
    });

    it('accepts the positional array older shader effects were written with', () => {
        expect(normalizeUniforms([
            { name: 'u_amount', value: 0.5 },
            { name: 'u_tint', value: [1, 0, 0, 1] },
        ])).toEqual({ u_amount: 0.5, u_tint: [1, 0, 0, 1] });
    });

    it('flattens nested arrays, so a colour list can be written the natural way', () => {
        expect(normalizeUniforms({ u_colors: [[1, 0, 0, 1], [0, 1, 0, 1]] as unknown as number[] }))
            .toEqual({ u_colors: [1, 0, 0, 1, 0, 1, 0, 1] });
    });

    it('drops non-finite values with a warning rather than writing NaN into the buffer', () => {
        expect(normalizeUniforms({ u_bad: NaN, u_good: 1 })).toEqual({ u_good: 1 });
        expect(warn).toHaveBeenCalled();
    });

    it('is idempotent, since an already-resolved fill is re-resolved on assignment', () => {
        const once = normalizeUniforms({ u_a: 1, u_v: [1, 2] });
        expect(normalizeUniforms(once)).toEqual(once);
    });
});

describe('lerpUniformRecord', () => {
    it('interpolates vectors component-wise', () => {
        expect(lerpUniformRecord({ u_p: [0, 10] }, { u_p: [10, 0] }, 0.5)).toEqual({ u_p: [5, 5] });
    });

    it('holds a one-sided key at its own value instead of pulling it toward zero', () => {
        expect(lerpUniformRecord({ u_a: 4 }, { u_b: 9 }, 0.5)).toEqual({ u_a: 4, u_b: 9 });
    });

    it('snaps a value whose arity changes, there being no in-between shape', () => {
        expect(lerpUniformRecord({ u_a: 1 }, { u_a: [1, 2] }, 0.25)).toEqual({ u_a: 1 });
        expect(lerpUniformRecord({ u_a: 1 }, { u_a: [1, 2] }, 0.75)).toEqual({ u_a: [1, 2] });
    });
});

describe('uniformRecordsEqual', () => {
    it('ignores key insertion order, unlike the positional effect form', () => {
        expect(uniformRecordsEqual({ u_a: 1, u_b: [2, 3] }, { u_b: [2, 3], u_a: 1 })).toBe(true);
    });

    it('is false on a changed value or a differing key set', () => {
        expect(uniformRecordsEqual({ u_a: 1 }, { u_a: 2 })).toBe(false);
        expect(uniformRecordsEqual({ u_a: 1 }, { u_a: 1, u_b: 1 })).toBe(false);
        expect(uniformRecordsEqual({ u_a: 1 }, { u_b: 1 })).toBe(false);
    });
});

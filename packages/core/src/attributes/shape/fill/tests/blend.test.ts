import { describe, it, expect } from 'vitest';
import { BlendModes, NodeBlendModes, getBlendModeHash } from '@/attributes/shape/fill/blend';

describe('getBlendModeHash', () => {
    it('returns the index of the mode within the list', () => {
        expect(getBlendModeHash('multiply')).toBe(0);
        expect(getBlendModeHash('normal')).toBe(BlendModes.length - 1);
    });

    it('assigns a unique hash to every mode', () => {
        const hashes = BlendModes.map(getBlendModeHash);
        expect(new Set(hashes).size).toBe(BlendModes.length);
    });

    it('matches the list order for each mode', () => {
        BlendModes.forEach((mode, i) => {
            expect(getBlendModeHash(mode)).toBe(i);
        });
    });
});

describe('BlendModes', () => {
    it('lists the sixteen CSS mix-blend-mode keywords a fill can use, with normal last', () => {
        expect(BlendModes).toHaveLength(16);
        expect(BlendModes[BlendModes.length - 1]).toBe('normal');
        expect(new Set(BlendModes).size).toBe(BlendModes.length);
    });

    it('does not offer pass-through to a fill', () => {
        expect(BlendModes).not.toContain('pass-through');
    });
});

describe('NodeBlendModes', () => {
    it('is every fill blend mode, in the same order, plus pass-through at the end', () => {
        expect(NodeBlendModes).toEqual([...BlendModes, 'pass-through']);
    });

    it('holds pass-through exactly once', () => {
        expect(NodeBlendModes.filter((mode) => mode === 'pass-through')).toHaveLength(1);
    });

    it('keeps normal, so a node can isolate itself without blending', () => {
        expect(NodeBlendModes).toContain('normal');
    });
});

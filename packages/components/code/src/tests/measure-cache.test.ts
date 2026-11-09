import { describe, expect, it } from 'vitest';
import { TokenAdvanceCache } from '../measure-cache';
import { CountingMeasurer, advanceOf } from './harness.fixtures';

/**
 * The cache that stands between a listing and the shaper: a token's advance is a
 * property of its text, its face and its letter spacing, so it is measured once
 * until the face changes.
 */

describe('TokenAdvanceCache.advance', () => {
    it('is the measured width of the text', () => {
        const cache = new TokenAdvanceCache();
        expect(cache.advance(new CountingMeasurer(), 'const', 20, 'Mono', 1)).toBe(advanceOf(5, 20, 1));
    });

    it('is 0 for an empty string, without asking the measurer', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        expect(cache.advance(measurer, '', 20, 'Mono', 1)).toBe(0);
        expect(measurer.calls).toBe(0);
    });

    it('asks the measurer once for the same content and letter spacing', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        const first = cache.advance(measurer, 'token', 20, 'Mono', 1);
        const second = cache.advance(measurer, 'token', 20, 'Mono', 1);
        expect(second).toBe(first);
        expect(measurer.calls).toBe(1);
    });

    it('measures again for another letter spacing, and keeps both', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        expect(cache.advance(measurer, 'abc', 20, 'Mono', 0)).toBe(30);
        expect(cache.advance(measurer, 'abc', 20, 'Mono', 2)).toBe(36);
        expect(measurer.calls).toBe(2);
        // Both are held: the letter-spaced token and the unspaced gutter share the cache.
        cache.advance(measurer, 'abc', 20, 'Mono', 0);
        cache.advance(measurer, 'abc', 20, 'Mono', 2);
        expect(measurer.calls).toBe(2);
    });

    it('measures again for other content', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        cache.advance(measurer, 'abc', 20, 'Mono', 0);
        cache.advance(measurer, 'abd', 20, 'Mono', 0);
        expect(measurer.asked).toEqual(['abc', 'abd']);
    });

    it('does not mistake text that ends in a number for the same text at another letter spacing', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        cache.advance(measurer, 'a 1', 20, 'Mono', 0);
        cache.advance(measurer, 'a', 20, 'Mono', 1);
        expect(measurer.calls).toBe(2);
    });

    it('serves the width it measured until it is told the face changed', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        expect(cache.advance(measurer, 'abc', 10, 'Mono', 0)).toBe(15);
        // The caller owes a sync() each frame; without one a bigger face still gets the old width.
        expect(cache.advance(measurer, 'abc', 20, 'Mono', 0)).toBe(15);
        expect(measurer.calls).toBe(1);
    });

    it('asks the measurer for the text at the size, the face and the letter spacing it was given', () => {
        const seen: unknown[][] = [];
        const cache = new TokenAdvanceCache();
        cache.advance({ measureText: (...args: unknown[]) => (seen.push(args), { width: 7, height: 1 }) } as never, 'tok', 18, 'Face', 3);
        expect(seen).toEqual([['tok', 18, 'Face', undefined, 3]]);
    });

    it('keeps only the width, whatever height the measurer answers', () => {
        const cache = new TokenAdvanceCache();
        expect(cache.advance({ measureText: () => ({ width: 9, height: 123 }) } as never, 'x', 20, 'Mono', 0)).toBe(9);
    });
});

describe('TokenAdvanceCache.sync', () => {
    it('names the font a signature is for: its size and its face', () => {
        const cache = new TokenAdvanceCache();
        expect(cache.signature(16, 'Fira Mono')).toBe('16|Fira Mono');
        expect(cache.signature(16, 'Fira Mono')).not.toBe(cache.signature(17, 'Fira Mono'));
        expect(cache.signature(16, 'Fira Mono')).not.toBe(cache.signature(16, 'Other'));
    });

    it('clears every entry when the signature changes', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        cache.sync(cache.signature(10, 'Mono'));
        cache.advance(measurer, 'abc', 10, 'Mono', 0);
        cache.advance(measurer, 'de', 10, 'Mono', 0);
        expect(measurer.calls).toBe(2);

        cache.sync(cache.signature(20, 'Mono'));
        expect(cache.advance(measurer, 'abc', 20, 'Mono', 0)).toBe(30);
        expect(cache.advance(measurer, 'de', 20, 'Mono', 0)).toBe(20);
        expect(measurer.calls).toBe(4);
    });

    it('keeps its entries while the signature is the same', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        const signature = cache.signature(10, 'Mono');
        cache.sync(signature);
        cache.advance(measurer, 'abc', 10, 'Mono', 0);
        cache.sync(signature);
        cache.sync(cache.signature(10, 'Mono'));
        cache.advance(measurer, 'abc', 10, 'Mono', 0);
        expect(measurer.calls).toBe(1);
    });

    it('clears on a change of face as well as of size', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        cache.sync(cache.signature(10, 'A'));
        cache.advance(measurer, 'abc', 10, 'A', 0);
        cache.sync(cache.signature(10, 'B'));
        cache.advance(measurer, 'abc', 10, 'B', 0);
        expect(measurer.calls).toBe(2);
    });

    it('clears on the way back to a signature it held before, since it kept nothing of it', () => {
        const measurer = new CountingMeasurer();
        const cache = new TokenAdvanceCache();
        cache.sync(cache.signature(10, 'Mono'));
        cache.advance(measurer, 'abc', 10, 'Mono', 0);
        cache.sync(cache.signature(20, 'Mono'));
        cache.sync(cache.signature(10, 'Mono'));
        cache.advance(measurer, 'abc', 10, 'Mono', 0);
        expect(measurer.calls).toBe(2);
    });
});

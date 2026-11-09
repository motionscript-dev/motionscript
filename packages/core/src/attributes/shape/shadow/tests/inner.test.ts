import { describe, it, expect } from 'vitest';
import { resolveShadow, shadowOps } from '@/attributes/shape/shadow/shadow';

describe('inner shadow flag', () => {
    it('defaults to false', () => {
        expect(resolveShadow({ blur: 10 }).inner).toBe(false);
    });
    it('honours explicit true', () => {
        expect(resolveShadow({ blur: 10, inner: true }).inner).toBe(true);
    });
    it('carries from previous when unspecified', () => {
        const prev = resolveShadow({ blur: 10, inner: true });
        expect(resolveShadow({ blur: 20 }, prev).inner).toBe(true);
    });
    it('keeps the start kind mid-tween and adopts the end at t=1', () => {
        const from = shadowOps.resolve({ blur: 0, inner: true });
        const to = shadowOps.resolve({ blur: 40, inner: false });
        expect(shadowOps.lerp(from, to, 0.5)[0].inner).toBe(true);
        expect(shadowOps.lerp(from, to, 1)[0].inner).toBe(false);
    });
});

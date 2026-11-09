import { describe, it, expect } from 'vitest';
import { size2DOps, sizeInputOps } from '@/attributes/layout/size';

describe('size2DOps.expand', () => {
    it('copies size into both width and height', () => {
        const props: Record<string, unknown> = { size: 200 };
        size2DOps.expand(props);
        expect(props).toEqual({ size: 200, width: 200, height: 200 });
    });

    it('is a no-op when size is absent', () => {
        const props: Record<string, unknown> = { width: 10 };
        size2DOps.expand(props);
        expect(props).toEqual({ width: 10 });
    });

    it('prefers an explicit width over size', () => {
        const props: Record<string, unknown> = { size: 200, width: 50 };
        size2DOps.expand(props);
        expect(props).toEqual({ size: 200, width: 50, height: 200 });
    });

    it('prefers an explicit height over size', () => {
        const props: Record<string, unknown> = { size: 200, height: 50 };
        size2DOps.expand(props);
        expect(props).toEqual({ size: 200, width: 200, height: 50 });
    });

    it('leaves both untouched when both width and height are explicit', () => {
        const props: Record<string, unknown> = { size: 200, width: 10, height: 20 };
        size2DOps.expand(props);
        expect(props).toEqual({ size: 200, width: 10, height: 20 });
    });

    it('passes through a callback (reactive-binding) form unchanged', () => {
        const fn = () => 42;
        const props: Record<string, unknown> = { size: fn };
        size2DOps.expand(props);
        expect(props.width).toBe(fn);
        expect(props.height).toBe(fn);
    });
});

describe('sizeInputOps.lerp', () => {
    it('interpolates between two numbers', () => {
        expect(sizeInputOps.lerp(0, 100, 0.5)).toBe(50);
    });

    it('hard-switches to the target at t=1 when a keyword is involved', () => {
        expect(sizeInputOps.lerp(100, 'fill', 1)).toBe('fill');
    });

    it('holds the source before t=1 when a keyword is involved', () => {
        expect(sizeInputOps.lerp(100, 'fill', 0.9)).toBe(100);
        expect(sizeInputOps.lerp('hug', 50, 0.5)).toBe('hug');
    });
});

describe('sizeInputOps.resolveLayout', () => {
    it('returns a fixed number as-is', () => {
        expect(sizeInputOps.resolveLayout(120, 500, 80)).toBe(120);
    });

    it('"fill" returns the available size', () => {
        expect(sizeInputOps.resolveLayout('fill', 500, 80)).toBe(500);
    });

    it('"hug" returns the content size', () => {
        expect(sizeInputOps.resolveLayout('hug', 500, 80)).toBe(80);
    });
});

describe('sizeInputOps.isAuto', () => {
    it('is false for fixed numbers', () => {
        expect(sizeInputOps.isAuto(100)).toBe(false);
        expect(sizeInputOps.isAuto(0)).toBe(false);
    });

    it('is true for "fill" and "hug"', () => {
        expect(sizeInputOps.isAuto('fill')).toBe(true);
        expect(sizeInputOps.isAuto('hug')).toBe(true);
    });
});

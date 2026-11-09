import { describe, it, expect } from 'vitest';
import { observeSlots } from '@/props/observer';
import { PropSlot } from '@/props/slot';
import { prepareNumericCellTween, prepareNumericTween } from '@/tween/prepare';

describe('prepareNumericTween', () => {
    it('snapshots the start values and interpolates toward the target', () => {
        const target = { x: 0, y: 100 };
        const apply = prepareNumericTween(target, { x: 10, y: 0 });

        apply(0.5);
        expect(target.x).toBe(5);
        expect(target.y).toBe(50);
    });

    it('writes the exact target at t=1', () => {
        const target = { x: 0 };
        const apply = prepareNumericTween(target, { x: 42 });
        apply(1);
        expect(target.x).toBe(42);
    });

    it('leaves the start value at t=0', () => {
        const target = { x: 7 };
        const apply = prepareNumericTween(target, { x: 100 });
        apply(0);
        expect(target.x).toBe(7);
    });

    it('captures the start value at preparation time, not call time', () => {
        const target = { x: 0 };
        const apply = prepareNumericTween(target, { x: 10 });
        // Mutating after prepare must not change the interpolation baseline.
        target.x = 1000;
        apply(0.5);
        expect(target.x).toBe(5);
    });

    it('only touches keys present in the target spec', () => {
        const target = { x: 0, y: 0 };
        const apply = prepareNumericTween(target, { x: 10 });
        apply(1);
        expect(target.y).toBe(0);
    });

    it('ignores undefined target values', () => {
        const target = { x: 5 };
        const apply = prepareNumericTween(target, { x: undefined });
        apply(1);
        expect(target.x).toBe(5);
    });
});

describe('prepareNumericCellTween', () => {
    const cells = (...values: number[]) => values.map((v) => new PropSlot(v));
    const read = (slots: PropSlot<number>[]) => slots.map((s) => s.get());

    it('writes from + (end - from) * t into each slot', () => {
        const slots = cells(0, 100);
        const apply = prepareNumericCellTween(slots, [0, 100], [10, 0]);

        apply(0);
        expect(read(slots)).toEqual([0, 100]);
        apply(0.5);
        expect(read(slots)).toEqual([5, 50]);
        apply(1);
        expect(read(slots)).toEqual([10, 0]);
    });

    it('takes its from values as given rather than reading the slots', () => {
        const slots = cells(999);
        const apply = prepareNumericCellTween(slots, [20], [40]);
        apply(0.5);
        expect(slots[0].get()).toBe(30);
    });

    it('does not clamp, so an eased overshoot lands as it was asked', () => {
        const slots = cells(0);
        const apply = prepareNumericCellTween(slots, [0], [10]);
        apply(1.5);
        expect(slots[0].get()).toBe(15);
        apply(-0.5);
        expect(slots[0].get()).toBe(-5);
    });

    it('is a function of t alone, however it is driven', () => {
        const slots = cells(0);
        const apply = prepareNumericCellTween(slots, [0], [8]);
        apply(1);
        apply(0.25);
        expect(slots[0].get()).toBe(2);
    });

    it('writes through the slot, which an observer sees', () => {
        const slots = cells(0, 0);
        const written: PropSlot<unknown>[] = [];
        const apply = prepareNumericCellTween(slots, [0, 0], [1, 1]);
        observeSlots({ read: () => { }, write: (slot) => written.push(slot) }, () => apply(0.5));
        expect(written).toEqual(slots);
    });

    it('does nothing with no cells', () => {
        expect(() => prepareNumericCellTween([], [], [])(0.5)).not.toThrow();
    });
});

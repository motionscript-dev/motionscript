import { describe, it, expect } from 'vitest';
import { PropSlot } from '@/props/slot';
import { getPropSlot } from '@/props/host';
import { Rect } from "@/components/builtins/geometry/geometry";

describe('PropSlot – basic get/set', () => {
    it('returns the initial value', () => {
        expect(new PropSlot(42).get()).toBe(42);
    });

    it('set() updates the value', () => {
        const slot = new PropSlot(0);
        slot.set(10);
        expect(slot.get()).toBe(10);
    });

    it('isBound() is false for plain slots', () => {
        expect(new PropSlot(0).isBound()).toBe(false);
    });
});

describe('PropSlot – bind', () => {
    it('bind() makes isBound() return true', () => {
        const slot = new PropSlot(0);
        slot.bind(() => 1);
        expect(slot.isBound()).toBe(true);
    });

    it('get() after bind() returns the computed value', () => {
        const slot = new PropSlot(0);
        slot.bind(() => 42);
        expect(slot.get()).toBe(42);
    });

    it('follows a source slot without anything declaring an edge', () => {
        const source = new PropSlot(10);
        const derived = new PropSlot(0);
        derived.bind(() => source.get() * 2);

        expect(derived.get()).toBe(20);
        source.set(5);
        expect(derived.get()).toBe(10);
    });

    it('recomputes on every read', () => {
        let computations = 0;
        const slot = new PropSlot(0);
        slot.bind(() => ++computations);

        slot.get();
        slot.get();
        expect(computations).toBe(2);
    });

    it('picks up a source written mid-read, which is what layout does', () => {
        const box = new PropSlot(10);
        const derived = new PropSlot(0);
        derived.bind(() => box.get() + 1);

        expect(derived.get()).toBe(11);
        box.set(99);
        expect(derived.get()).toBe(100);
    });

    it('resolves chains of bound slots', () => {
        const a = new PropSlot(1);
        const b = new PropSlot(0);
        const c = new PropSlot(0);
        b.bind(() => a.get() + 1);
        c.bind(() => b.get() + 1);

        expect(c.get()).toBe(3);
        a.set(10);
        expect(c.get()).toBe(12);
    });

    it('hands a self-reading binding the last settled value instead of recursing', () => {
        // The shape `_writeProp` builds for a mapper that needs the previous value.
        const slot = new PropSlot(5);
        slot.bind(() => slot.get() + 1);

        expect(slot.get()).toBe(6);
        expect(slot.get()).toBe(7);
    });

    it('unbind() freezes the slot at what it last computed', () => {
        const source = new PropSlot(5);
        const slot = new PropSlot(0);
        slot.bind(() => source.get() * 2);

        expect(slot.get()).toBe(10);
        slot.unbind();
        expect(slot.isBound()).toBe(false);
        expect(slot.get()).toBe(10);

        source.set(99);
        expect(slot.get()).toBe(10);
    });

    it('unbind() settles a slot that was never read', () => {
        const source = new PropSlot(5);
        const slot = new PropSlot(0);
        slot.bind(() => source.get() * 2);
        slot.unbind();
        expect(slot.get()).toBe(10);
    });

    it('set() on a bound slot detaches and uses the new value', () => {
        const source = new PropSlot(5);
        const slot = new PropSlot(0);
        slot.bind(() => source.get() * 2);

        slot.set(77);
        expect(slot.isBound()).toBe(false);
        expect(slot.get()).toBe(77);
    });
});

describe('PropSlot – snapshot / restoreFrom', () => {
    it('restores a plain value', () => {
        const slot = new PropSlot(1);
        const snap = slot.snapshot();
        slot.set(2);
        slot.restoreFrom(snap);
        expect(slot.get()).toBe(1);
    });

    it('restores a binding rather than freezing it at its captured value', () => {
        const source = new PropSlot(2);
        const slot = new PropSlot(0);
        slot.bind(() => source.get() * 10);

        const snap = slot.snapshot();
        expect(snap.value).toBe(20);

        slot.set(0);
        slot.restoreFrom(snap);
        source.set(3);
        expect(slot.get()).toBe(30);
    });
});

describe('PropSlot – dispose', () => {
    it('releases the bound closure', () => {
        const source = new PropSlot(1);
        const derived = new PropSlot(0);
        derived.bind(() => source.get() * 2);
        derived.get();

        derived.dispose();
        expect(derived.isBound()).toBe(false);
        expect(() => source.set(99)).not.toThrow();
    });
});

describe('PropSlot – a disposed slot', () => {
    it('reads as undefined and unbound', () => {
        const slot = new PropSlot(7);
        slot.bind(() => 8);
        slot.dispose();

        expect(slot.get()).toBeUndefined();
        expect(slot.isBound()).toBe(false);
        expect(slot.snapshot()).toEqual({ value: undefined });
    });

    it('drops a plain value too', () => {
        const slot = new PropSlot('kept');
        slot.dispose();
        expect(slot.get()).toBeUndefined();
    });
});

describe('PropSlot – a binding that throws', () => {
    it('propagates the error and runs again on the next read', () => {
        let fail = true;
        const slot = new PropSlot(0);
        slot.bind(() => {
            if (fail) throw new Error('boom');
            return 7;
        });

        expect(() => slot.get()).toThrow('boom');
        // The re-entrancy guard was released in a `finally`, so a retry evaluates
        // the thunk again instead of answering with the last settled value.
        fail = false;
        expect(slot.get()).toBe(7);
    });

    it('keeps the last settled value readable by a re-entrant read', () => {
        const slot = new PropSlot(1);
        let calls = 0;
        slot.bind(() => {
            calls++;
            if (calls === 2) throw new Error('second read fails');
            return slot.get() + 10;
        });

        expect(slot.get()).toBe(11);
        expect(() => slot.get()).toThrow('second read fails');
        expect(slot.isBound()).toBe(true);
        expect(slot.get()).toBe(21);
    });
});

describe('applyProp integration', () => {
    it('stores and retrieves plain values', () => {
        expect(new Rect({ x: 5 }).x).toBe(5);
    });

    it('allows direct assignment', () => {
        const node = new Rect({ x: 0 });
        node.set({ x: 42 });
        expect(node.x).toBe(42);
    });

    it('exposes a slot via getPropSlot once applyProp registers the field', () => {
        const slot = getPropSlot(new Rect({ x: 7 }), 'x');
        expect(slot).toBeDefined();
        expect(slot!.get()).toBe(7);
    });

    it('slot writes propagate to the public accessor', () => {
        const node = new Rect({ x: 3 });
        getPropSlot(node, 'x')!.set(99);
        expect(node.x).toBe(99);
    });

    it('a bound prop follows its source through the accessor', () => {
        const node = new Rect({ x: 0 });
        const source = new PropSlot(10);
        getPropSlot(node, 'x')!.bind(() => source.get());

        expect(node.x).toBe(10);
        source.set(20);
        expect(node.x).toBe(20);
    });

    it('returns undefined for an unknown property name', () => {
        expect(getPropSlot(new Rect({}), 'nonexistent')).toBeUndefined();
    });
});

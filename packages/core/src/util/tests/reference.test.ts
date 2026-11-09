import { describe, it, expect } from 'vitest';
import { createRef } from '@/util/reference';
import { Node2D, type Node2DProps, type NodeConfig } from '@/components/trees/2d/node2d';

describe('createRef', () => {
    it('throws when read before assignment', () => {
        const ref = createRef<number>();
        expect(() => ref()).toThrow(/not assigned/i);
    });

    it('returns the value after it is set', () => {
        const ref = createRef<string>();
        ref('hello');
        expect(ref()).toBe('hello');
    });

    it('overwrites the value on a second set', () => {
        const ref = createRef<number>();
        ref(1);
        ref(2);
        expect(ref()).toBe(2);
    });

    it('stores object references identically', () => {
        const ref = createRef<{ id: number }>();
        const obj = { id: 7 };
        ref(obj);
        expect(ref()).toBe(obj);
    });

    it('treats null as a cleared reference', () => {
        const ref = createRef<number>();
        ref(5);
        ref(null);
        expect(() => ref()).toThrow(/not assigned/i);
    });
});

/** A small class family, each with a member of its own so siblings differ. */
class Shape extends Node2D {
    constructor(props?: NodeConfig<Shape, Node2DProps>) { super(props as never); }
    readonly outline = "shape";
}
class Box extends Shape {
    constructor(props?: NodeConfig<Box, Node2DProps>) { super(props as never); }
    readonly corners = 4;
}
class Oval extends Shape {
    constructor(props?: NodeConfig<Oval, Node2DProps>) { super(props as never); }
    readonly radius = 1;
}
class Label extends Node2D {
    constructor(props?: NodeConfig<Label, Node2DProps>) { super(props as never); }
    readonly text = "";
}

/**
 * A node's `ref` slot is a `RefTarget`, not a `Reference`, so it accepts a ref
 * declared as a *supertype* of the node. These are compile-time assertions —
 * `typecheck` is what runs them; at runtime they only confirm the ref was
 * actually written. The `@ts-expect-error` lines are the load-bearing half: an
 * earlier attempt typed the slot as the bare setter, which looked equivalent
 * but let every one of them through (the zero-arg getter overload satisfies any
 * `(x) => void`).
 */
describe('ref variance', () => {
    it('accepts a ref declared as a supertype of the node', () => {
        const shape = createRef<Shape>();
        const node = createRef<Node2D>();

        const box = new Box({ ref: shape, width: 10, height: 10 });
        new Oval({ ref: node, width: 10, height: 10 });

        expect(shape()).toBe(box);
        // Reads narrow to what the ref was declared as, not what was stored.
        expect(shape().outline).toBe("shape");
    });

    it('rejects a ref declared as a subtype or sibling of the node', () => {
        // @ts-expect-error a `Reference<Box>` would be handed a Label at runtime
        new Label({ ref: createRef<Box>() });
        // @ts-expect-error an Oval is not a Box
        new Box({ ref: createRef<Oval>(), width: 10, height: 10 });
    });
});

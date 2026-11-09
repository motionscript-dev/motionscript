import { describe, it, expect, vi } from 'vitest';
import { Node2D, type Node2DProps } from '@/components/trees/2d/node2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import { Box3D } from "@/components/builtins/three/three";
import { PropSlot } from '@/props/slot';
import { createRef } from '@/util/reference';
import { attached } from '@/components/trees/node/node.fixtures';
import { declareMembers, getPropertyMeta, property } from '@/attributes/properties/decorator';
import type { FillResolved } from '@/attributes/shape/fill/union';
import { Registry } from '@/document/registry';

describe('a command on a node that is not in a scene', () => {
    it('runs its duration and writes nothing', () => {
        const node = new Rect({ x: 0, opacity: 1 });
        const command = node.to({ data: { x: 100, opacity: 0 }, duration: 2 });
        expect(command.duration).toBe(2);
        command.at(0.5);
        command.at(1);
        expect([node.x, node.opacity]).toEqual([0, 1]);
    });

    it('steps through its duration, reporting done at the end, and writes nothing', () => {
        const node = new Rect({ x: 0 });
        const step = node.to({ data: { x: 100 }, duration: 1 })._stepper();
        expect(step.advance(0.4)).toBe(false);
        expect(step.advance(0.4)).toBe(false);
        expect(step.advance(0.4)).toBe(true);
        expect(node.x).toBe(0);
    });

    it('keeps its shape on a seek, too', () => {
        const node = new Rect({ x: 0 });
        const step = node.to({ data: { x: 100 }, duration: 1 })._stepper();
        step.seek(5);
        expect(node.x).toBe(0);
        expect(step.advance(0.1)).toBe(true);
    });

    it('is the same for a named command: fillTo and moveTo write nothing', () => {
        const node = new Rect({ x: 0, fill: 'red' });
        node.fillTo({ data: 'blue', duration: 1 }).at(1);
        node.moveTo({ data: { x: 50, y: 50 }, duration: 1 }).at(1);
        expect(node.x).toBe(0);
        expect((node.fill as FillResolved[])[0]).toMatchObject({ color: [1, 0, 0, 1] });
    });

    it('writes once the node is in a scene', () => {
        const node = new Rect({ x: 0 });
        attached(node);
        node.to({ data: { x: 100 }, duration: 1 }).at(1);
        expect(node.x).toBe(100);
    });

    it('writes nothing again once the node has left the scene', () => {
        const parent = attached(new Rect({}));
        const node = new Rect({ x: 0 });
        parent.add(node);
        parent.remove(node);
        node.to({ data: { x: 100 }, duration: 1 }).at(1);
        expect(node.x).toBe(0);
    });

    it('does not throw for an unknown prop either', () => {
        const node = new Rect({});
        expect(() => node.to({ data: { nope: 1 } as never, duration: 1 }).at(1)).not.toThrow();
    });
});

describe('Node.set', () => {
    it('writes the props it is given', () => {
        const node = new Rect({ x: 0, y: 0 });
        node.set({ x: 5, y: 6 });
        expect([node.x, node.y]).toEqual([5, 6]);
    });

    it('ignores a key that is not a prop', () => {
        const node = new Rect({ x: 1 });
        expect(() => node.set({ nope: 1, x: 2 } as never)).not.toThrow();
        expect(node.x).toBe(2);
        expect('nope' in node).toBe(false);
    });

    it('ignores a prop given as undefined, leaving its value', () => {
        const node = new Rect({ x: 7, y: 8 });
        node.set({ x: undefined, y: 9 });
        expect([node.x, node.y]).toEqual([7, 9]);
    });

    it('binds a function, so the prop follows what it reads', () => {
        const leader = new Rect({ x: 10 });
        const follower = new Rect({ x: 0 });
        follower.set({ x: () => leader.x * 2 });
        expect(follower.x).toBe(20);
        leader.set({ x: 50 });
        expect(follower.x).toBe(100);
    });

    it('replaces a binding with a plain value, which stops it following', () => {
        const leader = new Rect({ x: 10 });
        const follower = new Rect({});
        follower.set({ x: () => leader.x });
        follower.set({ x: 3 });
        leader.set({ x: 99 });
        expect(follower.x).toBe(3);
    });

    it('does nothing to a node whose props have been disposed', () => {
        const node = new Rect({ x: 1 });
        node.dispose();
        expect(() => node.set({ x: 2 })).not.toThrow();
        expect(node.__cells).toBeUndefined();
    });

    it('is a plain assignment too: a prop is a property of the node', () => {
        const node = new Rect({ x: 1 });
        node.x = 4;
        expect(node.x).toBe(4);
    });

    it('runs a value through the prop\'s mapper, as the constructor does', () => {
        const node = new Rect({ fill: 'red' });
        node.set({ fill: 'blue' });
        expect((node.fill as FillResolved[])[0]).toMatchObject({ type: 'solid', color: [0, 0, 1, 1] });
    });
});

/**
 * A binding over a node that is not there reads `undefined` (see "A node
 * reference resolves at read time"). An unmapped prop is left holding it, so a
 * number goes `NaN` in the first frame; a mapped prop's stored form has a shape
 * its readers go through (`padding.left`), so it holds what a node constructed
 * without the prop holds, and its mapper is never handed `undefined`.
 */
describe('a binding that reads undefined', () => {
    const none = () => undefined as never;

    it('leaves an unmapped prop undefined, with no fallback to its default', () => {
        const node = new Rect({ x: 7, opacity: 0.5 });
        node.set({ x: none, opacity: none });
        expect([node.x, node.opacity]).toEqual([undefined, undefined]);
    });

    it('gives a mapped prop what a node constructed without it holds', () => {
        const fresh = new Rect({});
        const node = new Rect({ padding: 9, cornerRadius: 4, pivot: 'topLeft', align: 'bottomRight' });
        node.set({ padding: none, cornerRadius: none, pivot: none, align: none });
        expect(node.padding).toEqual(fresh.padding);
        expect(node.cornerRadius).toEqual(fresh.cornerRadius);
        expect(node.pivot).toEqual(fresh.pivot);
        expect(node.align).toEqual(fresh.align);
    });

    it('follows the source again when it reads a value, and goes back when it stops', () => {
        let source: unknown = undefined;
        const node = new Rect({});
        node.set({ padding: (() => source) as never });
        expect(node.padding).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
        source = 6;
        expect(node.padding).toEqual({ left: 6, right: 6, top: 6, bottom: 6 });
        source = undefined;
        expect(node.padding).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    });

    describe('on a prop declared with a mapper of its own', () => {
        const mapper = vi.fn((v: { n: number }) => ({ n: v.n * 2 }));

        interface BoxedProps extends Node2DProps {
            boxed: { n: number };
            bare: { n: number } | undefined;
            computed: { n: number };
        }

        class Boxed extends Node2D<BoxedProps> {
            declare boxed: { n: number };
            declare bare: { n: number } | undefined;
            declare computed: { n: number };
        }

        declareMembers(Boxed, {
            boxed: property({ default: { n: 1 }, mapper }),
            bare: property({ mapper }),
            computed: property({ default: (() => ({ n: 5 })) as never, mapper }),
        });

        it('never hands the mapper undefined', () => {
            mapper.mockClear();
            const node = new Boxed({});
            node.set({ boxed: none, bare: none, computed: none });
            expect(() => [node.boxed, node.bare, node.computed]).not.toThrow();
            expect(mapper.mock.calls.every(([input]) => input !== undefined)).toBe(true);
        });

        it('holds the mapped default', () => {
            const node = new Boxed({});
            node.set({ boxed: () => ({ n: 4 }) });
            expect(node.boxed).toEqual({ n: 8 });
            node.set({ boxed: none });
            expect(node.boxed).toEqual({ n: 2 });
        });

        it('holds undefined for a prop with no default, as the constructor leaves it', () => {
            const node = new Boxed({});
            expect(node.bare).toBeUndefined();
            node.set({ bare: () => ({ n: 1 }) });
            expect(node.bare).toEqual({ n: 2 });
            node.set({ bare: none });
            expect(node.bare).toBeUndefined();
        });

        it('holds what a computed default gives', () => {
            const node = new Boxed({});
            node.set({ computed: none });
            expect(node.computed).toEqual({ n: 10 });
        });
    });

    /**
     * The mappers differ — insets, alignment, corners, colour, fills — and what they
     * do with `undefined` differs with them: some throw, some answer `[]`, one
     * stores `undefined`. Whatever the prop, the binding hands back what a node
     * constructed without it holds.
     */
    describe('on every mapped prop of every built-in node', () => {
        const registry = new Registry();
        const build = (type: string) =>
            registry.instantiate({ id: 'n', type, parentId: null, layerOrder: 0, props: {} });

        const cases = registry.nodeKeys().flatMap((type) =>
            getPropertyMeta(build(type))
                .filter((meta) => meta.options?.mapper)
                .map((meta) => [type, meta.key] as const),
        );

        it('covers the families that dereference their input', () => {
            const keys = new Set(cases.map(([, key]) => key));
            for (const key of ['padding', 'pivot', 'align', 'cornerRadius', 'cornerStyle', 'crop', 'anchor', 'fill', 'color', 'emission']) {
                expect(keys.has(key), key).toBe(true);
            }
        });

        it.each(cases)('%s.%s', (type, key) => {
            const node = build(type) as unknown as Record<string, unknown> & { set(props: object): void };
            const fresh = build(type) as unknown as Record<string, unknown>;
            node.set({ [key]: none });
            expect(() => node[key]).not.toThrow();
            expect(node[key]).toEqual(fresh[key]);
        });
    });
});

describe('Node.properties', () => {
    it('collects every declared prop by name, with its current value', () => {
        const node = new Rect({ x: 3, opacity: 0.5, width: 20 });
        const props = node.properties as unknown as Record<string, unknown>;
        expect(props.x).toBe(3);
        expect(props.opacity).toBe(0.5);
        expect(props.width).toBe(20);
        expect(Object.keys(props)).toContain('fill');
    });

    it('reads a bound prop as the value it has now', () => {
        const leader = new Rect({ x: 10 });
        const follower = new Rect({});
        follower.set({ x: () => leader.x + 1 });
        expect((follower.properties as unknown as { x: number }).x).toBe(11);
        leader.set({ x: 20 });
        expect((follower.properties as unknown as { x: number }).x).toBe(21);
    });

    it('is a snapshot: a later write does not change one already taken', () => {
        const node = new Rect({ x: 1 });
        const before = node.properties as unknown as { x: number };
        node.set({ x: 2 });
        expect(before.x).toBe(1);
        expect((node.properties as unknown as { x: number }).x).toBe(2);
    });

    it('is empty for a node whose props are disposed', () => {
        const node = new Rect({ x: 1 });
        node.dispose();
        expect(node.properties).toEqual({});
    });

    it('lists the props a subclass declares beside the inherited ones', () => {
        class Gauge extends Node2D {
            declare level: number;
            constructor(props?: Record<string, unknown>) {
                super(props as never);
                this.initProps(props as never);
            }
        }

        declareMembers(Gauge, {
            level: property({ default: 0.25 }),
        });
        const props = new Gauge({ level: 0.75 }).properties as unknown as Record<string, unknown>;
        expect(props.level).toBe(0.75);
        expect('x' in props).toBe(true);
    });
});

describe('Node.dispose', () => {
    it('disposes every prop slot', () => {
        const node = new Rect({ x: 1 });
        const slots = [...node.__cells!.slots.values()];
        const dispose = slots.map((slot) => vi.spyOn(slot, 'dispose'));
        node.dispose();
        expect(slots.length).toBeGreaterThan(0);
        for (const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
    });

    it('clears the slot table', () => {
        const node = new Rect({ x: 1 });
        node.dispose();
        expect(node.__cells).toBeUndefined();
    });

    it('unmounts the node and drops its catalog', () => {
        const node = attached(new Rect({}));
        expect(node.mounted).toBe(true);
        node.dispose();
        expect(node.mounted).toBe(false);
        expect(() => node.assets).toThrow(/Assets not bound/);
    });

    it('keeps the identity and the raw props, so a reused instance re-derives its context', () => {
        const node = new Rect({ id: 'keep', key: 'k' });
        node.dispose();
        expect([node.id, node.key]).toEqual(['keep', 'k']);
        expect((node as unknown as { _props?: unknown })._props).toBeDefined();
    });

    it('leaves the tree alone: children and parent stay', () => {
        const child = new Rect({ id: 'c' });
        const parent = new Rect({ children: [child] });
        const grand = new Rect({ children: [parent] });
        parent.dispose();
        expect(parent.children).toEqual([child]);
        expect(parent.parent).toBe(grand);
        expect(child.__cells).toBeDefined();
    });

    it('can be called twice', () => {
        const node = new Rect({});
        node.dispose();
        expect(() => node.dispose()).not.toThrow();
    });

    it('leaves a disposed prop reading undefined', () => {
        const node = new Rect({ x: 5 });
        node.dispose();
        expect(node.x).toBeUndefined();
    });

    it('unbinds a prop that followed another node', () => {
        const leader = new Rect({ x: 1 });
        const follower = new Rect({});
        follower.set({ x: () => leader.x });
        const slot = follower.__cells!.slots.get('x') as PropSlot<number>;
        follower.dispose();
        leader.set({ x: 2 });
        // The slot released its binding and its value: it neither follows nor holds anything.
        expect(slot.get()).toBeUndefined();
    });

    it('still lets assets be asked of a node that was never attached', () => {
        const node = new Rect({});
        expect(() => node.assets).toThrow('Assets not bound — this node is not attached to a scene. See Node.attach().');
    });
});

describe('the ref prop', () => {
    it('is called with the node while it is being constructed', () => {
        const ref = createRef<Rect>();
        const node = new Rect({ ref });
        expect(ref()).toBe(node);
    });

    it('is called before the children are adopted', () => {
        let childrenAtCall = -1;
        const child = new Rect({});
        const node = new Rect({ ref: (n) => { childrenAtCall = n!.children.length; }, children: [child] });
        expect(childrenAtCall).toBe(0);
        expect(node.children).toEqual([child]);
    });

    it('is called before the props are applied, so a callback must not read them yet', () => {
        let opacityAtCall: number | undefined = -1;
        const node = new Rect({ opacity: 0.5, ref: (n) => { opacityAtCall = n!.opacity; } });
        expect(opacityAtCall).toBeUndefined();
        expect(node.opacity).toBe(0.5);
    });

    it('is called once, with the node itself rather than a copy', () => {
        const calls: unknown[] = [];
        const node = new Rect({ ref: (n) => { calls.push(n); } });
        expect(calls).toEqual([node]);
    });

    it('is called by a plain Node2D too', () => {
        const ref = createRef<Node2D>();
        const node = new Node2D({ ref });
        expect(ref()).toBe(node);
    });

    it('is not a property of the node', () => {
        const node = new Rect({ ref: createRef<Rect>() });
        expect(node.properties).not.toHaveProperty('ref');
    });

    it('is left alone when absent', () => {
        expect(() => new Rect({})).not.toThrow();
    });

    it('throws on a read before the node assigned it', () => {
        const ref = createRef<Rect>();
        expect(() => ref()).toThrow();
    });

    // Compile-time half: `typecheck` runs these, the expectations only confirm the write.
    it('is typed on a call as the node it builds, or any supertype of it', () => {
        const own = createRef<Rect>();
        const base = createRef<Node2D>();
        const element = Rect({ ref: own, width: 10 });
        new Rect({ ref: base });
        expect(element).toBeTruthy();
        expect(base()).toBeInstanceOf(Rect.node);
        // @ts-expect-error a `Reference<Text>` would be handed a Rect
        new Rect({ ref: createRef<Text>() });
    });

    it('is typed on a 3D call as the 3D node it builds', () => {
        const ref = createRef<Box3D>();
        const box = new Box3D({ ref });
        expect(ref()).toBe(box);
        // @ts-expect-error a 2D node's ref takes no 3D node
        new Box3D({ ref: createRef<Rect>() });
    });
});

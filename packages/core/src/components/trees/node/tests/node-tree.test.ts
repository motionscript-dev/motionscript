import { describe, it, expect } from 'vitest';
import { Node2D } from '@/components/trees/2d/node2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Box3D } from "@/components/builtins/three/three";
import { Canvas3D } from "@/components/builtins/three/canvas3d";
import { attached } from '@/components/trees/node/node.fixtures';
import type { Node } from '@/components/trees/node/node';

const tile = (id: string) => new Rect({ id, width: 10, height: 10 });
const ids = (nodes: readonly Node[]) => nodes.map((n) => n.id);

describe('Node.add', () => {
    it('adds a single node, as its parent\'s child', () => {
        const parent = new Rect({});
        const a = tile('a');
        parent.add(a);
        expect(ids(parent.children)).toEqual(['a']);
        expect(a.parent).toBe(parent);
    });

    it('adds an array in order', () => {
        const parent = new Rect({});
        parent.add([tile('a'), tile('b'), tile('c')]);
        expect(ids(parent.children)).toEqual(['a', 'b', 'c']);
    });

    it('appends after what is there', () => {
        const parent = new Rect({ children: [tile('a')] });
        parent.add(tile('b'));
        parent.add([tile('c'), tile('d')]);
        expect(ids(parent.children)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('flattens nested arrays to any depth', () => {
        const parent = new Rect({});
        parent.add([tile('a'), [tile('b'), [tile('c'), [tile('d')]]], tile('e')] as never);
        expect(ids(parent.children)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('drops falsy entries, so `cond && node` works', () => {
        const parent = new Rect({});
        parent.add([false, tile('a'), null, undefined, tile('b'), 0, ''] as never);
        expect(ids(parent.children)).toEqual(['a', 'b']);
    });

    it('adds nothing for a falsy value', () => {
        const parent = new Rect({});
        for (const value of [false, null, undefined] as const) parent.add(value);
        expect(parent.children).toHaveLength(0);
    });

    it('adds nothing for an empty array, or an array of only falsy entries', () => {
        const parent = new Rect({});
        parent.add([]);
        parent.add([false, null] as never);
        expect(parent.children).toHaveLength(0);
    });

    it('adopts the children prop the same way: nested, falsy entries dropped', () => {
        const parent = new Rect({ children: [tile('a'), [tile('b'), false], null, tile('c')] as never });
        expect(ids(parent.children)).toEqual(['a', 'b', 'c']);
    });

    it('sets every added child\'s parent', () => {
        const parent = new Rect({});
        const [a, b] = [tile('a'), tile('b')];
        parent.add([a, b]);
        expect([a.parent, b.parent]).toEqual([parent, parent]);
    });

    it('mounts a child added to a mounted node, and leaves one added to an unmounted node for the walk', () => {
        const live = attached(new Rect({}));
        const early = tile('early');
        live.add(early);
        expect(early.mounted).toBe(true);

        const idle = new Rect({});
        const late = tile('late');
        idle.add(late);
        expect(late.mounted).toBe(false);
        attached(idle);
        expect(late.mounted).toBe(true);
    });

    it('mounts a whole added subtree', () => {
        const live = attached(new Rect({}));
        const leaf = tile('leaf');
        live.add(new Rect({ children: [leaf] }));
        expect(leaf.mounted).toBe(true);
    });

    it('throws for a child of another dimension, naming both', () => {
        const parent = new Rect({});
        expect(() => parent.add(new Box3D({} as never))).toThrow(TypeError);
        expect(() => parent.add(new Box3D({} as never))).toThrow(/Rect \(2d\) cannot hold Box3d \(3d\)/);
    });

    it('throws before adding any of an array, so a bad entry leaves the node as it was', () => {
        const parent = new Rect({});
        expect(() => parent.add([tile('a'), new Box3D({} as never)] as never)).toThrow(TypeError);
        expect(parent.children).toHaveLength(0);
    });

    it('lets a Canvas3D hold both dimensions', () => {
        const canvas = new Canvas3D({});
        expect(() => canvas.add([tile('hud'), new Box3D({} as never)])).not.toThrow();
        expect(canvas._allChildren).toHaveLength(2);
    });
});

describe('Node.remove', () => {
    const build = () => {
        const [a, b, c] = [tile('a'), tile('b'), tile('c')];
        const parent = new Rect({ children: [a, b, c] });
        return { parent, a, b, c };
    };

    it('removes a single child and unparents it', () => {
        const { parent, a } = build();
        parent.remove(a);
        expect(ids(parent.children)).toEqual(['b', 'c']);
        expect(a.parent).toBeNull();
    });

    it('removes an array of children, nested ones included', () => {
        const { parent, a, c } = build();
        parent.remove([a, [c]] as never);
        expect(ids(parent.children)).toEqual(['b']);
    });

    it('ignores falsy entries', () => {
        const { parent, a } = build();
        parent.remove([false, a, null, undefined] as never);
        expect(ids(parent.children)).toEqual(['b', 'c']);
        parent.remove(false);
        expect(parent.children).toHaveLength(2);
    });

    it('is a no-op for a node that is not a child', () => {
        const { parent } = build();
        const stranger = tile('stranger');
        expect(() => parent.remove(stranger)).not.toThrow();
        expect(ids(parent.children)).toEqual(['a', 'b', 'c']);
    });

    it('leaves a node alone that belongs to another parent', () => {
        const { parent } = build();
        const other = tile('other');
        const elsewhere = new Rect({ children: [other] });
        parent.remove(other);
        expect(other.parent).toBe(elsewhere);
        expect(ids(elsewhere.children)).toEqual(['other']);
    });

    it('does not unmount a stranger either', () => {
        const live = attached(new Rect({}));
        const other = tile('other');
        const elsewhere = attached(new Rect({ children: [other] }));
        live.remove(other);
        expect(other.mounted).toBe(true);
        expect(elsewhere.children).toContain(other);
    });

    it('keeps the order of what is left', () => {
        const { parent, b } = build();
        parent.remove(b);
        expect(ids(parent.children)).toEqual(['a', 'c']);
    });

    it('detaches the removed subtree: the child and everything under it', () => {
        const leaf = tile('leaf');
        const branch = new Rect({ id: 'branch', children: [leaf] });
        const root = attached(new Rect({ children: [branch] }));
        expect(leaf.mounted).toBe(true);
        root.remove(branch);
        expect(branch.mounted).toBe(false);
        expect(leaf.mounted).toBe(false);
        expect(leaf.parent).toBe(branch);
    });

    it('can be added again, which mounts the subtree again', () => {
        const branch = new Rect({ id: 'branch', children: [tile('leaf')] });
        const root = attached(new Rect({ children: [branch] }));
        root.remove(branch);
        root.add(branch);
        expect(branch.mounted).toBe(true);
        expect(branch.children[0].mounted).toBe(true);
    });

    it('removes a child only once when it was asked to twice', () => {
        const { parent, a } = build();
        parent.remove([a, a]);
        expect(ids(parent.children)).toEqual(['b', 'c']);
    });
});

describe('Node.clear', () => {
    it('removes every child, unparenting each', () => {
        const [a, b] = [tile('a'), tile('b')];
        const parent = new Rect({ children: [a, b] });
        parent.clear();
        expect(parent.children).toHaveLength(0);
        expect([a.parent, b.parent]).toEqual([null, null]);
    });

    it('detaches each child and its subtree', () => {
        const leaf = tile('leaf');
        const branch = new Rect({ children: [leaf] });
        const root = attached(new Rect({ children: [branch, tile('b')] }));
        root.clear();
        expect(branch.mounted).toBe(false);
        expect(leaf.mounted).toBe(false);
    });

    it('is a no-op on a node with no children', () => {
        const parent = new Rect({});
        expect(() => parent.clear()).not.toThrow();
        expect(parent.children).toHaveLength(0);
    });

    it('also clears children of the other dimension', () => {
        const canvas = new Canvas3D({ children: [tile('hud'), new Box3D({} as never)] } as never);
        canvas.clear();
        expect(canvas._allChildren).toHaveLength(0);
    });

    it('leaves the node itself mounted and able to take new children', () => {
        const root = attached(new Rect({ children: [tile('a')] }));
        root.clear();
        expect(root.mounted).toBe(true);
        const late = tile('late');
        root.add(late);
        expect(late.mounted).toBe(true);
    });

    it('can be repeated', () => {
        const parent = new Rect({ children: [tile('a')] });
        parent.clear();
        parent.clear();
        expect(parent.children).toHaveLength(0);
    });
});

describe('Node2D.children', () => {
    it('returns the 2D children, and the live array when nothing else is in it', () => {
        const parent = new Rect({ children: [tile('a')] });
        expect(parent.children).toBe((parent as unknown as { _children: Node2D[] })._children);
    });

    it('filters a 3D child out of the 2D view of a Canvas3D, keeping it in the full one', () => {
        const hud = tile('hud');
        const box = new Box3D({} as never);
        const canvas = new Canvas3D({ children: [hud, box] } as never);
        expect(canvas.children).toEqual([hud]);
        expect(canvas._allChildren).toEqual([hud, box]);
    });
});

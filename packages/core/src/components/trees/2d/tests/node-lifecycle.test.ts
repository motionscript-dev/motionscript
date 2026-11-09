import { describe, it, expect } from 'vitest';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Node2D } from '@/components/trees/2d/node2d';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { BoxBounds } from '@/layout/bounds';
import { SizeInput } from '@/attributes/layout/size';
import { attached } from '@/components/trees/node/node.fixtures';
import { Box3D } from "@/components/builtins/three/three";
import { getCommandMeta } from '@/tween/command-decorator';
import type { Command } from '@/tween/command';
import { generated } from "@/components/factory/tests/generated.fixtures";

const scope = new FakeMeasureContext();

/** A leaf that exposes the box its parent laid it into (protected `layoutBounds` seam). */
class Tile extends Node2D {
    constructor(width: SizeInput, height: SizeInput) {
        super({ width, height });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

/** A hug-sized container wrapping one fixed tile, so its natural width is only known once laid out. */
class HugItem extends Node2D {
    constructor(childWidth: number) {
        super({ width: 'hug', height: 'hug', children: [new Tile(childWidth, 40)] });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
    /** The protected opacity, surfaced so a test can tell visible frames apart. */
    get op(): number {
        return this.opacity;
    }
}

/**
 * Play a child-management command to completion, running a measure + layout pass
 * against `root` between every step. This mirrors the runtime's per-frame order
 * (advance → layout → render), which is what makes a hug child's `measuredWidth`
 * available to the animated add on the frame after it is inserted. Returns the
 * sequence of `sample()` snapshots taken *after* each layout pass.
 */
function driveWithLayout<T>(
    root: Node2D & { rect: BoxBounds },
    command: Command<Record<string, never>>,
    dt: number,
    sample: () => T,
    rootBox: BoxBounds,
): T[] {
    const step = command._stepper();
    const snaps: T[] = [];
    const layout = () => {
        // Measure against a generous space, then lay the root into a cell sized to
        // its own hugged extent — so a hug root reports its content width via
        // layoutBounds, exactly as a parent packing it to size would.
        const size = root.measure({ maxWidth: rootBox.width, maxHeight: rootBox.height }, scope);
        root.layout(
            { x: rootBox.x, y: rootBox.y, width: size.width ?? 0, height: size.height ?? 0 },
            scope,
        );
    };
    // Initial layout so on-screen children have a valid rect before we start.
    layout();
    for (;;) {
        const done = step.advance(dt);
        layout();
        snaps.push(sample());
        if (done) break;
    }
    return snaps;
}

/**
 * A horizontal-flow container that exposes its own laid-out box for the driver.
 * Hugs both axes explicitly: a `Rect` built with no children defaults to `fill`,
 * and what these tests watch is the hug width tracking an animated insert.
 */
class ProbeRow extends generated(Rect) {
    constructor(props: { gap?: number } = {}) {
        super({ ...props, flow: 'horizontal', width: 'hug', height: 'hug' });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

describe('addChildAt (animated) — grows the child in so siblings reflow', () => {
    it('interpolates a hug child from 0 up to its measured width (no snap)', () => {
        const a = new Tile(100, 40);
        const b = new Tile(100, 40);
        const row = new ProbeRow({ gap: 20 });
        row.add([a, b]);
        attached(row);

        const incoming = new HugItem(60); // natural hug width = 60
        // 0.4s at dt = 0.1s → 4 tween frames. The hug width is measured detached
        // (off-tree) before the child is attached, so there is no in-flow measure
        // frame that could shift the siblings.
        const gen = row.addChildAt({ data: { child: incoming, index: 1 }, duration: 0.4 });

        const rootBox = { x: 0, y: 0, width: 1000, height: 1000 };
        const snaps = driveWithLayout(
            row,
            gen,
            0.1,
            () => ({ item: incoming.rect.width, row: row.rect.width, op: incoming.op }),
            rootBox,
        );

        // Final item width lands exactly on the hug size.
        expect(snaps[snaps.length - 1].item).toBeCloseTo(60, 5);
        // Final row width = 100 + 20 + 60 + 20 + 100 = 300.
        expect(snaps[snaps.length - 1].row).toBeCloseTo(300, 5);

        const itemWidths = snaps.map((s) => s.item);
        const rowWidths = snaps.map((s) => s.row);

        // No frame ever overshoots the final packed size — the regression this
        // guards is a one-frame jump to the final layout (siblings snapping to
        // their end positions) before the grow-in. Item width stays ≤ 60 and row
        // width stays ≤ 300 on *every* frame, including the first.
        for (const w of itemWidths) expect(w).toBeLessThanOrEqual(60 + 1e-6);
        for (const w of rowWidths) expect(w).toBeLessThanOrEqual(300 + 1e-6);

        // The grow-in is gradual: the item passes through partial widths and the
        // row climbs through intermediate totals rather than snapping.
        expect(itemWidths.some((w) => w > 0 && w < 60)).toBe(true);
        expect(rowWidths.some((w) => w > 240 && w < 300)).toBe(true);

        // Row width only ever widens across the whole animation — monotonic from
        // frame one, since there is no detached-measure dip in the flow.
        for (let i = 1; i < rowWidths.length; i++) {
            expect(rowWidths[i]).toBeGreaterThanOrEqual(rowWidths[i - 1] - 1e-6);
        }
    });

    it('restores the hug token after the tween so the child reflows naturally', () => {
        const row = new ProbeRow({ gap: 20 });
        row.add([new Tile(100, 40)]);

        const incoming = new HugItem(60);
        const gen = row.addChildAt({ data: { child: incoming, index: 0 }, duration: 0.2 });
        driveWithLayout(row, gen, 0.1, () => null, { x: 0, y: 0, width: 1000, height: 1000 });

        // Once the animation completes the axis is a hug token again (not pinned
        // to the numeric tween end), so a later content change re-hugs.
        expect((incoming as unknown as { width: SizeInput }).width).toBe('hug');
        expect((incoming as unknown as { height: SizeInput }).height).toBe('hug');
    });
});

describe('removeChildAt (instant) — takes the subtree out of the scene', () => {
    it('unparents and unmounts the removed child and its descendants', () => {
        const inner = new Tile(10, 10);
        const outer = new Rect({ width: 40, height: 40, children: [inner] });
        const row = new ProbeRow({ gap: 0 });
        row.add([new Tile(100, 40), outer]);
        attached(row);
        expect(outer.mounted).toBe(true);
        expect(inner.mounted).toBe(true);

        const removed = row.removeChildAt({ data: { index: 1 } });

        expect(removed).toBe(outer);
        expect(outer.parent).toBeNull();
        expect(outer.mounted).toBe(false);
        expect(inner.mounted).toBe(false);
        expect(row.children).not.toContain(outer);
    });

    it('can be added back, mounting the subtree again', () => {
        const outer = new Tile(40, 40);
        const row = new ProbeRow({ gap: 0 });
        row.add([new Tile(100, 40), outer]);
        attached(row);

        row.removeChildAt({ data: { index: 1 } });
        row.addChildAt({ data: { child: outer, index: 1 } });

        expect(outer.mounted).toBe(true);
        expect(outer.parent).toBe(row);
    });

    it('returns null for an index out of range', () => {
        const row = new ProbeRow({ gap: 0 });
        row.add([new Tile(100, 40)]);
        expect(row.removeChildAt({ data: { index: 3 } })).toBeNull();
    });
});

describe('removeChildAt (animated) — shrinks the child so siblings close the gap', () => {
    it('shrinks the removed child to 0 then detaches it', () => {
        const a = new Tile(100, 40);
        const b = new Tile(100, 40);
        const row = new ProbeRow({ gap: 20 });
        row.add([a, b]);
        attached(row);

        const gen = row.removeChildAt({ data: { index: 1 }, duration: 0.2 });
        const rowWidths = driveWithLayout(
            row,
            gen,
            0.1,
            () => row.rect.width,
            { x: 0, y: 0, width: 1000, height: 1000 },
        );

        // Ends with b gone: single 100-wide child, no gap → row hugs to 100.
        expect(rowWidths[rowWidths.length - 1]).toBeCloseTo(100, 5);
        expect(row.children).not.toContain(b);
        // Width only ever shrank.
        for (let i = 1; i < rowWidths.length; i++) {
            expect(rowWidths[i]).toBeLessThanOrEqual(rowWidths[i - 1] + 1e-6);
        }
    });
});

// ── The instant forms ──────────────────────────────────────────────

describe('addChildAt (instant) — inserts at an index', () => {
    const idOf = (nodes: readonly Node2D[]) => nodes.map((n) => n.id);
    const tile = (id: string) => new Rect({ id, width: 10, height: 10 });
    const row = () => new Rect({ children: [tile('a'), tile('b'), tile('c')] });

    it('inserts at the front', () => {
        const parent = row();
        parent.addChildAt({ data: { child: tile('x'), index: 0 } });
        expect(idOf(parent.children)).toEqual(['x', 'a', 'b', 'c']);
    });

    it('inserts in the middle', () => {
        const parent = row();
        parent.addChildAt({ data: { child: tile('x'), index: 2 } });
        expect(idOf(parent.children)).toEqual(['a', 'b', 'x', 'c']);
    });

    it('inserts at the end', () => {
        const parent = row();
        parent.addChildAt({ data: { child: tile('x'), index: 3 } });
        expect(idOf(parent.children)).toEqual(['a', 'b', 'c', 'x']);
    });

    it('appends for an index past the end', () => {
        const parent = row();
        parent.addChildAt({ data: { child: tile('x'), index: 99 } });
        expect(idOf(parent.children)).toEqual(['a', 'b', 'c', 'x']);
    });

    it('inserts into an empty parent', () => {
        const parent = new Rect({});
        parent.addChildAt({ data: { child: tile('x'), index: 0 } });
        expect(idOf(parent.children)).toEqual(['x']);
    });

    it('returns nothing, there being nothing to play', () => {
        expect(row().addChildAt({ data: { child: tile('x'), index: 0 } })).toBeUndefined();
    });

    it('parents the child, and mounts it in a live tree', () => {
        const parent = attached(row());
        const x = tile('x');
        parent.addChildAt({ data: { child: x, index: 1 } });
        expect(x.parent).toBe(parent);
        expect(x.mounted).toBe(true);
    });

    it('leaves the child unmounted in a tree that is not live', () => {
        const parent = row();
        const x = tile('x');
        parent.addChildAt({ data: { child: x, index: 1 } });
        expect(x.parent).toBe(parent);
        expect(x.mounted).toBe(false);
    });

    it('throws for a child of another dimension, naming both, before anything is inserted', () => {
        const parent = row();
        expect(() => parent.addChildAt({ data: { child: new Box3D({} as never), index: 0 } })).toThrow(TypeError);
        expect(() => parent.addChildAt({ data: { child: new Box3D({} as never), index: 0 } }))
            .toThrow(/Rect \(2d\) cannot hold Box3d \(3d\)/);
        expect(idOf(parent.children)).toEqual(['a', 'b', 'c']);
    });

    it('throws for a child of another dimension in its animated form too', () => {
        const parent = attached(row());
        expect(() => parent.addChildAt({ data: { child: new Box3D({} as never), index: 0 }, duration: 1 })).toThrow(TypeError);
        expect(idOf(parent.children)).toEqual(['a', 'b', 'c']);
    });

    it('is a command a document can name', () => {
        expect(getCommandMeta(new Rect({})).map((m) => m.key)).toEqual(expect.arrayContaining(['addChildAt', 'removeChildAt', 'reparent']));
    });
});

describe('removeChildAt (instant) — returns what it took out', () => {
    const tile = (id: string) => new Rect({ id, width: 10, height: 10 });

    it('returns the node it removed, in the middle of the others', () => {
        const [a, b, c] = [tile('a'), tile('b'), tile('c')];
        const parent = new Rect({ children: [a, b, c] });
        expect(parent.removeChildAt({ data: { index: 1 } })).toBe(b);
        expect(parent.children).toEqual([a, c]);
    });

    it('returns the first and the last', () => {
        const [a, b, c] = [tile('a'), tile('b'), tile('c')];
        const parent = new Rect({ children: [a, b, c] });
        expect(parent.removeChildAt({ data: { index: 0 } })).toBe(a);
        expect(parent.removeChildAt({ data: { index: 1 } })).toBe(c);
        expect(parent.children).toEqual([b]);
    });

    it('returns null, and removes nothing, for an index out of range', () => {
        const parent = new Rect({ children: [tile('a'), tile('b')] });
        expect(parent.removeChildAt({ data: { index: 2 } })).toBeNull();
        expect(parent.removeChildAt({ data: { index: -1 } })).toBeNull();
        expect(parent.removeChildAt({ data: { index: 99 } })).toBeNull();
        expect(parent.children).toHaveLength(2);
    });

    it('returns null for a parent with no children', () => {
        expect(new Rect({}).removeChildAt({ data: { index: 0 } })).toBeNull();
    });

    it('unparents the removed node', () => {
        const a = tile('a');
        const parent = new Rect({ children: [a] });
        parent.removeChildAt({ data: { index: 0 } });
        expect(a.parent).toBeNull();
    });

    it('does not touch the nodes that are left', () => {
        const [a, b, c] = [tile('a'), tile('b'), tile('c')];
        const parent = attached(new Rect({ children: [a, b, c] }));
        parent.removeChildAt({ data: { index: 1 } });
        expect([a.mounted, c.mounted, a.parent, c.parent]).toEqual([true, true, parent, parent]);
    });
});

describe('reparent (instant) — moves the node to another parent', () => {
    const tile = (id: string) => new Rect({ id, width: 10, height: 10 });

    it('takes the node out of its old parent and appends it to the new one', () => {
        const node = tile('n');
        const from = new Rect({ children: [tile('a'), node] });
        const to = new Rect({ children: [tile('b')] });
        const result = node.reparent({ data: { newParent: to } });
        expect(result).toBeUndefined();
        expect(from.children.map((c) => c.id)).toEqual(['a']);
        expect(to.children.map((c) => c.id)).toEqual(['b', 'n']);
        expect(node.parent).toBe(to);
    });

    it('adopts a node that had no parent', () => {
        const node = tile('n');
        const to = new Rect({});
        node.reparent({ data: { newParent: to } });
        expect(node.parent).toBe(to);
    });

    it('keeps the node mounted, in a live tree', () => {
        const node = tile('n');
        const from = new Rect({ children: [node] });
        const to = new Rect({});
        const root = attached(new Rect({ children: [from, to] }));
        node.reparent({ data: { newParent: to } });
        expect(node.mounted).toBe(true);
        expect(root.children).toEqual([from, to]);
    });

    it('unmounts the node when the new parent is outside the scene', () => {
        const node = tile('n');
        const from = attached(new Rect({ children: [node] }));
        const outside = new Rect({});
        node.reparent({ data: { newParent: outside } });
        expect(node.mounted).toBe(false);
        expect(from.children).toHaveLength(0);
    });

    it('moves the node\'s whole subtree with it', () => {
        const leaf = tile('leaf');
        const node = new Rect({ id: 'n', children: [leaf] });
        const to = new Rect({});
        new Rect({ children: [node] });
        node.reparent({ data: { newParent: to } });
        expect(node.children).toEqual([leaf]);
        expect(to.children).toEqual([node]);
    });
});

// ── reparentAnimated ───────────────────────────────────────────────

describe('reparent (animated) — exits one parent, enters the other', () => {
    function setup() {
        const node = new Tile(60, 40);
        const sibling = new Tile(100, 40);
        const from = new ProbeRow({ gap: 20 });
        from.add([sibling, node]);
        const to = new ProbeRow({ gap: 20 });
        to.add([new Tile(30, 40)]);
        const root = new Rect({ flow: 'vertical', width: 1000, height: 1000, children: [from, to] });
        attached(root);
        const box = { x: 0, y: 0, width: 1000, height: 1000 };
        root.layout(box, scope);
        return { node, sibling, from, to, root, box };
    }
    const idsOf = (parent: Node2D) => parent.children.map((c) => c.id);

    it('hands the node over at the midpoint: still in the old parent just before, in the new one from there', () => {
        const { node, from, to } = setup();
        const command = node.reparent({ data: { newParent: to }, duration: 1 });
        command.at(0.49);
        expect(node.parent).toBe(from);
        command.at(0.5);
        expect(node.parent).toBe(to);
        command.at(1);
        expect(node.parent).toBe(to);
    });

    it('hands the node back when it is sought back across the midpoint', () => {
        const { node, from, to } = setup();
        const command = node.reparent({ data: { newParent: to }, duration: 1 });
        command.at(0.9);
        expect(node.parent).toBe(to);
        command.at(0.3);
        expect(node.parent).toBe(from);
        expect(idsOf(from)).toContain(node.id);
        expect(idsOf(to)).not.toContain(node.id);
        command.at(0.6);
        expect(node.parent).toBe(to);
        expect(idsOf(from)).not.toContain(node.id);
    });

    it('is in exactly one parent at every moment', () => {
        const { node, from, to } = setup();
        const command = node.reparent({ data: { newParent: to }, duration: 1 });
        for (const t of [0, 0.2, 0.49, 0.5, 0.51, 0.8, 1, 0.7, 0.4, 0.1, 0]) {
            command.at(t);
            const holders = [from, to].filter((parent) => parent.children.includes(node));
            expect(holders, `at t = ${t}`).toHaveLength(1);
        }
    });

    it('fades and shrinks out of the old parent over the first half, to nothing at the midpoint', () => {
        const { node, to } = setup();
        const command = node.reparent({ data: { newParent: to }, duration: 1 });
        command.at(0);
        expect(node.opacity).toBe(1);
        expect(node.width).toBe(60);
        command.at(0.1);
        // The fade comes first, with the box held at its size.
        expect(node.opacity).toBeLessThan(1);
        expect(node.width).toBe(60);
        command.at(0.3);
        expect(node.opacity).toBe(0);
        expect(node.width).toBeGreaterThan(0);
        expect(node.width).toBeLessThan(60);
        expect(node.gapScale).toBeLessThan(1);
        command.at(0.5);
        expect([node.width, node.height, node.opacity, node.gapScale]).toEqual([0, 0, 0, 0]);
    });

    it('opens and fades in over the second half, back to what it was', () => {
        const { node, to } = setup();
        const command = node.reparent({ data: { newParent: to }, duration: 1 });
        command.at(0.7);
        expect(node.width).toBeGreaterThan(0);
        expect(node.width).toBeLessThan(60);
        expect(node.opacity).toBe(0);
        command.at(0.92);
        expect(node.opacity).toBeGreaterThan(0);
        expect(node.opacity).toBeLessThan(1);
        command.at(1);
        expect([node.width, node.height, node.opacity, node.gapScale]).toEqual([60, 40, 1, 1]);
    });

    it('lets the old parent close the gap while the node leaves, and the new parent open one while it arrives', () => {
        const { node, from, to, root, box } = setup();
        const command = node.reparent({ data: { newParent: to }, duration: 1 });
        const widths = (t: number) => {
            command.at(t);
            root.layout(box, scope);
            return { from: from.rect.width, to: to.rect.width };
        };
        const start = widths(0);
        const atHandoff = widths(0.5);
        const end = widths(1);
        // 100 + 20 + 60 before, 100 once it has left; 30 before, 30 + 20 + 60 once it has arrived.
        expect(start.from).toBeCloseTo(180, 5);
        expect(atHandoff.from).toBeCloseTo(100, 5);
        expect(end.from).toBeCloseTo(100, 5);
        expect(start.to).toBeCloseTo(30, 5);
        expect(atHandoff.to).toBeCloseTo(30, 5);
        expect(end.to).toBeCloseTo(110, 5);
    });

    it('reads the same however it is reached: straight to the second half, or after the first', () => {
        const direct = setup();
        const cmdA = direct.node.reparent({ data: { newParent: direct.to }, duration: 1 });
        cmdA.at(0.7);
        const viaFirst = setup();
        const cmdB = viaFirst.node.reparent({ data: { newParent: viaFirst.to }, duration: 1 });
        cmdB.at(0.2);
        cmdB.at(0.45);
        cmdB.at(0.7);
        expect([direct.node.width, direct.node.opacity, direct.node.gapScale])
            .toEqual([viaFirst.node.width, viaFirst.node.opacity, viaFirst.node.gapScale]);
    });

    it('steps through its duration like any command', () => {
        const { node, to } = setup();
        const step = node.reparent({ data: { newParent: to }, duration: 1 })._stepper();
        expect(step.advance(0.4)).toBe(false);
        expect(node.parent).not.toBe(to);
        expect(step.advance(0.2)).toBe(false);
        expect(node.parent).toBe(to);
        expect(step.advance(0.5)).toBe(true);
        expect(node.opacity).toBe(1);
    });

    it('carries its duration', () => {
        const { node, to } = setup();
        expect(node.reparent({ data: { newParent: to }, duration: 2.5 }).duration).toBe(2.5);
    });
});

// ── removeChildAt (animated), sought back ─────────────────────────

describe('removeChildAt (animated) — membership follows t in both directions', () => {
    function setup() {
        const [a, b, c] = [new Tile(100, 40), new Tile(60, 40), new Tile(80, 40)];
        const row = new ProbeRow({ gap: 20 });
        row.add([a, b, c]);
        attached(row);
        row.layout({ x: 0, y: 0, width: 1000, height: 1000 }, scope);
        return { a, b, c, row };
    }

    it('keeps the child in the tree until the end', () => {
        const { b, row } = setup();
        const command = row.removeChildAt({ data: { index: 1 }, duration: 1 });
        for (const t of [0, 0.3, 0.9, 0.999]) {
            command.at(t);
            expect(row.children, `at t = ${t}`).toContain(b);
        }
        command.at(1);
        expect(row.children).not.toContain(b);
    });

    it('puts the child back at its index when sought back below the end', () => {
        const { a, b, c, row } = setup();
        const command = row.removeChildAt({ data: { index: 1 }, duration: 1 });
        command.at(1);
        expect(row.children).toEqual([a, c]);
        command.at(0.5);
        expect(row.children).toEqual([a, b, c]);
        expect(b.parent).toBe(row);
        expect(b.mounted).toBe(true);
    });

    it('puts the child back at the start of its fade when sought all the way back', () => {
        const { b, row } = setup();
        const command = row.removeChildAt({ data: { index: 1 }, duration: 1 });
        command.at(1);
        command.at(0);
        expect(row.children).toContain(b);
        expect(b.opacity).toBe(1);
    });

    it('goes in and out of the tree as often as it is sought across the end', () => {
        const { b, row } = setup();
        const command = row.removeChildAt({ data: { index: 1 }, duration: 1 });
        for (const [t, present] of [[1, false], [0.4, true], [1, false], [0.9, true], [1, false]] as const) {
            command.at(t);
            expect(row.children.includes(b), `at t = ${t}`).toBe(present);
        }
    });

    it('resets the removed child\'s gap scale, so a later re-add keeps its gap', () => {
        const { b, row } = setup();
        const command = row.removeChildAt({ data: { index: 1 }, duration: 1 });
        command.at(1);
        expect(b.gapScale).toBe(1);
    });

    it('fades first, then shrinks, as the mirror of an insert', () => {
        const { b, row } = setup();
        const command = row.removeChildAt({ data: { index: 1 }, duration: 1 });
        command.at(0.15);
        expect(b.opacity).toBeLessThan(1);
        expect(b.width).toBe(60);
        command.at(0.65);
        expect(b.opacity).toBe(0);
        expect(b.width).toBeGreaterThan(0);
        expect(b.width).toBeLessThan(60);
    });

    it('does nothing at all for an index out of range', () => {
        const { a, b, c, row } = setup();
        const command = row.removeChildAt({ data: { index: 9 }, duration: 1 });
        command.at(0.5);
        command.at(1);
        expect(row.children).toEqual([a, b, c]);
    });
});

// ── addChildAt (animated), before the parent was measured ─────────

describe('addChildAt (animated) — a parent that was never measured', () => {
    it('has nothing to measure a hug child against, so it keeps the token and fades in without a width tween', () => {
        const row = new ProbeRow({ gap: 10 });
        row.add([new Tile(100, 40)]);
        attached(row); // attached, never measured or laid out: no retained scope to measure with
        expect(row.lastMeasure).toBeUndefined();

        const incoming = new HugItem(60);
        const command = row.addChildAt({ data: { child: incoming, index: 0 }, duration: 1 });
        for (const t of [0, 0.3, 0.7, 0.9]) {
            command.at(t);
            expect(incoming.width, `width at t = ${t}`).toBe('hug');
            expect(incoming.height, `height at t = ${t}`).toBe('hug');
        }
        command.at(1);
        expect(incoming.width).toBe('hug');
        expect(incoming.op).toBe(1);
    });

    it('still fades in and opens its gap', () => {
        const row = new ProbeRow({ gap: 10 });
        row.add([new Tile(100, 40)]);
        attached(row);
        const incoming = new HugItem(60);
        const command = row.addChildAt({ data: { child: incoming, index: 1 }, duration: 1 });
        command.at(0.35);
        expect(incoming.op).toBe(0);
        expect(incoming.gapScale).toBeGreaterThan(0);
        expect(incoming.gapScale).toBeLessThan(1);
        command.at(0.7);
        expect(incoming.gapScale).toBe(1);
        expect(incoming.op).toBe(0);
        command.at(0.95);
        expect(incoming.op).toBeGreaterThan(0);
        expect(incoming.op).toBeLessThan(1);
        command.at(1);
        expect(incoming.op).toBe(1);
    });

    it('grows a numeric axis from 0 even without a measure, leaving a hug axis at its token', () => {
        const row = new ProbeRow({ gap: 10 });
        row.add([new Tile(100, 40)]);
        attached(row);
        const mixed = new Rect({ id: 'mixed', width: 60, height: 'hug', children: [new Tile(10, 10)] });
        const command = row.addChildAt({ data: { child: mixed, index: 1 }, duration: 1 });
        command.at(0);
        expect(mixed.width).toBe(0);
        command.at(0.35);
        expect(mixed.width).toBeCloseTo(30, 6);
        expect(mixed.height).toBe('hug');
        command.at(1);
        expect(mixed.width).toBe(60);
        expect(mixed.height).toBe('hug');
    });

    it('inserts the child at once, in place, whatever the axes do', () => {
        const row = new ProbeRow({ gap: 10 });
        const first = new Tile(100, 40);
        row.add([first]);
        attached(row);
        const incoming = new HugItem(60);
        const command = row.addChildAt({ data: { child: incoming, index: 0 }, duration: 1 });
        command.at(0);
        expect(row.children).toEqual([incoming, first]);
    });

    it('collapses the child to nothing at the start: no opacity and no gap', () => {
        const row = new ProbeRow({ gap: 10 });
        row.add([new Tile(100, 40)]);
        attached(row);
        const incoming = new HugItem(60);
        const command = row.addChildAt({ data: { child: incoming, index: 1 }, duration: 1 });
        command.at(0);
        expect([incoming.op, incoming.gapScale]).toEqual([0, 0]);
    });

    it('remembers the opacity the child was authored with, and returns to it', () => {
        const row = new ProbeRow({ gap: 10 });
        row.add([new Tile(100, 40)]);
        attached(row);
        const incoming = new Rect({ id: 'dim', width: 50, height: 50, opacity: 0.6 });
        const command = row.addChildAt({ data: { child: incoming, index: 1 }, duration: 1 });
        command.at(1);
        expect(incoming.opacity).toBeCloseTo(0.6, 9);
    });
});

describe('the animated lifecycle commands carry their duration and their easing', () => {
    it('reports the duration it was given', () => {
        const row = new ProbeRow({});
        row.add([new Tile(10, 10)]);
        attached(row);
        expect(row.addChildAt({ data: { child: new Tile(10, 10), index: 0 }, duration: 0.8 }).duration).toBe(0.8);
        expect(row.removeChildAt({ data: { index: 0 }, duration: 1.2 }).duration).toBe(1.2);
        expect(new Tile(5, 5).reparent({ data: { newParent: row }, duration: 3 }).duration).toBe(3);
    });
});

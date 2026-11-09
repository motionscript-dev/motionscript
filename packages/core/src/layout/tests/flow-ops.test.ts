import { describe, it, expect, vi } from 'vitest';
import { flowOps } from '@/layout/ops';
import type { FlowMode, FlowSettings, FlowSpace, LayoutItem } from '@/layout/types';
import type { Alignment } from '@/attributes/layout/alignment';
import type { Size2D } from '@/attributes/layout/size';

function tile(width: number, height: number, gapScale?: number): LayoutItem {
    return { width, height, gapScale };
}

describe('flowOps.arrange', () => {
    it('returns boxes y-up and centred on the box, the space Graphics2D draws in', () => {
        const boxes = flowOps.arrange(
            { flow: 'vertical', gap: 10, align: 'topCenter' },
            [tile(100, 40), tile(100, 40)],
            { width: 200, height: 200 },
        );
        // Top-aligned in a 200-tall box: the first sits at y = 100 - 20, the next below it.
        expect(boxes.map((b) => b.y)).toEqual([80, 30]);
        expect(boxes[0].y).toBeGreaterThan(boxes[1].y);
    });

    it('takes a named alignment as well as a Vector2', () => {
        const named = flowOps.arrange({ flow: 'horizontal', align: 'centerRight' }, [tile(100, 40)], { width: 400, height: 100 });
        const vector = flowOps.arrange({ flow: 'horizontal', align: { x: 1, y: 0 } }, [tile(100, 40)], { width: 400, height: 100 });
        expect(named).toEqual(vector);
        expect(named[0].x).toBe(150);
    });

    it('with no settings, centres every item freeform', () => {
        const boxes = flowOps.arrange({}, [tile(100, 40), tile(60, 60)], { width: 400, height: 400 });
        expect(boxes.map((b) => [b.x, b.y])).toEqual([[0, 0], [0, 0]]);
    });
});

describe('a run slides as `align` tweens', () => {
    it('an align between start and centre lands between them, rather than snapping to the end', () => {
        const at = (x: number) => flowOps.arrange(
            { flow: 'horizontal', align: { x, y: 0 } }, [tile(100, 50)], { width: 500, height: 100 },
        )[0].x;
        expect(at(-1)).toBe(-200);
        expect(at(0)).toBe(0);
        expect(at(-0.5)).toBe(-100);
    });

    it('a cross-axis align between two positions lands between them', () => {
        const at = (y: number) => flowOps.arrange(
            { flow: 'horizontal', align: { x: 0, y } }, [tile(100, 20)], { width: 500, height: 100 },
        )[0].y;
        expect(at(1)).toBe(40);
        expect(at(-1)).toBe(-40);
        expect(at(0.5)).toBe(20);
    });
});

describe('a centred run centres on the padded box', () => {
    it('shifts by half the difference between the start and end padding', () => {
        const boxes = flowOps.arrange(
            { flow: 'horizontal', align: 'center', padding: { left: 100 } },
            [tile(100, 50)],
            { width: 500, height: 100 },
        );
        // Content box is 400 wide and its centre is 50 right of the box's.
        expect(boxes[0].x).toBe(50);
    });
});

describe('a collapsing first child holds the visible run still at any alignment', () => {
    function xs(align: { x: number; y: number }, first: LayoutItem[]): number[] {
        const items = [...first, tile(100, 50), tile(100, 50), tile(100, 50)];
        const settings: FlowSettings = { flow: 'horizontal', gap: 20, align };
        return flowOps.arrange(settings, items, { width: 500, height: 100 }).slice(first.length).map((b) => b.x);
    }

    it('under centre alignment', () => {
        expect(xs({ x: 0, y: 0 }, [tile(0, 50, 0)])).toEqual(xs({ x: 0, y: 0 }, []));
    });

    it('under end alignment', () => {
        expect(xs({ x: 1, y: 0 }, [tile(0, 50, 0)])).toEqual(xs({ x: 1, y: 0 }, []));
    });
});

describe('the flow prop', () => {
    it('holds both modes and how far along between them', () => {
        expect(flowOps.lerp('horizontal', 'vertical', 0.3)).toEqual({ from: 'horizontal', to: 'vertical', t: 0.3 });
    });

    it('settles on the destination at the end, or when nothing changes', () => {
        expect(flowOps.lerp('horizontal', 'vertical', 1)).toBe('vertical');
        expect(flowOps.lerp('grid', 'grid', 0.5)).toBe('grid');
    });

    it('starts a tween built mid-blend from where that blend was heading', () => {
        const midway = { from: 'horizontal', to: 'vertical', t: 0.5 } as const;
        expect(flowOps.lerp(midway, 'grid', 0.25)).toEqual({ from: 'vertical', to: 'grid', t: 0.25 });
    });

    it('places a blend between the two modes', () => {
        const items = [tile(100, 50), tile(100, 50)];
        const inner = { width: 400, height: 400 };
        const place = (flow: FlowSettings['flow']) =>
            flowOps.place(flowOps.measure({ flow }, items, inner), { flow }, inner);

        const row = place('horizontal');
        const column = place('vertical');
        const halfway = place({ from: 'horizontal', to: 'vertical', t: 0.5 });
        expect(halfway.map((b) => b.x)).toEqual(row.map((b, i) => (b.x + column[i].x) / 2));
        expect(halfway.map((b) => b.y)).toEqual(row.map((b, i) => (b.y + column[i].y) / 2));
    });
});

describe('flowOps.reusable', () => {
    const items = [tile(100, 50), tile(100, 50)];

    it('holds for the box it was measured in', () => {
        const m = flowOps.measure({ flow: 'horizontal' }, items, { width: 1000, height: 300 });
        expect(flowOps.reusable(m, { width: 1000, height: 300 })).toBe(true);
        expect(flowOps.reusable(m, { width: 900, height: 300 })).toBe(false);
    });

    it('holds on a hugging axis laid out at exactly what it hugged', () => {
        const m = flowOps.measure({ flow: 'horizontal' }, items, { width: 1000, height: 300, hugWidth: true });
        expect(flowOps.reusable(m, { width: 200, height: 300 })).toBe(true);
        expect(flowOps.reusable(m, { width: 150, height: 300 })).toBe(false);
    });

    it('never matches an unbounded measure against a finite box', () => {
        const m = flowOps.measure({ flow: 'horizontal' }, items, { width: Infinity, height: 300 });
        expect(flowOps.reusable(m, { width: 200, height: 300 })).toBe(false);
    });
});

describe('sizing a container', () => {
    const padding = { left: 10, right: 10, top: 5, bottom: 5 };

    it('hugs what its items came to, plus padding', () => {
        const sizing = { width: 'hug', height: 'hug' } as const;
        const space = flowOps.contentBox(sizing, { maxWidth: 1000, maxHeight: 1000 }, padding);
        expect(space).toEqual({ width: 980, height: 990, hugWidth: true, hugHeight: true });

        const m = flowOps.measure({ flow: 'horizontal', gap: 10 }, [tile(100, 50), tile(100, 50)], space);
        expect(flowOps.size(sizing, { maxWidth: 1000, maxHeight: 1000 }, padding, m.hug))
            .toEqual({ width: 230, height: 60 });
    });

    it('keeps a fixed or fill size whatever its items came to', () => {
        const size = flowOps.size({ width: 300, height: 'fill' }, { maxWidth: 1000, maxHeight: 800 }, padding, { width: 5000, height: 5000 });
        expect(size).toEqual({ width: 300, height: 800 });
    });
});

describe('flowOps.collapsedRun', () => {
    it('names a run laid out in a box of length 0 that holds sized items', () => {
        const m = flowOps.measure({ flow: 'horizontal' }, [tile(100, 50)], { width: 0, height: 100 });
        expect(flowOps.collapsedRun(m, { width: 0, height: 100 })).toMatch(/run of length 0/);
    });

    it('lets an empty or fully collapsed run be, and ignores freeform', () => {
        const collapsed = flowOps.measure({ flow: 'horizontal' }, [tile(0, 0)], { width: 0, height: 0 });
        expect(flowOps.collapsedRun(collapsed, { width: 0, height: 0 })).toBeNull();
        const freeform = flowOps.measure({}, [tile(100, 50)], { width: 0, height: 0 });
        expect(flowOps.collapsedRun(freeform, { width: 0, height: 0 })).toBeNull();
    });
});

// ── Alignment ────────────────────────────────────────────────────────

describe('an unknown named align', () => {
    const unknown = 'middle' as unknown as Alignment;
    const items = [tile(100, 40)];
    const box = { width: 400, height: 200 };

    it.each(['freeform', 'horizontal', 'vertical'] as const)('throws from arrange in a %s container', (flow) => {
        expect(() => flowOps.arrange({ flow, align: unknown }, items, box))
            .toThrow("Unknown alignment value: 'middle'");
    });

    it('throws from place, where the alignment is read', () => {
        const settings: FlowSettings = { flow: 'horizontal', align: unknown };
        const measured = flowOps.measure(settings, items, box);
        expect(() => flowOps.place(measured, settings, box)).toThrow(/Unknown alignment value/);
    });

    it('does not throw from measure, which reads no alignment', () => {
        expect(() => flowOps.measure({ flow: 'horizontal', align: unknown }, items, box)).not.toThrow();
    });

    it('is never read by a grid', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 1, align: unknown };
        expect(() => flowOps.arrange(settings, items, box)).not.toThrow();
    });

    it('does not accept a key that only the prototype chain has', () => {
        expect(() => flowOps.arrange({ flow: 'horizontal', align: 'toString' as unknown as Alignment }, items, box))
            .toThrow(/Unknown alignment value: 'toString'/);
    });
});

// ── Items that measure themselves ────────────────────────────────────

describe('an item whose measure returns a partial size', () => {
    const partial = (size: Partial<Size2D>): LayoutItem => ({ width: 'hug', height: 'hug', measure: () => size });
    const space: FlowSpace = { width: 500, height: 500 };

    it.each(['freeform', 'horizontal', 'vertical', 'grid'] as const)('counts a missing field as 0 in a %s container', (flow) => {
        const measured = flowOps.measure({ flow, columns: 2 }, [partial({ width: 40 }), partial({ height: 30 }), partial({})], space);
        expect(measured.sizes).toEqual([
            { width: 40, height: 0 },
            { width: 0, height: 30 },
            { width: 0, height: 0 },
        ]);
    });

    it('counts a missing field as 0 in a wrapped run', () => {
        const measured = flowOps.measure({ flow: 'horizontal', wrap: true }, [partial({ width: 40 }), partial({ height: 30 })], space);
        expect(measured.sizes).toEqual([{ width: 40, height: 0 }, { width: 0, height: 30 }]);
    });

    it('hugs to what it did report', () => {
        const measured = flowOps.measure({ flow: 'horizontal' }, [partial({ width: 40 }), partial({ height: 30 })], space);
        expect(measured.hug).toEqual({ width: 40, height: 30 });
    });

    it('passes the measurer on to the item', () => {
        const seen: unknown[] = [];
        const measurer = { measureText: () => ({ width: 0 }) } as never;
        const item: LayoutItem = { width: 'hug', height: 'hug', measure: (_c, m) => { seen.push(m); return { width: 1, height: 1 }; } };
        flowOps.measure({ flow: 'horizontal' }, [item], space, measurer);
        flowOps.measure({ flow: 'freeform' }, [item], space, measurer);
        flowOps.measure({ flow: 'grid' }, [item], space, measurer);
        flowOps.measure({ flow: 'vertical', wrap: true }, [item], space, measurer);
        expect(seen).toEqual([measurer, measurer, measurer, measurer]);
    });
});

// ── Purity ───────────────────────────────────────────────────────────

describe('arrange, measure and place are pure', () => {
    // A fresh deep copy each call, so the arguments can be frozen and compared with a copy.
    const settings = (flow: FlowSettings['flow']): FlowSettings => ({
        flow, gap: 12, crossGap: 8, wrap: true, columns: 2, align: { x: -1, y: 1 }, padding: { left: 4, top: 6 },
    });
    const items = (): LayoutItem[] => [
        { width: 100, height: 40 },
        { width: 'fill', height: 30, flex: 2 },
        { width: 80, height: 'fill', gapScale: 0.5 },
        { width: 60, height: 60, column: 2, row: 1 },
        { width: 'hug', height: 'hug' },
    ];
    const box = { width: 300, height: 260 };
    const space: FlowSpace = { width: 300, height: 260, hugHeight: true };

    function deepFreeze<T>(value: T): T {
        if (value && typeof value === 'object') {
            Object.freeze(value);
            for (const inner of Object.values(value)) deepFreeze(inner);
        }
        return value;
    }

    const modes: NonNullable<FlowSettings['flow']>[] = [
        'freeform', 'horizontal', 'vertical', 'grid', { from: 'horizontal', to: 'grid', t: 0.4 },
    ];

    it.each(modes)('leaves its arguments as they were (%j)', (flow) => {
        const s = deepFreeze(settings(flow));
        const list = deepFreeze(items());
        const b = deepFreeze({ ...box });
        const sp = deepFreeze({ ...space });
        const before = JSON.stringify([s, list, b, sp]);

        const arranged = flowOps.arrange(s, list, b);
        const measured = flowOps.measure(s, list, sp);
        const placed = flowOps.place(measured, s, b);
        flowOps.reusable(measured, b);
        flowOps.collapsedRun(measured, b);

        expect(JSON.stringify([s, list, b, sp])).toBe(before);
        expect(arranged).toHaveLength(list.length);
        expect(placed).toHaveLength(list.length);
    });

    it.each(modes)('returns equal results for equal inputs, in fresh objects (%j)', (flow) => {
        const first = flowOps.arrange(settings(flow), items(), box);
        const second = flowOps.arrange(settings(flow), items(), box);
        expect(second).toEqual(first);
        expect(second[0]).not.toBe(first[0]);

        const m1 = flowOps.measure(settings(flow), items(), space);
        const m2 = flowOps.measure(settings(flow), items(), space);
        expect(m2.hug).toEqual(m1.hug);
        expect(m2.sizes).toEqual(m1.sizes);
        expect(m2.sizes).not.toBe(m1.sizes);
        expect(flowOps.place(m1, settings(flow), box)).toEqual(flowOps.place(m1, settings(flow), box));
    });
});

// ── Freeform ─────────────────────────────────────────────────────────

describe('freeform', () => {
    const inner = { width: 400, height: 300 };

    it('hugs to the per-axis maximum of its items, each measured against the whole content box', () => {
        const measured = flowOps.measure({}, [tile(100, 20), tile(40, 80), tile(70, 50)], { ...inner, hugWidth: true, hugHeight: true });
        expect(measured.mode).toBe('freeform');
        expect(measured.hug).toEqual({ width: 100, height: 80 });
        expect(measured.sizes).toEqual([{ width: 100, height: 20 }, { width: 40, height: 80 }, { width: 70, height: 50 }]);
    });

    it('lets a fill item take the whole content box, and a hug item nothing', () => {
        const measured = flowOps.measure({}, [{ width: 'fill', height: 20 }, { width: 'hug', height: 'hug' }], inner);
        expect(measured.sizes).toEqual([{ width: 400, height: 20 }, { width: 0, height: 0 }]);
        expect(measured.hug).toEqual({ width: 400, height: 20 });
    });

    it('hugs to 0 with no items', () => {
        expect(flowOps.measure({}, [], inner).hug).toEqual({ width: 0, height: 0 });
    });

    it.each([
        ['topLeft', -150, 125],
        ['bottomRight', 150, -125],
        ['centerLeft', -150, 0],
        ['topCenter', 0, 125],
    ] as const)('puts an item at %s of the content box', (align, x, y) => {
        const [box] = flowOps.arrange({ flow: 'freeform', align }, [tile(100, 50)], inner);
        expect([box.x, box.y]).toEqual([x, y]);
    });

    it('takes a fractional align linearly', () => {
        const [box] = flowOps.arrange({ align: { x: 0.5, y: -0.5 } }, [tile(100, 50)], inner);
        expect([box.x, box.y]).toEqual([75, -62.5]);
    });

    it('keeps an item larger than the box centred whatever the align', () => {
        for (const align of ['topLeft', 'bottomRight', { x: 1, y: -1 }] as const) {
            const [box] = flowOps.arrange({ align }, [tile(500, 400)], inner);
            // `+ 0` folds a -0 (a negative align times zero slack) into 0.
            expect([box.x + 0, box.y + 0]).toEqual([0, 0]);
            expect([box.width, box.height]).toEqual([500, 400]);
        }
    });

    it('clamps the slack per axis, so an item that overflows only one axis is aligned on the other', () => {
        const [box] = flowOps.arrange({ align: 'topLeft' }, [tile(500, 50)], inner);
        expect([box.x, box.y]).toEqual([0, 125]);
    });
});

// ── Blends ───────────────────────────────────────────────────────────

describe('measuring a blend', () => {
    const items = [tile(100, 50), tile(100, 50)];
    const space: FlowSpace = { width: 400, height: 400 };

    it('returns the destination mode\'s measure, with the hug interpolated by t', () => {
        const row = flowOps.measure({ flow: 'horizontal' }, items, space).hug;
        const column = flowOps.measure({ flow: 'vertical' }, items, space).hug;
        expect(row).toEqual({ width: 200, height: 50 });
        expect(column).toEqual({ width: 100, height: 100 });

        const blend = flowOps.measure({ flow: { from: 'horizontal', to: 'vertical', t: 0.25 } }, items, space);
        expect(blend.mode).toBe('vertical');
        expect(blend.hug).toEqual({ width: 175, height: 62.5 });
    });

    it('attaches the measure of the mode being left and how far along', () => {
        const blend = flowOps.measure({ flow: { from: 'horizontal', to: 'vertical', t: 0.25 } }, items, space);
        expect(blend.t).toBe(0.25);
        expect(blend.from?.mode).toBe('horizontal');
        expect(blend.from?.hug).toEqual({ width: 200, height: 50 });
        expect(blend.sizes).toEqual(flowOps.measure({ flow: 'vertical' }, items, space).sizes);
    });

    it('attaches nothing to a measure of a single mode', () => {
        const single = flowOps.measure({ flow: 'vertical' }, items, space);
        expect(single.from).toBeUndefined();
        expect(single.t).toBeUndefined();
    });

    it('is the source mode\'s boxes at t = 0 and the destination\'s at t = 1', () => {
        const place = (t: number) => {
            const settings: FlowSettings = { flow: { from: 'horizontal', to: 'vertical', t } };
            return flowOps.place(flowOps.measure(settings, items, space), settings, space);
        };
        const row = flowOps.arrange({ flow: 'horizontal' }, items, space);
        const column = flowOps.arrange({ flow: 'vertical' }, items, space);
        expect(place(0)).toEqual(row);
        expect(place(1)).toEqual(column);
    });
});

describe('the flow prop, at its ends', () => {
    it('is the identity on resolve', () => {
        const blend = { from: 'horizontal', to: 'vertical', t: 0.5 } as const;
        expect(flowOps.resolve('grid')).toBe('grid');
        // A restored prop hands a stored blend back through `resolve`, though its input type names modes only.
        expect(flowOps.resolve(blend as unknown as FlowMode)).toBe(blend);
    });

    it('keeps the blend at t = 0 and below, with t as given', () => {
        expect(flowOps.lerp('horizontal', 'vertical', 0)).toEqual({ from: 'horizontal', to: 'vertical', t: 0 });
        expect(flowOps.lerp('horizontal', 'vertical', -0.5)).toEqual({ from: 'horizontal', to: 'vertical', t: -0.5 });
    });

    it('settles on the destination above t = 1', () => {
        expect(flowOps.lerp('horizontal', 'vertical', 1.5)).toBe('vertical');
        expect(flowOps.lerp({ from: 'grid', to: 'horizontal', t: 0.3 }, { from: 'horizontal', to: 'freeform', t: 0.9 }, 2)).toBe('freeform');
    });

    it('collapses a blend on either side to its destination mode', () => {
        const blend = { from: 'horizontal', to: 'vertical', t: 0.5 } as const;
        expect(flowOps.lerp('grid', blend, 0.5)).toEqual({ from: 'grid', to: 'vertical', t: 0.5 });
        expect(flowOps.lerp(blend, blend, 0.5)).toBe('vertical');
    });
});

// ── Sizing a container ───────────────────────────────────────────────

describe('contentBox', () => {
    const none = { left: 0, right: 0, top: 0, bottom: 0 };
    const padding = { left: 10, right: 20, top: 5, bottom: 15 };

    it('takes the constraint\'s max for a fill axis, insets it by the padding and hugs neither', () => {
        expect(flowOps.contentBox({ width: 'fill', height: 'fill' }, { maxWidth: 800, maxHeight: 600 }, padding))
            .toEqual({ width: 770, height: 580, hugWidth: false, hugHeight: false });
    });

    it('takes a number as given, whatever the constraint', () => {
        expect(flowOps.contentBox({ width: 300, height: 200 }, { maxWidth: 800, maxHeight: 600 }, none))
            .toEqual({ width: 300, height: 200, hugWidth: false, hugHeight: false });
    });

    it('measures a hug axis in the constraint\'s max and flags it', () => {
        expect(flowOps.contentBox({ width: 'hug', height: 200 }, { maxWidth: 800, maxHeight: 600 }, padding))
            .toEqual({ width: 770, height: 180, hugWidth: true, hugHeight: false });
    });

    it('is 0 on an axis with no max constraint, hugging or filling', () => {
        expect(flowOps.contentBox({ width: 'fill', height: 'hug' }, {}, none))
            .toEqual({ width: 0, height: 0, hugWidth: false, hugHeight: true });
    });

    it('clamps the inset content box at 0 when the padding outgrows it', () => {
        const box = flowOps.contentBox({ width: 'fill', height: 'fill' }, { maxWidth: 20, maxHeight: 10 }, padding);
        expect(box.width).toBe(0);
        expect(box.height).toBe(0);
    });
});

describe('size', () => {
    const none = { left: 0, right: 0, top: 0, bottom: 0 };

    it('takes the constraint\'s max for a fill axis, and 0 when there is none', () => {
        expect(flowOps.size({ width: 'fill', height: 'fill' }, { maxWidth: 800 }, none, { width: 5, height: 5 }))
            .toEqual({ width: 800, height: 0 });
    });

    it('hugs an axis to its items plus padding, and keeps the other as given', () => {
        expect(flowOps.size({ width: 'hug', height: 90 }, { maxWidth: 800, maxHeight: 600 }, { left: 3, right: 4, top: 1, bottom: 1 }, { width: 50, height: 5 }))
            .toEqual({ width: 57, height: 90 });
    });
});

// ── Diagnostics ──────────────────────────────────────────────────────

describe('flowOps.collapsedRun, in a column and in the plural', () => {
    it('names a vertical run laid out in a box of height 0, with the mode and the box', () => {
        const m = flowOps.measure({ flow: 'vertical' }, [tile(100, 50)], { width: 100, height: 0 });
        expect(flowOps.collapsedRun(m, { width: 100, height: 0 })).toBe(
            'is laying out 1 sized child in a run of length 0 (100×0, vertical). '
            + 'They will be positioned from its centre rather than its leading edge.',
        );
    });

    it('counts the sized items and says children for more than one', () => {
        const m = flowOps.measure({ flow: 'vertical' }, [tile(100, 50), tile(0, 0), tile(0, 8), tile(10, 0)], { width: 100, height: 0 });
        expect(flowOps.collapsedRun(m, { width: 100, height: 0 })).toMatch(/^is laying out 3 sized children in a run of length 0 \(100×0, vertical\)/);
    });

    it('only looks at the main axis: a column of height 0 is collapsed, a column of width 0 is not', () => {
        const m = flowOps.measure({ flow: 'vertical' }, [tile(100, 50)], { width: 0, height: 100 });
        expect(flowOps.collapsedRun(m, { width: 0, height: 100 })).toBeNull();
        expect(flowOps.collapsedRun(m, { width: 100, height: 0 })).not.toBeNull();
    });

    it('treats a negative main length as collapsed too', () => {
        const m = flowOps.measure({ flow: 'horizontal' }, [tile(100, 50)], { width: 100, height: 100 });
        expect(flowOps.collapsedRun(m, { width: -1, height: 100 })).toMatch(/run of length 0/);
    });

    it('says nothing about a grid', () => {
        const m = flowOps.measure({ flow: 'grid' }, [tile(100, 50)], { width: 0, height: 0 });
        expect(flowOps.collapsedRun(m, { width: 0, height: 0 })).toBeNull();
    });

    it('logs nothing itself', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const m = flowOps.measure({ flow: 'horizontal' }, [tile(100, 50)], { width: 0, height: 0 });
            flowOps.collapsedRun(m, { width: 0, height: 0 });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});

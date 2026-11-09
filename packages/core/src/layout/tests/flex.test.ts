import { describe, it, expect } from 'vitest';
import { flowOps } from '@/layout/ops';
import type { FlowSettings, FlowSpace, GapSize, LayoutItem } from '@/layout/types';
import { Size2D, SizeInput } from '@/attributes/layout/size';

// ── Helpers ─────────────────────────────────────────────────────────

/** A plain item: a number is its size, `fill` takes what it is offered, `hug` is 0. */
function child(width: SizeInput, height: SizeInput, flex?: number): LayoutItem {
    return { width, height, flex };
}

/**
 * Simulates a wrapping {@link Text}-like child: its `fill` axes report a
 * fixed intrinsic content size regardless of the incoming constraint
 * (mirroring how `Text.measure()` reports wrapped line height even when
 * asked to "fill"), rather than echoing back whatever constraint it's given.
 */
function intrinsicChild(
    width: SizeInput,
    height: SizeInput,
    intrinsicWidth: number,
    intrinsicHeight: number,
    flex?: number,
): LayoutItem {
    return {
        width,
        height,
        flex,
        measure: (): Partial<Size2D> => ({
            width: typeof width === 'number' ? width : intrinsicWidth,
            height: typeof height === 'number' ? height : intrinsicHeight,
        }),
    };
}

function measure(
    items: LayoutItem[],
    over: { flow?: 'horizontal' | 'vertical'; gap?: GapSize; space?: Partial<FlowSpace> } = {},
) {
    return flowOps.measure(
        { flow: over.flow ?? 'horizontal', gap: over.gap ?? 0 },
        items,
        { width: 1000, height: 1000, ...over.space },
    );
}

/** Measure then place, the way a container lays a run out in a `width` × `height` content box. */
function place(items: LayoutItem[], settings: FlowSettings, width: number, height: number) {
    const inner = { width, height };
    return flowOps.place(flowOps.measure(settings, items, inner), settings, inner);
}

const ROW_START: FlowSettings = { flow: 'horizontal', align: { x: -1, y: -1 } };

// ── Measuring a run ─────────────────────────────────────────────────

describe('measure – fixed children, row', () => {
    it('returns one size per child', () => {
        const result = measure([child(100, 50), child(200, 80)]);
        expect(result.sizes).toHaveLength(2);
    });

    it('measures fixed widths and heights from each child', () => {
        const result = measure([child(100, 50), child(200, 80)]);
        expect(result.sizes[0]).toEqual({ width: 100, height: 50 });
        expect(result.sizes[1]).toEqual({ width: 200, height: 80 });
    });

    it('hug width is the sum of fixed main sizes (no gap)', () => {
        expect(measure([child(100, 50), child(200, 80)]).hug.width).toBe(300);
    });

    it('hug height is the max cross size', () => {
        expect(measure([child(100, 50), child(200, 80)]).hug.height).toBe(80);
    });

    it('a fixed-main child keeps its own main size beside a fill sibling', () => {
        const result = measure([child(100, 50), child('fill', 50)]);
        expect(result.sizes[0].width).toBe(100);
    });
});

describe('measure – column direction', () => {
    it('swaps which axis is main', () => {
        const result = measure([child(50, 100), child(80, 200)], { flow: 'vertical' });
        expect(result.hug.height).toBe(300);
        expect(result.hug.width).toBe(80);
    });

    it('fill on the height is what flexes in a column', () => {
        const result = measure([child(100, 'fill'), child(100, 50)], { flow: 'vertical' });
        expect(result.sizes[0].height).toBe(950);
        expect(result.sizes[1].height).toBe(50);
    });
});

describe('measure – fill children', () => {
    it('distributes remaining space evenly across fill children', () => {
        const result = measure(
            [child(100, 50), child('fill', 50), child('fill', 50)],
            { space: { width: 500 } },
        );
        // 500 - 100 = 400 remaining, split between 2 fill → 200 each
        expect(result.sizes[1].width).toBe(200);
        expect(result.sizes[2].width).toBe(200);
    });

    it('respects gap when distributing fill space', () => {
        const result = measure([child('fill', 50), child('fill', 50)], { gap: 20, space: { width: 500 } });
        // 500 - 20 (one gap) = 480 split between 2 → 240
        expect(result.sizes[0].width).toBe(240);
        expect(result.sizes[1].width).toBe(240);
    });

    it('gives zero to fill children when no space remains', () => {
        const result = measure([child(500, 50), child('fill', 50)], { space: { width: 500 } });
        expect(result.sizes[1].width).toBe(0);
    });

    it('flex child cross size matches the inner cross when the parent fills cross', () => {
        const result = measure([child('fill', 'fill')], { space: { width: 200, height: 100 } });
        expect(result.sizes[0].height).toBe(100);
    });
});

describe('measure – flex weights', () => {
    it('splits remaining space by flex weight (2:1)', () => {
        const result = measure(
            [child(100, 50), child('fill', 50, 2), child('fill', 50, 1)],
            { space: { width: 500 } },
        );
        // 500 - 100 = 400 free, split 2:1 → 266.67 / 133.33
        expect(result.sizes[1].width).toBeCloseTo(400 * 2 / 3);
        expect(result.sizes[2].width).toBeCloseTo(400 / 3);
    });

    it('subtracts gap before applying weights', () => {
        const result = measure([child('fill', 50, 3), child('fill', 50, 1)], { gap: 20, space: { width: 500 } });
        // 500 - 20 (one gap) = 480 free, split 3:1 → 360 / 120
        expect(result.sizes[0].width).toBe(360);
        expect(result.sizes[1].width).toBe(120);
    });

    it('a lone fill child takes all free space regardless of its flex', () => {
        const result = measure([child(100, 50), child('fill', 50, 5)], { space: { width: 500 } });
        expect(result.sizes[1].width).toBe(400);
    });

    it('flex 0 takes no space; sibling absorbs the rest', () => {
        const result = measure([child('fill', 50, 0), child('fill', 50, 1)], { space: { width: 500 } });
        expect(result.sizes[0].width).toBe(0);
        expect(result.sizes[1].width).toBe(500);
    });

    it('all-zero flex collapses every fill child to zero', () => {
        const result = measure([child('fill', 50, 0), child('fill', 50, 0)], { space: { width: 500 } });
        expect(result.sizes[0].width).toBe(0);
        expect(result.sizes[1].width).toBe(0);
    });

    it('sanitizes negative / NaN flex to 1 (behaves as equal split)', () => {
        const result = measure([child('fill', 50, -3), child('fill', 50, NaN)], { space: { width: 500 } });
        expect(result.sizes[0].width).toBe(250);
        expect(result.sizes[1].width).toBe(250);
    });

    it('weights the main axis in a column', () => {
        const result = measure(
            [child(50, 'fill', 3), child(50, 'fill', 1)],
            { flow: 'vertical', space: { height: 400 } },
        );
        expect(result.sizes[0].height).toBe(300);
        expect(result.sizes[1].height).toBe(100);
    });

    it('flex does not affect cross-axis fill', () => {
        const result = measure([child('fill', 'fill', 9)], { space: { width: 200, height: 100 } });
        // cross (height) fills to the inner height irrespective of flex
        expect(result.sizes[0].height).toBe(100);
    });

    it('hug-main + fill-main children measure unconstrained, ignoring flex weight', () => {
        // Figma disallows "Fill container" on the axis a parent hugs, so a
        // fill-main child here measures like a hug child: its own intrinsic
        // size, regardless of flex weight (there's no real space to divide).
        const result = measure(
            [child(80, 50), intrinsicChild('fill', 50, 60, 50, 3), intrinsicChild('fill', 50, 20, 50, 1)],
            { space: { hugWidth: true } },
        );
        expect(result.sizes[1].width).toBe(60);
        expect(result.sizes[2].width).toBe(20);
        // hug width includes every child's real measured size (80+60+20)
        expect(result.hug.width).toBe(160);
    });
});

describe('measure – parent hug behavior', () => {
    it('hug main counts fixed-main contributions plus gaps when parent hugs main', () => {
        const result = measure([child(100, 50), child(200, 50)], { gap: 10, space: { hugWidth: true } });
        // 100 + 200 + 10 (one gap) = 310
        expect(result.hug.width).toBe(310);
    });

    it('parent hug main + fill-main child measures its own intrinsic size, not a borrowed share', () => {
        const result = measure([intrinsicChild('fill', 50, 30, 50)], { space: { hugWidth: true } });
        expect(result.sizes[0].width).toBe(30);
        expect(result.hug.width).toBe(30);
    });

    it('parent hug main + fill-main child with no intrinsic size collapses to 0, not Infinity', () => {
        // A fill-main child with no content-driven intrinsic size measures as
        // Infinity when probed unconstrained — there's nothing real to hug to. An
        // Infinity here would propagate into the container's hug size and make
        // the whole thing disappear, so it collapses to 0.
        const result = measure([child('fill', 50)], { space: { hugWidth: true } });
        expect(result.sizes[0].width).toBe(0);
        expect(result.hug.width).toBe(0);
    });

    it('hug-main column with a fixed child and a wrapping fill-height child hugs to both (wrap-bounds regression)', () => {
        // A hug-height column containing a fixed-height box and a wrapping Text
        // with height: 'fill'. The column must grow to fit the text's real
        // wrapped content height, not just the fixed sibling.
        const result = measure(
            [child(500, 205), intrinsicChild('fill', 'fill', 500, 77)],
            { flow: 'vertical', gap: 10, space: { width: 500, height: 1000, hugHeight: true } },
        );
        expect(result.sizes[1].height).toBe(77);
        // 205 (fixed) + 77 (wrapped text) + 10 (gap) = 292
        expect(result.hug.height).toBe(292);
    });

    it('hug-cross parent anchors fill-cross children to the deepest fixed child', () => {
        const result = measure([child(50, 80), child(50, 'fill')], { space: { hugHeight: true } });
        expect(result.sizes[1].height).toBe(80);
    });
});

describe('measure – wrapped run hugging its main axis', () => {
    const wrapped = (items: LayoutItem[], over: { flow?: 'horizontal' | 'vertical'; space?: Partial<FlowSpace> } = {}) =>
        flowOps.measure(
            { flow: over.flow ?? 'horizontal', gap: 10, wrap: true },
            items,
            { width: 1000, height: 1000, hugWidth: true, ...over.space },
        );
    const unwrapped = (items: LayoutItem[]) =>
        flowOps.measure({ flow: 'horizontal', gap: 10 }, items, { width: 1000, height: 1000, hugWidth: true });

    it('measures a fill item intrinsically, so wrapping does not change the hug size', () => {
        // Both runs hug a 1000-wide max: one 100-wide item and a bare `fill` that
        // has nothing to fill. The wrapped run measured the fill against the whole
        // 1000 and hugged to 1110 where the unwrapped run hugs to 110.
        const items = [child(100, 20), child('fill', 20)];
        expect(unwrapped(items).hug.width).toBe(110);
        expect(wrapped(items).hug.width).toBe(110);
        expect(wrapped(items).sizes[1].width).toBe(0);
    });

    it('uses the intrinsic size of a fill item that has one', () => {
        const items = [child(100, 20), intrinsicChild('fill', 20, 60, 20)];
        expect(wrapped(items).sizes[1].width).toBe(60);
        expect(wrapped(items).hug.width).toBe(unwrapped(items).hug.width);
        expect(wrapped(items).hug.width).toBe(170);
    });

    it('does the same down a hugging column', () => {
        const items = [child(20, 100), child(20, 'fill')];
        const column = flowOps.measure(
            { flow: 'vertical', gap: 10, wrap: true },
            items,
            { width: 1000, height: 1000, hugHeight: true },
        );
        expect(column.hug.height).toBe(110);
    });

    it('still gives a fill item the whole main axis when the axis is bounded', () => {
        const result = flowOps.measure(
            { flow: 'horizontal', gap: 10, wrap: true },
            [child(100, 20), child('fill', 20)],
            { width: 1000, height: 1000 },
        );
        // 100 + 10 + 1000 does not fit one line: the fill item takes a line alone.
        expect(result.lines).toHaveLength(2);
        expect(result.sizes[1].width).toBe(1000);
    });
});

describe('measure – edge cases', () => {
    it('handles an empty child list', () => {
        const result = measure([]);
        expect(result.sizes).toHaveLength(0);
        expect(result.hug).toEqual({ width: 0, height: 0 });
    });

    it('returns the single child sizes when only one child', () => {
        expect(measure([child(123, 45)]).hug).toEqual({ width: 123, height: 45 });
    });
});

// ── Placing a run ───────────────────────────────────────────────────
// Boxes are centred on the content box and y-up, so a y that read -200 when
// layout space was y-down now reads 200.

describe('place – start alignment', () => {
    it('places first child at left edge in a row', () => {
        const result = place([child(100, 50)], ROW_START, 500, 200);
        // start: the run begins at -250, so the child's centre is -250 + 100/2 = -200
        expect(result[0].x).toBe(-200);
    });

    it('places second child at firstWidth + gap from first', () => {
        const result = place([child(100, 50), child(80, 50)], { ...ROW_START, gap: 20 }, 500, 200);
        // Next starts at -250 + 100 + 20 = -130, centre = -130 + 40 = -90
        expect(result[1].x).toBe(-90);
    });
});

describe('place – center alignment', () => {
    it('centers a single child horizontally in a row', () => {
        const result = place([child(100, 50)], { flow: 'horizontal', align: { x: 0, y: 0 } }, 500, 200);
        expect(result[0].x).toBe(0);
        expect(result[0].y).toBe(0);
    });
});

describe('place – end alignment', () => {
    it('places last child flush to the right edge', () => {
        const result = place([child(100, 50)], { flow: 'horizontal', align: { x: 1, y: -1 } }, 500, 200);
        // 250 - 100 = 150 start, centre = 200
        expect(result[0].x).toBe(200);
    });
});

describe('place – auto gap', () => {
    it('distributes remaining inner space across gaps', () => {
        const result = place(
            [child(100, 50), child(100, 50), child(100, 50)],
            { ...ROW_START, gap: 'auto' },
            900, 200,
        );
        // 3 children = 300 main, 2 gaps = (900-300)/2 = 300 each
        expect(result.map((b) => b.x)).toEqual([-400, 0, 400]);
    });

    it('auto gap is 0 when only one child', () => {
        const result = place([child(100, 50)], { ...ROW_START, gap: 'auto' }, 500, 200);
        expect(result[0].x).toBe(-200);
    });
});

describe('arrange – padding', () => {
    it('start in row pushes inwards by padding.left', () => {
        const result = flowOps.arrange(
            { ...ROW_START, padding: { left: 20, right: 0, top: 0, bottom: 0 } },
            [child(100, 50)],
            { width: 500, height: 200 },
        );
        // -250 + 20 = -230, centre = -230 + 50 = -180
        expect(result[0].x).toBe(-180);
    });

    it('end in row offsets by padding.right', () => {
        const result = flowOps.arrange(
            { flow: 'horizontal', align: { x: 1, y: -1 }, padding: { left: 0, right: 20, top: 0, bottom: 0 } },
            [child(100, 50)],
            { width: 500, height: 200 },
        );
        // 250 - 100 - 20 = 130, centre = 130 + 50 = 180
        expect(result[0].x).toBe(180);
    });

    it('center in column shifts to the padded inner center for asymmetric padding', () => {
        const result = flowOps.arrange(
            { flow: 'vertical', align: { x: 0, y: 0 }, padding: { left: 50, right: 250, top: 0, bottom: 0 } },
            [child(100, 50)],
            { width: 500, height: 200 },
        );
        // cross center honors padding asymmetry: (50 - 250) / 2 = -100
        expect(result[0].x).toBe(-100);
    });
});

describe('place – column direction', () => {
    it('places first child at the top when alignment y=1', () => {
        const result = place([child(50, 100)], { flow: 'vertical', align: { x: 0, y: 1 } }, 200, 500);
        // top: the run begins at y = 250, so the child's centre is 250 - 100/2 = 200
        expect(result[0].y).toBe(200);
        expect(result[0].x).toBe(0);
    });

    it('respects gap when stacking column children', () => {
        const result = place(
            [child(50, 100), child(50, 80)],
            { flow: 'vertical', gap: 30, align: { x: 0, y: 1 } },
            200, 500,
        );
        // second starts 100 + 30 below the top: 250 - 130 - 40 = 80
        expect(result[0].y).toBe(200);
        expect(result[1].y).toBe(80);
    });
});

describe('place – returns sizes from the measure', () => {
    it('width/height in the result come from the child, not the box', () => {
        const result = place([child(100, 50)], ROW_START, 500, 200);
        expect(result[0].width).toBe(100);
        expect(result[0].height).toBe(50);
    });
});

// A fixed-size child carrying a per-child `gapScale`, for the animated
// insert/remove gap behavior. `gapScale` weights the gaps around this child.
function scaledChild(width: number, gapScale: number): LayoutItem {
    return { ...child(width, 50), gapScale };
}

describe('measure – gapScale (animated insert/remove gap budget)', () => {
    it('default gapScale of 1 reproduces the flat (count - 1) gap budget', () => {
        // 3 × 100, gap 20, all default weight → hug = 300 + 2×20 = 340.
        const result = measure([child(100, 50), child(100, 50), child(100, 50)], { gap: 20 });
        expect(result.hug.width).toBe(340);
    });

    it('a fractional-scale child opens a fractional gap in the hug size', () => {
        // Σ gapScale = 1 + 0.5 + 1 = 2.5 → totalGap = 20 × (2.5 − 1) = 30 → hug = 330.
        const result = measure([child(100, 50), scaledChild(100, 0.5), child(100, 50)], { gap: 20 });
        expect(result.hug.width).toBe(330);
    });

    it('a fully collapsed child removes exactly one gap from the budget', () => {
        // Σ gapScale = 1 + 0 + 1 = 2 → totalGap = 20 → hug = 320, one gap fewer than 340.
        const result = measure([child(100, 50), scaledChild(100, 0), child(100, 50)], { gap: 20 });
        expect(result.hug.width).toBe(320);
    });

    it('a collapsed *edge* child also removes exactly one gap (position-independent)', () => {
        const first = measure([scaledChild(100, 0), child(100, 50), child(100, 50)], { gap: 20 });
        const last = measure([child(100, 50), child(100, 50), scaledChild(100, 0)], { gap: 20 });
        expect(first.hug.width).toBe(320);
        expect(last.hug.width).toBe(320);
    });

    it('clamps an over/undershooting scale to [0, 1] (guards eased-tween overshoot)', () => {
        // 1.5 clamps to 1, −0.3 clamps to 0 → Σ = 2 → totalGap = 20 → hug 320.
        const result = measure([scaledChild(100, 1.5), child(100, 50), scaledChild(100, -0.3)], { gap: 20 });
        expect(result.hug.width).toBe(320);
    });

    it('leaves fill children the right space as an inserted child grows', () => {
        // 500 inner, one 100 fixed + one fill, gap 20, fixed child at scale 0.5:
        // totalGap = 20 × (1.5 − 1) = 10 → fill gets 500 − 100 − 10 = 390.
        const result = measure([scaledChild(100, 0.5), child('fill', 50)], { gap: 20, space: { width: 500 } });
        expect(result.sizes[1].width).toBe(390);
    });
});

describe('place – gapScale placement', () => {
    // 3 fixed 100-wide children in a 500-wide start-justified row, each carrying
    // a gapScale; returns the child centre x's.
    function centers(scales: number[], align = ROW_START.align): number[] {
        const items = scales.map((s) => scaledChild(100, s));
        return place(items, { flow: 'horizontal', gap: 20, align }, 500, 200).map((b) => b.x);
    }

    it('all default weights place children exactly like a flat gap', () => {
        // -250 start: -200, then +100+20 → -80, then again → 40.
        expect(centers([1, 1, 1])).toEqual([-200, -80, 40]);
    });

    it('a half-scale middle child half-opens both its gaps', () => {
        // boundary 0 = 20×(1+0.5)/2 = 15, boundary 1 = 20×(0.5+1)/2 = 15.
        expect(centers([1, 0.5, 1])).toEqual([-200, -85, 30]);
    });

    it('a collapsed middle child pulls its right neighbour in by one full gap', () => {
        expect(centers([1, 0, 1])).toEqual([-200, -90, 20]);
    });

    it('a collapsed leading child keeps the existing content edge pinned', () => {
        // The collapsed first child hangs half a gap before the run, so the first
        // *real* child (index 1) sits where a 3-child row's first child would.
        const items = [scaledChild(0, 0), scaledChild(100, 1), scaledChild(100, 1), scaledChild(100, 1)];
        const xs = place(items, { flow: 'horizontal', gap: 20, align: ROW_START.align }, 500, 200).map((b) => b.x);
        expect(xs.slice(1)).toEqual([-200, -80, 40]);
    });

    it('center justify stays centered with a collapsed child', () => {
        // totalMain = 300 + 20 = 320 → start at -160: -110, 0, 110 (symmetric).
        expect(centers([1, 0, 1], { x: 0, y: 0 })).toEqual([-110, 0, 110]);
    });
});

// ── gap: "auto" in the measure ──────────────────────────────────────

describe('measure – gap: "auto"', () => {
    it('reserves nothing, so the hug extent excludes the gaps', () => {
        const auto = measure([child(100, 50), child(100, 50), child(100, 50)], { gap: 'auto', space: { hugWidth: true } });
        expect(auto.hug).toEqual({ width: 300, height: 50 });
        expect(measure([child(100, 50), child(100, 50), child(100, 50)], { gap: 10, space: { hugWidth: true } }).hug.width).toBe(320);
    });

    it('leaves the whole free space to the fill items', () => {
        const result = measure([child(100, 50), child('fill', 50), child('fill', 50)], { gap: 'auto' });
        expect(result.sizes.map((s) => s.width)).toEqual([100, 450, 450]);
    });

    it('reserves nothing down a column either', () => {
        const result = measure([child(50, 100), child(50, 100)], { flow: 'vertical', gap: 'auto', space: { hugHeight: true } });
        expect(result.hug).toEqual({ width: 50, height: 200 });
    });

    it('is still spread over the free space when the run is placed', () => {
        const bounds = place([child(100, 50), child(100, 50), child(100, 50)], { ...ROW_START, gap: 'auto' }, 600, 100);
        // 600 - 300 = 300 free over two gaps: items at 0, 250 and 500 from the left edge.
        expect(bounds.map((b) => b.x - b.width / 2 + 300)).toEqual([0, 250, 500]);
    });
});

// ── An overflowing run ──────────────────────────────────────────────

describe('place – an overflowing run', () => {
    const items = [child(100, 50), child(100, 50), child(100, 50)];
    // A 200-wide box holding 300 of items spills by 100: the main fraction decides how it is split.
    const lefts = (align: { x: number; y: number }) =>
        place(items, { flow: 'horizontal', align }, 200, 100).map((b) => b.x - b.width / 2 + 100);

    it('is not clamped: fill-free items keep their size', () => {
        const bounds = place(items, { flow: 'horizontal' }, 200, 100);
        expect(bounds.map((b) => b.width)).toEqual([100, 100, 100]);
    });

    it('spills off the end under start alignment', () => {
        expect(lefts({ x: -1, y: 0 })).toEqual([0, 100, 200]);
    });

    it('spills evenly off both ends under centre alignment', () => {
        expect(lefts({ x: 0, y: 0 })).toEqual([-50, 50, 150]);
    });

    it('spills off the start under end alignment', () => {
        expect(lefts({ x: 1, y: 0 })).toEqual([-100, 0, 100]);
    });

    it('spills by the main fraction in between', () => {
        expect(lefts({ x: -0.5, y: 0 })).toEqual([-25, 75, 175]);
    });

    it('spills the same way down a column', () => {
        const tall = [child(50, 100), child(50, 100), child(50, 100)];
        const tops = place(tall, { flow: 'vertical', align: { x: 0, y: 1 } }, 100, 200)
            .map((b) => 100 - (b.y + b.height / 2));
        expect(tops).toEqual([0, 100, 200]);
    });

    it('gives fill items nothing when the fixed ones already overflow', () => {
        const result = measure([child(150, 50), child(150, 50), child('fill', 50)], { space: { width: 200 } });
        expect(result.sizes.map((s) => s.width)).toEqual([150, 150, 0]);
    });
});

// ── measureWrap, directly ───────────────────────────────────────────

describe('measureWrap – line breaks', () => {
    const wrap = (
        items: LayoutItem[],
        over: { flow?: 'horizontal' | 'vertical'; gap?: GapSize; crossGap?: number; space?: Partial<FlowSpace> } = {},
    ) => flowOps.measure(
        { flow: over.flow ?? 'horizontal', gap: over.gap ?? 10, crossGap: over.crossGap, wrap: true },
        items,
        { width: 250, height: 1000, ...over.space },
    );
    const lines = (m: ReturnType<typeof wrap>) => m.lines?.map((l) => [l.start, l.end]);

    it('breaks greedily where the next item and its gap no longer fit', () => {
        // 100 + 10 + 100 = 210 fits 250; adding 10 + 100 does not.
        const m = wrap([child(100, 20), child(100, 20), child(100, 20), child(100, 20), child(100, 20)]);
        expect(lines(m)).toEqual([[0, 2], [2, 4], [4, 5]]);
    });

    it('fits an item that lands exactly on the limit', () => {
        const m = wrap([child(100, 20), child(140, 20)]);
        expect(lines(m)).toEqual([[0, 2]]);
        expect(wrap([child(100, 20), child(141, 20)]).lines).toHaveLength(2);
    });

    it('hugs to the widest line and the stacked lines with the cross gap between them', () => {
        const m = wrap([child(100, 20), child(100, 20), child(100, 30)], { crossGap: 7 });
        expect(m.hug).toEqual({ width: 210, height: 20 + 7 + 30 });
    });

    it('lets an unset cross gap follow the gap', () => {
        const followed = wrap([child(100, 20), child(100, 20), child(100, 20)], { gap: 15 });
        expect(followed.hug.height).toBe(20 + 15 + 20);
        const explicit = wrap([child(100, 20), child(100, 20), child(100, 20)], { gap: 15, crossGap: 0 });
        expect(explicit.hug.height).toBe(40);
    });

    it('takes at least one item per line, so an over-long one overflows its own', () => {
        const m = wrap([child(400, 20), child(50, 20)]);
        expect(lines(m)).toEqual([[0, 1], [1, 2]]);
        expect(m.hug.width).toBe(400);
    });

    it('records each line\'s thickness as its deepest item', () => {
        const m = wrap([child(100, 20), child(100, 45), child(100, 10)]);
        expect(m.lines?.map((l) => l.cross)).toEqual([45, 10]);
    });

    it('measures every item at its natural size and gives each a gap scale of 1', () => {
        const m = wrap([child(100, 20), { width: 100, height: 20, gapScale: 0 }]);
        expect(m.gapScales).toEqual([1, 1]);
        expect(m.sizes).toEqual([{ width: 100, height: 20 }, { width: 100, height: 20 }]);
    });

    it('wraps a column against the height, stacking its lines across the width', () => {
        const m = wrap(
            [child(20, 100), child(30, 100), child(20, 100)],
            { flow: 'vertical', space: { width: 1000, height: 250 }, crossGap: 5 },
        );
        expect(lines(m)).toEqual([[0, 2], [2, 3]]);
        expect(m.lines?.map((l) => l.cross)).toEqual([30, 20]);
        expect(m.hug).toEqual({ width: 30 + 5 + 20, height: 210 });
    });

    it('does not break on a hugging main axis', () => {
        const m = wrap([child(100, 20), child(100, 20), child(100, 20)], { space: { hugWidth: true } });
        expect(lines(m)).toEqual([[0, 3]]);
        expect(m.hug).toEqual({ width: 320, height: 20 });
    });

    it('breaks on a bounded axis even when the cross axis hugs', () => {
        const m = wrap([child(100, 20), child(100, 20), child(100, 20)], { space: { hugHeight: true } });
        expect(m.lines).toHaveLength(2);
    });

    it('has no lines and hugs to nothing with no items', () => {
        const m = wrap([]);
        expect(m.lines).toEqual([]);
        expect(m.sizes).toEqual([]);
        expect(m.hug).toEqual({ width: 0, height: 0 });
    });

    it('counts "auto" as no gap when breaking', () => {
        // 100 + 100 + 100 = 300 > 250, so two to a line, whatever gap would be spread later.
        const m = wrap([child(100, 20), child(100, 20), child(100, 20)], { gap: 'auto' });
        expect(lines(m)).toEqual([[0, 2], [2, 3]]);
        expect(m.hug.width).toBe(200);
    });
});

describe('measureWrap – fill', () => {
    const wrap = (items: LayoutItem[], over: { flow?: 'horizontal' | 'vertical'; space?: Partial<FlowSpace> } = {}) =>
        flowOps.measure(
            { flow: over.flow ?? 'horizontal', gap: 10, crossGap: 4, wrap: true },
            items,
            { width: 300, height: 1000, ...over.space },
        );

    it('gives a fill-main item the whole main axis, so it takes a line to itself', () => {
        const m = wrap([child(100, 20), child('fill', 20), child(100, 20)]);
        expect(m.lines?.map((l) => [l.start, l.end])).toEqual([[0, 1], [1, 2], [2, 3]]);
        expect(m.sizes[1].width).toBe(300);
    });

    it('does not divide the main axis among fill items by flex', () => {
        const m = wrap([child('fill', 20, 3), child('fill', 20, 1)]);
        expect(m.sizes.map((s) => s.width)).toEqual([300, 300]);
        expect(m.lines).toHaveLength(2);
    });

    it('stretches a fill-cross item to the thickness of its own line', () => {
        const m = wrap([child(100, 30), child(100, 'fill'), child(250, 50), child(100, 20), child(100, 'fill')]);
        expect(m.lines?.map((l) => [l.start, l.end])).toEqual([[0, 2], [2, 3], [3, 5]]);
        expect(m.sizes.map((s) => s.height)).toEqual([30, 30, 50, 20, 20]);
        expect(m.lines?.map((l) => l.cross)).toEqual([30, 50, 20]);
    });

    it('stretches down a column the same way', () => {
        const m = wrap(
            [child(30, 100), child('fill', 100), child(50, 100)],
            { flow: 'vertical', space: { width: 1000, height: 300 } },
        );
        expect(m.lines?.map((l) => [l.start, l.end])).toEqual([[0, 2], [2, 3]]);
        expect(m.sizes.map((s) => s.width)).toEqual([30, 30, 50]);
    });

    it('makes a line holding only fill-cross items zero thick', () => {
        const m = wrap([child(100, 'fill'), child(250, 40)], { space: { width: 300 } });
        expect(m.lines?.map((l) => l.cross)).toEqual([0, 40]);
        expect(m.sizes[0]).toEqual({ width: 100, height: 0 });
    });
});

describe('place – a wrapped run with gap "auto"', () => {
    const settings: FlowSettings = { flow: 'horizontal', gap: 'auto', wrap: true, crossGap: 0, align: { x: -1, y: 1 } };
    const lefts = (items: LayoutItem[], width: number) => {
        const inner = { width, height: 400 };
        return flowOps.place(flowOps.measure(settings, items, inner), settings, inner)
            .map((b) => b.x - b.width / 2 + width / 2);
    };

    it('spreads each line over the full main axis', () => {
        const items = [child(100, 20), child(100, 20), child(100, 20), child(100, 20), child(100, 20)];
        // Three to a line in 350 (auto counts no gap when breaking); the last two are spread wider.
        expect(lefts(items, 350)).toEqual([0, 125, 250, 0, 250]);
    });

    it('loosens a short last line as much as the full ones, not less', () => {
        const items = [child(100, 20), child(100, 20), child(100, 20), child(100, 20)];
        expect(lefts(items, 250)).toEqual([0, 150, 0, 150]);
    });

    it('puts a single-item line at the alignment start', () => {
        const items = [child(100, 20), child(100, 20), child(100, 20)];
        expect(lefts(items, 250)).toEqual([0, 150, 0]);
    });

    it('puts a single-item line at the alignment end under end alignment', () => {
        const end: FlowSettings = { ...settings, align: { x: 1, y: 1 } };
        const items = [child(100, 20), child(100, 20), child(100, 20)];
        const inner = { width: 250, height: 400 };
        const lefts = flowOps.place(flowOps.measure(end, items, inner), end, inner).map((b) => b.x - b.width / 2 + 125);
        expect(lefts).toEqual([0, 150, 150]);
    });

    it('centres a single-item line under centre alignment', () => {
        const centre: FlowSettings = { ...settings, align: { x: 0, y: 1 } };
        const items = [child(100, 20), child(100, 20), child(100, 20)];
        const inner = { width: 250, height: 400 };
        const lefts = flowOps.place(flowOps.measure(centre, items, inner), centre, inner).map((b) => b.x - b.width / 2 + 125);
        expect(lefts).toEqual([0, 150, 75]);
    });
});

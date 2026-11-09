import { describe, it, expect } from 'vitest';
import { BooleanGroup, MaskGroup } from "@/components/builtins/geometry/composite";
import { Rect, Ellipse } from "@/components/builtins/geometry/geometry";
import { Effects } from '@/attributes/shape/effects/chain';
import { laidOut, recorded, RecordingContext } from '@/components/trees/tests/recording-context.fixtures';
import type { BooleanOperation } from '@/attributes/mask/boolean';

/** A rect child whose scope shows up in the log as `begin:<id>` … `end`. */
const part = (id: string, extra: Record<string, unknown> = {}) => new Rect({ id, width: 40, height: 40, ...extra });

describe('BooleanGroup render — the boolean scope', () => {
    it('collects its children between beginBoolean and endBoolean, in tree order', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'subtract', width: 100, height: 100, children: [part('a'), part('b')] }));
        const ctx = recorded(group);

        const inside = ctx.between('beginBoolean:subtract', 'endBoolean');
        // Each child renders as a full node of its own: scope, transform, its drawing.
        expect(inside.filter((e) => e.startsWith('begin:'))).toEqual(['begin:a', 'begin:b']);
        expect(inside.indexOf('begin:a')).toBeLessThan(inside.indexOf('begin:b'));
        expect(ctx.events.filter((e) => e.startsWith('beginBoolean'))).toHaveLength(1);
    });

    it('hands the scope the operation it was given', () => {
        for (const op of ['union', 'subtract', 'intersect', 'exclude'] as BooleanOperation[]) {
            const group = laidOut(new BooleanGroup({ id: 'g', op, width: 100, height: 100, children: [part('a'), part('b')] }));
            expect(recorded(group).events).toContain(`beginBoolean:${op}`);
        }
    });

    it('is a union unless told otherwise', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', width: 100, height: 100, children: [part('a')] } as never));
        expect(group.op).toBe('union');
        expect(recorded(group).events).toContain('beginBoolean:union');
    });

    it('draws nothing of its own before the scope opens', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, children: [part('a')] }));
        const ctx = recorded(group);
        expect(ctx.events.slice(0, 3)).toEqual(['begin:g', 'transform', 'beginBoolean:union']);
    });

    it('pushes its own transform once, before the children push theirs', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', x: 10, width: 100, height: 100, children: [part('a')] }));
        const ctx = recorded(group);
        expect(ctx.events.filter((e) => e === 'transform')).toHaveLength(2);
        expect(ctx.events.indexOf('transform')).toBeLessThan(ctx.events.indexOf('beginBoolean:union'));
        expect(ctx.transforms[0].x).toBe(10);
    });

    it('ends the scope before it paints the combined silhouette', () => {
        const group = laidOut(new BooleanGroup({
            id: 'g', op: 'union', width: 100, height: 100, fill: 'red', children: [part('a')],
        }));
        const ctx = recorded(group);
        const end = ctx.events.indexOf('endBoolean');
        expect(end).toBeGreaterThan(ctx.events.lastIndexOf('end', end - 1));
        expect(ctx.events.slice(end, end + 2)).toEqual(['endBoolean', 'draw:shadow+fill']);
    });

    it('paints shadow and fill, then the overlay, then the stroke, once each', () => {
        const group = laidOut(new BooleanGroup({
            id: 'g', op: 'union', width: 100, height: 100,
            fill: 'red', shadow: { blur: 4, fill: 'black' }, overlay: 'white/10', stroke: { weight: 2, fill: 'blue' },
            children: [part('a')],
        }));
        const ctx = recorded(group);
        const after = ctx.events.slice(ctx.events.indexOf('endBoolean') + 1);
        expect(after).toEqual(['draw:shadow+fill', 'draw:fill', 'draw:stroke', 'end']);
    });

    it('paints the combined silhouette with the group\'s own fill, shadow and stroke, not the children\'s', () => {
        const group = laidOut(new BooleanGroup({
            id: 'g', op: 'union', width: 100, height: 100, fill: 'red', stroke: { weight: 3, fill: 'blue' },
            children: [part('a', { fill: 'green' })],
        }));
        const ctx = recorded(group);
        const [shadowAndFill, stroke] = ctx.graphics.slice(-2);
        const fill = shadowAndFill.ops().find((op) => op.kind === 'fill') as { fills: unknown } | undefined;
        expect(JSON.stringify(fill?.fills)).toContain('"color":[1,0,0,1]');
        const outline = stroke.ops().find((op) => op.kind === 'stroke') as { strokes: Array<{ weight: number }> } | undefined;
        expect(outline?.strokes[0].weight).toBe(3);
    });

    it('draws no overlay pass when there is no overlay', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, fill: 'red', children: [part('a')] }));
        const ctx = recorded(group);
        const after = ctx.events.slice(ctx.events.indexOf('endBoolean') + 1);
        expect(after).toEqual(['draw:shadow+fill', 'draw:stroke', 'end']);
    });

    it('always draws the fill and stroke passes, even with nothing to paint', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, children: [part('a')] }));
        const ctx = recorded(group);
        expect(ctx.events.slice(ctx.events.indexOf('endBoolean') + 1)).toEqual(['draw:shadow+fill', 'draw:stroke', 'end']);
    });

    it('ends every scope it opened', () => {
        const group = laidOut(new BooleanGroup({
            id: 'g', op: 'exclude', width: 100, height: 100, fill: 'red', overlay: 'white/10', stroke: { weight: 1, fill: 'blue' },
            children: [part('a'), part('b')],
        }));
        const ctx = recorded(group);
        expect(ctx.unbalanced).toEqual({});
        expect(ctx.events.filter((e) => e.startsWith('begin:')).length).toBe(ctx.events.filter((e) => e === 'end').length);
    });

    it('opens and closes the scope with no children at all', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, fill: 'red' }));
        const ctx = recorded(group);
        expect(ctx.events).toEqual([
            'begin:g', 'transform', 'beginBoolean:union', 'endBoolean', 'draw:shadow+fill', 'draw:stroke', 'end',
        ]);
    });

    it('feeds a nested group into the scope of the one above it', () => {
        const inner = new BooleanGroup({ id: 'inner', op: 'subtract', width: 60, height: 60, children: [part('x'), part('y')] });
        const outer = laidOut(new BooleanGroup({ id: 'outer', op: 'union', width: 100, height: 100, children: [inner, part('z')] }));
        const ctx = recorded(outer);

        const events = ctx.events;
        expect(events.indexOf('beginBoolean:union')).toBeLessThan(events.indexOf('beginBoolean:subtract'));
        expect(events.lastIndexOf('endBoolean')).toBeGreaterThan(events.indexOf('begin:z'));
        // The inner scope closed before the outer one: two endBooleans, the first inside the outer scope.
        const ends = events.map((e, i) => (e === 'endBoolean' ? i : -1)).filter((i) => i >= 0);
        expect(ends).toHaveLength(2);
        expect(ends[0]).toBeLessThan(events.indexOf('begin:z'));
        expect(ctx.unbalanced).toEqual({});
    });

    it('does not draw a fully transparent child into the scope', () => {
        const group = laidOut(new BooleanGroup({
            id: 'g', op: 'union', width: 100, height: 100,
            children: [part('shown'), part('clear', { opacity: 0 })],
        }));
        const ctx = recorded(group);
        expect(ctx.events).toContain('begin:shown');
        expect(ctx.events).not.toContain('begin:clear');
    });

    it('wraps the lot in a foreground effect scope when it has a warping effect', () => {
        const group = laidOut(new BooleanGroup({
            id: 'g', op: 'union', width: 100, height: 100, fill: 'red', effects: Effects.twirl(30), children: [part('a')],
        }));
        const ctx = recorded(group);
        const events = ctx.events;
        expect(events.indexOf('beginEffects:foreground')).toBeLessThan(events.indexOf('beginBoolean:union'));
        expect(events.lastIndexOf('endEffects')).toBeGreaterThan(events.indexOf('draw:stroke'));
        expect(ctx.unbalanced).toEqual({});
    });

    it('opens no effect scope without effects', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, children: [part('a')] }));
        expect(recorded(group).events.some((e) => e.startsWith('beginEffects'))).toBe(false);
    });

    it('draws nothing when it is itself invisible', () => {
        const group = laidOut(new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, opacity: 0, children: [part('a')] }));
        expect(recorded(group).events).toEqual([]);
    });

    it('draws nothing when it is not in a scene', () => {
        const group = new BooleanGroup({ id: 'g', op: 'union', width: 100, height: 100, children: [part('a')] });
        const ctx = new RecordingContext();
        group.render(ctx);
        expect(ctx.events).toEqual([]);
    });
});

describe('MaskGroup render — the mask scope', () => {
    const mask = () => new Ellipse({ id: 'mask', width: 60, height: 60 });

    it('draws the mask, applies it, then draws the content, inside one scope', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, children: [mask(), part('c1'), part('c2')] }));
        const ctx = recorded(group);

        const events = ctx.events;
        const begin = events.indexOf('beginMask:alpha:false');
        const apply = events.indexOf('applyMask');
        const end = events.indexOf('endMask');
        expect(begin).toBeGreaterThan(-1);
        expect(begin).toBeLessThan(events.indexOf('begin:mask'));
        expect(events.indexOf('begin:mask')).toBeLessThan(apply);
        expect(apply).toBeLessThan(events.indexOf('begin:c1'));
        expect(events.indexOf('begin:c1')).toBeLessThan(events.indexOf('begin:c2'));
        expect(events.indexOf('begin:c2')).toBeLessThan(end);
        expect(ctx.unbalanced).toEqual({});
    });

    it('renders the first child as the mask and every other child as content', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, children: [mask(), part('c1'), part('c2'), part('c3')] }));
        const ctx = recorded(group);
        const asMask = ctx.between('beginMask:alpha:false', 'applyMask').filter((e) => e.startsWith('begin:'));
        const asContent = ctx.between('applyMask', 'endMask').filter((e) => e.startsWith('begin:'));
        expect(asMask).toEqual(['begin:mask']);
        expect(asContent).toEqual(['begin:c1', 'begin:c2', 'begin:c3']);
    });

    it('passes alpha and not inverted by default', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, children: [mask(), part('c')] }));
        const ctx = recorded(group);
        expect(ctx.masks).toEqual([{ mode: 'alpha', inverted: false }]);
    });

    it.each(['alpha', 'vector', 'luminance'] as const)('passes the %s mode through', (mode) => {
        const group = laidOut(new MaskGroup({ id: 'm', mode, width: 100, height: 100, children: [mask(), part('c')] }));
        expect(recorded(group).masks[0]?.mode).toBe(mode);
    });

    it('passes inverted through', () => {
        const group = laidOut(new MaskGroup({ id: 'm', inverted: true, width: 100, height: 100, children: [mask(), part('c')] }));
        expect(recorded(group).masks).toEqual([{ mode: 'alpha', inverted: true }]);
    });

    it('opens no mask for one child alone, which draws as itself', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, children: [mask()] }));
        const ctx = recorded(group);
        expect(ctx.events.some((e) => e.includes('Mask'))).toBe(false);
        expect(ctx.events).toContain('begin:mask');
        expect(ctx.events.indexOf('begin:m')).toBeLessThan(ctx.events.indexOf('begin:mask'));
    });

    it('draws only its own scope and transform with no children', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100 }));
        expect(recorded(group).events).toEqual(['begin:m', 'transform', 'end']);
    });

    it('pushes its own transform once, before the mask scope', () => {
        const group = laidOut(new MaskGroup({ id: 'm', x: 7, width: 100, height: 100, children: [mask(), part('c')] }));
        const ctx = recorded(group);
        expect(ctx.events.indexOf('transform')).toBeLessThan(ctx.events.indexOf('beginMask:alpha:false'));
        expect(ctx.transforms[0].x).toBe(7);
    });

    it('draws nothing of its own, only the mask and the content', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, children: [mask(), part('c')] }));
        const ctx = recorded(group);
        // The group has no paint: its first and last events are its scope, with no draw outside a child.
        expect(ctx.events.slice(0, 2)).toEqual(['begin:m', 'transform']);
        expect(ctx.events[ctx.events.length - 1]).toBe('end');
        expect(ctx.events[ctx.events.length - 2]).toBe('endMask');
    });

    it('wraps the mask scope in a foreground effect scope when it has a warping effect', () => {
        const group = laidOut(new MaskGroup({
            id: 'm', width: 100, height: 100, effects: Effects.twirl(30), children: [mask(), part('c')],
        }));
        const ctx = recorded(group);
        const events = ctx.events;
        expect(events.indexOf('beginEffects:foreground')).toBeLessThan(events.indexOf('beginMask:alpha:false'));
        expect(events.indexOf('endEffects')).toBeGreaterThan(events.indexOf('endMask'));
        expect(ctx.unbalanced).toEqual({});
    });

    it('wraps the lone child in the effect scope too', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, effects: Effects.twirl(30), children: [mask()] }));
        const events = recorded(group).events;
        expect(events.indexOf('beginEffects:foreground')).toBeLessThan(events.indexOf('begin:mask'));
        expect(events.indexOf('endEffects')).toBeGreaterThan(events.indexOf('begin:mask'));
    });

    it('does not render the mask child twice', () => {
        const group = laidOut(new MaskGroup({ id: 'm', width: 100, height: 100, children: [mask(), part('c')] }));
        expect(recorded(group).events.filter((e) => e === 'begin:mask')).toHaveLength(1);
    });

    it('draws nothing when it is itself invisible', () => {
        const group = laidOut(new MaskGroup({ id: 'm', opacity: 0, width: 100, height: 100, children: [mask(), part('c')] }));
        expect(recorded(group).events).toEqual([]);
    });
});

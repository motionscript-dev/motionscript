import { describe, it, expect } from 'vitest';
import { PathBuilder } from '@/render/descriptors/path-builder';
import { pathOps } from '@/attributes/shape/path/ops';
import type { PathCommand } from '@/render/descriptors/path';

const arcs = (cmds: PathCommand[]) => cmds.filter(c => c.type === 'A');

describe('PathBuilder arcs', () => {
    it('splits a sweep into quarter turns, since one A command cannot span a full one', () => {
        const cmds = new PathBuilder().arc({ width: 200, sweep: 360 }).toCommands();

        expect(cmds[0]).toEqual({ type: 'M', x: 100, y: 0 });
        expect(arcs(cmds)).toHaveLength(4);
        expect(arcs(cmds).every(c => c.type === 'A' && c.largeArc === 0)).toBe(true);
    });

    it('sweeps counter-clockwise when positive and clockwise when negative', () => {
        const ccw = arcs(new PathBuilder().arc({ width: 200, sweep: 90 }).toCommands())[0];
        const cw = arcs(new PathBuilder().arc({ width: 200, sweep: -90 }).toCommands())[0];

        // y-up authoring: +90° from 3 o'clock lands above the centre.
        expect(ccw).toMatchObject({ type: 'A', sweep: 1 });
        expect(cw).toMatchObject({ type: 'A', sweep: 0 });
        if (ccw.type === 'A') expect(ccw.y).toBeCloseTo(100, 6);
        if (cw.type === 'A') expect(cw.y).toBeCloseTo(-100, 6);
    });

    it('keeps the subpath unbroken: it joins the pen to the arc start with a line', () => {
        const cmds = new PathBuilder()
            .moveTo(-300, 0)
            .arc({ x: 0, y: 0, width: 200, startAngle: 180, sweep: -180 })
            .toCommands();

        expect(cmds.map(c => c.type)).toEqual(['M', 'L', 'A', 'A']);
        const join = cmds[1];
        expect(join.type).toBe('L');
        if (join.type === 'L') {
            expect(join.x).toBeCloseTo(-100, 6);
            expect(join.y).toBeCloseTo(0, 6);
        }
    });

    it('emits no join when the pen is already on the arc start', () => {
        const cmds = new PathBuilder()
            .moveTo(100, 0)
            .arc({ width: 200, sweep: 90 })
            .toCommands();

        expect(cmds.map(c => c.type)).toEqual(['M', 'A']);
    });

    it('takes height from width, so a lone width is a circle', () => {
        const circle = arcs(new PathBuilder().arc({ width: 200, sweep: 90 }).toCommands())[0];
        expect(circle).toMatchObject({ rx: 100, ry: 100 });
    });

    it('ellipse closes its own subpath', () => {
        const cmds = new PathBuilder().ellipse({ x: 50, y: 20, width: 200, height: 100 }).toCommands();

        expect(cmds[0]).toEqual({ type: 'M', x: 150, y: 20 });
        expect(cmds[cmds.length - 1]).toEqual({ type: 'Z' });
        expect(arcs(cmds)[0]).toMatchObject({ rx: 100, ry: 50 });
    });

    it('measures as the real curve — a circle’s perimeter, not its chords', () => {
        const circle = new PathBuilder().ellipse({ width: 200 }).toCommands();
        expect(pathOps.sampler(circle).length).toBeCloseTo(2 * Math.PI * 100, 1);
    });

    it('close() returns the pen to the subpath start', () => {
        const cmds = new PathBuilder()
            .moveTo(10, 10)
            .lineTo(50, 10)
            .close()
            .arc({ x: 10, y: 10, width: 0, sweep: 0 })
            .toCommands();

        // The arc's start is the current point, so no join was needed.
        expect(cmds.map(c => c.type)).toEqual(['M', 'L', 'Z']);
    });
});

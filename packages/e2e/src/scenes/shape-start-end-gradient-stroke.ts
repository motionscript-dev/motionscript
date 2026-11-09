import { Rect, Fills } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A Write On reveals a shape's paint; it does not re-fit that paint to however
 * much is revealed.
 *
 * Each trimmed shape sits beside an untrimmed twin, so the check is direct: the
 * sliver must be the colour its twin's top edge is. The gradients are vertical
 * and radial on purpose — both resolve against an axis the trimmed fragment has
 * no extent in, which is where shading against the fragment's own box stopped
 * being merely wrong and collapsed to a flat colour.
 */
const COLORS = ['#6990dd', '#e8617c'];
const box = (fill: unknown, end: number) => el(Rect, {
    width: 150,
    height: 150,
    cornerRadius: 12,
    fill: 'transparent',
    stroke: { weight: 12, fill: fill as never },
    start: 0,
    end,
});

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'horizontal', gap: 24, children: [
            box(Fills.linearGradient(COLORS, { start: { x: 0, y: 1 }, end: { x: 0, y: -1 } }), 0.2),
            box(Fills.linearGradient(COLORS, { start: { x: 0, y: 1 }, end: { x: 0, y: -1 } }), 1),
            box(Fills.radialGradient(COLORS), 0.2),
            box(Fills.radialGradient(COLORS), 1),
        ] }),
    );
}, [holdTail(1)]);

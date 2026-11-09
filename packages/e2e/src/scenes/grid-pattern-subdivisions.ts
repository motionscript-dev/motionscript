import { Camera, Fills } from '@motionscript/sdk';
import { GridPattern } from '@motionscript/patterns';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Exercises {@link GridPattern.subdivisions}: a world-anchored grid (cellSize
 * 120) viewed through a {@link Camera}, with a distinct lighter `subStroke` for
 * the minor lines. The subdivision count animates 1 → 3, so the mid frame
 * catches the minor lines filling in between every major cell line across the
 * whole visible region.
 */
const grid = createRef<GridPattern>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Camera, {
            width: 720,
            height: 460,
            fill: 'card',
            cornerRadius: 12,
            stroke: { weight: 3, fill: '#2c3344' },
            children: [
                el(GridPattern, {
                    ref: grid,
                    cellSize: 120,
                    subdivisions: 1,
                    fill: Fills.color('card'),
                    stroke: { weight: 3, fill: 'primary' },
                    subStroke: { weight: 1, fill: 'accent' },
                }),
            ],
        }),
    );
}, [
    // Densify the minor lines: each world cell splits into three.
    () => grid().to({ data: { subdivisions: 3 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

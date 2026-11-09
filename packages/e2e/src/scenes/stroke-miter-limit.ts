import { Polygram } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `miterLimit` caps the ratio of miter length to stroke weight before a
 * `'miter'` join is truncated to a bevel. A sharp star's points exceed the
 * ratio quickly, so dropping the limit visibly flattens its tips even though
 * `join` stays `'miter'` throughout.
 */
const star = createRef<Polygram>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygram, {
            ref: star,
            sides: 5,
            ratio: 0.4,
            width: 280,
            height: 280,
            fill: 'card',
            stroke: { weight: 14, fill: 'primary', join: 'miter', miterLimit: 8 },
        }),
    );
}, [
    () => star().strokeTo({ data: { weight: 14, fill: 'primary', join: 'miter', miterLimit: 1 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

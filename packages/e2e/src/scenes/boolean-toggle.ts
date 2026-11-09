import { BooleanGroup, Rect, Ellipse } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link BooleanGroup}'s `op` toggling between `'union'` and `'subtract'` at the midpoint — the combined silhouette of a rect and an overlapping circle switches from a merged blob to a rect with a circular bite taken out. */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    const group = createRef<BooleanGroup>();
    stage.add(
        el(BooleanGroup, { ref: group, op: 'union', fill: 'primary', children: [
            el(Rect, { width: 280, height: 200, cornerRadius: 20, center: { x: -40, y: 0 } }),
            el(Ellipse, { width: 200, height: 200, center: { x: 80, y: 0 } }),
        ] }),
    );
}, [
    0.5,
    0.8,
    holdTail(1.3),
]);

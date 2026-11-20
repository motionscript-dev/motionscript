import { Repeater, Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Repeater} in a row: overlapping circles stacked `below` (top row, the first copy on top) and `above` (bottom row, each copy over the last), each copy smaller and fainter; the top row's offset slides its copies along. */
const top = createRef<Repeater>();
const disc = (fill: string) => el(Ellipse, { x: -240, width: 110, height: 110, fill, stroke: { weight: 4, fill: '#ffffff' } });
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add([
        el(Repeater, {
            ref: top, y: 90, width: 'fill', height: 200, copies: 6, composite: 'below',
            stepPosition: { x: 70, y: 0 }, stepScale: { x: 0.9, y: 0.9 }, endOpacity: 0.5,
            children: [disc('#e83fd6')],
        }),
        el(Repeater, {
            y: -90, width: 'fill', height: 200, copies: 6, composite: 'above',
            stepPosition: { x: 70, y: 0 }, stepScale: { x: 0.9, y: 0.9 }, endOpacity: 0.5,
            children: [disc('#28d6c8')],
        }),
    ]);
}, [
    () => top().to({ data: { offset: 1 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

import { Rect, Effects, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.oilPaint}: Kuwahara brushwork — flat strokes, edges intact. */
const photo = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 480, height: 320, cornerRadius: 20, clip: true, flow: 'freeform', children: [
                el(Rect, {
                    ref: photo,
                    fill: Fills.image('./cat.jpg', { fit: 'fill' }),
                    width: 'fill',
                    height: 'fill',
                    effects: Effects.oilPaint(0),
                }),
            ] }),
        ] }),
    );
}, [
    () => photo().to({ data: { effects: Effects.oilPaint(4) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);

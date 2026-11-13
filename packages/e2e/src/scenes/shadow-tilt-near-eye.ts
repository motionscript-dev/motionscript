import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A card larger than the stage, with a drop shadow, tipping in perspective
 * until an edge nears the eye. The magnification there once grew the shadow's
 * blur layer past any texture, and the frame failed to draw.
 */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: '#e8ecf4' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 1800,
            height: 1000,
            cornerRadius: 24,
            fill: '#3d6fe0',
            shadow: { blur: 8, offset: { x: 0, y: 12 }, fill: 'black/40' },
            rotationX: 20,
            rotationY: -55,
            rotationZ: 117.8,
            perspective: 800,
        }),
    );
}, [
    () => card().to({ data: { rotationX: 80 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

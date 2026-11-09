import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * An SVG scaled far past its intrinsic size. A vector has no resolution to cap
 * at, so it is re-rasterized for the draw: the last frame's edges must be as
 * hard as the first's.
 */
const logo = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: logo, width: 96, height: 96, scale: 0.5, fill: Fills.image('logo.svg', { fit: 'fit' }) }),
        ] }),
    );
}, [
    () => logo().to({ data: { scale: 5 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

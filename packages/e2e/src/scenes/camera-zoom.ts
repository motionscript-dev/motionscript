import { Camera, Rect, Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A camera zooming in on a small scene of shapes. */
const camera = createRef<Camera>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Camera, { ref: camera, width: 'fill', height: 'fill', zoom: 1, children: [
            el(Rect, { width: 160, height: 160, cornerRadius: 16, fill: 'primary', x: -120 }),
            el(Ellipse, { width: 140, height: 140, fill: 'accent', x: 120 }),
        ] }),
    );
}, [
    () => camera().to({ data: { zoom: 2.4, lookAt: { x: 120, y: 0 } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

import { Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Path.data} morphing: animating `to({ data })` smoothly reconciles a
 * 4-point square outline into an 8-point star, despite the differing point
 * counts.
 */
const shape = createRef<Path>();
const star =
        'M 0 -150 L 35 -50 L 140 -50 L 55 15 L 85 120 L 0 55 L -85 120 L -55 15 L -140 -50 L -35 -50 Z';
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    const square = 'M -120 -120 L 120 -120 L 120 120 L -120 120 Z';
    stage.add(
        el(Path, { ref: shape, data: square, fill: 'primary' }),
    );
}, [
    () => shape().to({ data: { data: star }, duration: 1.5, easing: easeInOut('quad') }),
    holdTail(1.5),
]);

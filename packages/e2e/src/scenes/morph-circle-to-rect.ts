import { Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

const CIRCLE = 'M 90 0 A 90 90 0 1 1 -90 0 A 90 90 0 1 1 90 0 Z';
const ROUNDED_RECT = 'M -120 -70 L 120 -70 Q 140 -70 140 -50 L 140 50 Q 140 70 120 70 L -120 70 Q -140 70 -140 50 L -140 -50 Q -140 -70 -120 -70 Z';

/** {@link Path}'s `data` prop morphing smoothly from a circle into a rounded rectangle, reconciled into a common cubic correspondence under the hood. */
const shape = createRef<Path>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, { ref: shape, data: CIRCLE, fill: 'primary' }),
    );
}, [
    () => shape().to({ data: { data: ROUNDED_RECT }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

import { Text, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Text} `fill` as a linear gradient, sweeping its angle across the glyphs. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Gradient Text',
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 72,
            fill: Fills.linearGradient(['#6990dd', '#e8617c']),
            rotation: 0,
        }),
    );
}, [
    () => label().to({ data: { rotation: 360 }, duration: 1.6, easing: easeInOut('quad') }),
    holdTail(1.6),
]);

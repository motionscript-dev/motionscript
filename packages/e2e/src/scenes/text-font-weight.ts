import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Text.fontWeight}: the same word thickening from a thin 200 weight to a heavy 900. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Weight',
            fontFamily: 'Inter',
            fontWeight: 200,
            fontSize: 84,
            fill: '#f4f6ff',
        }),
    );
}, [
    () => label().to({ data: { fontWeight: 900 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

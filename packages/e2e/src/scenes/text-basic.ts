import { Text } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Single-line text in the default style, fading + rising into place. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Motion Script',
            fontFamily: 'Inter',
            fontSize: 84,
            fill: '#f4f6ff',
            opacity: 0,
            y: 30,
        }),
    );
}, [
    () => label().to({ data: { opacity: 1, y: 0 }, duration: 0.8, easing: easeOut('cubic') }),
    holdTail(0.8),
]);

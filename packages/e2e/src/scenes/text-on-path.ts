import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Text.path}: a single line of text follows an arcing path instead of a straight baseline. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Curving Along the Arc',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 40,
            fill: 'primary',
            path: 'M -320 80 Q 0 -260 320 80',
            scale: 0,
        }),
    );
}, [
    () => label().to({ data: { scale: 1 }, duration: 1.2, easing: easeInOut('back') }),
    holdTail(1.2),
]);

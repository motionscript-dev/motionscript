import { Text } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** Write On: the text types itself on, character by character; nothing shows at the start, all of it at the end. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Write On',
            fontFamily: 'Inter',
            fontSize: 96,
            fill: '#f4f6ff',
            stroke: { weight: 3, fill: '#ff5a5f', align: 'outside' },
            end: 0,
        }),
    );
}, [
    () => label().progressTo({ data: { end: 1 }, duration: 1.2, easing: linear() }),
    holdTail(1.2),
]);

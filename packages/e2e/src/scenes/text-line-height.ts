import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Text.lineHeight}: a wrapped paragraph's row spacing loosens from tight (0.9) to airy (2). */
const para = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: para,
            text: 'Line height controls the vertical rhythm between wrapped rows of text.',
            fontFamily: 'Inter',
            fontSize: 32,
            lineHeight: 0.9,
            wrap: true,
            width: 520,
            fill: '#f4f6ff',
        }),
    );
}, [
    () => para().to({ data: { lineHeight: 2 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

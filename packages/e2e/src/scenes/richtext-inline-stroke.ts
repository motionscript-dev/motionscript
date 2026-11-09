import { RichText } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link RichText} per-span `stroke`: one word in a sentence gets its own outline, distinct from its plain-fill neighbors. */
const para = createRef<RichText>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(RichText, {
            ref: para,
            fontFamily: 'Inter',
            fontSize: 48,
            fontWeight: 700,
            fill: '#f4f6ff',
            opacity: 0,
            spans: [
                { text: 'Stay ' },
                { text: 'OUTLINED', fill: 'transparent', stroke: { weight: 3, fill: 'accent' } },
                { text: ' today' },
            ],
        }),
    );
}, [
    () => para().to({ data: { opacity: 1 }, duration: 0.8, easing: easeOut('quad') }),
    holdTail(0.8),
]);

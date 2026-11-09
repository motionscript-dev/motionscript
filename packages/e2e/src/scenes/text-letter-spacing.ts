import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Text.letterSpacing}: glyphs spread apart from tight (0) to loose (16). */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'SPACING',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 64,
            letterSpacing: 0,
            fill: '#f4f6ff',
        }),
    );
}, [
    () => label().to({ data: { letterSpacing: 16 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

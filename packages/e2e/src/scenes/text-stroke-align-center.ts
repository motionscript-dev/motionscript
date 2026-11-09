import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `align: 'center'` on {@link Text}: the band straddles each glyph's edge, so the word grows by half the weight and thins by the other half. The one alignment drawn as a plain stroke rather than through a mask â a centered band's inner half *is* the interior a union would erase, so it is not unioned and overlapping glyphs show their crossing, which is the honest reading of "centered" rather than a silent third alignment. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Center',
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 140,
            fill: '#f4f6ff',
            stroke: { weight: 10, fill: 'accent', align: 'center' },
        }),
    );
}, [
    () => label().to({ data: { x: 6.5 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);

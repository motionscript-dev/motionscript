import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `align: 'inside'` on {@link Text}: the band eats **inward** from each glyph's edge, so the word's footprint stays the size the type set it and the counters close up instead. Glyph paths aren't reachable here, so the half to keep is chosen by compositing a silhouette mask over a double-width band rather than by clipping a path â see `drawTextUnionStroke`. The word drifts a non-integer distance because the mask meets the fill at a sub-pixel boundary: a single static position could sit on the one phase that hides a mismatch. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Inside',
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 140,
            fill: '#f4f6ff',
            stroke: { weight: 10, fill: 'accent', align: 'inside' },
        }),
    );
}, [
    () => label().to({ data: { x: 6.5 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);

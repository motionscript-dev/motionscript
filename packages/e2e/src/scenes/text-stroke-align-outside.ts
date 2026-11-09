import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `align: 'outside'` on {@link Text} â what a stroked heading almost always wants, and what an editor would seed a text stroke with: the band grows away from the glyphs, so the counters stay open and the letterforms keep the weight the type designer set. Unioned, so the outline follows the outer boundary of the whole word rather than tracing every glyph's own edge through the overlaps. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Outside',
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 140,
            fill: '#f4f6ff',
            stroke: { weight: 10, fill: 'accent', align: 'outside' },
        }),
    );
}, [
    () => label().to({ data: { x: 6.5 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);

import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A text stroke in the **same colour as its fill**, which is the only way to see
 * the join between them: with one colour the two draws must read as a single
 * solid letterform, and any hairline down a stem is the fill and the band failing
 * to meet.
 *
 * Two things used to put one there. The band and the fill are separate passes, and
 * antialiased edges that *abut* never sum to full coverage — complementary
 * coverages composite to `f + (1−f)²`, leaving up to a quarter of the background.
 * Worse, the silhouette mask is a second rasterization of the same glyphs, and
 * the rasterizer sized a glyph mask by the paint colour's luminance, so a white mask cut a
 * silhouette up to ~0.75 device px fatter than a dark fill had painted. The band
 * is bridged past the boundary now rather than butted against it; see
 * `drawTextUnionStroke`.
 *
 * Light ground and dark ink so a leak is bright, and the word drifts a
 * non-integer distance so the frames land on different sub-pixel phases — the
 * artefact is sub-pixel, so a single static position could sit on the one phase
 * that hides it.
 */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: '#f4f6ff' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'Seam',
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 200,
            fill: '#101317',
            stroke: { weight: 14, fill: '#101317', align: 'outside' },
        }),
    );
}, [
    () => label().to({ data: { x: 7.5 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);

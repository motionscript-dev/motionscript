import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * An **outside** text stroke with no fill and negative tracking, which is the
 * shape of the artefact this guards: the letters overlap, so every glyph's own
 * outline runs through its neighbour's body, and with nothing painted inside
 * there is nowhere for a stray line to hide.
 *
 * What must be true is that the band traces the **union** of the letterforms and
 * nothing else — no contour crossing another letter, no ghost of the miter
 * spikes a double-width stroke throws inward at every sharp corner. Both used to
 * appear the moment the seam bridge shrank the mask with a stroked ring, because
 * a glyph run's outline is not the silhouette's boundary; a morphological erode
 * has no such notion and only moves the outer edge. See `applyTextAlignMask`.
 *
 * Centered and inside are *not* unioned and are not expected to be: a centered
 * band's inner half is the interior a union would erase. Figma draws those
 * crossings too — outside is the alignment that has to come out clean.
 *
 * The tracking eases so the overlap sweeps through every depth rather than
 * testing one arrangement of the glyphs.
 */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Text, {
            ref: label,
            text: 'efwa',
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 190,
            letterSpacing: 0,
            stroke: { weight: 10, fill: 'accent', align: 'outside' },
        }),
    );
}, [
    () => label().to({ data: { letterSpacing: -46 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);

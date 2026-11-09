import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * An image fill's `crop` — a window onto the source, in fractions of its own
 * size, applied *before* `fit`. The box never changes; only the slice of the
 * bird being shown does, opening from a tight centre crop out to the whole
 * frame. Because the cover scale is recomputed against the cropped window, the
 * picture stays edge-to-edge throughout — a crop composes with `fit` rather than
 * fighting it.
 */
const SRC = 'kingfisher.jpg';

const photo = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Rect, {
            ref: photo,
            fill: Fills.image(SRC, { crop: { horizontal: 0.3, vertical: 0.2 } }),
            width: 520,
            height: 380,
            cornerRadius: 20,
            stroke: { weight: 3, fill: 'primary' },
        }),
    );
}, [
    () => photo().to({ data: { fill: Fills.image(SRC, { crop: 0 }) }, duration: 1.4, easing: easeInOut('cubic') }),
    holdTail(1.4),
]);

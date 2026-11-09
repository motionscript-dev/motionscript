import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * An image fill's `zoom` + `anchor` — a Ken Burns push. `zoom` multiplies
 * whatever scale `fit` resolved, and `anchor` names the point of the source that
 * stays pinned to the same point of the box, so the magnification grows away
 * from *it* rather than from the centre. The anchor here sits on the bird's head
 * (left of centre, above the middle), so the head holds its place in frame while
 * everything around it expands past the edges.
 */
const SRC = 'kingfisher.jpg';
const ANCHOR = { x: -0.16, y: 0.24 };

const photo = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Rect, {
            ref: photo,
            fill: Fills.image(SRC, { anchor: ANCHOR }),
            width: 520,
            height: 380,
            cornerRadius: 20,
            stroke: { weight: 3, fill: 'primary' },
        }),
    );
}, [
    () => photo().to({ data: { fill: Fills.image(SRC, { anchor: ANCHOR, zoom: 2.4 }) }, duration: 1.4, easing: easeInOut('cubic') }),
    holdTail(1.4),
]);

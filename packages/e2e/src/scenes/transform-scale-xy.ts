import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Independent horizontal/vertical scale (as opposed to uniform `scale`): a card stretches wide and flattens by tweening `width`/`height` independently, then squeezes narrow and tall. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: card, width: 160, height: 160, cornerRadius: 20, fill: 'primary' }),
    );
}, [
    () => card().to({ data: { width: 288, height: 80 }, duration: 0.8, easing: easeInOut('quad') }),
    () => card().to({ data: { width: 80, height: 288 }, duration: 0.8, easing: easeInOut('quad') }),
    holdTail(1.6),
]);

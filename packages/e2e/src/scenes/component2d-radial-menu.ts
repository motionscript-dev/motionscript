import { Rect, type Node2D } from '@motionscript/sdk';
import { RadialMenuV2, RectV2 } from '@/components/component-syntax';
import { cmd, createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A custom `layout`: six items fanned out on a circle, turned to face out and faded by the slot. `open` spreads them. */
const menu = createRef<Node2D>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(RectV2, { width: 'fill', height: 'fill', flow: 'freeform', children: [
            el(RadialMenuV2, { ref: menu, radius: 180, spread: 0.15, children: [
                [0, 1, 2, 3, 4, 5].map((i) => el(Rect, { width: 64, height: 40, cornerRadius: 12, fill: i % 2 === 0 ? 'primary' : 'accent' })),
            ] }),
        ] }),
    );
}, [
    () => cmd(menu, 'open', { spread: 1 }, 1.2, easeInOut('quad')),
    holdTail(1.2),
]);

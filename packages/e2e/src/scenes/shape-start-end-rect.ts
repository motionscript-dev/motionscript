import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Rect drawing its outline in: `end` animates 0 → 1 to reveal the path. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 320,
                height: 220,
                cornerRadius: 12,
                fill: 'transparent',
                stroke: { weight: 8, fill: 'primary', cap: 'round' },
                start: 0,
                end: 0,
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { end: 1 }, duration: 1.5, easing: easeInOut('quad') }),
    holdTail(1.5),
]);

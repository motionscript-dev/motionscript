import type { Node2D } from '@motionscript/sdk';
import { GaugeV2, RectV2 } from '@/components/component-syntax';
import { cmd, createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A `component2d` with one entry and one command of its own, run from the document: `fillUp`. */
const gauge = createRef<Node2D>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(RectV2, { width: 'fill', height: 'fill', flow: 'freeform', children: [
            el(GaugeV2, {
                ref: gauge,
                width: 300,
                height: 300,
                value: 0.05,
                fill: 'primary',
                stroke: { weight: 4, fill: 'white/40' },
            }),
        ] }),
    );
}, [
    () => cmd(gauge, 'fillUp', { value: 0.85 }, 1.2, easeInOut('quad')),
    holdTail(1.2),
]);

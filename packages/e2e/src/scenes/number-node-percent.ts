import { NumberNode } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link NumberNode} `format: 'percent'`: a completion percentage counting up to 87%. */
const percent = createRef<NumberNode>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(NumberNode, {
            ref: percent,
            value: 0,
            format: 'percent',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 72,
            fill: 'primary',
        }),
    );
}, [
    () => percent().countTo({ data: { value: 0.87 }, duration: 1.5, easing: easeOut('cubic') }),
    holdTail(1.5),
]);

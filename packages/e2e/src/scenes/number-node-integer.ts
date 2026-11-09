import { NumberNode } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link NumberNode} `format: 'number'` with grouping: a counter ticking up to a large integer. */
const counter = createRef<NumberNode>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(NumberNode, {
            ref: counter,
            value: 0,
            format: 'number',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 72,
            fill: 'accent',
        }),
    );
}, [
    () => counter().countTo({ data: { value: 48291 }, duration: 1.5, easing: easeOut('cubic') }),
    holdTail(1.5),
]);

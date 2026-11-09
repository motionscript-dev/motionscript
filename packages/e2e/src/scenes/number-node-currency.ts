import { NumberNode } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link NumberNode} `format: 'currency'`: a dollar amount counting up from 0. */
const amount = createRef<NumberNode>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(NumberNode, {
            ref: amount,
            value: 0,
            format: 'currency',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 72,
            fill: 'primary',
        }),
    );
}, [
    () => amount().countTo({ data: { value: 1234.5 }, duration: 1.5, easing: easeOut('cubic') }),
    holdTail(1.5),
]);

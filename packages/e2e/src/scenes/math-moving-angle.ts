import { Rect } from '@motionscript/sdk';
import { AngleMark } from '@motionscript/math';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's MovingAngle: a fixed line, a second one turning about their shared
 * end, and the angle between them marked and measured from one variable.
 */
export default scene((stage) => {
    stage.variable('theta', 110);
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { x: 150, y: -60, width: 300, height: 4, fill: '#9ca3af' }),
            el(Rect, { x: 0, y: -60, width: 0, height: 0, rotation: '=-[theta]', children: [
                el(Rect, { x: 150, y: 0, width: 300, height: 4, fill: '#58a6ff' }),
            ] }),
            el(AngleMark, {
                x: 0,
                y: -60,
                fromAngle: 0,
                toAngle: '=[theta]',
                radius: 70,
                label: '°',
                labelSize: 30,
                fontFamily: 'Inter',
                stroke: { weight: 4, fill: '#facc15', align: 'center', cap: 'round' },
            }),
            el(AngleMark, { x: 300, y: -60, fromAngle: 90, toAngle: 180, radius: 36 }),
        ] }),
    );
}, [
    () => variableTo('theta', 40, 1, easeInOut('quad')),
    () => variableTo('theta', 140, 1.2, easeInOut('quad')),
    holdTail(0.5),
]);

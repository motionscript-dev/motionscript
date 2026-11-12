import { RadialChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

const DATA = [
    { browser: 'Chrome', visitors: 275 },
    { browser: 'Safari', visitors: 200 },
    { browser: 'Firefox', visitors: 187 },
    { browser: 'Edge', visitors: 173 },
    { browser: 'Other', visitors: 90 },
];

/** Five rings with tracks and a centre total, sweeping in. */
const chart = createRef<RadialChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', padding: 40, children: [
            el(RadialChart, {
                ref: chart,
                data: DATA,
                categoryField: 'browser',
                valueField: 'visitors',
                centerLabel: '925',
                centerCaption: 'Visitors',
                style: { fontFamily: 'Inter', sweep: 270, ringLabels: true, track: true },
            }),
        ] }),
    );
}, [
    () => chart().enter({ data: {}, duration: 1.2 }),
    holdTail(1.2),
]);

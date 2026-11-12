import { PieChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail, inter } from './_lib';

const DATA = [
    { browser: 'Chrome', visitors: 275 },
    { browser: 'Safari', visitors: 200 },
    { browser: 'Firefox', visitors: 187 },
    { browser: 'Edge', visitors: 173 },
    { browser: 'Other', visitors: 90 },
];

/** A donut with outside labels and a centre summary, sweeping in. */
const chart = createRef<PieChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', padding: 40, children: [
            el(PieChart, {
                ref: chart,
                data: DATA,
                categoryField: 'browser',
                valueField: 'visitors',
                centerLabel: '925',
                centerCaption: 'Visitors',
                style: { ...inter('labelText', 'valueText', 'centerText', 'legendText'), innerRadius: 0.6, labelPlacement: 'outside', legend: 'right' },
            }),
        ] }),
    );
}, [
    () => chart().enter({ data: {}, duration: 1.2 }),
    holdTail(1.2),
]);

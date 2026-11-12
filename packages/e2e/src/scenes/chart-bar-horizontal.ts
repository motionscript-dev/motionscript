import { BarChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

const DATA = [
    { browser: 'Chrome', organic: 275, paid: 120 },
    { browser: 'Safari', organic: 200, paid: 96 },
    { browser: 'Firefox', organic: 187, paid: 54 },
    { browser: 'Edge', organic: 173, paid: 70 },
    { browser: 'Other', organic: 90, paid: 32 },
];

/** A stacked horizontal bar chart with value labels inside the bars, on a 1080p frame shown at half size. */
const chart = createRef<BarChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 1920, height: 1080, scale: 0.5, padding: 96, children: [
            el(BarChart, {
                ref: chart,
                data: DATA,
                categoryField: 'browser',
                orientation: 'horizontal',
                stack: 'stacked',
                series: [{ field: 'organic', label: 'Organic' }, { field: 'paid', label: 'Paid' }],
                style: { fontFamily: 'Inter', grid: 'vertical', values: 'inside' },
            }),
        ] }),
    );
}, [
    () => chart().enter({ data: {}, duration: 1.4 }),
    holdTail(1.4),
]);

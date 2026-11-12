import { LineChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

const DATA = [
    { month: 'Jan', desktop: 186, mobile: 80, tablet: 45 },
    { month: 'Feb', desktop: 305, mobile: 200, tablet: 70 },
    { month: 'Mar', desktop: 237, mobile: 120, tablet: 62 },
    { month: 'Apr', desktop: 173, mobile: 190, tablet: 88 },
    { month: 'May', desktop: 209, mobile: 130, tablet: 74 },
    { month: 'Jun', desktop: 264, mobile: 140, tablet: 96 },
];

/** A stacked area chart with gradient fills, tracing in on a 1080p frame shown at half size. */
const chart = createRef<LineChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 1920, height: 1080, scale: 0.5, padding: 96, children: [
            el(LineChart, {
                ref: chart,
                data: DATA,
                xField: 'month',
                stack: 'stacked',
                series: [
                    { field: 'desktop', label: 'Desktop' },
                    { field: 'mobile', label: 'Mobile' },
                    { field: 'tablet', label: 'Tablet' },
                ],
                style: { fontFamily: 'Inter', area: 'gradient', strokeWidth: 3 },
            }),
        ] }),
    );
}, [
    () => chart().enter({ data: {}, duration: 1.4 }),
    holdTail(1.4),
]);

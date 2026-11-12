import { LineChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

const DATA = [
    { month: 'Jan', desktop: 186, mobile: 80 },
    { month: 'Feb', desktop: 305, mobile: 200 },
    { month: 'Mar', desktop: 237, mobile: 120 },
    { month: 'Apr', desktop: 73, mobile: 190 },
    { month: 'May', desktop: 209, mobile: 130 },
    { month: 'Jun', desktop: 214, mobile: 140 },
];

/** A two-series line chart, smooth with dots, tracing in on a 1080p frame shown at half size. */
const chart = createRef<LineChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 1920, height: 1080, scale: 0.5, padding: 96, children: [
            el(LineChart, {
                ref: chart,
                data: DATA,
                xField: 'month',
                series: [{ field: 'desktop', label: 'Desktop' }, { field: 'mobile', label: 'Mobile' }],
                style: { fontFamily: 'Inter', dots: true, horizontalGrid: { weight: 2, fill: 'white/25', dash: [10, 10], cap: 'round' } },
            }),
        ] }),
    );
}, [
    () => chart().enter({ data: {}, duration: 1.4 }),
    holdTail(1.4),
]);

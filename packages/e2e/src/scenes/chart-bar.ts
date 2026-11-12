import { BarChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail, inter } from './_lib';

const DATA = [
    { month: 'Jan', desktop: 186, mobile: 80 },
    { month: 'Feb', desktop: 305, mobile: 200 },
    { month: 'Mar', desktop: 237, mobile: 120 },
    { month: 'Apr', desktop: 73, mobile: 190 },
    { month: 'May', desktop: 209, mobile: 130 },
    { month: 'Jun', desktop: 214, mobile: 140 },
];

/** A grouped vertical bar chart with rounded bars rising in, on a 1080p frame shown at half size. */
const chart = createRef<BarChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 1920, height: 1080, scale: 0.5, padding: 96, children: [
            el(BarChart, {
                ref: chart,
                data: DATA,
                categoryField: 'month',
                series: [{ field: 'desktop', label: 'Desktop' }, { field: 'mobile', label: 'Mobile' }],
                style: { ...inter('xLabelText', 'xTitleText', 'yLabelText', 'yTitleText', 'valueText', 'legendText'), barCornerRadius: { topLeft: 14, topRight: 14, bottomRight: 4, bottomLeft: 4 }, gridBackground: 'white/4' },
            }),
        ] }),
    );
}, [
    () => chart().enter({ data: {}, duration: 1.4 }),
    holdTail(1.4),
]);

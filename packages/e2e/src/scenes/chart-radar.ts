import { RadarChart } from '@motionscript/charts';
import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

const DATA = [
    { skill: 'Design', ana: 86, ben: 62 },
    { skill: 'Motion', ana: 74, ben: 90 },
    { skill: 'Code', ana: 58, ben: 80 },
    { skill: 'Audio', ana: 66, ben: 44 },
    { skill: 'Story', ana: 92, ben: 70 },
    { skill: 'Colour', ana: 70, ben: 55 },
];

/** A radar chart comparing two people over six skills, growing in. */
const chart = createRef<RadarChart>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', padding: 40, children: [
            el(RadarChart, {
                ref: chart,
                data: DATA,
                categoryField: 'skill',
                series: [
                    { field: 'ana', label: 'Ana' },
                    { field: 'ben', label: 'Ben' },
                ],
                style: { fontFamily: 'Inter' },
            }),
        ] }),
    );
}, [
    () => chart().enter({ duration: 1.4 }),
    holdTail(1.2),
]);

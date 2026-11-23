// Scratch: the Fibonacci charts in the Swiss Grid look. `node zz-globe/swiss-fib.mjs`
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
// DARK=1 inverts it: black ground, paper ink.
const DARK = process.env.DARK === '1';
const PAPER = DARK ? '#111111' : '#EEECE5';
const INK = DARK ? '#EEECE5' : '#111111';
const SUFFIX = DARK ? '-dark' : '';
const RED = '#FF3B1F';
const solid = (c) => ({ type: 'solid', color: c });
const text = (family, size, weight, fill) => ({ fontFamily: family, fontSize: size, fontWeight: weight, fill });
const scene = (w, h, node) => ({
    kind: 'composition', duration: 1, fps: 30, viewport: { width: w, height: h },
    nodes: [{ id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: [solid(PAPER)] } }, { id: 'c', parentId: '', layerOrder: 0, ...node }],
    commands: [],
});

const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
fs.writeFileSync(path.join(here, `swiss-fib-bars${SUFFIX}.json`), JSON.stringify(scene(740, 800, {
    type: 'barChart',
    props: {
        x: 0, y: 0, width: 740, height: 800, categoryField: 'n',
        data: fib.map((value, i) => ({ n: String(i + 1), value })),
        series: [{ field: 'value', label: 'F(n)' }],
        valueAxis: { range: [0, 60], ticks: [], format: '0' },
        style: {
            seriesFills: [[solid(RED)]], legend: 'none', values: 'end',
            valueText: text('Oswald', 34, 700, INK),
            xLabelText: text('Inter', 14, 500, INK), yLabelText: text('Inter', 14, 500, INK),
            axisStroke: [], horizontalGrid: [], verticalGrid: [], showXAxis: false, showYAxis: false,
            barCornerRadius: 0, barStroke: { weight: 0, fill: '#00000000' }, barWidth: 0.8,
        },
    },
})));

const ratio = fib.map((f, i) => (i + 1 < fib.length ? fib[i + 1] / f : 89 / 55));
fs.writeFileSync(path.join(here, `swiss-fib-line${SUFFIX}.json`), JSON.stringify(scene(320, 200, {
    type: 'lineChart',
    props: {
        x: 0, y: 0, width: 312, height: 192, xField: 'n',
        data: ratio.map((r, i) => ({ n: String(i + 1), ratio: Math.round(r * 1000) / 1000, phi: 1.618 })),
        series: [{ field: 'phi', label: '1.618' }, { field: 'ratio', label: 'F(n+1) / F(n)' }],
        yAxis: { range: [0.8, 2.2], ticks: [1, 1.5, 2] },
        style: {
            seriesFills: [RED, INK], legend: 'none',
            xLabelText: text('Inter', 11, 500, INK), yLabelText: text('Inter', 11, 500, INK),
            axisStroke: { weight: 1.5, fill: INK },
            horizontalGrid: { weight: 1, fill: DARK ? '#EEECE52E' : '#11111833', dash: [3, 4] },
            strokeWidth: 2.5, curve: 'linear', dots: true, dotSize: 7, area: 'none',
        },
    },
})));

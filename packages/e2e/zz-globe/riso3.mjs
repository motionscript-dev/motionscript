// Scratch: riso charts for a non-geography poster (Fibonacci). `node zz-globe/riso3.mjs`
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const PAPER = '#F3ECDD';
const BLUE = '#1F5FD0';
const PINK = '#FF3D9A';
const solid = (c) => ({ type: 'solid', color: c });
const text = (size, weight, fill) => ({ fontFamily: 'Space Mono', fontSize: size, fontWeight: weight, fill });
const scene = (w, h, node) => ({
    kind: 'composition', duration: 1, fps: 30, viewport: { width: w, height: h },
    nodes: [{ id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: [solid(PAPER)] } }, { id: 'c', parentId: '', layerOrder: 0, ...node }],
    commands: [],
});

const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
const bars = scene(1000, 440, {
    type: 'barChart',
    props: {
        x: 0, y: 0, width: 950, height: 400, categoryField: 'n',
        data: fib.map((value, i) => ({ n: String(i + 1), value })),
        series: [{ field: 'value', label: 'F(n)' }],
        valueAxis: { range: [0, 60], ticks: [0, 20, 40, 60], format: '0' },
        style: {
            seriesFills: [[solid(PINK), { type: 'dotGrid', radius: 1.6, spacing: 6, color: PAPER, opacity: 0.55 }]],
            legend: 'none', values: 'end',
            valueText: text(22, 700, PINK),
            xLabelText: text(16, 700, BLUE),
            yLabelText: text(15, 400, BLUE),
            axisStroke: { weight: 2.5, fill: BLUE },
            horizontalGrid: { weight: 1.2, fill: `${BLUE}55`, dash: [4, 6] },
            verticalGrid: [],
            barCornerRadius: 0, barStroke: { weight: 0, fill: '#00000000' }, barWidth: 0.72,
        },
    },
});
fs.writeFileSync(path.join(here, 'riso-fib-bars.json'), JSON.stringify(bars));

const ratio = fib.map((f, i) => (i + 1 < fib.length ? fib[i + 1] / f : 89 / 55));
const line = scene(640, 330, {
    type: 'lineChart',
    props: {
        x: 0, y: 0, width: 600, height: 300, xField: 'n',
        data: ratio.map((r, i) => ({ n: String(i + 1), ratio: Math.round(r * 1000) / 1000, phi: 1.618 })),
        series: [{ field: 'phi', label: 'phi' }, { field: 'ratio', label: 'F(n+1) / F(n)' }],
        yAxis: { range: [0.8, 2.2], ticks: [1, 1.5, 2] },
        style: {
            seriesFills: [PINK, BLUE],
            legend: 'none',
            xLabelText: text(14, 700, BLUE),
            yLabelText: text(14, 400, BLUE),
            axisStroke: { weight: 2.5, fill: BLUE },
            horizontalGrid: { weight: 1.2, fill: `${BLUE}40`, dash: [4, 6] },
            strokeWidth: 4, curve: 'linear', dots: true, dotSize: 14, area: 'none',
        },
    },
});
fs.writeFileSync(path.join(here, 'riso-fib-line.json'), JSON.stringify(line));
console.log(ratio.map((r) => r.toFixed(3)).join(' '));

// Scratch: deep-space math pieces for a style frame, built from the math kit's own nodes.
// Full prop sets are copied from the Math Video dumps in ../zz-math, then overridden. `node zz-space/gen.mjs`
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const read = (name) => JSON.parse(fs.readFileSync(path.join(here, '../zz-math', `tmpl-${name}.json`), 'utf8'));
const pick = (doc, type) => structuredClone(doc.nodes.find((n) => n.type === type).props);
const gd = read('gradient-descent');
const der = read('derivative');

const BG = '#050506';
const solid = (c) => ({ type: 'solid', color: c });
const bloom = (threshold, radius, intensity) => ({ type: 'bloom', threshold, radius, intensity });
const scene = (w, h, nodes) => ({
    kind: 'composition', duration: 1, fps: 30, viewport: { width: w, height: h }, theme: gd.theme,
    nodes: [{ id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { ...gd.nodes[0].props, fill: [solid(BG)] } }, ...nodes],
    commands: [],
});

// --- A wormhole: the catenoid r = b cosh(z / b), two sheets joined at a throat of radius b.
const B = 0.62;
const S = 2.6;
const sOf = (u) => `(-${S} + ${2 * S} * ${u})`;
const axes = {
    ...pick(gd, 'axes3d'),
    x: 0, y: 0, width: 1400, height: 1100,
    orbit: -30, elevation: 13, zoom: 15, fov: 32,
    ambientIntensity: 0.35, keyIntensity: 1.4,
    xRange: [-4.1, 4.1], yRange: [-4.1, 4.1], zRange: [-1.62, 1.62],
    xLength: 8.2, yLength: 8.2, zLength: 3.24,
    showGrid: false, showAxes: false, grid: false, tips: false, thickness: 0, color: 'rgba(0, 0, 0, 0)',
    effects: [bloom(0.5, 30, 1)],
};
const surface = {
    ...pick(gd, 'surfacePlot3d'),
    expression: `(${B} * cosh(${sOf('u')}) * cos(2 * pi * v), ${B} * cosh(${sOf('u')}) * sin(2 * pi * v), ${B} * ${sOf('u')})`,
    uDomain: null, vDomain: null, segments: 128,
    fill: '#0B0806',
    colorScale: ['#1A0A04', '#7A2E0E', '#FF9A3C', '#FFF1D6', '#FF9A3C', '#7A2E0E', '#1A0A04'],
    meshLines: 30, meshColor: 'rgba(255, 176, 96, 0.6)', floorShadow: 0,
};
const curve = { ...pick(gd, 'curvePlot3d'), start: 0, end: 1 };
// A path that winds down one sheet, through the throat and out along the other.
const path3 = {
    ...curve,
    expression: `(1.03 * ${B} * cosh(t) * cos(2.4 * t), 1.03 * ${B} * cosh(t) * sin(2.4 * t), ${B} * t)`,
    domain: [-2.45, 2.45], samples: 900, thickness: 0.03, fill: '#FFF6E6', unlit: true,
};
const ring = (sAt, thickness, fill) => ({
    ...curve,
    expression: `(1.02 * ${B} * cosh(${sAt}) * cos(t), 1.02 * ${B} * cosh(${sAt}) * sin(t), ${B} * ${sAt})`,
    domain: [0, 6.28319], samples: 360, thickness, fill, unlit: true,
});
const wellNodes = [
    { id: 'ax', type: 'axes3d', parentId: '', layerOrder: 0, props: axes },
    { id: 'sf', type: 'surfacePlot3d', parentId: 'ax', layerOrder: 0, props: surface },
    { id: 'sp', type: 'curvePlot3d', parentId: 'ax', layerOrder: 1, props: path3 },
    { id: 'r1', type: 'curvePlot3d', parentId: 'ax', layerOrder: 2, props: ring(0, 0.05, '#FFFFFF') },
    { id: 'r2', type: 'curvePlot3d', parentId: 'ax', layerOrder: 3, props: ring(1.1, 0.02, '#FFC27A') },
    { id: 'r3', type: 'curvePlot3d', parentId: 'ax', layerOrder: 4, props: ring(-1.1, 0.02, '#FFC27A') },
];
fs.writeFileSync(path.join(here, 'well.json'), JSON.stringify(scene(1400, 1100, wellNodes)));

// --- Clock rate against distance, in Schwarzschild radii: sqrt(1 - 1/r).
const axes2 = {
    ...pick(der, 'axes2d'),
    x: 0, y: 0, width: 760, height: 380,
    xRange: [0, 10.5], yRange: [0, 1.15], xStep: 1, yStep: 0.5,
    stroke: [{ weight: 2, fill: '#C9B79C', align: 'center', endCap: 'triangle', capScale: 4 }],
    labelSize: 22, labelColor: '#C9B79C', fontFamily: 'JetBrains Mono',
    start: 0, end: 1,
};
const plot = {
    ...pick(der, 'functionPlot'),
    expression: 'sqrt(1 - 1/x)', domain: [1, 10.4], start: 0, end: 1,
    stroke: [{ weight: 5, fill: '#FFB15C', align: 'center', cap: 'round', join: 'round' }],
};
fs.writeFileSync(path.join(here, 'dilation.json'), JSON.stringify(scene(820, 440, [
    { id: 'a2', type: 'axes2d', parentId: '', layerOrder: 0, props: { ...axes2, effects: [bloom(0.6, 14, 0.6)] } },
    { id: 'fp', type: 'functionPlot', parentId: 'a2', layerOrder: 0, props: plot },
])));

// --- The equations, in the warm white of the rings.
const latex = (tex, y, size) => ({ ...pick(gd, 'latex'), x: 0, y, latex: tex, fontSize: size, written: 1, fill: [solid('#F6E9D2')] });
for (const [name, tex] of [['eq-radius', String.raw`r_s = \frac{2GM}{c^2}`], ['eq-time', String.raw`\Delta t' = \Delta t \sqrt{1 - \frac{r_s}{r}}`], ['eq-throat', String.raw`r(z) = b \cosh\left(\frac{z}{b}\right)`]]) {
    fs.writeFileSync(path.join(here, `${name}.json`), JSON.stringify(scene(760, 220, [{ id: 'e', type: 'latex', parentId: '', layerOrder: 0, props: latex(tex, 0, 72) }])));
}
console.log('well.json dilation.json equations.json');

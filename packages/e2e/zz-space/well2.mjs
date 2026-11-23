// Scratch: the long wormhole for the revised deep-space frame, at poster size. `node zz-space/well2.mjs`
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const gd = JSON.parse(fs.readFileSync(path.join(here, '../zz-math/tmpl-gradient-descent.json'), 'utf8'));
const pick = (type) => structuredClone(gd.nodes.find((n) => n.type === type).props);
const solid = (c) => ({ type: 'solid', color: c });
const bloom = (threshold, radius, intensity) => ({ type: 'bloom', threshold, radius, intensity });

// r = b cosh(s), z = K b s: K stretches the neck so the tunnel reads long.
const B = 0.55;
const K = 2.2;
const S = 2.75;
const sOf = (u) => `(-${S} + ${2 * S} * ${u})`;
const Z = K * B * S;
const R = B * Math.cosh(S);
const W = 1080;
const H = 1350;
const axes = {
    ...pick('axes3d'),
    x: 0, y: 0, width: W, height: H,
    orbit: -24, elevation: 9, zoom: 16, fov: 30,
    ambientIntensity: 0.3, keyIntensity: 1.1,
    xRange: [-R, R], yRange: [-R, R], zRange: [-Z, Z],
    xLength: 2 * R, yLength: 2 * R, zLength: 2 * Z,
    showGrid: false, showAxes: false, grid: false, tips: false, thickness: 0, color: 'rgba(0, 0, 0, 0)',
    effects: [bloom(0.45, 40, 1.15)],
};
const surface = {
    ...pick('surfacePlot3d'),
    expression: `(${B} * cosh(${sOf('u')}) * cos(2 * pi * v), ${B} * cosh(${sOf('u')}) * sin(2 * pi * v), ${K * B} * ${sOf('u')})`,
    uDomain: null, vDomain: null, segments: 160,
    fill: '#07090C',
    // Cold steel at the far rims, warm cream light pooling in the throat.
    colorScale: ['#06080B', '#1C2633', '#5D5444', '#C99A5B', '#FFF4DE', '#C99A5B', '#5D5444', '#1C2633', '#06080B'],
    meshLines: 34, meshColor: 'rgba(226, 210, 178, 0.42)', floorShadow: 0,
};
const curve = { ...pick('curvePlot3d'), start: 0, end: 1 };
const path3 = {
    ...curve,
    expression: `(1.04 * ${B} * cosh(t) * cos(1.9 * t), 1.04 * ${B} * cosh(t) * sin(1.9 * t), ${K * B} * t)`,
    domain: [-2.6, 2.6], samples: 1200, thickness: 0.022, fill: '#FFFFFF', unlit: true,
};
const ring = (sAt, thickness, fill) => ({
    ...curve,
    expression: `(1.03 * ${B} * cosh(${sAt}) * cos(t), 1.03 * ${B} * cosh(${sAt}) * sin(t), ${K * B} * ${sAt})`,
    domain: [0, 6.28319], samples: 360, thickness, fill, unlit: true,
});
const doc = {
    kind: 'composition', duration: 1, fps: 30, viewport: { width: W, height: H }, theme: gd.theme,
    nodes: [
        { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { ...gd.nodes[0].props, fill: [solid('#030406')] } },
        { id: 'ax', type: 'axes3d', parentId: '', layerOrder: 0, props: axes },
        { id: 'sf', type: 'surfacePlot3d', parentId: 'ax', layerOrder: 0, props: surface },
        { id: 'sp', type: 'curvePlot3d', parentId: 'ax', layerOrder: 1, props: path3 },
        { id: 'r0', type: 'curvePlot3d', parentId: 'ax', layerOrder: 2, props: ring(0, 0.04, '#FFFFFF') },
        { id: 'r1', type: 'curvePlot3d', parentId: 'ax', layerOrder: 3, props: ring(0.55, 0.014, '#F3DDB2') },
        { id: 'r2', type: 'curvePlot3d', parentId: 'ax', layerOrder: 4, props: ring(-0.55, 0.014, '#F3DDB2') },
    ],
    commands: [],
};
fs.writeFileSync(path.join(here, 'well2.json'), JSON.stringify(doc));
console.log({ Z, R });

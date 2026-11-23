// Scratch: the two-ink world map (all land in blue, the six largest countries in pink) and the riso bar chart.
// Works out the pink layer's box so its equirectangular fit lands on the blue layer's. `node zz-globe/riso2.mjs`
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const geo = 'C:/Users/workk/Projects/motionscript/motionscript/packages/components/geography';
const { geoBounds } = await import(pathToFileURL(`${geo}/node_modules/d3-geo/src/index.js`).href);
const { decodeGeoFile, ringCoordinates } = await import(pathToFileURL(`${geo}/dist/border/format.js`).href);

const here = import.meta.dirname;
const mapDoc = JSON.parse(fs.readFileSync(path.join(here, '../zz-geo/tmpl-the-map.json'), 'utf8'));
const WORLD = mapDoc.nodes.find((n) => n.type === 'geoBorder').props.iso;
const SIX = ['RU', 'CA', 'US', 'CN', 'BR', 'AU'];

function bounds(codes) {
    const coordinates = [];
    for (const code of codes) {
        const file = path.join(geo, 'data/v1/countries', `${code}.json`);
        if (!fs.existsSync(file)) continue;
        const feature = decodeGeoFile(JSON.parse(fs.readFileSync(file, 'utf8'))).features.get(code);
        if (!feature) continue;
        for (const polygon of feature.polygons) coordinates.push([ringCoordinates(polygon.rings[0])]);
    }
    return geoBounds({ type: 'MultiPolygon', coordinates });
}

const [[ww, ws], [we, wn]] = bounds(WORLD);
const [[sw, ss], [se, sn]] = bounds(SIX);
console.log('world', { ww, ws, we, wn }, 'six', { sw, ss, se, sn });

// Equirectangular, both centred on 0° when they span the antimeridian: px per degree is set by the width.
const W = 1000;
const p = W / 360;
const worldH = (wn - ws) * p;
const sixH = (sn - ss) * p;
const sixY = ((sn + ss) / 2 - (wn + ws) / 2) * p; // y is up
const MIS = { x: 5, y: -4 }; // off-register
console.log({ worldH, sixH, sixY });

const solid = (c) => ({ type: 'solid', color: c });
const halftone = (size, angle) => ({ type: 'halftone', size, angle, shape: 'dot', separation: 'mono' });
const duotone = (shadows, highlights) => ({ type: 'duotone', amount: 1, shadows, highlights });
const border = (iso, props) => ({ type: 'geoBorder', parentId: '', props: { iso, level: 'country', detail: 0.7, projection: 'equirectangular', frame: 'all', borders: 'outline', stroke: [], ...props } });

const VW = 1040;
const VH = Math.ceil(worldH) + 40;
const map = {
    kind: 'composition', duration: 1, fps: 30, viewport: { width: VW, height: VH },
    nodes: [
        { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: [solid('#F3ECDD')] } },
        { id: 'w', layerOrder: 0, ...border(WORLD, { x: 0, y: 0, width: W, height: worldH, fill: [solid('#3C3C3C')], effects: [halftone(7, 22), duotone('#1F5FD0', '#FFFFFF00')] }) },
        { id: 's', layerOrder: 1, ...border(SIX, { x: MIS.x, y: sixY + MIS.y, width: W, height: sixH, fill: [solid('#3A3A3A')], effects: [halftone(7, 67), duotone('#FF3D9A', '#FFFFFF00')] }) },
    ],
    commands: [],
};
fs.writeFileSync(path.join(here, 'riso-map.json'), JSON.stringify(map));

const text = (family, size, weight, fill) => ({ fontFamily: family, fontSize: size, fontWeight: weight, fill });
const chart = {
    kind: 'composition', duration: 1, fps: 30, viewport: { width: 960, height: 420 },
    nodes: [
        { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: [solid('#F3ECDD')] } },
        {
            id: 'c', type: 'barChart', parentId: '', layerOrder: 0,
            props: {
                x: 0, y: 0, width: 960, height: 420, orientation: 'horizontal', categoryField: 'country',
                data: [
                    { country: 'RUSSIA', area: 17.1 }, { country: 'CANADA', area: 10.0 }, { country: 'USA', area: 9.8 },
                    { country: 'CHINA', area: 9.6 }, { country: 'BRAZIL', area: 8.5 }, { country: 'AUSTRALIA', area: 7.7 },
                ],
                series: [{ field: 'area', label: 'Million km²' }],
                valueAxis: { range: [0, 18], ticks: [0, 5, 10, 15], format: '0.0' },
                style: {
                    seriesFills: [[solid('#FF3D9A'), { type: 'dotGrid', radius: 1.6, spacing: 6, color: '#F3ECDD', opacity: 0.55 }]],
                    legend: 'none', values: 'end',
                    valueText: text('Space Mono', 22, 700, '#FF3D9A'),
                    xLabelText: text('Space Mono', 15, 400, '#1F5FD0'),
                    yLabelText: text('Space Mono', 20, 700, '#1F5FD0'),
                    axisStroke: { weight: 2.5, fill: '#1F5FD0' },
                    horizontalGrid: [],
                    verticalGrid: { weight: 1.2, fill: '#1F5FD055', dash: [4, 6] },
                    barCornerRadius: 0, barStroke: { weight: 0, fill: '#00000000' }, barWidth: 0.66,
                },
            },
        },
    ],
    commands: [],
};
fs.writeFileSync(path.join(here, 'riso-chart.json'), JSON.stringify(chart));

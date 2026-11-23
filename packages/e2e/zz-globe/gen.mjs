// Scratch: one square still per globe look, rendered with zz-geo/render.ts. `node zz-globe/gen.mjs`
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const S = 1200;

const halftone = (size, angle, shape, separation) => ({ type: 'halftone', size, angle, shape, separation });
const duotone = (shadows, highlights) => ({ type: 'duotone', amount: 1, shadows, highlights });
const bloom = (threshold, radius, intensity) => ({ type: 'bloom', threshold, radius, intensity });
const grain = (amount) => ({ type: 'grain', amount, size: 1, seed: 3, animated: false, colored: false });
const dither = (levels, scale) => ({ type: 'dither', levels, matrix: 4, scale, monochrome: false, noise: 'bayer' });
const solid = (c) => ({ type: 'solid', color: c });

const LOOKS = {
    noir: {
        bg: '#0A0C10',
        globe: {
            longitude: 18, latitude: 22, shading: 'lit',
            fill: [{ type: 'radial-gradient', colors: ['#1B2536', '#0A0E16'], center: { x: -0.35, y: 0.35 }, radius: 760 }],
            stroke: [{ weight: 1.5, fill: '#D9C08A88' }],
            land: [solid('#D8BE86')],
            coast: [{ weight: 0.9, fill: '#F6E7C1' }],
            graticule: [{ weight: 0.8, fill: '#D9C08A38' }],
            graticuleStep: 15,
            highlight: ['EG'], highlightFill: [solid('#FF5B3A')],
            effects: [bloom(0.62, 28, 0.55)],
        },
    },
    swiss: {
        bg: '#EEECE5',
        globe: {
            longitude: -38, latitude: 18, shading: 'flat',
            fill: [solid('#EEECE5')],
            stroke: [{ weight: 3, fill: '#111111' }],
            land: [solid('#FF3B1F')],
            coast: [],
            graticule: [{ weight: 1.2, fill: '#11111166' }],
            graticuleStep: 10,
        },
    },
    swissNight: {
        bg: '#0D1F45',
        globe: {
            longitude: -38, latitude: 18, shading: 'flat',
            fill: [solid('#0D1F45')],
            stroke: [{ weight: 3, fill: '#EEECE5' }],
            land: [solid('#EEECE5')],
            coast: [],
            graticule: [{ weight: 1.2, fill: '#EEECE566' }],
            graticuleStep: 10,
        },
    },
    swissCobalt: {
        bg: '#0D1F45',
        globe: {
            longitude: -38, latitude: 18, shading: 'flat',
            fill: [solid('#2459E0')],
            stroke: [{ weight: 3, fill: '#EEECE5' }],
            land: [solid('#EEECE5')],
            coast: [],
            graticule: [{ weight: 1.2, fill: '#EEECE54D' }],
            graticuleStep: 10,
        },
    },
    swissSunset: {
        bg: '#0D1F45',
        globe: {
            longitude: -38, latitude: 18, shading: 'flat',
            fill: [solid('#0D1F45')],
            stroke: [{ weight: 3, fill: '#EEECE5' }],
            land: [{ type: 'linear-gradient', colors: ['#FFD23F', '#FF7A2F', '#FF3D7F'], start: { x: 0, y: 0.5 }, end: { x: 0, y: -0.3 } }],
            coast: [],
            graticule: [{ weight: 1.2, fill: '#EEECE559' }],
            graticuleStep: 10,
        },
    },
    riso: {
        bg: '#F3ECDD',
        globe: {
            longitude: 100, latitude: 18, shading: 'lit',
            fill: [solid('#2D6BD8')],
            stroke: [],
            land: [solid('#FF4FA3')],
            coast: [],
            graticule: [],
            effects: [halftone(11, 22, 'dot', 'cmyk')],
        },
    },
    risoMono: {
        bg: '#F3ECDD',
        globe: {
            longitude: 100, latitude: 18, shading: 'lit',
            fill: [solid('#3A3A3A')],
            stroke: [],
            land: [solid('#BBBBBB')],
            coast: [],
            graticule: [],
            effects: [halftone(10, 22, 'dot', 'mono'), duotone('#1F5FD0', '#F3ECDD')],
        },
    },
    engraved2: {
        bg: '#ECE2CC',
        globe: {
            longitude: -60, latitude: 12, shading: 'lit', borders: 'all',
            fill: [solid('#E9DDC3'), { type: 'stripe', gap: 7, strokeWidth: 1.4, angle: 0, color: '#3A2817', opacity: 0.8 }],
            stroke: [{ weight: 3, fill: '#2A1C10' }],
            land: [solid('#FFFBF2')],
            coast: [{ weight: 1.6, fill: '#2A1C10' }],
            graticule: [{ weight: 1, fill: '#2A1C10CC' }],
            graticuleStep: 15,
            effects: [halftone(6, 45, 'cross', 'mono'), duotone('#2A1C10', '#F4ECDA')],
        },
    },
    engraved3: {
        bg: '#ECE2CC',
        globe: {
            longitude: -60, latitude: 12, shading: 'lit', borders: 'all',
            fill: [solid('#B8A27E')],
            stroke: [{ weight: 3, fill: '#2A1C10' }],
            land: [solid('#FFFDF6')],
            coast: [{ weight: 1.8, fill: '#2A1C10' }],
            graticule: [{ weight: 1.1, fill: '#2A1C10' }],
            graticuleStep: 15,
            effects: [halftone(5, 0, 'line', 'mono'), duotone('#2A1C10', '#F2E9D5')],
        },
    },
    engraved: {
        bg: '#E8DCC2',
        globe: {
            longitude: -60, latitude: 12, shading: 'lit', borders: 'all',
            fill: [solid('#DCCCAA'), { type: 'stripe', gap: 6, strokeWidth: 1, angle: 0, color: '#4A3420', opacity: 0.55 }],
            stroke: [{ weight: 2.5, fill: '#2E2014' }],
            land: [solid('#F2E8D3')],
            coast: [{ weight: 1.3, fill: '#2E2014' }],
            graticule: [{ weight: 0.9, fill: '#2E2014AA' }],
            graticuleStep: 15,
            effects: [halftone(4, 45, 'cross', 'mono'), duotone('#2E2014', '#EEE3CC')],
        },
    },
    risoTop: {
        bg: '#F3ECDD',
        under: {
            longitude: 100, latitude: 18, shading: 'lit',
            fill: [solid('#444444')], stroke: [], land: [solid('#FFFFFF')], coast: [], graticule: [],
            effects: [halftone(10, 22, 'dot', 'mono'), duotone('#1F5FD0', '#F3ECDD')],
        },
        globe: {
            x: 7, y: -5,
            longitude: 100, latitude: 18, shading: 'lit',
            fill: [solid('#FFFFFF00')], stroke: [], land: [solid('#555555')], coast: [], graticule: [],
            effects: [halftone(10, 67, 'dot', 'mono'), duotone('#FF3D9A', '#FFFFFF00')],
        },
    },
    signal: {
        bg: '#040705',
        globe: {
            longitude: -95, latitude: 30, shading: 'lit',
            fill: [solid('#0A1F14')],
            stroke: [{ weight: 2, fill: '#3DFF8F' }],
            land: [solid('#3DFF8F')],
            coast: [],
            graticule: [{ weight: 1, fill: '#3DFF8F55' }],
            graticuleStep: 10,
            effects: [dither(3, 4), bloom(0.5, 18, 0.7)],
        },
    },
};

fs.mkdirSync(path.join(here, 'out'), { recursive: true });
for (const [key, look] of Object.entries(LOOKS)) {
    const size = look.size ?? 1040;
    const doc = {
        kind: 'composition', duration: 1, viewport: { width: S, height: S }, fps: 30,
        nodes: [
            { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: [solid(look.bg)] } },
            ...(look.under ? [{ id: 'u', type: 'geoGlobe', parentId: '', layerOrder: 0, props: { x: 0, y: 0, width: size, height: size, detail: 0.6, ...look.under } }] : []),
            { id: 'g', type: 'geoGlobe', parentId: '', layerOrder: 1, props: { x: 0, y: 0, width: size, height: size, detail: 0.6, ...look.globe } },
        ],
        commands: [],
    };
    fs.writeFileSync(path.join(here, `${key}.json`), JSON.stringify(doc));
}
console.log(Object.keys(LOOKS).join(' '));

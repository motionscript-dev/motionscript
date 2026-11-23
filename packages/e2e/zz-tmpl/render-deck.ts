import fs from 'node:fs';
import path from 'node:path';
import { createServerEngine } from '@motionscript/headless';

// Scratch: render dumped deck slides to PNG at TIMES (seconds, comma-separated; default the thumbnail time). `tsx zz-tmpl/render-deck.ts <out-dir> <tmpl.json...>`
const here = import.meta.dirname;
const [outDir, ...docs] = process.argv.slice(2);

const font: Record<string, unknown> = {};
const serve: Record<string, string> = {};
const face = (family: string, file: string, weight: number) => {
    const src = `/fonts/${path.basename(file)}`;
    serve[src] = file;
    font[`${family}@${weight}`] = { fontFamily: family, fontWeight: weight, fontStyle: 'normal', src, sizeBytes: fs.statSync(file).size };
};
const local = (name: string) => path.join(here, 'fonts', name);
const italic = (family: string, file: string, weight: number) => {
    const src = `/fonts/${path.basename(file)}`;
    serve[src] = file;
    font[`${family}@${weight}i`] = { fontFamily: family, fontWeight: weight, fontStyle: 'italic', src, sizeBytes: fs.statSync(file).size };
};
face('Unbounded', local('unbounded-400.ttf'), 400);
face('Unbounded', local('unbounded-700.ttf'), 700);
face('Unbounded', local('unbounded-900.ttf'), 900);
face('Newsreader', local('newsreader-400.ttf'), 400);
face('Newsreader', local('newsreader-500.ttf'), 500);
italic('Newsreader', local('newsreader-400i.ttf'), 400);
face('IBM Plex Mono', local('ibm-plex-mono-400.ttf'), 400);
face('IBM Plex Mono', local('ibm-plex-mono-500.ttf'), 500);
face('Inter Tight', local('inter-tight-500.ttf'), 500);
face('Inter Tight', local('inter-tight-700.ttf'), 700);
face('Instrument Serif', local('instrument-serif-400.ttf'), 400);
italic('Instrument Serif', local('instrument-serif-400i.ttf'), 400);
face('Anton', local('anton-400.ttf'), 400);
face('Big Shoulders Display', local('big-shoulders-display-900.ttf'), 900);
face('Bricolage Grotesque', local('bricolage-grotesque-800.ttf'), 800);
face('Instrument Sans', local('instrument-sans-500.ttf'), 500);
face('Instrument Sans', local('instrument-sans-600.ttf'), 600);
face('Geist Mono', local('geist-mono-400.ttf'), 400);
face('Geist Mono', local('geist-mono-500.ttf'), 500);
face('Space Mono', local('space-mono-400.ttf'), 400);
face('Space Mono', local('space-mono-700.ttf'), 700);

const geoData = 'C:/Users/workk/Projects/motionscript/motionscript/packages/components/geography/data/v1';
serve['/geo/v1/index.json'] = path.join(geoData, 'index.json');
for (const file of fs.readdirSync(path.join(geoData, 'countries'))) serve[`/geo/v1/countries/${file}`] = path.join(geoData, 'countries', file);

const engine = createServerEngine({
    projectRoot: path.resolve(here, '..'),
    entry: path.resolve(here, 'project.ts'),
    serve,
    manifest: { image: {}, video: {}, audio: {}, font } as never,
    softwareRender: process.env.GPU !== '1',
    onPageMessage({ type, text }) {
        if (type === 'error' || /warn/i.test(type)) console.log(`[page ${type}] ${text}`);
    },
});
try {
    fs.mkdirSync(outDir!, { recursive: true });
    for (const docPath of docs) {
        const spec = JSON.parse(fs.readFileSync(docPath, 'utf8'));
        const W = spec.viewport?.width ?? 1920;
        const H = spec.viewport?.height ?? 1080;
        const seconds = spec.composition?.duration ?? spec.duration ?? 6;
        const clip = { kind: 'composition', nodes: spec.nodes, commands: spec.commands ?? [], duration: seconds, ...(spec.theme ? { theme: spec.theme } : {}), ...(spec.variables ? { variables: spec.variables } : {}) };
        const document = { kind: 'project', name: 'tmpl', fps: 30, viewport: { width: W, height: H }, theme: { colors: {} }, tracks: [{ id: 't', clip, duration: seconds }] };
        const times = (process.env.TIMES ?? String(spec.thumbnailAt ?? 4.5)).split(',').map(Number);
        for (const t of times) {
            const shot = await engine.renderImage({ document: document as never, frame: Math.min(Math.round(t * 30), Math.round(seconds * 30) - 1), scale: Number(process.env.SCALE ?? 1), format: 'png' });
            const out = path.join(outDir!, path.basename(docPath).replace(/.json$/, `@${t}.png`));
            fs.writeFileSync(out, shot.bytes);
            console.log('wrote', out);
        }
    }
} finally {
    await engine.close();
}

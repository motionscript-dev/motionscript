import fs from 'node:fs';
import path from 'node:path';
import { createServerEngine } from '@motionscript/headless';

// Scratch: render dumped drawing-template layouts to PNG. `tsx zz-tmpl/render.ts <out-dir> <tmpl.json...>`
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
        const clip = { kind: 'composition', nodes: spec.nodes, commands: spec.commands ?? [], duration: 1, ...(spec.theme ? { theme: spec.theme } : {}), ...(spec.variables ? { variables: spec.variables } : {}) };
        const document = { kind: 'project', name: 'tmpl', fps: 30, viewport: { width: W, height: H }, theme: { colors: {} }, tracks: [{ id: 't', clip, duration: 1 }] };
        const shot = await engine.renderImage({ document: document as never, frame: 0, scale: Number(process.env.SCALE ?? 1), format: 'png' });
        const out = path.join(outDir!, path.basename(docPath).replace(/\.json$/, '.png'));
        fs.writeFileSync(out, shot.bytes);
        console.log('wrote', out);
    }
} finally {
    await engine.close();
}

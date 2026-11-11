import fs from 'node:fs';
import path from 'node:path';
import { createServerEngine } from '@motionscript/headless';

// Scratch: render the Catan board/pieces to PNGs. `tsx zz-catan/render.ts <scene.json> <out-prefix> <frames...>`
const here = import.meta.dirname;
const [docPath, outPrefix, ...frameArgs] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(docPath!, 'utf8'));
const W = spec.viewport?.width ?? 1920;
const H = spec.viewport?.height ?? 1080;
const fps = spec.fps ?? 30;

const inter = path.resolve(here, '../fonts/inter/inter-regular.ttf');
const font: Record<string, unknown> = {};
const serve: Record<string, string> = { '/fonts/inter.ttf': inter };
for (const weight of [400, 500, 600, 700, 800]) {
    font[`Inter@${weight}`] = { fontFamily: 'Inter', fontWeight: weight, src: '/fonts/inter.ttf', sizeBytes: fs.statSync(inter).size };
}
const bundled = 'C:/Users/workk/Projects/motionscript/studio/packages/client/desktop/resources/fonts';
for (const [family, file, weight, style] of [
    ['JetBrains Mono', 'jetbrains-mono/jetbrains-mono-400.ttf', 400, 'normal'],
    ['JetBrains Mono', 'jetbrains-mono/jetbrains-mono-700.ttf', 700, 'normal'],
    ['Instrument Serif', 'instrument-serif/instrument-serif-400.ttf', 400, 'normal'],
    ['Instrument Serif', 'instrument-serif/instrument-serif-400i.ttf', 400, 'italic'],
] as const) {
    const src = `/fonts/${path.basename(file)}`;
    serve[src] = path.join(bundled, file);
    font[`${family}@${weight}${style === 'italic' ? 'i' : ''}`] = { fontFamily: family, fontWeight: weight, fontStyle: style, src, sizeBytes: fs.statSync(path.join(bundled, file)).size };
}

const clip = { kind: 'composition', nodes: spec.nodes, commands: spec.commands ?? [], duration: spec.duration, ...(spec.theme ? { theme: spec.theme } : {}), ...(spec.variables ? { variables: spec.variables } : {}) };
const document = {
    kind: 'project', name: 'catan', fps, viewport: { width: W, height: H }, theme: { colors: {} },
    tracks: [{ id: 'catan', clip, duration: spec.duration }],
};

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
    if (process.env.VIDEO === '1') {
        const bytes = await engine.renderVideo({ document: document as never, scale: Number(process.env.SCALE ?? 0.5), supersample: 1, includeAudio: false });
        fs.writeFileSync(`${outPrefix}.mp4`, bytes);
        console.log('wrote', `${outPrefix}.mp4`);
        process.exit(0);
    }
    for (const f of frameArgs.length ? frameArgs : ['0']) {
        const frame = f === 'last' ? 'last' : Math.round(Number(f) * fps);
        const shot = await engine.renderImage({ document: document as never, frame, scale: Number(process.env.SCALE ?? 0.5), format: 'png' });
        const out = `${outPrefix}-${f}.png`;
        fs.writeFileSync(out, shot.bytes);
        console.log('wrote', out, `(${shot.totalFrames} frames)`);
    }
} finally {
    await engine.close();
}

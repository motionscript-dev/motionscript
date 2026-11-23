import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Scratch: export each pixel scene on the real GPU and report ms per frame plus the top self-time functions.
// `GPU=1 npx tsx zz-pixels/bench.ts [scene...]` from packages/e2e. Scenes: empty garden mosaic0 mosaic1.
const here = import.meta.dirname;
const req = createRequire(path.resolve(here, '../../headless/package.json'));
const pw = req('playwright');
let page: any = null;
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (opts: any) => {
    const browser = await launch(opts);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...a: unknown[]) => (page = await newPage(...a));
    return browser;
};
const { createServerEngine } = await import('@motionscript/headless');

const FPS = 60;
const node = (type: string, props: Record<string, unknown>) => ({ id: type, type, parentId: null, layerOrder: 0, props: { width: 1920, height: 1080, ...props } });
const cmd = (target: string, type: string, duration: number, args: Record<string, unknown>) => ({ id: `${target}-${type}`, type, targetId: target, at: 0, duration, easing: { kind: 'linear' }, args });
const SCENES: Record<string, { seconds: number; nodes: unknown[]; commands: unknown[] }> = {
    empty: { seconds: 3, nodes: [node('rect', { fill: '#eee' })], commands: [] },
    garden: {
        seconds: 3,
        nodes: [node('pixelGarden', { cell: 16, flowers: 26, clouds: 6, grown: 0, wind: 0 })],
        commands: [cmd('pixelGarden', 'grow', 3, { grown: 1 }), cmd('pixelGarden', 'blow', 3, { wind: 30 })],
    },
    mosaic0: { seconds: 1, nodes: [node('mosaic', { cell: 12, mode: 0 })], commands: [cmd('mosaic', 'shift', 1, { phase: 60 })] },
    mosaic1: { seconds: 3, nodes: [node('mosaic', { cell: 12, mode: 1 })], commands: [cmd('mosaic', 'shift', 3, { phase: 180 })] },
};

const engine = createServerEngine({
    projectRoot: path.resolve(here, '..'),
    entry: path.resolve(here, 'project.ts'),
    manifest: { image: {}, video: {}, audio: {}, font: {} } as never,
    softwareRender: process.env.GPU !== '1',
    onPageMessage({ type, text }) {
        if (type === 'error' || /warn/i.test(type)) console.log(`[page ${type}] ${text}`);
    },
});

function topSelf(profile: any, n: number) {
    const byId = new Map<number, any>(profile.nodes.map((x: any) => [x.id, x]));
    const self = new Map<number, number>();
    profile.samples.forEach((id: number, i: number) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    const agg = new Map<string, number>();
    let total = 0;
    for (const [id, us] of self) {
        const cf = byId.get(id).callFrame;
        if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
        const key = `${cf.functionName || '(anon)'} ${path.basename(cf.url || '')}:${cf.lineNumber}`;
        agg.set(key, (agg.get(key) ?? 0) + us);
        total += us;
    }
    return { total: total / 1000, rows: [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`) };
}

const pick = process.argv.slice(2);
try {
    for (const name of pick.length ? pick : Object.keys(SCENES)) {
        const s = SCENES[name];
        const clip = { kind: 'composition', nodes: s.nodes, commands: s.commands, duration: s.seconds };
        const document = { kind: 'project', name, fps: FPS, viewport: { width: 1920, height: 1080 }, theme: { colors: {} }, tracks: [{ id: name, clip, duration: s.seconds }] };
        // Warm-up (bundle, page, pipelines) so the timed run is steady state.
        await engine.renderImage({ document: document as never, frame: 0, scale: 1, format: 'png' });
        const cdp = page ? await page.context().newCDPSession(page) : null;
        if (cdp) {
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
            await cdp.send('Profiler.start');
        }
        const t0 = performance.now();
        await engine.renderVideo({ document: document as never, scale: 1, supersample: 1, includeAudio: false });
        const ms = performance.now() - t0;
        const frames = s.seconds * FPS;
        console.log(`\n== ${name}: ${frames} frames in ${(ms / 1000).toFixed(2)} s = ${(ms / frames).toFixed(1)} ms/frame`);
        if (cdp) {
            const { profile } = await cdp.send('Profiler.stop');
            const top = topSelf(profile, 18);
            console.log(`   page JS+wasm busy ${(top.total / frames).toFixed(1)} ms/frame; top self time:`);
            console.log(top.rows.map((r) => `   ${r}`).join('\n'));
            await cdp.detach();
        }
    }
} finally {
    await engine.close();
}

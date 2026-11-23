import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

// Scratch: export the whole promo on the real GPU while counting GPU allocations by label and the GPU process's VRAM.
// `GPU=1 npx tsx zz-promo/leak.ts [scale] [fps] [scenes...]` from packages/e2e.
const here = import.meta.dirname;
const req = createRequire(path.resolve(here, '../../headless/package.json'));
const pw = req('playwright');
const INIT = fs.readFileSync(path.join(here, 'gpu-track.js'), 'utf8');
let page: any = null;
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (opts: any) => {
    const browser = await launch(opts);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...a: unknown[]) => {
        const p = await newPage(...a);
        await p.addInitScript(INIT);
        page = p;
        return p;
    };
    return browser;
};
const { createServerEngine } = await import('@motionscript/headless');

const [scaleArg, fpsArg, ...sceneArgs] = process.argv.slice(2);
const scale = Number(scaleArg ?? 1);
const fps = Number(fpsArg ?? 60);
const ORDER = ['intro', 'commands', 'built-for', 'real-d', 'components', 'free', 'open-source', 'sign-off'];
const scenes = sceneArgs.length ? sceneArgs : ORDER;

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
    ['DM Sans', 'dm-sans/dm-sans-400.ttf', 400, 'normal'],
    ['DM Sans', 'dm-sans/dm-sans-500.ttf', 500, 'normal'],
    ['DM Sans', 'dm-sans/dm-sans-700.ttf', 700, 'normal'],
] as const) {
    const src = `/fonts/${path.basename(file)}`;
    serve[src] = path.join(bundled, file);
    font[`${family}@${weight}${style === 'italic' ? 'i' : ''}`] = { fontFamily: family, fontWeight: weight, fontStyle: style, src, sizeBytes: fs.statSync(path.join(bundled, file)).size };
}
const geoData = 'C:/Users/workk/Projects/motionscript/motionscript/packages/components/geography/data/v1';
serve['/geo/v1/index.json'] = path.join(geoData, 'index.json');
for (const file of fs.readdirSync(path.join(geoData, 'countries'))) serve[`/geo/v1/countries/${file}`] = path.join(geoData, 'countries', file);

const tracks = scenes.map((slug) => {
    const spec = JSON.parse(fs.readFileSync(path.join(here, `tmpl-${slug}.json`), 'utf8'));
    const clip = { kind: 'composition', nodes: spec.nodes, commands: spec.commands ?? [], duration: spec.duration, ...(spec.theme ? { theme: spec.theme } : {}), ...(spec.variables ? { variables: spec.variables } : {}) };
    return { id: slug, clip, duration: spec.duration };
});
const document = { kind: 'project', name: 'promo', fps, viewport: { width: 1920, height: 1080 }, theme: { colors: {} }, tracks };
const seconds = tracks.reduce((a, t) => a + t.duration, 0);

function ps(cmd: string): Promise<string> {
    return new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', cmd], (_e, out) => resolve(String(out ?? '').trim())));
}
let gpuPid = '';
async function vram(): Promise<string> {
    if (!gpuPid) {
        gpuPid = await ps(`(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? { $_.CommandLine -like '*type=gpu-process*' -and $_.CommandLine -like '*ms-playwright*' } | select -First 1).ProcessId`);
    }
    if (!gpuPid) return 'gpu pid ?';
    const out = await ps(`$s=(Get-Counter "\\GPU Process Memory(pid_${gpuPid}_*)\\Dedicated Usage","\\GPU Process Memory(pid_${gpuPid}_*)\\Shared Usage" -ErrorAction SilentlyContinue).CounterSamples; $d=($s | ? Path -like '*dedicated*' | measure CookedValue -Sum).Sum; $h=($s | ? Path -like '*shared*' | measure CookedValue -Sum).Sum; "{0:N0} MB dedicated, {1:N0} MB shared" -f ($d/1MB),($h/1MB)`);
    return out;
}

const MB = (b: number) => `${(b / 2 ** 20).toFixed(0)} MB`;
async function sample(tag: string) {
    if (!page) return;
    const st = await page.evaluate(() => (globalThis as any).__gpuStats?.()).catch(() => null);
    if (!st) return;
    const top = Object.entries(st.rows as Record<string, any>)
        .sort((a, b) => b[1].heldB - a[1].heldB)
        .slice(0, 6)
        .map(([l, v]) => `${l} held ${MB(v.heldB)} (${v.made} made, ${v.destroyed} destroyed, ${v.gced} gc'd)`);
    console.log(`[${tag}] held by GC: ${MB(st.held)} | js heap ${MB(st.jsHeap)} | ${await vram()}\n    ${top.join('\n    ')}`);
}

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
const t0 = Date.now();
const timer = setInterval(() => void sample(`${((Date.now() - t0) / 1000).toFixed(0)}s`), 4000);
try {
    console.log(`exporting ${scenes.join(', ')}: ${seconds} s at ${fps} fps, scale ${scale}`);
    const bytes = await engine.renderVideo({ document: document as never, scale, supersample: 1, includeAudio: false });
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${MB(bytes.length)} mp4`);
    await sample('end');
    if (page) {
        const st = await page.evaluate(() => (globalThis as any).__gpuStats?.());
        fs.writeFileSync(path.join(here, 'out', 'leak-stats.json'), JSON.stringify(st, null, 1));
    }
} finally {
    clearInterval(timer);
    await engine.close();
}

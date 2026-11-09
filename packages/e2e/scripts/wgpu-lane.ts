/**
 * The wgpu lane: renders the scenes in wgpu-lane.json through
 * `@motionscript/renderer` (WebGPU on SwiftShader, no GPU needed) and diffs
 * each frame against the committed wgpu-baseline/ PNGs.
 *
 *   tsx scripts/wgpu-lane.ts                  # shoot + compare; exits 1 on a failed frame
 *   tsx scripts/wgpu-lane.ts --update         # shoot, then rewrite the baseline
 *   tsx scripts/wgpu-lane.ts --scenes a,b     # a subset of the listed scenes
 *   tsx scripts/wgpu-lane.ts --shard 1/2      # every other scene, for CI's parallel jobs
 *
 * A frame fails when the share of pixels pixelmatch marks as changed exceeds
 * the scene's `threshold` (percent; the file's default otherwise), or when it
 * or its baseline is missing, or when the frame is fully transparent: every
 * scene fills its stage, and a renderer that silently draws nothing must
 * neither pass nor be recorded by `--update`. Needs `pnpm build:lib`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { FRAME_LABELS } from './lib/frames.ts';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(pkgRoot, 'out', 'wgpu');
const diffDir = path.join(pkgRoot, 'out', 'wgpu-diff');
const baselineDir = path.join(pkgRoot, 'wgpu-baseline');

interface Lane {
    /** Default max share of changed pixels, in percent. */
    threshold: number;
    /** pixelmatch's per-pixel colour distance (0 strict … 1 loose). */
    pixelThreshold: number;
    scenes: Record<string, { threshold?: number }>;
}

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const lane = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'wgpu-lane.json'), 'utf8')) as Lane;
const only = argv.find(a => a.startsWith('--scenes='))?.slice(9) ?? (argv.includes('--scenes') ? argv[argv.indexOf('--scenes') + 1] : undefined);
const shardArg = argv.find(a => a.startsWith('--shard='))?.slice(8) ?? (argv.includes('--shard') ? argv[argv.indexOf('--shard') + 1] : undefined);
const [shard, shards] = (shardArg ?? '1/1').split('/').map(Number);
if (!(shards >= 1 && shard >= 1 && shard <= shards)) throw new Error(`--shard takes i/n with 1 <= i <= n, not "${shardArg}".`);
const ids = (only ? only.split(',').filter(id => id in lane.scenes) : Object.keys(lane.scenes)).filter((_, i) => i % shards === shard - 1);
if (ids.length === 0) throw new Error('No scenes selected: --scenes must name scenes in wgpu-lane.json.');

/** Whether a PNG is fully transparent: every scene fills its stage, so nothing was drawn. */
function blankFrame(file: string): boolean {
    const { data } = PNG.sync.read(fs.readFileSync(file));
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    return true;
}

fs.rmSync(outDir, { recursive: true, force: true });
const shot = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(pkgRoot, 'scripts', 'shoot.ts'), '--scenes', ids.join(',')],
    { cwd: pkgRoot, stdio: 'inherit' },
);

if (update) {
    fs.mkdirSync(baselineDir, { recursive: true });
    const blank: string[] = [];
    for (const id of ids) {
        for (const label of FRAME_LABELS) {
            const file = `${id}.${label}.png`;
            if (!fs.existsSync(path.join(outDir, file))) continue;
            if (blankFrame(path.join(outDir, file))) blank.push(file);
            else fs.copyFileSync(path.join(outDir, file), path.join(baselineDir, file));
        }
    }
    if (blank.length > 0) console.log(`\nNot recorded, fully transparent: ${blank.join(', ')}`);
    console.log(`\nBaseline rewritten for ${ids.length} scene(s) in ${path.relative(pkgRoot, baselineDir)}/.`);
    process.exit(shot.status !== 0 || blank.length > 0 ? 1 : 0);
}

fs.rmSync(diffDir, { recursive: true, force: true });
fs.mkdirSync(diffDir, { recursive: true });
const results: Array<{ id: string; frame: string; mismatch: number | null; threshold: number; error?: string }> = [];
for (const id of ids) {
    const threshold = lane.scenes[id].threshold ?? lane.threshold;
    for (const label of FRAME_LABELS) {
        const file = `${id}.${label}.png`;
        const actual = path.join(outDir, file);
        const expected = path.join(baselineDir, file);
        if (!fs.existsSync(actual) || !fs.existsSync(expected)) {
            results.push({ id, frame: label, mismatch: null, threshold, error: fs.existsSync(actual) ? 'no baseline (run --update)' : 'not rendered' });
            continue;
        }
        if (blankFrame(actual)) {
            results.push({ id, frame: label, mismatch: null, threshold, error: 'fully transparent: nothing was drawn' });
            continue;
        }
        const a = PNG.sync.read(fs.readFileSync(expected));
        const b = PNG.sync.read(fs.readFileSync(actual));
        if (a.width !== b.width || a.height !== b.height) {
            results.push({ id, frame: label, mismatch: null, threshold, error: `size ${b.width}x${b.height}, baseline ${a.width}x${a.height}` });
            continue;
        }
        const diff = new PNG({ width: a.width, height: a.height });
        const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: lane.pixelThreshold });
        const mismatch = (changed / (a.width * a.height)) * 100;
        if (mismatch > threshold) fs.writeFileSync(path.join(diffDir, file), PNG.sync.write(diff));
        results.push({ id, frame: label, mismatch, threshold });
    }
}

const failed = results.filter(r => r.mismatch === null || r.mismatch > r.threshold);
fs.writeFileSync(path.join(pkgRoot, 'out', 'wgpu-summary.json'), JSON.stringify({ failed: failed.length, results }, null, 2));
for (const r of failed) {
    console.log(`  ✗ ${r.id}.${r.frame}: ${r.error ?? `${r.mismatch!.toFixed(3)}% changed (max ${r.threshold}%)`}`);
}
console.log(`\nwgpu lane: ${results.length - failed.length}/${results.length} frames match the baseline.`);
process.exit(failed.length > 0 || shot.status !== 0 ? 1 : 0);

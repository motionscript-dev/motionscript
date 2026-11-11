/**
 * Native export vs the WebCodecs export on the same e2e scenes, on this
 * machine's GPU (Chrome with WebGPU; the sidecar on DX12/Vulkan + NVENC).
 *
 *   npx tsx packages/renderer/crates/export/bench/run.ts --scenes rect-basic,text-basic [--repeat 10]
 *       [--scale 2] [--supersample 2] [--out DIR] [--encoder auto|nvenc|software] [--preset p4]
 *
 * Needs the sidecar built (`cargo build --release` in crates/export), the
 * renderer's WASM in web/pkg, built core/sdk/kits (`pnpm build:lib`), and
 * Chrome installed. For each scene: one WebCodecs export, one live native
 * export (page → driver → ms-export stdin), a replay of the recorded stream
 * (native side alone) and a render-only replay; then PSNR/SSIM of the native
 * file against the WebCodecs one.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(here, "../../..");
const packages = path.resolve(renderer, "..");
const e2e = path.join(packages, "e2e");
const exe = path.resolve(here, "../target/release/ms-export.exe");
// esbuild and Playwright as the headless package has them installed.
const fromHeadless = createRequire(path.join(packages, "headless/package.json"));
const { build } = fromHeadless("esbuild") as typeof import("esbuild");
const { chromium } = fromHeadless("playwright") as typeof import("playwright");

const argv = process.argv.slice(2);
const opt = (name: string, d?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : d;
};
const scenes = (opt("scenes", "rect-basic") ?? "").split(",").filter(Boolean);
const repeat = Number(opt("repeat", "10"));
const scale = Number(opt("scale", "2"));
const supersample = Number(opt("supersample", "2"));
const encoder = opt("encoder", "auto")!;
const preset = opt("preset");
const outDir = path.resolve(opt("out", path.join(here, "out"))!);
const ffmpeg = opt("ffmpeg", "ffmpeg")!;
fs.mkdirSync(outDir, { recursive: true });

/** Vite's eager `import.meta.glob("./*.ts")` (the renderer's effect ports), as static imports. */
function viteGlob(): import("esbuild").Plugin {
    return {
        name: "vite-glob",
        setup(b) {
            b.onLoad({ filter: /effects[\\/]_port\.ts$/ }, (args) => {
                const dir = path.dirname(args.path);
                const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.startsWith("_"));
                let src = fs.readFileSync(args.path, "utf8");
                const imports = files.map((f, i) => `import * as __glob${i} from "./${f}";`).join("\n");
                const table = `({${files.map((f, i) => `"./${f}": __glob${i}`).join(", ")}})`;
                src = src.replace(/import\.meta\.glob<[^>]*>\([^)]*\)/, () => table);
                return { contents: `${imports}\n${src}`, loader: "ts" };
            });
        },
    };
}

// ── page bundle ──────────────────────────────────────────────────────────────
const bundleDir = path.join(outDir, "page");
await build({
    entryPoints: [path.join(here, "page.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: path.join(bundleDir, "page.js"),
    sourcemap: false,
    logLevel: "warning",
    // This checkout's sources, not the last build's dist.
    alias: {
        "@motionscript/browser": path.join(packages, "browser/src/index.ts"),
        "@motionscript/renderer": path.join(renderer, "web/src/engine/index.ts"),
    },
    nodePaths: [path.join(packages, "browser/node_modules"), path.join(renderer, "node_modules"), path.join(e2e, "node_modules")],
    loader: { ".wasm": "file" },
    plugins: [viteGlob()],
});

// ── manifest (as e2e/scripts/shoot.ts builds it) ─────────────────────────────
const fontManifest: Record<string, unknown> = {};
const served: Record<string, string> = {
    "/": "",
    "/page.js": path.join(bundleDir, "page.js"),
    "/ms_renderer_bg.wasm": path.join(renderer, "web/pkg/ms_renderer_bg.wasm"),
};
for (const [family, file] of [["Inter", "inter/inter-regular.ttf"], ["Fira Mono", "fira-mono/fira-mono.ttf"]]) {
    const p = path.join(e2e, "fonts", file);
    served[`/fonts/${path.basename(p)}`] = p;
    fontManifest[`${family}@400`] = { fontFamily: family, fontWeight: 400, src: `/fonts/${path.basename(p)}`, sizeBytes: fs.statSync(p).size };
}
const image: Record<string, unknown> = {}, video: Record<string, unknown> = {};
for (const name of fs.readdirSync(path.join(e2e, "public"))) {
    const p = path.join(e2e, "public", name);
    if (fs.statSync(p).isDirectory()) continue;
    served[`/${name}`] = p;
    const ext = path.extname(name).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".svg", ".webp"].includes(ext)) image[name] = { src: `/${name}`, width: 0, height: 0, sizeBytes: fs.statSync(p).size };
    if (ext === ".mp4") video[name] = { src: `/${name}`, width: 0, height: 0, duration: mp4Duration(p), sizeBytes: fs.statSync(p).size };
}
const manifest = { image, video, audio: {}, font: fontManifest };

function mp4Duration(file: string): number {
    const bytes = fs.readFileSync(file);
    const at = bytes.indexOf("mvhd", 0, "latin1");
    if (at < 0) return 0;
    const v = bytes.readUInt8(at + 4);
    const ts = v === 1 ? bytes.readUInt32BE(at + 24) : bytes.readUInt32BE(at + 16);
    const d = v === 1 ? Number(bytes.readBigUInt64BE(at + 28)) : bytes.readUInt32BE(at + 20);
    return ts > 0 ? d / ts : 0;
}

const TYPES: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".mp4": "video/mp4" };
const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><meta charset=utf-8><body><script type=module src="/page.js"></script>`);
        return;
    }
    const file = served[decodeURIComponent(url)];
    if (!file || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;

// ── documents ────────────────────────────────────────────────────────────────
const { catalog } = await import(pathToFileURL(path.join(e2e, "src/scenes/catalog.ts")).href);
const { projectOf } = await import(pathToFileURL(path.join(e2e, "src/project.ts")).href);
async function documentOf(id: string): Promise<{ doc: unknown; frames: number }> {
    const entry = (catalog as Array<{ id: string; load: () => Promise<{ default: { duration?: number } }> }>).find((e) => e.id === id);
    if (!entry) throw new Error(`no scene ${id}`);
    const clip = (await entry.load()).default;
    const one = projectOf(id, clip);
    // The scene played `repeat` times back to back, so steady-state speed outweighs start-up.
    const tracks = Array.from({ length: repeat }, (_, i) => ({ ...one.tracks[0], id: `${id}-${i}`, startAt: i * one.tracks[0].duration }));
    return { doc: { ...one, tracks }, frames: Math.round((clip.duration ?? 0) * one.fps) * repeat };
}

// ── sidecar ──────────────────────────────────────────────────────────────────
const info = JSON.parse(spawnSync(exe, ["info"], { encoding: "utf8" }).stdout.trim().split("\n").pop()!);
console.log(`sidecar: ${info.adapter}; NVENC h264 ${info.encoders.h264_nvenc}`);

interface Done { event: "done"; fps: number; seconds: number; frameSeconds: number; encodeTailSeconds: number; renderMs: number; applyMs: number; readbackWaitMs: number; imageUploadMs: number; streamBytes: number; encoder: string; frames: number }

function runSidecar(args: string[]): { child: ChildProcessWithoutNullStreams; done: Promise<Done> } {
    const child = spawn(exe, ["encode", "--encoder", encoder, ...(preset ? ["--preset", preset] : []), ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const done = new Promise<Done>((resolve, reject) => {
        child.on("close", (code) => {
            const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
            const d = lines.find((l) => l.event === "done");
            if (code === 0 && d) resolve(d);
            else reject(new Error(`ms-export exited ${code}: ${lines.find((l) => l.event === "error")?.message ?? ""} ${err}`));
        });
    });
    return { child, done };
}

function quality(ref: string, test: string): { psnr: number; ssim: number } {
    const r = spawnSync(ffmpeg, ["-hide_banner", "-i", test, "-i", ref, "-lavfi", "[0:v][1:v]psnr;[0:v][1:v]ssim", "-f", "null", "-"], { encoding: "utf8" });
    const psnr = Number(/PSNR .*average:([\d.inf]+)/.exec(r.stderr)?.[1] ?? NaN);
    const ssim = Number(/SSIM .*All:([\d.]+)/.exec(r.stderr)?.[1] ?? NaN);
    return { psnr, ssim };
}

function frameCount(file: string): number {
    const r = spawnSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file], { encoding: "utf8" });
    return Number(r.stdout.trim());
}

// ── run ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
page.on("console", (m) => {
    if (m.type() === "error" || /not drawn|failed|No font/i.test(m.text())) console.log(`  [page] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`  [page error] ${e.message}`));

let current: ChildProcessWithoutNullStreams | null = null;
let currentDone: Promise<Done> | null = null;
await page.exposeBinding("__nativeWrite", async (_s, b64: string) => {
    const buf = Buffer.from(b64, "base64");
    if (!current!.stdin.write(buf)) await new Promise((r) => current!.stdin.once("drain", r));
});
await page.exposeBinding("__nativeFinish", async () => {
    current!.stdin.end();
    await currentDone;
});
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 60_000 });
await page.evaluate((m) => (window as any).bench.setManifest(m), manifest);

async function native(doc: string, file: string, tee: string) {
    const run = runSidecar(["--out", file, "--tee", tee]);
    current = run.child;
    currentDone = run.done;
    const page_ = await page.evaluate(([d, o]) => (window as any).bench.native(d, o), [doc, { scale, supersample, effects: info.effects }] as const);
    const done = await run.done;
    return { page: page_ as { ms: number; sent: number; writeMs: number; firstFrameAt: number }, done };
}

async function webcodecs(doc: string, file: string) {
    const r = await page.evaluate(([d, o]) => (window as any).bench.webcodecs(d, o), [doc, { scale, supersample }] as const) as { ms: number; file: string };
    fs.writeFileSync(file, Buffer.from(r.file, "base64"));
    return r.ms;
}

// Warm both paths (WASM, device, pipelines, sidecar's driver caches) on the first scene.
{
    const { doc } = await documentOf(scenes[0]);
    const json = JSON.stringify({ ...(doc as object), tracks: (doc as { tracks: unknown[] }).tracks.slice(0, 1) });
    await webcodecs(json, path.join(outDir, "warm.web.mp4"));
    await native(json, path.join(outDir, "warm.native.mp4"), path.join(outDir, "warm.stream"));
}

const rows: Record<string, unknown>[] = [];
for (const id of scenes) {
    const { doc, frames } = await documentOf(id);
    const json = JSON.stringify(doc);
    const webFile = path.join(outDir, `${id}.web.mp4`);
    const nativeFile = path.join(outDir, `${id}.native.mp4`);
    const stream = path.join(outDir, `${id}.stream`);
    try {
        const webMs = await webcodecs(json, webFile);
        const n = await native(json, nativeFile, stream);
        const replay = await runSidecar(["--input", stream, "--out", path.join(outDir, `${id}.replay.mp4`)]).done;
        const renderOnly = await runSidecar(["--input", stream, "--out", path.join(outDir, `${id}.none.mp4`), "--no-encode"]).done;
        const jsOnly = await page.evaluate(([d, o]) => (window as any).bench.native(d, o), [json, { scale, supersample, effects: info.effects, discard: true }] as const) as { ms: number };
        const q = quality(webFile, nativeFile);
        const row = {
            scene: id,
            frames,
            webFps: +(frames / (webMs / 1000)).toFixed(1),
            webS: +(webMs / 1000).toFixed(2),
            nativeFps: +(frames / (n.page.ms / 1000)).toFixed(1),
            nativeS: +(n.page.ms / 1000).toFixed(2),
            speedup: +(webMs / n.page.ms).toFixed(2),
            jsOnlyFps: +(frames / (jsOnly.ms / 1000)).toFixed(1),
            replayFps: +replay.fps.toFixed(1),
            renderOnlyFps: +renderOnly.fps.toFixed(1),
            streamKBPerFrame: +(n.done.streamBytes / 1024 / frames).toFixed(1),
            transportMs: +n.page.writeMs.toFixed(0),
            encoder: n.done.encoder,
            psnr: q.psnr,
            ssim: q.ssim,
            webFrames: frameCount(webFile),
            nativeFrames: frameCount(nativeFile),
            webMB: +(fs.statSync(webFile).size / 1e6).toFixed(2),
            nativeMB: +(fs.statSync(nativeFile).size / 1e6).toFixed(2),
            sidecar: { renderMs: n.done.renderMs, applyMs: n.done.applyMs, readbackWaitMs: n.done.readbackWaitMs, imageUploadMs: n.done.imageUploadMs, encodeTailS: n.done.encodeTailSeconds },
        };
        rows.push(row);
        console.log(JSON.stringify(row));
    } catch (e) {
        console.log(`${id}: FAILED ${(e as Error).message}`);
        rows.push({ scene: id, error: (e as Error).message });
    }
    if (!argv.includes("--keep")) fs.rmSync(stream, { force: true });
}
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ scale, supersample, repeat, adapter: info.adapter, rows }, null, 2));
await browser.close();
server.close();

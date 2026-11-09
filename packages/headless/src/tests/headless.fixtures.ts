import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { TestContext } from 'vitest';
import { isEngineError } from '../errors.js';

/**
 * Shared by the tests that boot a project: a scratch project directory, the
 * entries and documents they render, a PNG reader and writer so a frame is
 * asserted by the colour it holds, not by a byte count, and an MP4 table reader.
 */

/** How long a test that boots Chromium may take. */
export const BOOT_TIMEOUT_MS = 60_000;

/**
 * A video is H.264, and not every Chromium can encode it. Where this one cannot
 * the test is skipped with the reason and a warning is printed; with
 * `REQUIRE_ENCODERS=1` it fails instead, as the browser package's suites do.
 */
const REQUIRE_ENCODERS = process.env.REQUIRE_ENCODERS === '1';
const MISSING_ENCODER = /encod|codec|avc|h\.?264/i;

export async function videoOrSkip(context: TestContext, work: Promise<Uint8Array>): Promise<Uint8Array> {
    try {
        return await work;
    } catch (error) {
        if (!REQUIRE_ENCODERS && !isEngineError(error) && MISSING_ENCODER.test((error as Error).message)) {
            const reason = `renderVideo needs an H.264 encoder and this Chromium has none (${(error as Error).message.split('\n')[0]})`;
            console.warn(`[skipped] ${reason}. Set REQUIRE_ENCODERS=1 to fail instead.`);
            context.skip(reason);
        }
        throw error;
    }
}

export interface ScratchProject {
    /** The project root. */
    readonly dir: string;
    /** `<dir>/src/project.ts`, the default entry. */
    readonly entry: string;
    /** Where the bundle is cached, inside {@link dir}. */
    readonly cacheDir: string;
    /** `<dir>/public`, the default assets directory. */
    readonly assetsDir: string;
    /** Replace the entry's source. */
    writeEntry(source: string): void;
    /** Write a file under {@link assetsDir}. */
    writeAsset(name: string, bytes: Uint8Array | string): string;
    remove(): void;
}

export function scratchProject(prefix: string): ScratchProject {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ms-headless-${prefix}-`));
    const entry = path.join(dir, 'src', 'project.ts');
    const assetsDir = path.join(dir, 'public');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    return {
        dir,
        entry,
        cacheDir: path.join(dir, 'cache'),
        assetsDir,
        writeEntry(source) {
            fs.writeFileSync(entry, source);
        },
        writeAsset(name, bytes) {
            const file = path.join(assetsDir, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, bytes);
            return file;
        },
        remove() {
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}

/** An entry that registers nothing and has no default project, so a request has to bring its document. */
export const BARE_ENTRY = 'export const nodes = [];\n';

/** The key the source-string component below declares for itself. */
export const SOURCE_NODE_KEY = 'greenBox';

/** A component whose source is a string, compiled inside the page: it fills its parent with green. */
const GREEN_BOX_SOURCE = `
    import { component2d, Rect } from "@motionscript/sdk";

    export default component2d({
        key: "${SOURCE_NODE_KEY}",
        children: () => [Rect({ width: "fill", height: "fill", fill: "#00ff00" })],
    });
`;

/** The default project's shape: 10 frames at 10 fps in 32 by 24 pixels, two tracks. */
export const DEFAULT_PROJECT = {
    name: 'scratch',
    fps: 10,
    viewport: { width: 32, height: 24 },
    trackIds: ['back', 'front'],
    totalFrames: 10,
} as const;

/** The scene's own `canvas2d` row. */
function root(fill: string) {
    return { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill } };
}

/** A black scene with a red 8 by 8 square that slides 10 pixels to the right over one second. */
export function slidingSquareClip() {
    return {
        kind: 'composition' as const,
        nodes: [
            root('#000000'),
            { id: 'sq', type: 'rect', parentId: null, layerOrder: 0, props: { width: 8, height: 8, fill: '#ff0000' } },
        ],
        commands: [{ id: 'slide', type: 'to', targetId: 'sq', at: 0, duration: 1, args: { x: 10 } }],
    };
}

/** One track around {@link slidingSquareClip}, at the default project's size and rate. */
export function slidingSquareProject() {
    return {
        kind: 'project' as const,
        name: 'sliding',
        fps: DEFAULT_PROJECT.fps,
        viewport: DEFAULT_PROJECT.viewport,
        tracks: [{ id: 'main', duration: 1, clip: slidingSquareClip() }],
    };
}

/** A still: a scene filled with `fill`, plus `children`. */
export function stillOf(fill: string, children: object[] = []) {
    return { kind: 'still' as const, nodes: [root(fill), ...children] };
}

/** An entry with a default project of two tracks and a source-string node. */
export function richEntry(): string {
    const project = {
        kind: 'project',
        name: DEFAULT_PROJECT.name,
        fps: DEFAULT_PROJECT.fps,
        viewport: DEFAULT_PROJECT.viewport,
        tracks: [
            { id: 'back', duration: 1, clip: slidingSquareClip() },
            {
                id: 'front',
                duration: 0.5,
                clip: { kind: 'composition', nodes: [root('#0000ff')], commands: [] },
            },
        ],
    };
    return [
        `const greenBox = ${JSON.stringify(GREEN_BOX_SOURCE)};`,
        'export const nodes = [greenBox];',
        `export default ${JSON.stringify(project)};`,
        '',
    ].join('\n');
}

/** An entry whose only node is a source string that cannot compile. */
export const BROKEN_SOURCE_ENTRY = [
    'export const nodes = [\'import { component2d } from "@motionscript/sdk"; export default component2d({{{\'];',
    '',
].join('\n');

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
    width: number;
    height: number;
    /** The `[r, g, b, a]` at a pixel. */
    pixel(x: number, y: number): [number, number, number, number];
}

/** Read an 8-bit RGB or RGBA, non-interlaced PNG: what the engine's encoder writes. */
export function decodePng(bytes: Uint8Array): DecodedPng {
    const buffer = Buffer.from(bytes);
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG.');
    let width = 0;
    let height = 0;
    let colorType = -1;
    const data: Buffer[] = [];
    for (let at = 8; at < buffer.length;) {
        const length = buffer.readUInt32BE(at);
        const type = buffer.toString('latin1', at + 4, at + 8);
        const body = buffer.subarray(at + 8, at + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            if (body[8] !== 8 || body[12] !== 0) throw new Error('Only 8-bit, non-interlaced PNGs are read.');
            colorType = body[9];
        } else if (type === 'IDAT') {
            data.push(body);
        }
        at += 12 + length;
    }
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
    if (channels === 0) throw new Error(`PNG colour type ${colorType} is not read.`);

    const raw = zlib.inflateSync(Buffer.concat(data));
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const left = x >= channels ? pixels[y * stride + x - channels] : 0;
            const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
            let predicted = 0;
            if (filter === 1) predicted = left;
            else if (filter === 2) predicted = up;
            else if (filter === 3) predicted = (left + up) >> 1;
            else if (filter === 4) predicted = paeth(left, up, upLeft);
            else if (filter !== 0) throw new Error(`PNG filter ${filter} is not read.`);
            pixels[y * stride + x] = (line[x] + predicted) & 0xff;
        }
    }
    return {
        width,
        height,
        pixel(x, y) {
            const at = y * stride + x * channels;
            return [pixels[at], pixels[at + 1], pixels[at + 2], channels === 4 ? pixels[at + 3] : 255];
        },
    };
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/** A PNG of one colour, to serve as an image asset without a binary file in the tree. */
export function solidPng(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Buffer {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            raw.set([r, g, b, a], y * (stride + 1) + 1 + x * 4);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
        PNG_SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function chunk(type: string, body: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** Seconds, from an MP4's `mvhd` box; `NaN` for a container without one. */
export function mp4Seconds(bytes: Uint8Array): number {
    const buffer = Buffer.from(bytes);
    const at = buffer.indexOf('mvhd', 0, 'latin1');
    if (at < 0) return NaN;
    const version = buffer.readUInt8(at + 4);
    const timescale = version === 1 ? buffer.readUInt32BE(at + 24) : buffer.readUInt32BE(at + 16);
    const duration = version === 1 ? Number(buffer.readBigUInt64BE(at + 28)) : buffer.readUInt32BE(at + 20);
    return duration / timescale;
}

export interface Mp4Track {
    /** The handler type: `vide`, `soun`, … */
    handler: string;
    samples: number;
    /** The media duration in its header. */
    seconds: number;
    /** Zero-based indices of the sync samples; every sample when the track has no `stss`. */
    keyFrames: number[];
    /** Encoded bytes across every sample. */
    bytes: number;
}

interface Mp4Box {
    type: string;
    body: number;
    end: number;
}

/** The tracks of a non-fragmented MP4, read off its sample tables. */
export function mp4Tracks(bytes: Uint8Array): Mp4Track[] {
    const buffer = Buffer.from(bytes);
    const moov = boxChild(buffer, { type: '', body: 0, end: buffer.length }, 'moov');
    return boxChildren(buffer, moov).filter((box) => box.type === 'trak').map((trak) => {
        const mdia = boxChild(buffer, trak, 'mdia');
        const hdlr = boxChild(buffer, mdia, 'hdlr');
        const mdhd = boxChild(buffer, mdia, 'mdhd');
        const stbl = boxChild(buffer, boxChild(buffer, mdia, 'minf'), 'stbl');
        const stsz = boxChild(buffer, stbl, 'stsz');
        const stss = boxChildren(buffer, stbl).find((box) => box.type === 'stss');

        const v1 = buffer[mdhd.body] === 1;
        const timescale = buffer.readUInt32BE(mdhd.body + (v1 ? 20 : 12));
        const duration = v1 ? Number(buffer.readBigUInt64BE(mdhd.body + 24)) : buffer.readUInt32BE(mdhd.body + 16);
        const sampleSize = buffer.readUInt32BE(stsz.body + 4);
        const samples = buffer.readUInt32BE(stsz.body + 8);
        let total = sampleSize * samples;
        if (sampleSize === 0) for (let i = 0; i < samples; i++) total += buffer.readUInt32BE(stsz.body + 12 + 4 * i);
        const keyFrames = stss
            ? Array.from({ length: buffer.readUInt32BE(stss.body + 4) }, (_, i) => buffer.readUInt32BE(stss.body + 8 + 4 * i) - 1)
            : Array.from({ length: samples }, (_, i) => i);
        return {
            handler: buffer.toString('latin1', hdlr.body + 8, hdlr.body + 12),
            samples,
            seconds: duration / timescale,
            keyFrames,
            bytes: total,
        };
    });
}

function boxChildren(buffer: Buffer, parent: Mp4Box): Mp4Box[] {
    const out: Mp4Box[] = [];
    for (let at = parent.body; at + 8 <= parent.end;) {
        let size = buffer.readUInt32BE(at);
        let body = at + 8;
        if (size === 1) {
            size = Number(buffer.readBigUInt64BE(at + 8));
            body = at + 16;
        } else if (size === 0) {
            size = parent.end - at;
        }
        out.push({ type: buffer.toString('latin1', at + 4, at + 8), body, end: at + size });
        at += size;
    }
    return out;
}

function boxChild(buffer: Buffer, parent: Mp4Box, type: string): Mp4Box {
    const found = boxChildren(buffer, parent).find((box) => box.type === type);
    if (!found) throw new Error(`No ${type} box.`);
    return found;
}

/** A 16-bit stereo WAV of a sine tone, to serve as an audio asset. */
export function toneWav(seconds: number, hz = 440, rate = 44100): Buffer {
    const frames = Math.round(seconds * rate);
    const data = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i++) {
        const sample = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.5 * 32767);
        data.writeInt16LE(sample, i * 4);
        data.writeInt16LE(sample, i * 4 + 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8, 'latin1');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'latin1');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/** Whether the bytes are a PNG, by its eight-byte signature. */
export function isPng(bytes: Uint8Array): boolean {
    return Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE);
}

/** Whether the bytes are a JPEG, by its start-of-image marker. */
export function isJpeg(bytes: Uint8Array): boolean {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export interface PageMessage {
    type: string;
    text: string;
}

/** A collector for `onPageMessage`. The GL driver adds warnings of its own, so ask for yours by pattern. */
export function pageMessages() {
    const all: PageMessage[] = [];
    return {
        all,
        onPageMessage: (message: PageMessage) => {
            all.push(message);
        },
        matching(pattern: RegExp): PageMessage[] {
            return all.filter((message) => pattern.test(message.text));
        },
    };
}

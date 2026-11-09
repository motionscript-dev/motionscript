/**
 * Snapshot the documents this release writes into core's fixture corpus,
 * `packages/core/test/fixtures/documents/<core version>/`, which core's
 * `fixture-corpus.test.ts` migrates, validates and builds forever after.
 *
 *   pnpm --filter @motionscript/e2e exec tsx scripts/snapshot-document-fixtures.ts [--unstamped] [--force]
 *
 * Two groups: `e2e/`, every scene whose node types and commands are all core's
 * own, as the harness opens it (a one-track project with the e2e theme); and
 * `coverage/`, documents written here to reach what the scenes do not: every
 * built-in node type, every command family, stills, audio, variables and
 * expressions. `vocabulary.json` beside them records every built-in type's props,
 * defaults and commands as they stood. A set once written is frozen: rerunning refuses to touch it
 * without `--force`, which is only for the release that made it.
 *
 * `--unstamped` writes no `formatVersion`, as releases before the field did.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DOCUMENT_FORMAT_VERSION,
    Registry,
    type AudioDocument,
    type ClipDocument,
    type CommandSpec,
    type CompositionDocument,
    type ProjectDocument,
    type StillDocument,
    type TimedNodeSpec,
} from '@motionscript/sdk';
// A project validator is host API, so it comes from core rather than the authoring surface.
import { registryVocabulary, validateProjectDocument } from '@motionscript/core';
import { catalog } from '../src/scenes/catalog';
import { projectOf, THEME, FPS, VIEWPORT } from '../src/project';

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(here, '../../core');
const args = new Set(process.argv.slice(2));
const version = (JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { version: string }).version;
const out = join(coreRoot, 'test/fixtures/documents', version);

if (existsSync(out) && !args.has('--force')) {
    console.error(`${out} exists. A fixture set is frozen once written; pass --force only for the release that made it.`);
    process.exit(1);
}

const registry = new Registry();
const stamp = <T extends ProjectDocument>(doc: T): T =>
    (args.has('--unstamped') ? doc : { ...doc, formatVersion: DOCUMENT_FORMAT_VERSION });

/** Written once every document has validated, so a failure leaves no half-written set. */
const pending: { file: string; doc: ProjectDocument }[] = [];

function write(group: string, id: string, doc: ProjectDocument): void {
    const issues = validateProjectDocument(doc, { registry }).issues;
    if (issues.length > 0) throw new Error(`${group}/${id} does not validate:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
    pending.push({ file: join(out, group, `${id}.json`), doc: stamp(doc) });
}

// ─── e2e scenes ───────────────────────────────────────────────────────────────

/** Scenes that name a shader pack only the e2e project registers. */
const NEEDS_E2E_SHADERS = new Set(['effect-shader-named']);

let kept = 0;
const skipped: string[] = [];
for (const entry of catalog) {
    const clip = (await entry.load()).default;
    const doc = projectOf(entry.id, clip);
    const foreign = validateProjectDocument(doc, { registry }).issues.length > 0 || NEEDS_E2E_SHADERS.has(entry.id);
    if (foreign) {
        skipped.push(entry.id);
        continue;
    }
    write('e2e', entry.id, doc);
    kept++;
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

let rows = 0;
function row(type: string, props: Record<string, unknown> = {}, parentId: string | null = null, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec {
    return { id: `${type}-${rows++}`, type, parentId, layerOrder: rows, props, ...extra };
}

let commandCount = 0;
function command(type: string, targetId: string | null, at: number, args: Record<string, unknown> = {}, extra: Partial<CommandSpec> = {}): CommandSpec {
    return { id: `c${commandCount++}`, type, targetId, at, duration: 0.5, args, ...extra };
}

function project(id: string, ...clips: ClipDocument[]): ProjectDocument {
    return {
        kind: 'project',
        name: id,
        fps: FPS,
        viewport: VIEWPORT,
        theme: THEME,
        tracks: clips.map((clip, i) => ({ id: `${id}-${i}`, clip, startAt: i * 0.5, duration: 2 })),
    };
}

const fills = [
    'primary',
    { type: 'linear-gradient', colors: ['#ff0000', '#0000ff'], angle: 45 },
    { type: 'radial-gradient', colors: ['white', 'black/50'] },
];

// Every 2D built-in in one still, with paints, effects and bound props.
{
    const group = row('rect', { width: 600, height: 400, flow: 'row', gap: 8, padding: 12, fill: fills, cornerRadius: 12 });
    const card = row('rect', { width: 120, height: 80, fill: '=[tint]', stroke: { weight: 2, fill: 'accent' }, shadow: { blur: 8, y: 4, color: 'black/40' } }, group.id, { key: 'card' });
    const boolean = row('boolean', { op: 'subtract', fill: 'accent' }, group.id);
    const mask = row('mask', { mode: 'alpha' }, group.id);
    const camera = row('camera', { width: 200, height: 120, zoom: 1.5 }, group.id);
    const theme = row('theme-provider', { theme: { colors: { ink: '#ffcc00' } } }, group.id);
    const textStyle = row('default-text-style', { fontSize: 18, fill: 'white' }, theme.id);
    const still: StillDocument = {
        kind: 'still',
        variables: [{ id: 'tint', value: '#44aa88' }, { id: 'size', value: 24 }],
        nodes: [
            { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: 'bg' } },
            group,
            card,
            row('ellipse', { width: 80, height: 80, fill: 'primary', sweep: 270, ratio: 0.5 }, group.id),
            row('polygon', { width: 80, height: 80, sides: 6, fill: 'accent', cornerRadius: 6 }, group.id),
            row('polygram', { width: 80, height: 80, points: 5, ratio: 0.5, fill: 'primary' }, group.id),
            row('path', { width: 80, height: 80, data: 'M0 0 L1 0 L0.5 1 Z', fill: 'accent' }, group.id),
            boolean,
            row('rect', { width: 60, height: 60 }, boolean.id),
            row('ellipse', { width: 40, height: 40 }, boolean.id),
            mask,
            row('ellipse', { width: 60, height: 60 }, mask.id),
            row('rect', { width: 60, height: 60, fill: fills[1] }, mask.id),
            camera,
            row('rect', { width: 40, height: 40, fill: 'primary', x: '=[card.x] + 10' }, camera.id),
            row('orbitCamera', { orbit: 20, elevation: 10 }, group.id),
            row('rotated-box', { angle: 45 }, group.id),
            row('provider', {}, group.id),
            theme,
            textStyle,
            row('text', { text: 'Hello', fill: 'ink', fontSize: '=[size]', effects: [{ type: 'glow', radius: 6 }] }, textStyle.id),
            row('richtext', { spans: [{ text: 'Rich ' }, { text: 'text', fontWeight: 700 }] }, theme.id),
            row('number', { value: 1234.5, format: 'currency', fractionDigits: 2 }, theme.id),
            row('rect', { width: 60, height: 60, fill: 'card', blend: 'multiply', opacity: 0.8, effects: [{ type: 'blur', radius: 4 }] }, group.id),
        ],
    };
    write('coverage', 'still-2d', project('still-2d', still));
}

// One composition reaching every command family a 2D node, the root and a variable publish.
{
    const box = row('rect', { width: 80, height: 80, fill: 'primary' }, null, { key: 'box' });
    const shape = row('ellipse', { width: 80, height: 80, fill: 'accent', stroke: { weight: 2, fill: 'white' } });
    const late = row('rect', { width: 40, height: 40, fill: 'card', x: '=[box.x]' }, null, { startAt: 1, endAt: 3 });
    const text = row('text', { text: 'Hi', fontSize: 24, fill: 'white' });
    const count = row('number', { value: 0, fontSize: 24, fill: 'white' });
    const camera = row('camera', { width: 300, height: 200 });
    const orbit = row('orbitCamera', {});
    const ease = (kind: string, extra: Record<string, unknown> = {}) => ({ easing: { kind, ...extra } as CommandSpec['easing'] });
    const comp: CompositionDocument = {
        kind: 'composition',
        duration: 4,
        variables: [{ id: 'progress', value: 0 }, { id: 'tint', value: '#ff0000', lerp: 'color' }],
        nodes: [
            { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: 'bg', opacity: '=[progress] * 0.5 + 0.5' } },
            box, shape, late, text, count, camera, orbit,
        ],
        commands: [
            command('moveTo', box.id, 0, { x: 120, y: -40 }, ease('inOut')),
            command('fadeTo', box.id, 0.5, { opacity: 0.4 }, ease('out', { args: 3 })),
            command('rotateTo', box.id, 1, { rotation: 90 }, { loop: { count: 2, direction: 'alternate' } }),
            command('scaleTo', box.id, 1.5, { scale: 1.4 }, ease('custom', { args: [{ x: 0, y: 0 }, { x: 0.3, y: 0.8 }, { x: 1, y: 1 }] })),
            command('layoutTo', box.id, 2, { width: 120 }),
            command('pulse', box.id, 2.5, { factor: 1.2 }),
            command('wiggle', box.id, 3, { angle: 10, turns: 2 }),
            command('flash', shape.id, 0, { portion: 0.3 }),
            command('effectTo', shape.id, 0.5, { effects: [{ type: 'blur', radius: 6 }] }),
            command('fillTo', shape.id, 1, { fill: 'primary' }),
            command('strokeTo', shape.id, 1.5, { stroke: { weight: 4, fill: 'accent' } }),
            command('shadowTo', shape.id, 2, { shadow: { blur: 10, color: 'black/50' } }),
            command('overlayTo', shape.id, 2.5, { overlay: 'white/20' }),
            command('progressTo', shape.id, 3, { start: 0.2, end: 0.8 }),
            command('to', late.id, 1, { y: 60, fill: 'accent' }),
            command('set', late.id, 2, { opacity: '=[progress]' }, { duration: 0 }),
            command('save', box.id, 3.5, {}, { duration: 0 }),
            command('restore', box.id, 3.8, {}, { duration: 0 }),
            command('append', text.id, 0, { text: ' there' }),
            command('prepend', text.id, 1, { text: 'Oh, ' }),
            command('countTo', count.id, 0, { value: 99 }, { duration: 2 }),
            command('zoomTo', camera.id, 0, { zoom: 2 }),
            command('panTo', camera.id, 0.5, { lookAt: { x: 20, y: 10 } }),
            command('headingTo', camera.id, 1, { heading: 15 }),
            command('orbitTo', orbit.id, 0, { orbit: 30, elevation: 15 }),
            command('dollyTo', orbit.id, 1, { dolly: 0.5 }),
            command('zoomTo', null, 2, { zoom: 1.2 }),
            command('variableTo', 'progress', 0, { value: 1 }, { duration: 3 }),
            command('variableTo', 'tint', 0, { value: '#0000ff' }, { duration: 2 }),
            command('variableSet', 'progress', 3.5, { value: 0.25 }, { duration: 0 }),
        ],
    };
    write('coverage', 'composition-commands', project('composition-commands', comp));
}

// Every 3D built-in under a viewport, with the 3D commands.
{
    const view = row('canvas3d', { width: 800, height: 450 });
    const group = row('group3d', { y: 0.5 }, view.id);
    const camera = row('camera3d', { orbit: 30, elevation: 20, distance: 6 }, view.id);
    const cube = row('box3d', { fill: 'primary' }, group.id);
    const three = [
        'sphere3d', 'plane3d', 'circle3d', 'cylinder3d', 'cone3d', 'capsule3d', 'torus3d', 'torus-knot3d', 'ring3d',
        'polyhedron3d', 'points3d', 'sprite3d', 'instances3d', 'mesh3d',
    ].map((type, i) => row(type, { x: (i % 5) - 2, z: Math.floor(i / 5) - 1 }, group.id));
    const comp: CompositionDocument = {
        kind: 'composition',
        duration: 2,
        nodes: [
            { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: { fill: 'bg' } },
            view, group, camera, cube, ...three,
            row('lathe3d', { points: [[0, 0], [0.5, 0.5], [0.2, 1]] }, group.id),
            row('tube3d', { points: [[0, 0, 0], [1, 1, 0], [2, 0, 1]], radius: 0.1 }, group.id),
            row('extrude3d', { path: 'M0 0 L1 0 L1 1 Z', depth: 0.2 }, group.id),
            row('line3d', { points: [[0, 0, 0], [1, 1, 1]], stroke: { color: 'accent', width: 2 } }, group.id),
            row('ambient-light3d', { intensity: 0.3 }, view.id),
            row('directional-light3d', { x: 2, y: 4, z: 3 }, view.id),
            row('point-light3d', { y: 2 }, view.id),
            row('spot-light3d', { y: 3 }, view.id),
            row('hemisphere-light3d', {}, view.id),
            row('area-light3d', {}, view.id),
            row('fog3d', { color: 'bg', near: 4, far: 20 }, view.id),
            row('environment3d', { preset: 'studio' }, view.id),
            row('model3d', { src: 'robot.glb', scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 }, group.id),
        ],
        commands: [
            command('moveTo', cube.id, 0, { x: 1, y: 0.5, z: 0 }),
            command('rotateTo', cube.id, 0.5, { rotationY: 90 }),
            command('scaleTo', cube.id, 1, { scale: 1.5 }),
            command('orbitTo', camera.id, 0, { orbit: 90, elevation: 30 }, { duration: 2 }),
            command('lookTo', camera.id, 1, { target: [0, 1, 0] }),
            command('orbitTo', view.id, 0, { orbit: 10 }),
        ],
    };
    write('coverage', 'three', project('three', comp));
}

// Sound as its own clip, and inside a composition.
{
    const bus = row('audioBus', { volume: 0.8 });
    const sound = row('sound', { src: 'music.mp3', volume: { keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] } }, bus.id, { startAt: 0.5 });
    const audio: AudioDocument = {
        kind: 'audio',
        duration: 2,
        nodes: [{ id: '', type: 'audioBus', parentId: null, layerOrder: 0, props: {} }, bus, sound],
        commands: [command('to', bus.id, 1, { mute: true }, { duration: 0 })],
    };
    const clipBus = row('audioBus', { pan: -0.2 });
    const clipSound = row('sound', { src: 'click.wav' }, clipBus.id);
    const video = row('video', { src: 'clip.mp4', width: 320, height: 180 });
    const withSound: CompositionDocument = {
        kind: 'composition',
        duration: 2,
        nodes: [{ id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: {} }, clipBus, clipSound, video],
        commands: [command('play', clipSound.id, 0.5, {}, { duration: 0.5 }), command('play', video.id, 0, { from: 0, volume: 0.5 }, { duration: 2 })],
    };
    write('coverage', 'audio', project('audio', audio, withSound));
}

if (existsSync(out)) rmSync(out, { recursive: true });
for (const { file, doc } of pending) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
// What the corpus test diffs the next release against: a removed prop or a changed default is breaking.
writeFileSync(join(out, 'vocabulary.json'), `${JSON.stringify(registryVocabulary(registry), null, 2)}\n`);

console.log(`Wrote ${kept} e2e scenes and the coverage set to ${out}.`);
console.log(`Skipped ${skipped.length} scenes naming types or packs core lacks: ${skipped.join(', ')}`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { isEngineError } from '../errors.js';
import { bundlePage } from '../page-bundle.js';
import { MotionScriptServerEngine, type ServerEngineOptions } from '../server-engine.js';
import {
    BARE_ENTRY,
    BOOT_TIMEOUT_MS,
    BROKEN_SOURCE_ENTRY,
    DEFAULT_PROJECT,
    richEntry,
    scratchProject,
    type ScratchProject,
} from './headless.fixtures.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * How an engine boots, through a real headless Chromium: what it finds, what it
 * says when the project cannot start, and what a failed start leaves behind.
 * Boots that fail do so before the renderer loads, so they cost a launch and little more.
 */
describe('booting an engine', () => {
    let project: ScratchProject;
    let engine: MotionScriptServerEngine | undefined;
    let launch: MockInstance<typeof chromium.launch>;

    const engineFor = (options: ServerEngineOptions = {}) => {
        engine = new MotionScriptServerEngine({
            projectRoot: project.dir,
            cacheDir: project.cacheDir,
            softwareRender: true,
            onPageMessage: () => undefined,
            ...options,
        });
        return engine;
    };

    /** The browsers `chromium.launch` handed out, in order. */
    const launchedBrowsers = () => Promise.all(launch.mock.results.map((result) => result.value as ReturnType<typeof chromium.launch>));

    beforeEach(() => {
        project = scratchProject('boot');
        launch = vi.spyOn(chromium, 'launch');
    });

    afterEach(async () => {
        await engine?.close();
        engine = undefined;
        vi.restoreAllMocks();
        project.remove();
    });

    describe('start()', () => {
        it('starts a project whose first import is the SDK, as a kit-only project\'s is', { timeout: BOOT_TIMEOUT_MS }, async () => {
            // A junction on Windows: a directory symlink needs Developer Mode or an elevated shell there.
            fs.symlinkSync(path.join(packageRoot, 'node_modules'), path.join(project.dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
            project.writeEntry('export { Rect } from "@motionscript/core/sdk";\nexport const nodes = [];\n');
            const subject = engineFor();

            await subject.start();

            expect(subject.started).toBe(true);
        });

        it('shares one boot between callers, and between the methods that start the engine themselves', { timeout: BOOT_TIMEOUT_MS }, async () => {
            // The default path holds an entry that throws, so the boot can only succeed from `entry`.
            project.writeEntry('throw new Error("the default entry must not be read");\n');
            const other = path.join(project.dir, 'other', 'entry.ts');
            fs.mkdirSync(path.dirname(other), { recursive: true });
            fs.writeFileSync(other, BARE_ENTRY);
            const subject = engineFor({ entry: other });

            const first = subject.start();
            const second = subject.start();
            expect(second).toBe(first);
            const [tracks, name, fps] = await Promise.all([subject.listTracks(), subject.projectName(), subject.fps(), first]);

            expect(launch).toHaveBeenCalledTimes(1);
            expect(subject.started).toBe(true);
            // An entry that exports only code has no default project to describe.
            expect([tracks, name, fps]).toEqual([[], '', 0]);
            // Started: a further call is already done and launches nothing.
            await subject.start();
            expect(launch).toHaveBeenCalledTimes(1);
        });

        it('says PROJECT_NOT_FOUND, naming the default entry path, without launching a browser', async () => {
            const subject = engineFor();

            const failure = await subject.start().then(() => null, (error: unknown) => error);
            expect(isEngineError(failure)).toBe(true);
            expect(failure).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
            expect((failure as Error).message).toContain(path.join(project.dir, 'src', 'project.ts'));
            expect(launch).not.toHaveBeenCalled();
            expect(subject.started).toBe(false);
        });

        it('says START_FAILED, with the compiler\'s message, for a source node that does not compile, and starts on retry once it does', { timeout: BOOT_TIMEOUT_MS }, async () => {
            project.writeEntry(BROKEN_SOURCE_ENTRY);
            const subject = engineFor();

            const failure = await subject.start().then(() => null, (error: unknown) => error);
            expect(isEngineError(failure)).toBe(true);
            expect(failure).toMatchObject({ code: 'START_FAILED' });
            expect((failure as Error).message).toMatch(/^The project entry failed to load: /);
            expect((failure as Error).message).toMatch(/Transform failed|Expected|Unexpected|error/i);
            expect(subject.started).toBe(false);
            const [failed] = await launchedBrowsers();
            expect(failed.isConnected()).toBe(false);

            // The same engine, a fixed entry: the failure was not remembered.
            project.writeEntry(richEntry());
            await subject.start();

            expect(launch).toHaveBeenCalledTimes(2);
            expect(subject.started).toBe(true);
            expect(await subject.listTracks()).toEqual([...DEFAULT_PROJECT.trackIds]);
            expect(await subject.projectName()).toBe(DEFAULT_PROJECT.name);
            expect(await subject.fps()).toBe(DEFAULT_PROJECT.fps);
        });

        it('says BRIDGE_INCOMPATIBLE, listing what is missing, when a stale cached bundle publishes an older bridge', { timeout: BOOT_TIMEOUT_MS }, async () => {
            project.writeEntry(BARE_ENTRY);
            // Learn which file the cache keeps this entry's bundle in, then leave an older one there.
            await bundlePage({ entry: project.entry, cacheDir: project.cacheDir });
            const [cached] = fs.readdirSync(project.cacheDir);
            fs.writeFileSync(path.join(project.cacheDir, cached), [
                "document.documentElement.setAttribute('data-motion-script', 'ready');",
                'globalThis.__motionScript = { projectName: "", fps: 0, listTracks() { return []; } };',
            ].join('\n'));
            const subject = engineFor();

            const failure = await subject.start().then(() => null, (error: unknown) => error);
            expect(isEngineError(failure)).toBe(true);
            expect(failure).toMatchObject({ code: 'BRIDGE_INCOMPATIBLE' });
            expect((failure as Error).message).toBe('The page bridge is missing: screenshot(), exportVideo(), countFrames(), concatSegments().');
            expect(subject.started).toBe(false);
            const [stale] = await launchedBrowsers();
            expect(stale.isConnected()).toBe(false);
        });
    });
});

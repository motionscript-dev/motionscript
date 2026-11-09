import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEngineError } from '../errors.js';
import { MotionScriptServerEngine } from '../server-engine.js';

/**
 * A project entry that throws while it loads must surface as `START_FAILED` with
 * the cause, at once. The synthetic entry used to import the project statically,
 * so the throw ran before `installBridge` and escaped the catch that sets the
 * `failed` attribute: `start()` then waited out the whole bridge timeout and
 * reported `BRIDGE_TIMEOUT`, with the real cause only on stderr.
 *
 * This launches Chromium (the failure happens before the renderer loads, so it is
 * quick); the page is the only place the load can fail.
 */
describe('a project entry that throws on load', () => {
    let dir: string;
    let engine: MotionScriptServerEngine | undefined;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-headless-entry-'));
    });

    afterEach(async () => {
        await engine?.close();
        engine = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects start() with START_FAILED naming the cause', { timeout: 45_000 }, async () => {
        const entry = path.join(dir, 'src', 'project.ts');
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, "throw new Error('entry blew up on load');\nexport const nodes = [];\n");

        const messages: string[] = [];
        engine = new MotionScriptServerEngine({
            entry,
            projectRoot: dir,
            cacheDir: path.join(dir, 'cache'),
            onPageMessage: (m) => messages.push(m.text),
        });

        const failure = await engine.start().then(() => null, (err: unknown) => err);
        expect(isEngineError(failure)).toBe(true);
        expect(failure).toMatchObject({ code: 'START_FAILED' });
        expect((failure as Error).message).toContain('entry blew up on load');
    });
});

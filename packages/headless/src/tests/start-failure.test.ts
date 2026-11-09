import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEngineError } from '../errors.js';

/**
 * `start()` is documented as retryable, so a failed boot must own nothing: the
 * browser it launched is closed, the next `start()` launches its own, and a
 * `close()` that lands mid-boot ends the boot rather than letting it finish on a
 * closed engine. Playwright is replaced so each case is exact and fast.
 */
const launched: FakeBrowser[] = [];
let launchGate: Promise<void> | null = null;
let pageFailure: Error | null = null;
let launchEntered = false;

interface FakeBrowser {
    closed: boolean;
    newPage(): Promise<unknown>;
    close(): Promise<void>;
}

function fakeBrowser(): FakeBrowser {
    const browser: FakeBrowser = {
        closed: false,
        async newPage() {
            if (pageFailure) throw pageFailure;
            throw new Error('unexpected: the test stops the boot before a page does anything');
        },
        async close() {
            browser.closed = true;
        },
    };
    return browser;
}

vi.mock('playwright', () => ({
    chromium: {
        async launch() {
            launchEntered = true;
            await launchGate;
            const browser = fakeBrowser();
            launched.push(browser);
            return browser;
        },
    },
}));

vi.mock('../page-bundle.js', () => ({
    bundlePage: async () => ({ code: '', inputs: [], cached: false }),
}));

const { MotionScriptServerEngine } = await import('../server-engine.js');

describe('a failed start()', () => {
    beforeEach(() => {
        launched.length = 0;
        launchGate = null;
        pageFailure = null;
        launchEntered = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('closes the browser it launched, and a retry launches a fresh one', async () => {
        pageFailure = new Error('page failed');
        const engine = new MotionScriptServerEngine({ projectRoot: '/nowhere' });

        await expect(engine.start()).rejects.toThrow('page failed');
        expect(launched).toHaveLength(1);
        expect(launched[0].closed).toBe(true);
        expect(engine.started).toBe(false);

        await expect(engine.start()).rejects.toThrow('page failed');
        expect(launched).toHaveLength(2);
        expect(launched.every((b) => b.closed)).toBe(true);
    });

    it('ends a boot that a close() overtook while the browser was launching', async () => {
        let release!: () => void;
        launchGate = new Promise<void>((resolve) => { release = resolve; });
        const engine = new MotionScriptServerEngine({ projectRoot: '/nowhere' });

        const starting = engine.start().then(() => null, (err: unknown) => err);
        await vi.waitFor(() => expect(launchEntered).toBe(true));
        await engine.close();
        release();

        const failure = await starting;
        expect(isEngineError(failure)).toBe(true);
        expect(failure).toMatchObject({ code: 'CLOSED' });
        expect(launched).toHaveLength(1);
        expect(launched[0].closed).toBe(true);
        expect(engine.started).toBe(false);
    });
});

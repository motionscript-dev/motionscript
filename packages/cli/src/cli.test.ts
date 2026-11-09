import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printed } from './registry/workspace.fixtures.js';

vi.mock('./main.js', () => ({ main: vi.fn() }));

describe('the ms executable', () => {
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.exitCode = undefined;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    /** Evaluates `cli.ts` against a `main` that settles as `outcome`, and lets its `.catch` run. */
    async function runCli(outcome: Promise<void>) {
        vi.resetModules();
        const { main } = await import('./main.js');
        vi.mocked(main).mockReturnValue(outcome);
        await import('./cli.js');
        await new Promise((resolve) => setImmediate(resolve));
        return main;
    }

    it('runs main on the arguments after the executable, in the working directory', async () => {
        const main = await runCli(Promise.resolve());
        expect(main).toHaveBeenCalledExactlyOnceWith(process.argv.slice(2), process.cwd());
        expect(error).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('prints a thrown error as its message alone, with no stack, and exits 1', async () => {
        const failure = new Error('Registry source not found: /nowhere/gauge.json');
        await runCli(Promise.reject(failure));

        expect(error).toHaveBeenCalledOnce();
        const text = printed(error);
        expect(text).toBe('Registry source not found: /nowhere/gauge.json');
        expect(text).not.toContain('Error:');
        expect(text).not.toContain(String(failure.stack).split('\n')[1]!.trim());
        expect(process.exitCode).toBe(1);
    });

    it('prints a thrown value that is not an Error as a string', async () => {
        await runCli(Promise.reject('plain string'));
        expect(printed(error)).toBe('plain string');
        expect(process.exitCode).toBe(1);
    });
});

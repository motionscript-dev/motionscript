import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './main.js';
import { LOCK_FILENAME } from './registry/lock.js';
import { createWorkspace, itemOf, printed, snapshot, type Workspace } from './registry/workspace.fixtures.js';

describe('main', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;
    const version = (JSON.parse(
        fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }).version;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.exitCode = undefined;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it.each([['--version'], ['-v']])('prints the package version for %s', async (flag) => {
        await main([flag], process.cwd());
        expect(log).toHaveBeenCalledExactlyOnceWith(version);
        expect(error).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('prints help when no command is given', async () => {
        await main([], process.cwd());
        expect(String(log.mock.calls[0]?.[0])).toContain('ms add');
    });

    it('rejects an unknown command with a non-zero exit', async () => {
        await main(['nope'], process.cwd());
        expect(process.exitCode).toBe(1);
        expect(String(error.mock.calls[0]?.[0])).toContain('Unknown command "nope"');
    });

    it('points an unknown command at the help, and writes nothing', async () => {
        const ws = createWorkspace('main-unknown');
        try {
            const before = snapshot(ws.dir);
            await main(['nope', '--yes'], ws.project);
            expect(process.exitCode).toBe(1);
            expect(printed(error)).toContain('Run ms --help for what this does.');
            expect(log).not.toHaveBeenCalled();
            expect(snapshot(ws.dir)).toEqual(before);
        } finally {
            ws.remove();
        }
    });

    describe('the help', () => {
        it.each([['--help'], ['-h']])('is printed for %s, and lists every command and option', async (flag) => {
            await main([flag], process.cwd());
            const help = printed(log);
            for (const text of [
                'ms init', 'ms add', 'ms list', 'ms diff',
                '--yes', '--overwrite', '--skip-install', '--registry', '--check', '-v, --version',
            ]) {
                expect(help).toContain(text);
            }
            expect(process.exitCode).toBeUndefined();
        });

        it('is printed instead of running the command it is passed beside', async () => {
            const ws = createWorkspace('main-help', null);
            try {
                await main(['init', '--yes', '--help'], ws.project);
                expect(printed(log)).toContain('ms init');
                expect(snapshot(ws.dir)).toEqual({});
            } finally {
                ws.remove();
            }
        });
    });

    describe('dispatch', () => {
        let ws: Workspace;

        beforeEach(() => {
            ws = createWorkspace('main-dispatch', null);
            ws.publish(itemOf('gauge', { 'gauge.ts': 'gauge v1' }, { version: '1.0.0' }));
        });

        afterEach(() => {
            ws.remove();
        });

        it('runs init, then add (with -y for --yes), then list, ls and diff against the project root', async () => {
            await main(['init', '--yes'], ws.project);
            expect(Object.keys(snapshot(ws.project))).toEqual(['motionscript.json']);

            await main(['add', 'gauge', '-y', '--skip-install', '--registry', ws.registry], ws.project);
            expect(snapshot(ws.project)['src/components/gauge.ts']).toBe('gauge v1');
            expect(Object.keys(snapshot(ws.project))).toContain(LOCK_FILENAME);

            log.mockClear();
            await main(['list'], ws.project);
            const listed = printed(log);
            expect(listed).toContain('gauge');
            expect(listed).toContain('unchanged');

            // `ls` is the same command under a shorter name.
            log.mockClear();
            await main(['ls'], ws.project);
            expect(printed(log)).toBe(listed);

            log.mockClear();
            await main(['diff', 'gauge', '--registry', ws.registry], ws.project);
            expect(printed(log)).toContain('gauge');
            expect(process.exitCode).toBeUndefined();
        });

        it('ignores a flag it does not know', async () => {
            await main(['init', '--yes', '--no-such-flag', 'x'], ws.project);
            expect(Object.keys(snapshot(ws.project))).toEqual(['motionscript.json']);
            expect(error).not.toHaveBeenCalled();
        });

        it('lets an error from a command reach the caller, to be printed by the executable', async () => {
            await main(['init', '--yes'], ws.project);
            await expect(main(['add', 'missing', '--registry', ws.registry], ws.project)).rejects.toThrow(
                /Registry source not found/,
            );
        });
    });
});

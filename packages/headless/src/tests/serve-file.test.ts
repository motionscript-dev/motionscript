import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveFile } from '../server-engine.js';

interface Fulfilled {
    status: number;
    body: string;
}

/** What `serveFile` answers for `pathname`, through a stand-in for Playwright's `Route`. */
async function request(assetsDir: string, pathname: string): Promise<Fulfilled> {
    let fulfilled: Fulfilled | undefined;
    const route = {
        fulfill: async (response: { status: number; body: string | Buffer }) => {
            fulfilled = { status: response.status, body: String(response.body) };
        },
    };
    await serveFile(route as unknown as Parameters<typeof serveFile>[0], assetsDir, pathname);
    if (!fulfilled) throw new Error(`serveFile did not answer ${pathname}`);
    return fulfilled;
}

describe('serveFile', () => {
    let root: string;
    let assets: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-headless-serve-'));
        assets = path.join(root, 'public');
        fs.mkdirSync(path.join(assets, 'img'), { recursive: true });
        fs.writeFileSync(path.join(assets, 'img', 'a.png'), 'inside');
        fs.writeFileSync(path.join(assets, '..dots.txt'), 'dotted name');
        fs.mkdirSync(path.join(root, 'public-secret'));
        fs.writeFileSync(path.join(root, 'public-secret', 'x.txt'), 'secret');
        fs.writeFileSync(path.join(root, 'outside.txt'), 'outside');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('serves a file inside the assets directory', async () => {
        expect(await request(assets, '/img/a.png')).toEqual({ status: 200, body: 'inside' });
        expect(await request(assets, '/..dots.txt')).toEqual({ status: 200, body: 'dotted name' });
    });

    it('refuses a sibling directory whose name starts with the assets directory\'s', async () => {
        expect(await request(assets, '/..%2Fpublic-secret%2Fx.txt'))
            .toEqual({ status: 404, body: 'outside the assets directory' });
    });

    it('refuses a traversal above the assets directory', async () => {
        expect(await request(assets, '/..%2Foutside.txt'))
            .toEqual({ status: 404, body: 'outside the assets directory' });
        expect(await request(assets, '/img%2F..%2F..%2Foutside.txt'))
            .toEqual({ status: 404, body: 'outside the assets directory' });
    });

    it('refuses an absolute path', async () => {
        expect(await request(assets, `/${encodeURIComponent(path.join(root, 'outside.txt'))}`))
            .toEqual({ status: 404, body: 'outside the assets directory' });
    });

    it('refuses a symlink inside the assets directory that points out of it', async (context) => {
        try {
            fs.symlinkSync(path.join(root, 'public-secret'), path.join(assets, 'linked'), 'dir');
        } catch {
            context.skip();
        }
        expect(await request(assets, '/linked/x.txt'))
            .toEqual({ status: 404, body: 'outside the assets directory' });
    });

    it('answers a malformed escape and a missing file with a 404', async () => {
        expect(await request(assets, '/%E0%A4%A')).toEqual({ status: 404, body: 'not found' });
        expect(await request(assets, '/img/missing.png')).toEqual({ status: 404, body: 'not found' });
        expect(await request(assets, '/img')).toEqual({ status: 404, body: 'not found' });
    });
});

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as component from '@/component';

/**
 * Which entry points carry the asset-loading vocabulary, as values. Types are
 * erased at run time, so this pins the value half of that vocabulary; the
 * type half is checked by the compiler against the barrels themselves.
 *
 * The barrels are loaded by a dynamic import with a non-literal specifier for the
 * reason `sdk-parity.test.ts` gives: the lint rules forbid importing a barrel from
 * a non-barrel file, and the barrels are what is under test.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rootUrl = pathToFileURL(resolve(here, '../../index.ts')).href;
const sdkUrl = pathToFileURL(resolve(here, '../index.ts')).href;

let root: Record<string, unknown>;
let sdk: Record<string, unknown>;
const componentExports = component as Record<string, unknown>;

beforeAll(async () => {
    root = (await import(/* @vite-ignore */ rootUrl)) as Record<string, unknown>;
    sdk = (await import(/* @vite-ignore */ sdkUrl)) as Record<string, unknown>;
}, 60_000);

/** Runtime names the root carries, tagged internal but reachable through `export *`. */
const ROOT_ASSET_VALUES = [
    'AssetDeclaration', 'ManifestAssetCatalog', 'AssetManager', 'AssetNotLoadedError',
    'StorageAdapter', 'AssetTimeline',
] as const;

/** The refinement and update machinery, which no barrel exports. */
const NO_BARREL_VALUES = [
    'refineAssets', 'dirtyOwners', 'firstFrameAt', 'OwnerDependencies', 'SlotNamer',
    'hostSlotId', 'hostlessSlotId', 'ProjectAssets', 'AssetIndex',
] as const;

describe('asset-loading names across the entry points', () => {
    it('the root carries the asset runtime values', () => {
        for (const name of ROOT_ASSET_VALUES) {
            expect(root[name], `root.${name}`).toBeDefined();
            expect(typeof root[name], `root.${name}`).toBe('function');
        }
    });

    it('the root exports the error as the very class the manager throws', async () => {
        const { AssetNotLoadedError } = await import('@/assets/errors');
        expect(root.AssetNotLoadedError).toBe(AssetNotLoadedError);
    });

    it('the sdk carries none of the asset runtime values, only types', () => {
        for (const name of ROOT_ASSET_VALUES) {
            expect(sdk[name], `sdk.${name}`).toBeUndefined();
        }
    });

    it('the component entry point has no declarePaints: a component declares its paints through entries and load', () => {
        expect(componentExports.declarePaints).toBeUndefined();
    });

    it('no barrel exports the refinement, update and index machinery', () => {
        for (const name of NO_BARREL_VALUES) {
            expect(root[name], `root.${name}`).toBeUndefined();
            expect(sdk[name], `sdk.${name}`).toBeUndefined();
            expect(componentExports[name], `component.${name}`).toBeUndefined();
        }
    });
});

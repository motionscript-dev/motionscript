import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import minimist from 'minimist';
import { runAdd } from './add.js';
import type { ComponentsConfig, RegistryItem } from './protocol.js';

/**
 * A throwaway project and a local registry beside it, for tests that run a
 * command against both. Every path lives under one directory this helper
 * creates, and `remove` deletes exactly that directory.
 */

/** The config `ms init --yes` writes, minus `$schema`. */
export const TEST_CONFIG: ComponentsConfig = {
    project: 'src/project.ts',
    aliases: { components: '@/components' },
    paths: { components: 'src/components' },
};

export interface Workspace {
    /** The directory that holds both of the others. */
    dir: string;
    /** A local registry: one `<name>.json` per published item. */
    registry: string;
    /** The project root a command runs against. */
    project: string;
    /** Write `item` as `<name>.json` into the registry (or into `into`). */
    publish(item: RegistryItem, into?: string): void;
    /** Delete the registry's copy of an item, so a fetch of it fails. */
    unpublish(name: string): void;
    remove(): void;
}

/** `config: null` leaves the project without a `motionscript.json`. */
export function createWorkspace(prefix: string, config: ComponentsConfig | null = TEST_CONFIG): Workspace {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ms-cli-${prefix}-`));
    const registry = path.join(dir, 'registry');
    const project = path.join(dir, 'project');
    fs.mkdirSync(registry);
    fs.mkdirSync(project);
    if (config) fs.writeFileSync(path.join(project, 'motionscript.json'), JSON.stringify(config));
    return {
        dir,
        registry,
        project,
        publish(item, into = registry) {
            fs.mkdirSync(into, { recursive: true });
            fs.writeFileSync(path.join(into, `${item.name}.json`), JSON.stringify(item));
        },
        unpublish(name) {
            fs.rmSync(path.join(registry, `${name}.json`));
        },
        remove() {
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}

/** `ms add <names> --yes --skip-install` against the workspace's registry: the state `list` and `diff` read. */
export function addTo(ws: Workspace, ...names: string[]): Promise<void> {
    return runAdd(ws.project, minimist(['add', ...names, '--yes', '--skip-install', '--registry', ws.registry]));
}

/** A one-component item whose files are `{ path: content }`. */
export function itemOf(name: string, files: Record<string, string>, extra: Partial<RegistryItem> = {}): RegistryItem {
    return {
        name,
        type: 'registry:component',
        files: Object.entries(files).map(([filePath, content]) => ({ path: filePath, content })),
        ...extra,
    };
}

/** Every file under `dir`, by path relative to it, with its content: what "wrote nothing" is compared against. */
export function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else out[path.relative(dir, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
        }
    };
    walk(dir);
    return out;
}

/** What a spied `console.log` or `console.error` was given, joined by newlines and without colour codes. */
export function printed(spy: { mock: { calls: unknown[][] } }): string {
    return stripVTControlCharacters(spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n'));
}

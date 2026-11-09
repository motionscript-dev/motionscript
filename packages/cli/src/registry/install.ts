import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import type { ComponentsConfig, RegistryItem } from './protocol.js';
import { fetchRegistryItem } from './fetch.js';
import { fileState, type LockedComponent } from './lock.js';

/** A registry item and the name it was asked for by, which is its key in the lock. */
export interface ResolvedComponent {
    /**
     * The name as typed or as a dependency declared it, namespace included
     * (`@acme/gauge`). `item.name` has the namespace stripped and can collide
     * with another registry's item of the same name; this cannot.
     */
    requested: string;
    item: RegistryItem;
}

/**
 * Resolve a list of requested component names into an ordered, deduped
 * install list, recursively pulling in each item's `registryDependencies`
 * before the item itself (so a dependency's files land first).
 */
export async function resolveComponents(
    names: string[],
    config: ComponentsConfig | null,
    defaultRegistryUrl: string | undefined,
): Promise<ResolvedComponent[]> {
    const resolved: ResolvedComponent[] = [];
    const seen = new Set<string>();

    async function visit(name: string): Promise<void> {
        if (seen.has(name)) return;
        seen.add(name);
        const item = await fetchRegistryItem(name, config, defaultRegistryUrl);
        for (const dep of item.registryDependencies ?? []) {
            await visit(dep);
        }
        resolved.push({ requested: name, item });
    }

    for (const name of names) {
        await visit(name);
    }
    return resolved;
}

export interface WriteResult {
    written: string[];
    skipped: string[];
    /** What actually landed, by the path the item declared, for the lockfile. */
    recorded: Record<string, { target: string; content: string }>;
}

/**
 * Write every file in `item` under `<paths.components>/`, at whatever path
 * each file itself declares — prompting before overwriting an existing file
 * unless `force` is set.
 *
 * Deliberately does *not* nest every item under its own `<item.name>/`
 * subfolder: a simple single-file component declares one file at
 * `"code.ts"` and lands flat (`src/components/code.ts`), while a component
 * that genuinely needs several files declares them nested
 * (`"line-chart/chart.ts"`, `"line-chart/axis.ts"`) and lands in a real
 * subfolder. The registry item's own file paths are the only thing that
 * decides the shape, within the components root (see `componentDestinations`).
 */
export async function writeComponentFiles(
    item: RegistryItem,
    config: ComponentsConfig,
    projectRoot: string,
    options: { force?: boolean; previous?: LockedComponent } = {},
): Promise<WriteResult> {
    const destinations = componentDestinations(item, config, projectRoot);
    const written: string[] = [];
    const skipped: string[] = [];
    const recorded: Record<string, { target: string; content: string }> = {};

    for (const file of item.files) {
        const dest = destinations.get(file.path)!;
        if (fs.existsSync(dest) && !options.force) {
            // The lockfile is what makes this prompt worth reading. "Already
            // exists" is true of every file on a re-install and says nothing;
            // "you changed this since 3.1.0" is the one fact that decides
            // whether overwriting loses work.
            const previous = options.previous?.files[file.path];
            const state = previous ? fileState(projectRoot, previous) : undefined;
            if (state === 'unchanged') {
                // Untouched since it was installed, so there is nothing to lose.
                fs.writeFileSync(dest, file.content);
                written.push(dest);
                recorded[file.path] = {
                    target: lockTarget(projectRoot, dest),
                    content: file.content,
                };
                continue;
            }
            const { overwrite } = await prompts({
                type: 'confirm',
                name: 'overwrite',
                message:
                    state === 'modified'
                        ? `${path.relative(projectRoot, dest)} has local changes since ${
                              options.previous?.version ?? 'it was installed'
                          }. Overwrite?`
                        : `${path.relative(projectRoot, dest)} already exists. Overwrite?`,
                initial: false,
            });
            if (!overwrite) {
                skipped.push(dest);
                continue;
            }
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, file.content);
        written.push(dest);
        recorded[file.path] = {
            target: lockTarget(projectRoot, dest),
            content: file.content,
        };
    }
    return { written, skipped, recorded };
}

/**
 * Where each of `item`'s files lands, keyed by the path it declares.
 *
 * A registry is fetched, so its paths are input: one that is absolute, or that
 * leaves the components root once resolved, throws before anything is written,
 * as does a components root outside the project.
 */
export function componentDestinations(
    item: RegistryItem,
    config: ComponentsConfig,
    projectRoot: string,
): Map<string, string> {
    const root = path.resolve(projectRoot);
    const targetDir = path.resolve(root, config.paths.components);
    if (!isWithin(root, targetDir)) {
        throw new Error(
            `paths.components "${config.paths.components}" in motionscript.json is outside the project (${root}).`,
        );
    }
    const destinations = new Map<string, string>();
    for (const file of item.files) {
        const dest = path.resolve(targetDir, file.path);
        const absolute = path.posix.isAbsolute(file.path) || path.win32.isAbsolute(file.path);
        if (absolute || dest === targetDir || !isWithin(targetDir, dest)) {
            throw new Error(
                `Registry item "${item.name}" declares a file at "${file.path}", outside ${config.paths.components}/. ` +
                    'A registry file path must be relative to the components folder and stay inside it.',
            );
        }
        destinations.set(file.path, dest);
    }
    return destinations;
}

/** Whether `file` is `dir` or below it, by resolved path rather than by string prefix. */
function isWithin(dir: string, file: string): boolean {
    const rel = path.relative(dir, file);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** With forward slashes, so a lock committed from Windows reads the same everywhere. */
function lockTarget(projectRoot: string, dest: string): string {
    return path.relative(projectRoot, dest).split(path.sep).join('/');
}

/** Merge every installed item's npm `dependencies` ("pkg@range" strings) into one deduped map. */
export function collectDependencies(items: RegistryItem[]): Record<string, string> {
    const deps: Record<string, string> = {};
    for (const item of items) {
        for (const spec of item.dependencies ?? []) {
            const at = spec.lastIndexOf('@');
            // A spec always has a version after the last "@" (a scoped package
            // has an earlier "@" too, e.g. "@lezer/javascript@^1.5.4") — bail
            // rather than silently mis-splitting an unexpected shape.
            if (at <= 0) throw new Error(`Invalid dependency spec (expected "pkg@range"): ${spec}`);
            deps[spec.slice(0, at)] = spec.slice(at + 1);
        }
    }
    return deps;
}

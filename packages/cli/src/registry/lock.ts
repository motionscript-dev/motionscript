import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RegistryItem } from './protocol.js';

/**
 * What was installed, from where, at what version — and whether it has been
 * edited since.
 *
 * A copied component is source you are *meant* to change: that is the whole
 * point of copying it rather than depending on it. But then "is this file
 * yours or ours" stops having an obvious answer, and every later question —
 * can `ms add` overwrite this, what did upstream change, which of these
 * components am I even carrying — depends on it.
 *
 * So each install records the hash of the bytes it wrote. Re-hashing the file
 * on disk answers "modified since install" exactly, with no heuristic.
 *
 * ## Why a separate file
 *
 * `motionscript.json` is hand-authored configuration: registries, paths, an
 * alias. This is derived, rewritten on every install, and of no interest to a
 * human until something is wrong. Mixing the two would mean `ms add` rewriting
 * a file the user edits, and a merge conflict spanning both kinds of content.
 * Every package manager makes the same split for the same reason.
 *
 * ## Why not a header in each file
 *
 * A "generated, do not edit" banner above a file whose purpose is to be edited
 * is a lie, and the first `format-on-save` moves or mangles it. The record
 * belongs beside the project, not inside the thing it describes.
 */

export const LOCK_FILENAME = 'motionscript.lock.json';

/** What the lock file used to be called, oldest first. Both still read, never written. */
export const LEGACY_LOCK_FILENAMES = ['motion-script.lock.json', 'components.lock.json'];

/** One file as it was written. */
export interface LockedFile {
    /** Where it landed, relative to the project root. */
    target: string;
    /** sha256 of the bytes written, after any import rewriting. */
    installed: string;
}

/** One installed component. */
export interface LockedComponent {
    /** `"default"`, or the `@namespace` it came from. */
    registry: string;
    /** The exact URL it was read from. */
    url: string;
    /** The item name, with any namespace stripped. */
    item: string;
    /** The item's version at install time, when it declared one. */
    version?: string;
    /** The kit its copied source imports, and which stays a dependency. */
    kit?: string;
    installedAt: string;
    files: Record<string, LockedFile>;
}

export interface ComponentsLock {
    $schema?: string;
    lockfileVersion: 1;
    components: Record<string, LockedComponent>;
}

export function hashContent(content: string): string {
    return `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;
}

export function emptyLock(): ComponentsLock {
    return {
        $schema: 'https://motionscript.dev/schema/motionscript.lock.json',
        lockfileVersion: 1,
        components: {},
    };
}

export function loadLock(projectRoot: string): ComponentsLock {
    const lockPath = [LOCK_FILENAME, ...LEGACY_LOCK_FILENAMES]
        .map((name) => path.join(projectRoot, name))
        .find((candidate) => fs.existsSync(candidate));
    if (!lockPath) return emptyLock();
    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as ComponentsLock;
        // A lock from a future version describes installs whose shape this
        // client does not know. Starting over loses provenance, which is a
        // nuisance; acting on a record we cannot read would overwrite files
        // whose state we have guessed at, which is not.
        if (parsed.lockfileVersion !== 1) {
            throw new Error(
                `${LOCK_FILENAME} is version ${parsed.lockfileVersion}, which this CLI does not understand. Upgrade @motionscript/cli.`,
            );
        }
        return parsed;
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`${LOCK_FILENAME} is not valid JSON. Delete it to start over.`);
        }
        throw error;
    }
}

export function writeLock(projectRoot: string, lock: ComponentsLock): void {
    // Components sorted, so two installs in different orders produce the same
    // file and a diff shows only what actually changed.
    const sorted: ComponentsLock = {
        ...lock,
        components: Object.fromEntries(
            Object.entries(lock.components).sort(([a], [b]) => a.localeCompare(b)),
        ),
    };
    fs.writeFileSync(path.join(projectRoot, LOCK_FILENAME), `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Records one item's install, replacing any previous record of it.
 *
 * `written` is what landed this run. A file the item still declares but that
 * was not rewritten (the user declined to overwrite it) keeps the record it
 * had: the entry is the account of what was installed, and dropping the
 * record would make an edited file look like one the lock never knew.
 */
export function recordInstall(
    lock: ComponentsLock,
    requestedName: string,
    item: RegistryItem,
    url: string,
    written: Record<string, { target: string; content: string }>,
): void {
    const previous = lock.components[requestedName]?.files ?? {};
    // In the item's declared order, so a partial re-install does not reshuffle the entry.
    const files: Record<string, LockedFile> = {};
    for (const { path: declared } of item.files) {
        const fresh = written[declared];
        const record = fresh ? { target: fresh.target, installed: hashContent(fresh.content) } : previous[declared];
        if (record) files[declared] = record;
    }
    lock.components[requestedName] = {
        registry: requestedName.startsWith('@') ? requestedName.split('/')[0] : 'default',
        url,
        item: item.name,
        ...(item.version ? { version: item.version } : {}),
        ...(item.kit ? { kit: item.kit } : {}),
        installedAt: new Date().toISOString(),
        files,
    };
}

/** How one installed file stands against what was written. */
export type FileState = 'unchanged' | 'modified' | 'missing';

export function fileState(projectRoot: string, file: LockedFile): FileState {
    const full = path.join(projectRoot, file.target);
    if (!fs.existsSync(full)) return 'missing';
    return hashContent(fs.readFileSync(full, 'utf8')) === file.installed ? 'unchanged' : 'modified';
}

/** Every file of a component that is no longer as it was installed. */
export function changedFiles(projectRoot: string, entry: LockedComponent): string[] {
    return Object.entries(entry.files)
        .filter(([, file]) => fileState(projectRoot, file) !== 'unchanged')
        .map(([declared]) => declared);
}

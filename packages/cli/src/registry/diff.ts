import fs from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';
import type minimist from 'minimist';
import { loadComponentsConfig } from './config.js';
import { fetchRegistryItem } from './fetch.js';
import { hashContent, loadLock } from './lock.js';

/**
 * `ms diff [name]` — what upstream changed under your feet.
 *
 * The counterpart to `ms list`: that one answers "did I change this", this one
 * answers "did they". Both are only answerable because the lockfile recorded
 * the bytes that were written, which is what gives a three-way comparison a
 * middle term — yours, theirs, and the common ancestor they diverged from.
 *
 * Deliberately prints a summary rather than a unified diff. A component is
 * files on disk in a project that already has a diff tool and a version control
 * system with better ones; what the CLI uniquely knows is *which* files moved
 * and in which direction, and that is what it says.
 */
export async function runDiff(projectRoot: string, argv: minimist.ParsedArgs): Promise<void> {
    const lock = loadLock(projectRoot);
    const config = loadComponentsConfig(projectRoot);
    const defaultRegistryUrl = typeof argv.registry === 'string' ? argv.registry : undefined;

    const requested = argv._.slice(1).filter(Boolean);
    const names = requested.length > 0 ? requested : Object.keys(lock.components);

    if (names.length === 0) {
        console.log(kleur.dim('No components installed.'));
        return;
    }

    for (const name of names) {
        const entry = lock.components[name];
        if (!entry) {
            console.log(`${kleur.bold(name)}  ${kleur.red('not installed')}`);
            continue;
        }

        let upstream;
        try {
            upstream = await fetchRegistryItem(name, config, defaultRegistryUrl);
        } catch (error) {
            console.log(
                `${kleur.bold(name)}  ${kleur.red('unreachable')} ${kleur.dim(String(error))}`,
            );
            continue;
        }

        const header = [kleur.bold(name)];
        if (entry.version || upstream.version) {
            header.push(kleur.dim(`${entry.version ?? '?'} → ${upstream.version ?? '?'}`));
        }
        console.log(header.join('  '));

        const seen = new Set<string>();
        for (const file of upstream.files) {
            seen.add(file.path);
            const locked = entry.files[file.path];
            if (!locked) {
                console.log(`  ${kleur.green('+')} ${file.path} ${kleur.dim('(new upstream)')}`);
                continue;
            }
            const onDisk = path.join(projectRoot, locked.target);
            const local = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, 'utf8') : null;
            const upstreamChanged = hashContent(file.content) !== locked.installed;
            const localChanged = local !== null && hashContent(local) !== locked.installed;

            if (local === null) {
                console.log(`  ${kleur.red('-')} ${file.path} ${kleur.dim('(missing locally)')}`);
            } else if (upstreamChanged && localChanged) {
                // The only state that needs a person: both moved, so
                // re-installing loses work and not re-installing keeps a bug.
                console.log(`  ${kleur.yellow('!')} ${file.path} ${kleur.dim('(changed both sides)')}`);
            } else if (upstreamChanged) {
                console.log(`  ${kleur.cyan('↑')} ${file.path} ${kleur.dim('(changed upstream)')}`);
            } else if (localChanged) {
                console.log(`  ${kleur.yellow('~')} ${file.path} ${kleur.dim('(changed locally)')}`);
            }
        }

        for (const declared of Object.keys(entry.files)) {
            if (!seen.has(declared)) {
                console.log(`  ${kleur.dim('×')} ${declared} ${kleur.dim('(dropped upstream)')}`);
            }
        }
    }
}

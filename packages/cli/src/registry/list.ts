import kleur from 'kleur';
import type minimist from 'minimist';
import { loadComponentsConfig } from './config.js';
import { fetchRegistryItem } from './fetch.js';
import { changedFiles, fileState, loadLock } from './lock.js';

/**
 * `ms list` — what this project is carrying, where each piece came from, and
 * whether it still matches what was installed.
 *
 * The question a copied component makes hard to answer. A dependency's version
 * is in `package.json`; copied source has nothing to look at, so a project six
 * months in cannot tell which of its components are stock, which were edited,
 * and which are three versions behind. That is the cost of copying, and the
 * lockfile is what pays it.
 */
export async function runList(projectRoot: string, argv: minimist.ParsedArgs): Promise<void> {
    const lock = loadLock(projectRoot);
    const entries = Object.entries(lock.components);

    if (entries.length === 0) {
        console.log(kleur.dim('No components installed. Add one with `ms add <name>`.'));
        return;
    }

    const config = loadComponentsConfig(projectRoot);
    const defaultRegistryUrl = typeof argv.registry === 'string' ? argv.registry : undefined;

    for (const [name, entry] of entries) {
        const changed = changedFiles(projectRoot, entry);
        const missing = Object.values(entry.files).filter(
            (file) => fileState(projectRoot, file) === 'missing',
        ).length;

        const parts = [kleur.bold(name)];
        if (entry.version) parts.push(kleur.dim(entry.version));
        if (entry.registry !== 'default') parts.push(kleur.dim(`from ${entry.registry}`));

        if (missing > 0) {
            parts.push(kleur.red(`${missing} file${missing === 1 ? '' : 's'} missing`));
        } else if (changed.length > 0) {
            parts.push(
                kleur.yellow(
                    `modified (${changed.length} of ${Object.keys(entry.files).length} files)`,
                ),
            );
        } else {
            parts.push(kleur.green('unchanged'));
        }

        // Only reached for; never acted on. Telling someone an update exists is
        // useful, and taking it without being asked would overwrite the edits
        // the line above just reported.
        if (argv.check) {
            try {
                const upstream = await fetchRegistryItem(name, config, defaultRegistryUrl);
                if (upstream.version && upstream.version !== entry.version) {
                    parts.push(kleur.cyan(`${entry.version ?? '?'} → ${upstream.version} available`));
                }
            } catch {
                parts.push(kleur.dim('(upstream unreachable)'));
            }
        }

        console.log(`  ${parts.join('  ')}`);
    }

    if (!argv.check) {
        console.log(kleur.dim('\nPass --check to ask each registry whether a newer version exists.'));
    }
}

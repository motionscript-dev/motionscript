import fs from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';
import prompts from 'prompts';
import type minimist from 'minimist';
import { componentsConfigExists, loadComponentsConfig } from './config.js';
import { fetchRegistryIndex, resolveItemUrl } from './fetch.js';
import { componentDestinations, resolveComponents, writeComponentFiles, collectDependencies } from './install.js';
import { detectPackageManager, installDependencies } from './package-manager.js';
import { runInit } from './init.js';
import { loadLock, recordInstall, writeLock } from './lock.js';

/**
 * `ms add [name...]` — copy one or more registry components' source into
 * this project, following any `registryDependencies` first, then install the
 * npm packages they need.
 */
export async function runAdd(projectRoot: string, argv: minimist.ParsedArgs): Promise<void> {
    if (!componentsConfigExists(projectRoot)) {
        if (!argv.yes) {
            const { proceed } = await prompts({
                type: 'confirm',
                name: 'proceed',
                message: 'No motionscript.json found. Run `ms init` now?',
                initial: true,
            });
            if (!proceed) {
                console.log(kleur.dim('Aborted.'));
                return;
            }
        }
        await runInit(projectRoot, argv);
    }

    const config = loadComponentsConfig(projectRoot);
    if (!config) throw new Error('motionscript.json could not be loaded after init.');

    const defaultRegistryUrl = typeof argv.registry === 'string' ? argv.registry : undefined;

    let names = (argv._.slice(1) as string[]).filter(Boolean);
    if (names.length === 0) {
        const index = await fetchRegistryIndex(defaultRegistryUrl);
        if (index.length === 0) {
            console.log(kleur.yellow('The registry has no components to add.'));
            return;
        }
        const { selected } = await prompts({
            type: 'multiselect',
            name: 'selected',
            message: 'Select components to add',
            choices: index.map(entry => ({
                title: entry.name,
                description: entry.description,
                value: entry.name,
            })),
            min: 1,
        });
        if (!selected || (selected as string[]).length === 0) {
            console.log(kleur.dim('Aborted.'));
            return;
        }
        names = selected as string[];
    }

    console.log(kleur.bold(`Adding ${names.join(', ')}...`));
    const components = await resolveComponents(names, config, defaultRegistryUrl);
    // Everything that can be refused is refused before any file is written, so
    // one item's bad path, a malformed dependency spec or a project with
    // nowhere to put the dependencies leaves no half-installed set behind.
    for (const { item } of components) componentDestinations(item, config, projectRoot);
    const dependencies = collectDependencies(components.map(c => c.item));
    const install = !argv['skip-install'] && Object.keys(dependencies).length > 0;
    if (install && !fs.existsSync(path.join(projectRoot, 'package.json'))) {
        throw new Error(
            `There is no package.json in ${projectRoot} to add ${Object.keys(dependencies).join(', ')} to. ` +
                'Run this from your project root, or pass --skip-install to copy the source only.',
        );
    }
    const lock = loadLock(projectRoot);

    const added: string[] = [];
    const kept: string[] = [];
    for (const { requested, item } of components) {
        const { written, skipped, recorded } = await writeComponentFiles(item, config, projectRoot, {
            // --yes is "fully non-interactive": it also answers the overwrite
            // prompt, so a scripted `ms add --yes` never blocks on stdin.
            force: Boolean(argv.overwrite || argv.yes),
            previous: lock.components[requested],
        });
        if (Object.keys(recorded).length > 0) {
            recordInstall(lock, requested, item, resolveItemUrl(requested, config, defaultRegistryUrl).url, recorded);
        }
        (skipped.length > 0 && written.length === 0 ? kept : added).push(item.name);
        for (const file of written) {
            console.log(`  ${kleur.green('✓')} ${path.relative(projectRoot, file)}`);
        }
        for (const file of skipped) {
            console.log(`  ${kleur.dim('–')} ${path.relative(projectRoot, file)} ${kleur.dim('(skipped)')}`);
        }
    }

    // Before the install, not after: the files are on disk by now, and an
    // install that fails (a registry outage, a package manager exiting
    // non-zero) must not leave them untracked, where the next `ms add` would
    // take them for files it has never seen.
    writeLock(projectRoot, lock);

    if (install) {
        const pm = detectPackageManager(projectRoot);
        console.log(kleur.bold(`Installing dependencies with ${pm}...`));
        installDependencies(pm, dependencies, projectRoot);
    }

    const summary = [
        ...(added.length > 0 ? [`Added: ${added.join(', ')}`] : []),
        ...(kept.length > 0 ? [`Skipped: ${kept.join(', ')} (your files were kept)`] : []),
    ];
    console.log(kleur.green(`Done. ${summary.join('. ')}.`));
}

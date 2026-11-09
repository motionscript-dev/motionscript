import fs from 'node:fs';
import kleur from 'kleur';
import minimist from 'minimist';
import { runAdd } from './registry/add.js';
import { runDiff } from './registry/diff.js';
import { runInit } from './registry/init.js';
import { runList } from './registry/list.js';

/**
 * `ms` — the component CLI.
 *
 * Some Motion Script components do not ship as a dependency you import. Their
 * source is copied into your project, so you own it: you can read it, change
 * it, and delete the half you do not want. The cost is that fixes arrive
 * manually, which is what `ms list` and `ms diff` exist to make bearable.
 *
 * This is deliberately only the registry half of the CLI that used to live
 * here. Rendering from Node is `@motionscript/headless`'s job: a host imports
 * it and renders a project entry in a headless Chromium page.
 */

const HELP = `
${kleur.bold('ms')} — Motion Script components

  ${kleur.bold('ms init')}                 write motionscript.json and wire the @/components alias
  ${kleur.bold('ms add')} [name...]        copy a component's source into this project
  ${kleur.bold('ms list')}                 what is installed, and whether it has been edited
  ${kleur.bold('ms diff')} [name]          what changed upstream, and on which side

${kleur.bold('Options')}
  --yes                    skip prompts and accept defaults
  --overwrite              overwrite existing files without asking
  --skip-install           do not install npm dependencies after adding
  --registry <url>         override the default registry (a URL or a local path)
  --check                  (list) ask each registry whether a newer version exists
  -v, --version            print the installed version of this CLI

${kleur.bold('Registries')}
  A bare name resolves against ${kleur.dim('https://motionscript.dev/r')}. Additional or
  private registries go under motionscript.json's "registries", keyed by
  @namespace, and are reached as ${kleur.dim('ms add @acme/gauge')}.
`;

/** This package's own version, read from the `package.json` beside `src/` and `dist/`. */
function packageVersion(): string {
    const manifest = JSON.parse(
        fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    return manifest.version;
}

/** Run `ms` with `args` (the part after the executable) against `projectRoot`. */
export async function main(args: string[], projectRoot: string): Promise<void> {
    const argv = minimist(args, {
        boolean: ['yes', 'overwrite', 'skip-install', 'check', 'help', 'version'],
        string: ['registry'],
        alias: { y: 'yes', h: 'help', v: 'version' },
    });

    if (argv.version) {
        console.log(packageVersion());
        return;
    }

    const command = argv._[0];
    if (argv.help || !command) {
        console.log(HELP);
        return;
    }

    switch (command) {
        case 'init':
            // `runInit` hands back the config it wrote, which only `runAdd`
            // wants; here the command is done when it returns.
            await runInit(projectRoot, argv);
            return;
        case 'add':
            return runAdd(projectRoot, argv);
        case 'list':
        case 'ls':
            return runList(projectRoot, argv);
        case 'diff':
            return runDiff(projectRoot, argv);
        default:
            console.error(
                kleur.red(`Unknown command "${String(command)}".`),
                `\nRun ${kleur.bold('ms --help')} for what this does.`,
            );
            process.exitCode = 1;
    }
}

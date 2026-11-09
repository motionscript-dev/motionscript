#!/usr/bin/env node
import kleur from 'kleur';
import { main } from './main.js';

main(process.argv.slice(2), process.cwd()).catch((error: unknown) => {
    // A message, not a stack. Every throw on these paths is a condition the
    // user can act on — an unreachable registry, a namespace that is not
    // configured, a malformed item — and a stack trace buries the sentence
    // that says which.
    console.error(kleur.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
});

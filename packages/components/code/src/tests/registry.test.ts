/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * `ms add code` copies `node.ts` and rewrites its import of `./engine` to the
 * kit's specifier. That is only sound while every name the node takes from
 * `./engine` is one `engine.ts` exports: a name it forgot would dangle in the
 * copy, with a typecheck error that only the copy's owner would ever see.
 *
 * Read with the compiler rather than with a pattern, so a type, a re-export
 * through `export *` and a renamed import are all resolved the way the build
 * resolves them.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function program(entry: string) {
    const configPath = ts.findConfigFile(SRC, ts.sys.fileExists, 'tsconfig.build.json');
    if (!configPath) throw new Error('no tsconfig.build.json above src');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    return ts.createProgram({ rootNames: [path.join(SRC, entry)], options: { ...parsed.options, noEmit: true } });
}

/** The names `from` imports from the relative module `specifier`. */
function importsFrom(file: ts.SourceFile, specifier: string): string[] {
    const names: string[] = [];
    ts.forEachChild(file, (child) => {
        if (!ts.isImportDeclaration(child) || (child.moduleSpecifier as ts.StringLiteral).text !== specifier) return;
        const bindings = child.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
        }
    });
    return names;
}

describe('node.ts and the engine barrel', () => {
    const compiled = program('node.ts');
    const checker = compiled.getTypeChecker();
    const node = compiled.getSourceFile(path.join(SRC, 'node.ts'))!;
    const engine = compiled.getSourceFile(path.join(SRC, 'engine.ts'))!;
    const exported = new Set(checker.getExportsOfModule(checker.getSymbolAtLocation(engine)!).map((symbol) => symbol.name));
    const taken = importsFrom(node, './engine');

    it('reads the names the node imports from ./engine', () => {
        // The check is only as good as the list it checks: a scan that found nothing would pass for ever.
        expect(taken.length).toBeGreaterThan(20);
        expect(taken).toEqual(expect.arrayContaining(['drawCode', 'layoutCode', 'tokenizeCodeToIdLines', 'TokenAdvanceCache', 'CodeLayout']));
    });

    it('is exported by engine.ts, every name of it, so a copy cannot dangle', () => {
        expect(taken.filter((name) => !exported.has(name))).toEqual([]);
    });

    it('takes nothing from the engine by a path other than ./engine', () => {
        const other = ['./layout', './render', './transitions', './tokens', './highlight', './style', './diff', './measure-cache', './code-range']
            .filter((specifier) => importsFrom(node, specifier).length > 0);
        expect(other).toEqual([]);
    });

    it('takes the rest of what it needs from the SDK, and never from core', () => {
        const sources = readFileSync(path.join(SRC, 'node.ts'), 'utf8');
        expect(sources).toContain('from "@motionscript/sdk"');
        expect(sources).not.toContain('@motionscript/core');
    });
});

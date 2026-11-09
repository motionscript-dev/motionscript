import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    componentsConfigExists,
    defaultComponentsConfig,
    loadComponentsConfig,
    writeComponentsConfig,
    DEFAULT_COMPONENTS_ALIAS,
    DEFAULT_COMPONENTS_PATH,
    COMPONENTS_CONFIG_FILENAME,
    LEGACY_CONFIG_FILENAMES,
} from './config.js';

const [MOTION_SCRIPT_JSON, COMPONENTS_JSON] = LEGACY_CONFIG_FILENAMES;

describe('motionscript.json config', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cli-config-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reports absent when no motionscript.json exists', () => {
        expect(componentsConfigExists(dir)).toBe(false);
        expect(loadComponentsConfig(dir)).toBeNull();
    });

    // Each rename has to be a rename, not a reset: a project that ran `ms init`
    // before either rename still has `components.json` (or `motion-script.json`)
    // on disk, and silently reporting "no config" there would re-init over a
    // working setup.
    it('still reads a legacy components.json', () => {
        fs.writeFileSync(
            path.join(dir, COMPONENTS_JSON),
            JSON.stringify(defaultComponentsConfig({ project: 'src/legacy.ts' })),
        );

        expect(componentsConfigExists(dir)).toBe(true);
        expect(loadComponentsConfig(dir)?.project).toBe('src/legacy.ts');
    });

    it('still reads a legacy motion-script.json', () => {
        fs.writeFileSync(
            path.join(dir, MOTION_SCRIPT_JSON),
            JSON.stringify(defaultComponentsConfig({ project: 'src/dashed.ts' })),
        );

        expect(componentsConfigExists(dir)).toBe(true);
        expect(loadComponentsConfig(dir)?.project).toBe('src/dashed.ts');
    });

    it('prefers motionscript.json when all three are present', () => {
        fs.writeFileSync(
            path.join(dir, COMPONENTS_JSON),
            JSON.stringify(defaultComponentsConfig({ project: 'src/legacy.ts' })),
        );
        fs.writeFileSync(
            path.join(dir, MOTION_SCRIPT_JSON),
            JSON.stringify(defaultComponentsConfig({ project: 'src/dashed.ts' })),
        );
        fs.writeFileSync(
            path.join(dir, COMPONENTS_CONFIG_FILENAME),
            JSON.stringify(defaultComponentsConfig({ project: 'src/current.ts' })),
        );

        expect(loadComponentsConfig(dir)?.project).toBe('src/current.ts');
    });

    it('writes only the current name, never a legacy one', () => {
        writeComponentsConfig(dir, defaultComponentsConfig());

        expect(fs.existsSync(path.join(dir, COMPONENTS_CONFIG_FILENAME))).toBe(true);
        expect(fs.existsSync(path.join(dir, MOTION_SCRIPT_JSON))).toBe(false);
        expect(fs.existsSync(path.join(dir, COMPONENTS_JSON))).toBe(false);
    });

    it('round-trips a written config', () => {
        const config = defaultComponentsConfig();
        writeComponentsConfig(dir, config);

        expect(componentsConfigExists(dir)).toBe(true);
        expect(loadComponentsConfig(dir)).toEqual(config);
    });

    it('applies sensible defaults', () => {
        const config = defaultComponentsConfig();
        expect(config.aliases.components).toBe(DEFAULT_COMPONENTS_ALIAS);
        expect(config.paths.components).toBe(DEFAULT_COMPONENTS_PATH);
        expect(config.project).toBe('src/project.ts');
    });

    it('accepts a project path override', () => {
        const config = defaultComponentsConfig({ project: 'src/main.ts' });
        expect(config.project).toBe('src/main.ts');
    });
});

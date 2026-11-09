import fs from 'node:fs';
import path from 'node:path';
import type { ComponentsConfig } from './protocol.js';

export const COMPONENTS_CONFIG_FILENAME = 'motionscript.json';

/**
 * What this file used to be called, oldest first. Both still read, never written.
 *
 * `components.json` was renamed because it holds more than components now —
 * the project entry, asset and shader locations — and because that name at a
 * project root is shadcn/ui's, which a project may well also have.
 * `motion-script.json` was the dashed-scope-era name.
 */
export const LEGACY_CONFIG_FILENAMES = ['motion-script.json', 'components.json'];

/** The config file actually present, preferring the current name. */
function configPathIn(projectRoot: string): string | null {
    for (const name of [COMPONENTS_CONFIG_FILENAME, ...LEGACY_CONFIG_FILENAMES]) {
        const candidate = path.join(projectRoot, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** The registry bare (unnamespaced) component names resolve against, e.g. `ms add code`. */
export const DEFAULT_REGISTRY_URL = 'https://motionscript.dev/r';

export const DEFAULT_COMPONENTS_ALIAS = '@/components';
export const DEFAULT_COMPONENTS_PATH = 'src/components';

export function componentsConfigExists(projectRoot: string): boolean {
    return configPathIn(projectRoot) !== null;
}

/**
 * Load `motionscript.json` from a project root, falling back to either legacy
 * name. Returns null when absent, mirroring how the CLI probes for
 * `src/project.ts` elsewhere — presence, not requirement, since most commands
 * treat this file as optional context rather than something every project must
 * have.
 */
export function loadComponentsConfig(projectRoot: string): ComponentsConfig | null {
    return findComponentsConfig(projectRoot)?.config ?? null;
}

/**
 * The config under whichever name is present, and that name — for a message
 * that has to say which file it is talking about, since a project that still
 * carries a legacy name has no `motionscript.json` to point at.
 */
export function findComponentsConfig(
    projectRoot: string,
): { filename: string; config: ComponentsConfig } | null {
    const configPath = configPathIn(projectRoot);
    if (!configPath) return null;
    return {
        filename: path.basename(configPath),
        config: JSON.parse(fs.readFileSync(configPath, 'utf8')) as ComponentsConfig,
    };
}

/** Write `motionscript.json`, pretty-printed like the toolchain's other generated JSON files. */
export function writeComponentsConfig(projectRoot: string, config: ComponentsConfig): void {
    const configPath = path.join(projectRoot, COMPONENTS_CONFIG_FILENAME);
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function defaultComponentsConfig(overrides?: Partial<Pick<ComponentsConfig, 'project'>>): ComponentsConfig {
    return {
        $schema: 'https://motionscript.dev/schema/motionscript.json',
        project: overrides?.project ?? 'src/project.ts',
        aliases: { components: DEFAULT_COMPONENTS_ALIAS },
        paths: { components: DEFAULT_COMPONENTS_PATH },
    };
}

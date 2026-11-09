import type { Registry } from "./registry";

/**
 * What a stored document can name and rely on, as JSON: every node type, the
 * props it declares with their defaults (a row is sparse, so a changed default
 * changes every document that leaves the prop out), and the commands it
 * publishes. Each release snapshots it beside its fixture documents, so a test
 * can tell what a change takes away from documents already saved.
 */
export interface RegistryVocabulary {
    nodes: Record<string, { properties: Record<string, { kind: string; default?: unknown }>; commands: string[] }>;
    /** The commands that resolve without a node type: `to`, `set`, the paints, the variable commands. */
    commands: string[];
}

export function registryVocabulary(registry: Registry): RegistryVocabulary {
    const nodes: RegistryVocabulary["nodes"] = {};
    for (const key of registry.nodeKeys()) {
        const properties: RegistryVocabulary["nodes"][string]["properties"] = {};
        for (const [prop, described] of Object.entries(registry.describe(key)?.properties ?? {})) {
            properties[prop] = {
                kind: described.kind,
                ...(described.default !== undefined && { default: JSON.parse(JSON.stringify(described.default)) as unknown }),
            };
        }
        nodes[key] = { properties, commands: registry.commandKeys(key) };
    }
    return { nodes, commands: registry.commandKeys() };
}

/** One way `next` takes something away from what documents saved against `prev` relied on, named `type.prop`, `type.command` or `type`. */
export interface VocabularyBreak {
    name: string;
    what: "node type removed" | "prop removed" | "default changed" | "command removed";
}

/** What `next` removed or changed relative to `prev`. Anything it adds breaks nothing saved. */
export function vocabularyBreaks(prev: RegistryVocabulary, next: RegistryVocabulary): VocabularyBreak[] {
    const out: VocabularyBreak[] = [];
    for (const command of prev.commands) {
        if (!next.commands.includes(command)) out.push({ name: command, what: "command removed" });
    }
    for (const [type, was] of Object.entries(prev.nodes)) {
        const now = next.nodes[type];
        if (!now) {
            out.push({ name: type, what: "node type removed" });
            continue;
        }
        for (const [prop, { default: before }] of Object.entries(was.properties)) {
            const after = now.properties[prop];
            if (!after) out.push({ name: `${type}.${prop}`, what: "prop removed" });
            else if (JSON.stringify(before) !== JSON.stringify(after.default)) out.push({ name: `${type}.${prop}`, what: "default changed" });
        }
        for (const command of was.commands) {
            if (!now.commands.includes(command)) out.push({ name: `${type}.${command}`, what: "command removed" });
        }
    }
    return out;
}

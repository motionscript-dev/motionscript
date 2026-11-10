import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { evaluatorFor, precompFor } from "@/runtime/document.fixtures";

import { DOCUMENT_FORMAT_VERSION, migrateDocument } from "../migrate";
import type { ProjectDocument } from "../project";
import { Registry } from "../registry";
import { validateProjectDocument } from "../validate";
import { registryVocabulary, vocabularyBreaks, type RegistryVocabulary } from "../vocabulary";
import { jsonFiles, manifestFor, releases, root } from "./corpus.fixtures";

/** The notes of every changeset not yet released that start `**Breaking:**`. */
function pendingBreakingNotes(): string {
    const dir = resolve(root, "../../../../../.changeset");
    const released = new Set((JSON.parse(readFileSync(join(dir, "pre.json"), "utf8")) as { changesets: string[] }).changesets);
    return readdirSync(dir)
        .filter((name) => name.endsWith(".md") && name !== "README.md" && !released.has(name.slice(0, -3)))
        .map((name) => readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n").split(/^---$/m).slice(2).join("---").trim())
        .filter((note) => note.startsWith("**Breaking:**"))
        .join("\n");
}
const registry = new Registry({ strict: true });

describe("the saved-document corpus", () => {
    it("has a set from at least one release", () => {
        expect(releases.length).toBeGreaterThan(0);
    });

    // A document never adds, removes or reparents a node, so the lifecycle commands are no row's.
    it("names every built-in node type and every command a document can", () => {
        const types = new Set<string>();
        const commands = new Set<string>();
        for (const release of releases) {
            for (const file of jsonFiles(join(root, release))) {
                const doc = JSON.parse(readFileSync(file, "utf8")) as ProjectDocument;
                for (const { clip } of doc.tracks) {
                    for (const node of clip.nodes) types.add(node.type);
                    if ("commands" in clip) for (const command of clip.commands) commands.add(command.type);
                }
            }
        }
        const every = new Set(registry.commandKeys());
        for (const type of registry.nodeKeys()) for (const key of registry.commandKeys(type)) every.add(key);
        expect(registry.nodeKeys().filter((type) => !types.has(type))).toEqual([]);
        expect([...every].filter((key) => !commands.has(key)).sort()).toEqual(["addChildAt", "removeChildAt", "reparent"]);
    });

    // A sparse row leaves most props at their default, so a changed default changes saved
    // documents as surely as a removed prop does. Each must be named by a pending breaking changeset.
    it("takes nothing away from the newest set's vocabulary that no breaking changeset names", () => {
        const newest = JSON.parse(readFileSync(join(root, releases.at(-1)!, "vocabulary.json"), "utf8")) as RegistryVocabulary;
        const notes = pendingBreakingNotes();
        const unannounced = vocabularyBreaks(newest, registryVocabulary(new Registry()))
            .filter(({ name }) => !notes.includes(`\`${name}\``))
            .map(({ name, what }) => `${name}: ${what}`);
        expect(unannounced).toEqual([]);
    });

    for (const release of releases) {
        describe(release, () => {
            for (const file of jsonFiles(join(root, release))) {
                it(`migrates, validates and builds ${relative(join(root, release), file).replaceAll("\\", "/")}`, () => {
                    const stored = JSON.parse(readFileSync(file, "utf8")) as ProjectDocument;
                    const { document, to } = migrateDocument(stored);
                    expect(to).toBe(DOCUMENT_FORMAT_VERSION);
                    expect(validateProjectDocument(document, { registry }).issues).toEqual([]);

                    const assets = new ManifestAssetCatalog(manifestFor(document));
                    const scope = { registry, assets, fps: document.fps!, viewport: document.viewport! };
                    const result = precompFor(document, scope).run();
                    expect(result.buildErrors).toEqual([]);

                    const evaluator = evaluatorFor(document, scope);
                    for (const frame of new Set([0, Math.floor(result.totalFrames / 2), Math.max(0, result.totalFrames - 1)])) {
                        evaluator.stateAt(frame);
                    }
                });
            }
        });
    }
});

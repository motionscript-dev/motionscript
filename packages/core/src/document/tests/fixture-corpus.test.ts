import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { evaluatorFor, precompFor } from "@/runtime/document.fixtures";

import { DOCUMENT_FORMAT_VERSION, migrateDocument } from "../migrate";
import type { ProjectDocument } from "../project";
import { Registry } from "../registry";
import { validateProjectDocument } from "../validate";
import { registryVocabulary, vocabularyBreaks, type RegistryVocabulary } from "../vocabulary";
import { jsonFiles, manifestFor, releases, removedRows, root } from "./corpus.fixtures";

/** The notes of every changeset not yet released that start `**Breaking:**`. */
function pendingBreakingNotes(): string {
    const dir = resolve(root, "../../../../../.changeset");
    // A stable release leaves pre mode, deleting pre.json: every changeset still here is then pending.
    const pre = join(dir, "pre.json");
    const released = new Set(existsSync(pre) ? (JSON.parse(readFileSync(pre, "utf8")) as { changesets: string[] }).changesets : []);
    return readdirSync(dir)
        .filter((name) => name.endsWith(".md") && name !== "README.md" && !released.has(name.slice(0, -3)))
        .map((name) => readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n").split(/^---$/m).slice(2).join("---").trim())
        .filter((note) => note.startsWith("**Breaking:**"))
        .join("\n");
}
/**
 * The breaking entries of core's changelog for a version that has no snapshot yet. Versioning a release consumes
 * its changesets and its snapshot is written only once it has published, so on the release commit the notes are here.
 */
function unsnapshottedBreakingNotes(): string {
    const core = resolve(root, "../../..");
    const { version } = JSON.parse(readFileSync(join(core, "package.json"), "utf8")) as { version: string };
    if (releases.includes(version)) return "";
    const changelog = readFileSync(join(core, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
    const section = changelog.split(/^## /m).find((part) => part.startsWith(`${version}\n`)) ?? "";
    return section.split("\n").filter((line) => line.includes("**Breaking:**")).join("\n");
}

const registry = new Registry({ strict: true });
const lenient = new Registry();

describe("the saved-document corpus", () => {
    it("has a set from at least one release", () => {
        expect(releases.length).toBeGreaterThan(0);
    });

    // A document never adds, removes or reparents a node, so the lifecycle commands are no row's. A type the
    // newest set's vocabulary lacks is new since that release; its coverage row joins the corpus at the next one, and so does a command it lacks.
    // Reads every saved release, which takes over the default 5 s beside the rest of the suite.
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
        const known = (JSON.parse(readFileSync(join(root, releases.at(-1)!, "vocabulary.json"), "utf8")) as RegistryVocabulary).nodes;
        expect(registry.nodeKeys().filter((type) => !types.has(type) && type in known)).toEqual([]);
        const said = new Set(Object.values(known).flatMap((node) => node.commands));
        expect([...every].filter((key) => !commands.has(key) && said.has(key)).sort()).toEqual(["addChildAt", "removeChildAt", "reparent"]);
    }, 30_000);

    // A sparse row leaves most props at their default, so a changed default changes saved
    // documents as surely as a removed prop does. Each must be named by a pending breaking changeset.
    it("takes nothing away from the newest set's vocabulary that no breaking changeset names", () => {
        const newest = JSON.parse(readFileSync(join(root, releases.at(-1)!, "vocabulary.json"), "utf8")) as RegistryVocabulary;
        const notes = `${pendingBreakingNotes()}\n${unsnapshottedBreakingNotes()}`;
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
                    const removed = removedRows(document);
                    expect(validateProjectDocument(document, { registry }).issues)
                        .toEqual(removed.map(({ type, path }) => ({ path, message: `node type "${type}" is not registered.` })));

                    const assets = new ManifestAssetCatalog(manifestFor(document));
                    const scope = { registry: removed.length > 0 ? lenient : registry, assets, fps: document.fps!, viewport: document.viewport! };
                    const result = precompFor(document, scope).run();
                    const ids = new Set(removed.map(({ id }) => id));
                    expect(result.buildErrors.filter((e) => e.code === "unknown-node-type").map((e) => e.nodeId)).toEqual([...ids]);
                    // A command aimed at a removed row is skipped with it.
                    expect(result.buildErrors.filter((e) => e.code !== "unknown-node-type" && !(e.code === "unknown-command" && ids.has(e.nodeId!))))
                        .toEqual([]);

                    const evaluator = evaluatorFor(document, scope);
                    for (const frame of new Set([0, Math.floor(result.totalFrames / 2), Math.max(0, result.totalFrames - 1)])) {
                        evaluator.stateAt(frame);
                    }
                });
            }
        });
    }
});

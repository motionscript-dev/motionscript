import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";
import { evaluatorFor, precompFor } from "@/runtime/document.fixtures";

import { DOCUMENT_FORMAT_VERSION, migrateDocument } from "../migrate";
import type { ProjectDocument } from "../project";
import { Registry } from "../registry";
import { validateProjectDocument } from "../validate";
import { registryVocabulary, vocabularyBreaks, type RegistryVocabulary } from "../vocabulary";

// Documents as each release wrote them (`packages/e2e/scripts/snapshot-document-fixtures.ts`).
// A set is never edited or removed: a document a user saved under that release
// has to keep opening, so a change that breaks one needs a migration, not a new fixture.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/documents");

function jsonFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return jsonFiles(path);
        return entry.name.endsWith(".json") && entry.name !== "vocabulary.json" ? [path] : [];
    });
}

/** Every media file a document names (a `src`, or a 3D fill naming a picture), as the asset a host would have listed for it. Bytes are never read. */
const MEDIA = /^[\w./-]+\.(jpe?g|png|svg|webp|gif|mp4|webm|mov|mp3|wav|ogg|m4a|aac)$/i;

function manifestFor(doc: unknown): AssetManifest {
    const manifest: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };
    const visit = (value: unknown): void => {
        if (typeof value === "string" && MEDIA.test(value)) add(value.replace(/^\.\//, ""));
        else if (typeof value === "object" && value !== null) Object.values(value).forEach(visit);
    };
    const add = (src: string): void => {
        const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
        if (["mp4", "webm", "mov"].includes(ext)) {
            manifest.video[src] = { src, width: 640, height: 360, duration: 4, sizeBytes: 1 };
            manifest.audio[src] = { src, duration: 4, sizeBytes: 1 };
        } else if (["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) {
            manifest.audio[src] = { src, duration: 4, sizeBytes: 1 };
        } else {
            manifest.image[src] = { src, width: 640, height: 480, sizeBytes: 1 };
        }
    };
    visit(doc);
    return manifest;
}

const releases = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

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

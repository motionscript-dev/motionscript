import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssetManifest } from "@/assets/manifest";

// Documents as each release wrote them (`packages/e2e/scripts/snapshot-document-fixtures.ts`).
// A set is never edited or removed: a document a user saved under that release
// has to keep opening, so a change that breaks one needs a migration, not a new fixture.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/documents");

export function jsonFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return jsonFiles(path);
        return entry.name.endsWith(".json") && entry.name !== "vocabulary.json" ? [path] : [];
    });
}

/** Every media file a document names (a `src`, or a 3D fill naming a picture), as the asset a host would have listed for it. Bytes are never read. */
const MEDIA = /^[\w./-]+\.(jpe?g|png|svg|webp|gif|mp4|webm|mov|mp3|wav|ogg|m4a|aac)$/i;

export function manifestFor(doc: unknown): AssetManifest {
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

export const releases = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

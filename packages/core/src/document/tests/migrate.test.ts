import { describe, expect, it } from "vitest";

import { resolveProjectDocument } from "@/runtime/session";

import {
    DOCUMENT_FORMAT_VERSION,
    DOCUMENT_MIGRATIONS,
    DocumentTooNewError,
    documentFormatVersion,
    migrateDocument,
    migrateDocumentWith,
    type DocumentMigration,
} from "../migrate";
import type { ProjectDocument } from "../project";
import type { StillDocument } from "../types";
import { validateDocument } from "../validate";

const OUTPUT = { viewport: { width: 100, height: 100 }, fps: 30 };
const still = (over: Record<string, unknown> = {}): StillDocument =>
    ({ kind: "still", nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} }], ...over }) as StillDocument;
const project = (clip: object, over: Record<string, unknown> = {}): ProjectDocument =>
    ({ kind: "project", name: "P", tracks: [{ id: "t", duration: 1, clip }], ...over }) as ProjectDocument;

describe("a document's format version", () => {
    it("starts again at 1 with no steps, so nothing a 0.x engine wrote is read", () => {
        expect(DOCUMENT_FORMAT_VERSION).toBe(1);
        expect(DOCUMENT_MIGRATIONS).toEqual([]);
    });

    it("is its formatVersion, or the current one when it has none", () => {
        expect(documentFormatVersion(still())).toBe(DOCUMENT_FORMAT_VERSION);
        expect(documentFormatVersion(still({ formatVersion: 1 }))).toBe(1);
        expect(documentFormatVersion(null)).toBe(DOCUMENT_FORMAT_VERSION);
    });

    it("must be a whole number from 1", () => {
        for (const bad of [0, -1, 1.5, "1"]) {
            expect(() => documentFormatVersion(still({ formatVersion: bad }))).toThrow(TypeError);
        }
    });

    it("is validated where present, and absent is fine", () => {
        expect(validateDocument(still()).valid).toBe(true);
        expect(validateDocument(still({ formatVersion: 1 })).valid).toBe(true);
        expect(validateDocument(still({ formatVersion: 0 })).issues.map((i) => i.path)).toEqual(["formatVersion"]);
        expect(validateDocument(still({ formatVersion: 2 })).issues.map((i) => i.path)).toEqual(["formatVersion"]);
    });
});

describe("migrateDocument", () => {
    it("hands a current document back as it is, stamped or not", () => {
        for (const doc of [still(), still({ formatVersion: DOCUMENT_FORMAT_VERSION })]) {
            expect(migrateDocument(doc)).toEqual({ document: doc, from: DOCUMENT_FORMAT_VERSION, to: DOCUMENT_FORMAT_VERSION, changes: [] });
            expect(migrateDocument(doc).document).toBe(doc);
        }
    });

    it("refuses a document newer than the engine with a typed error", () => {
        const next = DOCUMENT_FORMAT_VERSION + 1;
        expect(() => migrateDocument(still({ formatVersion: next }))).toThrow(DocumentTooNewError);
        try {
            migrateDocument(project(still({ formatVersion: next })));
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentTooNewError);
            expect([(error as DocumentTooNewError).version, (error as DocumentTooNewError).supported]).toEqual([next, DOCUMENT_FORMAT_VERSION]);
        }
    });

    it("passes anything that is not a document through for validation to describe", () => {
        expect(migrateDocument(null).document).toBeNull();
        expect(migrateDocument([1]).document).toEqual([1]);
    });
});

describe("the runner, over steps of its own", () => {
    // Format 1 → 2 renames `rect` rows to `box`; the project step names the project. Format 2 → 3 does nothing.
    const steps: DocumentMigration[] = [
        {
            from: 1,
            description: "rect became box",
            clip: (clip, note) => ({
                ...clip,
                nodes: (clip.nodes as { type: string }[]).map((n, i) => {
                    if (n.type !== "rect") return n;
                    note(`nodes[${i}].type`, "rect is box now");
                    return { ...n, type: "box" };
                }),
            }),
            project: (p, note) => {
                note("name", "named");
                return { ...p, name: `${p.name as string}!` };
            },
        },
        { from: 2, description: "nothing" },
    ];
    const run = (doc: unknown) => migrateDocumentWith(doc, steps, 3);
    const typesOf = (doc: unknown) => ((doc as StillDocument).nodes ?? []).map((n) => n.type);

    it("runs every step from the document's format, in order, and stamps the result", () => {
        const result = run(still({ formatVersion: 1 }));
        expect(typesOf(result.document)).toEqual(["box"]);
        expect((result.document as StillDocument).formatVersion).toBe(3);
        expect(result.changes).toEqual([{ from: 1, path: "nodes[0].type", message: "rect is box now" }]);
        expect(run(still({ formatVersion: 3 })).changes).toEqual([]);
    });

    it("reads a project's clip at the project's format unless the clip says its own", () => {
        const inherits = run(project(still(), { formatVersion: 3 })).document as ProjectDocument;
        expect(typesOf(inherits.tracks[0].clip)).toEqual(["rect"]);
        expect(inherits.tracks[0].clip.formatVersion).toBeUndefined();

        const own = run(project(still({ formatVersion: 1 }), { formatVersion: 3 })).document as ProjectDocument;
        expect(typesOf(own.tracks[0].clip)).toEqual(["box"]);
        expect(own.tracks[0].clip.formatVersion).toBe(3);
        expect(own.name).toBe("P");

        const old = run(project(still(), { formatVersion: 1 })).document as ProjectDocument;
        expect(old.name).toBe("P!");
        expect(old.formatVersion).toBe(3);
        expect(typesOf(old.tracks[0].clip)).toEqual(["box"]);
    });

    it("names a gap in the steps", () => {
        expect(() => migrateDocumentWith(still({ formatVersion: 1 }), [steps[1]], 3)).toThrow("No document migration from format 1 to 2.");
    });
});

describe("opening a document", () => {
    it("plays a current document as it was given", () => {
        const clip = still();
        expect(resolveProjectDocument(clip, {}, OUTPUT).tracks[0].clip).toBe(clip);
    });

    it("refuses a newer format with DocumentTooNewError", () => {
        expect(() => resolveProjectDocument(still({ formatVersion: DOCUMENT_FORMAT_VERSION + 1 }), {}, OUTPUT))
            .toThrow(DocumentTooNewError);
    });
});

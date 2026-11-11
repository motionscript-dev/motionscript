import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { evaluatorFor, precompFor } from "@/runtime/document.fixtures";
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
import { Registry } from "../registry";
import type { CompositionDocument, StillDocument } from "../types";
import { validateDocument, validateProjectDocument } from "../validate";

const OUTPUT = { viewport: { width: 100, height: 100 }, fps: 30 };
const still = (over: Record<string, unknown> = {}): StillDocument =>
    ({ kind: "still", nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} }], ...over }) as StillDocument;
const project = (clip: object, over: Record<string, unknown> = {}): ProjectDocument =>
    ({ kind: "project", name: "P", tracks: [{ id: "t", duration: 1, clip }], ...over }) as ProjectDocument;
const frozen = <T>(value: T): T => {
    if (typeof value === "object" && value !== null) {
        for (const v of Object.values(value)) frozen(v);
        Object.freeze(value);
    }
    return value;
};

describe("a document's format version", () => {
    it("is its formatVersion, or 0 when it has none", () => {
        expect(documentFormatVersion(still())).toBe(0);
        expect(documentFormatVersion(still({ formatVersion: 1 }))).toBe(1);
        expect(documentFormatVersion("not a document")).toBe(0);
    });

    it("must be a whole number", () => {
        for (const formatVersion of [-1, 1.5, "1", null]) {
            expect(() => documentFormatVersion(still({ formatVersion }))).toThrow(/formatVersion must be a whole number/);
        }
    });

    it("is validated where present, and absent is fine", () => {
        expect(validateDocument(still()).issues).toEqual([]);
        expect(validateDocument(still({ formatVersion: DOCUMENT_FORMAT_VERSION })).issues).toEqual([]);
        expect(validateDocument(still({ formatVersion: "1" })).issues.map((i) => i.path)).toEqual(["formatVersion"]);
        expect(validateDocument(still({ formatVersion: DOCUMENT_FORMAT_VERSION + 1 })).issues[0].message)
            .toMatch(/newer than this engine reads/);
        expect(validateProjectDocument(project(still(), { formatVersion: 99 })).issues.map((i) => i.path)).toEqual(["formatVersion"]);
    });
});

describe("the steps", () => {
    it("go one format at a time from 0 to the current one, each with a description", () => {
        expect(DOCUMENT_MIGRATIONS.map((m) => m.from)).toEqual([...Array(DOCUMENT_FORMAT_VERSION).keys()]);
        for (const step of DOCUMENT_MIGRATIONS) expect(step.description.length).toBeGreaterThan(0);
    });

    describe("0 → 1", () => {
        const step = DOCUMENT_MIGRATIONS[0];
        const run = (clip: Record<string, unknown>) => {
            const notes: string[] = [];
            return { out: step.clip!(frozen(clip), (path, message) => notes.push(`${path}: ${message}`)), notes };
        };

        it("leaves a document without retired fields alone", () => {
            const doc = still();
            expect(run(doc as never).out).toBe(doc);
        });

        it("moves constants into variables without their kind", () => {
            const { out, notes } = run({
                kind: "composition",
                nodes: [],
                commands: [],
                variables: [{ id: "v", value: 1 }],
                constants: [{ id: "g", kind: "number", value: 9.8 }],
            });
            expect(out).toEqual({ kind: "composition", nodes: [], commands: [], variables: [{ id: "v", value: 1 }, { id: "g", value: 9.8 }] });
            expect(notes).toEqual(["constants: 1 constant row(s) moved into `variables`."]);
            expect(validateDocument(out).valid).toBe(true);
        });
    });

    describe("1 → 2", () => {
        const step = DOCUMENT_MIGRATIONS[1];
        const run = (clip: Record<string, unknown>) => {
            const notes: string[] = [];
            return { out: step.clip!(frozen(clip), (path, message) => notes.push(`${path}: ${message}`)), notes };
        };
        const SKSL_MAIN = "uniform float u_amount;\nhalf4 main(float2 p) { return half4(u_amount); }";
        const SKSL_UNIFORM_ONLY = "uniform shader u_backdrop;\nvec4 main(vec2 p) { return u_backdrop.eval(p); }";
        const WGSL = "struct Params { amount: f32 }\nfn fill(in: FillIn) -> vec4f { return vec4f(u.amount); }";
        const rect = (props: Record<string, unknown>) => ({ id: "a", type: "rect", parentId: null, layerOrder: 0, props });
        const PORT = "SkSL shaders no longer draw; port it to WGSL.";

        it("leaves a document with only WGSL shaders alone, by identity", () => {
            const doc = still({ nodes: [rect({ fill: { type: "shader", source: WGSL, language: "wgsl" } })] });
            const { out, notes } = run(doc as never);
            expect(out).toBe(doc);
            expect(notes).toEqual([]);
        });

        it("stamps an SkSL fill that said so, or whose source shows it, keeping the source", () => {
            const { out, notes } = run(still({
                nodes: [rect({
                    fill: [
                        { type: "shader", source: SKSL_MAIN, language: "sksl", coords: "centered" },
                        { type: "shader", source: SKSL_UNIFORM_ONLY },
                        { type: "shader", source: WGSL },
                    ],
                })],
            }) as never);
            expect((out.nodes as { props: { fill: unknown[] } }[])[0].props.fill).toEqual([
                { type: "shader", source: SKSL_MAIN, language: "sksl" },
                { type: "shader", source: SKSL_UNIFORM_ONLY, language: "sksl" },
                { type: "shader", source: WGSL },
            ]);
            expect(notes).toEqual([`nodes[0].props.fill[0]: ${PORT}`, `nodes[0].props.fill[1]: ${PORT}`]);
        });

        it("drops coords from a WGSL fill, which never read it", () => {
            const { out, notes } = run(still({ nodes: [rect({ fill: { type: "shader", source: WGSL, coords: "local" } })] }) as never);
            expect((out.nodes as { props: { fill: unknown } }[])[0].props.fill).toEqual({ type: "shader", source: WGSL });
            expect(notes).toEqual(["nodes[0].props.fill: `coords` dropped; it only ever applied to SkSL."]);
        });

        it("renames the retired sksl effect key and its source field, as SkSL whatever the source", () => {
            const { out, notes } = run({
                kind: "composition",
                nodes: [rect({ effects: [{ type: "blur", radius: 2 }, { type: "sksl", shader: "src", uniforms: [{ name: "u_a", value: 1 }], mode: "backdrop" }] })],
                commands: [{ id: "c", type: "to", targetId: "a", at: 0, duration: 1, args: { effects: [{ type: "sksl", shader: "src", uniforms: [{ name: "u_a", value: 2 }] }] } }],
            });
            const effects = (out.nodes as { props: { effects: unknown[] } }[])[0].props.effects;
            expect(effects).toEqual([
                { type: "blur", radius: 2 },
                { type: "shader", source: "src", language: "sksl", uniforms: [{ name: "u_a", value: 1 }], mode: "backdrop" },
            ]);
            expect((out.commands as { args: { effects: unknown[] } }[])[0].args.effects)
                .toEqual([{ type: "shader", source: "src", language: "sksl", uniforms: [{ name: "u_a", value: 2 }] }]);
            expect(notes).toEqual([`nodes[0].props.effects[1]: ${PORT}`, `commands[0].args.effects[0]: ${PORT}`]);
        });

        it("keeps an sksl-keyed effect that said it was WGSL as WGSL", () => {
            const { out, notes } = run(still({ nodes: [rect({ effects: [{ type: "sksl", shader: WGSL, language: "wgsl", uniforms: {} }] })] }) as never);
            expect((out.nodes as { props: { effects: unknown[] } }[])[0].props.effects)
                .toEqual([{ type: "shader", source: WGSL, language: "wgsl", uniforms: {} }]);
            expect(notes).toEqual(["nodes[0].props.effects[0]: The retired `sksl` effect key is now `shader`."]);
        });

        it("stamps an embedded shader pack", () => {
            const pack = { scope: "fill", name: "Swirl", source: SKSL_MAIN, coords: "centered", properties: {} };
            const { out } = run(still({ nodes: [rect({ fill: { type: "shader", source: WGSL } })], meta: { pack } }) as never);
            expect((out.meta as { pack: unknown }).pack).toEqual({ scope: "fill", name: "Swirl", source: SKSL_MAIN, language: "sksl", properties: {} });
        });

        it("gives a document that validates and builds, its SkSL shaders carried for the renderer to report", () => {
            const legacy = project({
                kind: "composition",
                formatVersion: 1,
                nodes: [rect({
                    width: 100, height: 100,
                    fill: { type: "shader", source: SKSL_MAIN, uniforms: { u_amount: 0.5 }, coords: "normalized" },
                    effects: [{ type: "sksl", shader: SKSL_UNIFORM_ONLY, uniforms: [], mode: "backdrop" }],
                })],
                commands: [{ id: "c", type: "to", targetId: "a", at: 0, duration: 1, args: { fill: { type: "shader", source: SKSL_MAIN, uniforms: { u_amount: 1 } } } }],
            }, { ...OUTPUT, formatVersion: 1 });
            const { document, changes } = migrateDocument(legacy);
            expect(changes.map((c) => c.path)).toEqual([
                "tracks[0].clip.nodes[0].props.fill",
                "tracks[0].clip.nodes[0].props.effects[0]",
                "tracks[0].clip.commands[0].args.fill",
            ]);

            const registry = new Registry({ strict: true });
            expect(validateProjectDocument(document, { registry }).issues).toEqual([]);
            const scope = { registry, assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }), ...OUTPUT };
            const result = precompFor(document, scope).run();
            expect(result.buildErrors).toEqual([]);
            const evaluator = evaluatorFor(document, scope);
            evaluator.stateAt(0);
            evaluator.stateAt(result.totalFrames - 1);

            const props = (document.tracks[0].clip.nodes[0] as unknown as { props: { fill: { language?: string }; effects: { type: string; language?: string }[] } }).props;
            expect(props.fill.language).toBe("sksl");
            expect(props.effects[0]).toMatchObject({ type: "shader", language: "sksl" });
        });
    });

    describe("2 → 3", () => {
        const step = DOCUMENT_MIGRATIONS[2];
        const run = (clip: object) => {
            const notes: string[] = [];
            return { out: step.clip!(frozen(clip) as Record<string, unknown>, (path, message) => notes.push(`${path}: ${message}`)), notes };
        };
        const rect = (props: Record<string, unknown>) => ({ id: "a", type: "rect", parentId: null, layerOrder: 0, props });
        const GRAY = [{ type: "grayscale", amount: 1 }];
        const BLUR = [{ type: "blur", radius: 3 }];

        it("leaves a document whose fills already carry a preset alone, by identity", () => {
            const doc = still({ nodes: [rect({ fill: { type: "image", src: "a.jpg", preset: { adjustments: GRAY, intensity: 0.5 } } })] });
            const { out, notes } = run(doc as never);
            expect(out).toBe(doc);
            expect(notes).toEqual([]);
        });

        it("moves an image or video fill's filters into preset.adjustments, wherever the fill sits", () => {
            const { out, notes } = run(still({
                nodes: [rect({
                    fill: [{ type: "image", src: "a.jpg", fit: "fill", filters: GRAY }, { type: "video", src: "a.mp4", filters: BLUR }],
                })],
                commands: [{ id: "c", type: "to", targetId: "a", at: 0, duration: 1, args: { fill: { type: "image", src: "a.jpg", filters: BLUR } } }],
            }));
            expect(out).toEqual(still({
                nodes: [rect({
                    fill: [
                        { type: "image", src: "a.jpg", fit: "fill", preset: { adjustments: GRAY } },
                        { type: "video", src: "a.mp4", preset: { adjustments: BLUR } },
                    ],
                })],
                commands: [{ id: "c", type: "to", targetId: "a", at: 0, duration: 1, args: { fill: { type: "image", src: "a.jpg", preset: { adjustments: BLUR } } } }],
            }));
            expect(notes).toEqual([
                "nodes[0].props.fill[0]: `filters` moved to `preset.adjustments`.",
                "nodes[0].props.fill[1]: `filters` moved to `preset.adjustments`.",
                "commands[0].args.fill: `filters` moved to `preset.adjustments`.",
            ]);
        });

        it("keeps the rest of a preset, and its adjustments over filters when the fill carried both", () => {
            const { out } = run(still({
                nodes: [rect({
                    fill: [
                        { type: "image", src: "a.jpg", filters: GRAY, preset: { intensity: 0.5 } },
                        { type: "image", src: "b.jpg", filters: GRAY, preset: { adjustments: BLUR } },
                    ],
                })],
            }));
            expect((out.nodes as { props: { fill: unknown } }[])[0].props.fill).toEqual([
                { type: "image", src: "a.jpg", preset: { intensity: 0.5, adjustments: GRAY } },
                { type: "image", src: "b.jpg", preset: { adjustments: BLUR } },
            ]);
        });

        it("does not mistake a Video node's own filters, or an object that is not a media fill, for one", () => {
            const doc = still({
                nodes: [
                    { id: "v", type: "video", parentId: null, layerOrder: 0, props: { src: "a.mp4", filters: BLUR } },
                    rect({ fill: { type: "solid", filters: GRAY }, effects: [{ type: "blur", filters: GRAY }] }),
                ],
            });
            expect(run(doc as never).out).toBe(doc);
        });

        it("gives a document that validates and builds, its image grade carried in the preset", () => {
            const legacy = project({
                kind: "still",
                formatVersion: 2,
                nodes: [rect({ width: 100, height: 100, fill: { type: "image", src: "a.jpg", filters: GRAY } })],
            }, { ...OUTPUT, formatVersion: 2 });
            const { document, changes } = migrateDocument(legacy);
            expect(changes.map((c) => c.path)).toEqual(["tracks[0].clip.nodes[0].props.fill"]);
            const registry = new Registry({ strict: true });
            expect(validateProjectDocument(document, { registry }).issues).toEqual([]);
            const scope = { registry, assets: new ManifestAssetCatalog({ image: { "a.jpg": { src: "a.jpg", width: 4, height: 4, sizeBytes: 1 } }, video: {}, audio: {}, font: {} }), ...OUTPUT };
            const result = precompFor(document, scope).run();
            expect(result.buildErrors).toEqual([]);
        });
    });
});

describe("migrateDocument", () => {
    it("hands a current document back as it is", () => {
        const doc = still({ formatVersion: DOCUMENT_FORMAT_VERSION });
        expect(migrateDocument(doc)).toEqual({ document: doc, from: DOCUMENT_FORMAT_VERSION, to: DOCUMENT_FORMAT_VERSION, changes: [] });
        expect(migrateDocument(doc).document).toBe(doc);
    });

    it("stamps a legacy document without mutating it", () => {
        const doc = frozen(still());
        const result = migrateDocument(doc);
        expect(result.from).toBe(0);
        expect(result.to).toBe(DOCUMENT_FORMAT_VERSION);
        expect(result.document).toEqual({ ...doc, formatVersion: DOCUMENT_FORMAT_VERSION });
        expect(result.changes).toEqual([]);
    });

    it("reports what each step changed, located in the document", () => {
        const clip = { kind: "composition", nodes: [], commands: [], constants: [{ id: "g", kind: "number", value: 1 }] };
        expect(migrateDocument(clip).changes).toEqual([
            { from: 0, path: "constants", message: "1 constant row(s) moved into `variables`." },
        ]);
        expect(migrateDocument(project(clip)).changes.map((c) => c.path)).toEqual(["tracks[0].clip.constants"]);
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
    // Format 1 → 2 renames `rect` rows to `box`; the project step names the project.
    const steps: DocumentMigration[] = [
        DOCUMENT_MIGRATIONS[0],
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
    ];
    const run = (doc: unknown) => migrateDocumentWith(doc, steps, 2);
    const typesOf = (doc: unknown) => ((doc as StillDocument).nodes ?? []).map((n) => n.type);

    it("runs every step from the document's format, in order", () => {
        expect(typesOf(run(still()).document)).toEqual(["box"]);
        expect(typesOf(run(still({ formatVersion: 1 })).document)).toEqual(["box"]);
        expect(run(still({ formatVersion: 2 })).changes).toEqual([]);
        expect(run(still({ formatVersion: 1 })).changes).toEqual([{ from: 1, path: "nodes[0].type", message: "rect is box now" }]);
    });

    it("reads a project's clip at the project's format unless the clip says its own", () => {
        const inherits = run(project(still(), { formatVersion: 2 })).document as ProjectDocument;
        expect(typesOf(inherits.tracks[0].clip)).toEqual(["rect"]);
        expect(inherits.tracks[0].clip.formatVersion).toBeUndefined();

        const own = run(project(still({ formatVersion: 1 }), { formatVersion: 2 })).document as ProjectDocument;
        expect(typesOf(own.tracks[0].clip)).toEqual(["box"]);
        expect(own.tracks[0].clip.formatVersion).toBe(2);
        expect(own.name).toBe("P");

        const legacy = run(project(still())).document as ProjectDocument;
        expect(legacy.name).toBe("P!");
        expect(legacy.formatVersion).toBe(2);
        expect(typesOf(legacy.tracks[0].clip)).toEqual(["box"]);
    });

    it("names a gap in the steps", () => {
        expect(() => migrateDocumentWith(still(), [steps[1]], 2)).toThrow("No document migration from format 0 to 1.");
    });
});

describe("opening a document", () => {
    it("migrates it before validating, so a legacy field opens", () => {
        const clip: CompositionDocument = {
            kind: "composition",
            nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, props: { opacity: "=[g]" } }],
            commands: [],
            constants: [{ id: "g", kind: "number", value: 0.5 }],
        } as never;
        expect(validateDocument(clip).valid).toBe(false);
        const opened = resolveProjectDocument(clip, {}, OUTPUT);
        expect(opened.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
        expect((opened.tracks[0].clip as CompositionDocument).variables).toEqual([{ id: "g", value: 0.5 }]);
    });

    it("keeps a document that needed only a stamp as it was given", () => {
        const clip = still();
        expect(resolveProjectDocument(clip, {}, OUTPUT).tracks[0].clip).toBe(clip);
    });

    it("refuses a newer format with DocumentTooNewError", () => {
        expect(() => resolveProjectDocument(still({ formatVersion: DOCUMENT_FORMAT_VERSION + 1 }), {}, OUTPUT))
            .toThrow(DocumentTooNewError);
    });
});

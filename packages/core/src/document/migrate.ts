import type { ProjectDocument } from "./project";
import type { ClipDocument } from "./types";

/**
 * Saved documents outlive the engine that wrote them, so each carries its format and this module carries every
 * step from one format to the next. A step is a pure function over JSON: it never mutates its input and never
 * needs a registry, so a host can run it over a row it has not opened. Steps only go up; a document newer than
 * the engine is refused with {@link DocumentTooNewError} rather than read as whatever it resembles.
 */

/** The format this engine reads natively and writes. A document without `formatVersion` is format 0. */
export const DOCUMENT_FORMAT_VERSION = 3;

export class DocumentTooNewError extends Error {
    readonly version: number;
    readonly supported: number;

    constructor(version: number, supported: number = DOCUMENT_FORMAT_VERSION) {
        super(
            `This document is format ${version}, newer than this engine reads (format ${supported}). ` +
            `Open it with a newer engine.`,
        );
        this.name = "DocumentTooNewError";
        this.version = version;
        this.supported = supported;
    }
}

export type JsonDocument = Record<string, unknown>;

export interface DocumentChange {
    from: number;
    path: string;
    message: string;
}

export type NoteChange = (path: string, message: string) => void;

/** The step from format {@link from} to `from + 1`. */
export interface DocumentMigration {
    readonly from: number;
    readonly description: string;
    /** Run on every clip document, standalone or inside a project's track. */
    readonly clip?: (clip: JsonDocument, note: NoteChange) => JsonDocument;
    readonly project?: (project: JsonDocument, note: NoteChange) => JsonDocument;
}

export interface DocumentMigrationResult<T> {
    document: T;
    from: number;
    to: number;
    changes: DocumentChange[];
}

/**
 * A release that changes what a stored document means adds the next step here, bumps {@link
 * DOCUMENT_FORMAT_VERSION}, and gives the step a test (`tests/migrate.test.ts`).
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [
    {
        from: 0,
        description: "Documents start carrying `formatVersion`; a clip's retired `constants` rows become `variables`.",
        clip: (clip, note) => {
            if (!Array.isArray(clip.constants)) return clip;
            const { constants, ...rest } = clip;
            const variables = Array.isArray(rest.variables) ? [...rest.variables] : [];
            for (const row of constants as unknown[]) {
                if (typeof row !== "object" || row === null) {
                    variables.push(row);
                    continue;
                }
                const { kind: _kind, ...variable } = row as Record<string, unknown>;
                variables.push(variable);
            }
            note("constants", `${constants.length} constant row(s) moved into \`variables\`.`);
            return { ...rest, variables };
        },
    },
    {
        from: 1,
        description:
            "SkSL is retired: every shader fill, shader effect and shader pack written in it says `language: \"sksl\"`, " +
            "the `sksl` effect key becomes `shader`, and `coords` is dropped.",
        clip: (clip, note) => retireSkSL(clip, "", note) as JsonDocument,
    },
    {
        from: 2,
        description: "An image or video fill's retired `filters` prop moves into `preset.adjustments`.",
        clip: (clip, note) => retireFillFilters(clip, "", note) as JsonDocument,
    },
];

/** SkSL's entry point or an SkSL `uniform` declaration, neither of which a WGSL source can contain. */
const SKSL_SOURCE = /\b(?:half4|float4|vec4)\s+main\s*\(|^\s*uniform\s+\w+\s+\w+/m;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Fills and effects sit in node props, named fills, effect and filter arrays,
// command values and tween keyframes alike, so the whole clip is walked.
function retireSkSL(value: unknown, path: string, note: NoteChange): unknown {
    if (Array.isArray(value)) {
        let out: unknown[] | undefined;
        value.forEach((item, i) => {
            const next = retireSkSL(item, `${path}[${i}]`, note);
            if (next !== item) (out ??= [...value])[i] = next;
        });
        return out ?? value;
    }
    if (!isObject(value)) return value;
    let out: JsonObject | undefined;
    for (const [key, item] of Object.entries(value)) {
        const next = retireSkSL(item, path ? `${path}.${key}` : key, note);
        if (next !== item) (out ??= { ...value })[key] = next;
    }
    return retireShader(out ?? value, path, note);
}

function retireShader(shader: JsonObject, path: string, note: NoteChange): JsonObject {
    const legacyKey = shader.type === "sksl";
    const isShader = legacyKey
        || (shader.type === "shader" && (typeof shader.source === "string" || typeof shader.shader === "string"))
        || ((shader.scope === "fill" || shader.scope === "effect") && typeof shader.source === "string");
    if (!isShader) return shader;

    const out: JsonObject = { ...shader };
    if (legacyKey) out.type = "shader";
    const moved = out.type === "shader" && typeof out.shader === "string" && out.source === undefined;
    if (moved) {
        out.source = out.shader;
        delete out.shader;
    }
    // The `sksl` key meant SkSL whatever its source looked like, unless it said otherwise.
    const sksl = out.language === "sksl"
        || (out.language === undefined && (legacyKey || SKSL_SOURCE.test(typeof out.source === "string" ? out.source : "")));
    const stamped = sksl && out.language === undefined;
    if (stamped) out.language = "sksl";
    const hadCoords = "coords" in out;
    delete out.coords;

    if (sksl) note(path, "SkSL shaders no longer draw; port it to WGSL.");
    else if (legacyKey) note(path, "The retired `sksl` effect key is now `shader`.");
    else if (moved) note(path, "The shader's `shader` field is now `source`.");
    else if (hadCoords) note(path, "`coords` dropped; it only ever applied to SkSL.");
    return legacyKey || moved || stamped || hadCoords ? out : shader;
}

// Image and video fills sit in node props, named fills, command values and tween
// keyframes alike, so the whole clip is walked. A `Video` node's own `filters` prop
// lives in its `props`, which has no `type`, so it is never mistaken for a fill's.
function retireFillFilters(value: unknown, path: string, note: NoteChange): unknown {
    if (Array.isArray(value)) {
        let out: unknown[] | undefined;
        value.forEach((item, i) => {
            const next = retireFillFilters(item, `${path}[${i}]`, note);
            if (next !== item) (out ??= [...value])[i] = next;
        });
        return out ?? value;
    }
    if (!isObject(value)) return value;
    let out: JsonObject | undefined;
    for (const [key, item] of Object.entries(value)) {
        const next = retireFillFilters(item, path ? `${path}.${key}` : key, note);
        if (next !== item) (out ??= { ...value })[key] = next;
    }
    const fill = out ?? value;
    if (!("filters" in fill) || !(fill.type === "image" || fill.type === "video") || typeof fill.src !== "string") return fill;

    const { filters, preset, ...rest } = fill;
    // A fill that somehow carried both keeps its preset's chain, as `resolveMediaPreset` always read it.
    const keeps = isObject(preset) && preset.adjustments !== undefined;
    note(path, keeps ? "`filters` dropped; the fill's `preset.adjustments` already says the grade." : "`filters` moved to `preset.adjustments`.");
    if (keeps || (preset !== undefined && !isObject(preset))) return { ...rest, preset };
    return { ...rest, preset: { ...(isObject(preset) ? preset : {}), adjustments: filters } };
}

export function documentFormatVersion(doc: unknown): number {
    if (typeof doc !== "object" || doc === null) return 0;
    const version = (doc as { formatVersion?: unknown }).formatVersion;
    if (version === undefined) return 0;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
        throw new TypeError(`formatVersion must be a whole number >= 0 (got ${JSON.stringify(version)}).`);
    }
    return version;
}

/**
 * Bring a still, composition, audio or project document up to
 * {@link DOCUMENT_FORMAT_VERSION}.
 *
 * A clip inside a project with no `formatVersion` of its own is read at the
 * project's, since it was written alongside it. Anything that is not a
 * document comes back untouched, for validation to describe.
 */
export function migrateDocument<T extends ProjectDocument | ClipDocument>(doc: T): DocumentMigrationResult<T>;
export function migrateDocument(doc: unknown): DocumentMigrationResult<unknown>;
export function migrateDocument(doc: unknown): DocumentMigrationResult<unknown> {
    return migrateDocumentWith(doc, DOCUMENT_MIGRATIONS, DOCUMENT_FORMAT_VERSION);
}

/** @internal {@link migrateDocument} over a given list of steps, for a test pinning the runner. */
export function migrateDocumentWith(
    doc: unknown,
    migrations: readonly DocumentMigration[],
    target: number,
): DocumentMigrationResult<unknown> {
    const from = documentFormatVersion(doc);
    if (from > target) throw new DocumentTooNewError(from, target);
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
        return { document: doc, from, to: from, changes: [] };
    }
    const changes: DocumentChange[] = [];
    const json = doc as JsonDocument;
    const migrated = json.kind === "project"
        ? migrateProject(json, from, migrations, target, changes)
        : migrateClip(json, from, migrations, target, changes, "");
    return { document: migrated, from, to: target, changes };
}

function stepsBetween(from: number, to: number, migrations: readonly DocumentMigration[]): DocumentMigration[] {
    const steps: DocumentMigration[] = [];
    for (let version = from; version < to; version++) {
        const step = migrations.find((m) => m.from === version);
        if (!step) throw new Error(`No document migration from format ${version} to ${version + 1}.`);
        steps.push(step);
    }
    return steps;
}

function noteInto(changes: DocumentChange[], from: number, prefix: string): NoteChange {
    return (path, message) => changes.push({ from, path: prefix && path ? `${prefix}.${path}` : prefix || path, message });
}

/** `stamp` false leaves a clip that inherits its project's version without a field of its own. */
function migrateClip(
    clip: JsonDocument,
    from: number,
    migrations: readonly DocumentMigration[],
    target: number,
    changes: DocumentChange[],
    prefix: string,
    stamp = true,
): JsonDocument {
    if (from === target) return clip;
    let out = clip;
    for (const step of stepsBetween(from, target, migrations)) {
        if (step.clip) out = step.clip(out, noteInto(changes, step.from, prefix));
    }
    return stamp ? { ...out, formatVersion: target } : out;
}

function migrateProject(
    project: JsonDocument,
    from: number,
    migrations: readonly DocumentMigration[],
    target: number,
    changes: DocumentChange[],
): JsonDocument {
    let out = project;
    if (from < target) {
        for (const step of stepsBetween(from, target, migrations)) {
            if (step.project) out = step.project(out, noteInto(changes, step.from, ""));
        }
    }
    let tracksChanged = false;
    const tracks = Array.isArray(out.tracks)
        ? (out.tracks as unknown[]).map((track, i) => {
            if (typeof track !== "object" || track === null) return track;
            const clip = (track as { clip?: unknown }).clip;
            if (typeof clip !== "object" || clip === null || Array.isArray(clip)) return track;
            const own = (clip as { formatVersion?: unknown }).formatVersion !== undefined;
            const version = own ? documentFormatVersion(clip) : from;
            if (version > target) throw new DocumentTooNewError(version, target);
            const next = migrateClip(clip as JsonDocument, version, migrations, target, changes, `tracks[${i}].clip`, own);
            if (next === clip) return track;
            tracksChanged = true;
            return { ...(track as object), clip: next };
        })
        : out.tracks;
    if (from === target && !tracksChanged) return project;
    return { ...out, ...(tracksChanged ? { tracks } : {}), formatVersion: target };
}

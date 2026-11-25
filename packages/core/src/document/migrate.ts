import type { ProjectDocument } from "./project";
import type { ClipDocument } from "./types";

/**
 * Saved documents outlive the engine that wrote them, so each carries its format and this module carries every
 * step from one format to the next. A step is a pure function over JSON: it never mutates its input and never
 * needs a registry, so a host can run it over a row it has not opened. Steps only go up; a document newer than
 * the engine is refused with {@link DocumentTooNewError} rather than read as whatever it resembles.
 */

/**
 * The format this engine reads natively and writes. 1.0 started the count again: no 0.x format is read, and a
 * document without `formatVersion` is read as this one.
 */
export const DOCUMENT_FORMAT_VERSION = 1;

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
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [];

export function documentFormatVersion(doc: unknown): number {
    if (typeof doc !== "object" || doc === null) return DOCUMENT_FORMAT_VERSION;
    const version = (doc as { formatVersion?: unknown }).formatVersion;
    if (version === undefined) return DOCUMENT_FORMAT_VERSION;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        throw new TypeError(`formatVersion must be a whole number >= 1 (got ${JSON.stringify(version)}).`);
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

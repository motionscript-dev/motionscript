import type { Size2D } from "@/attributes/layout/size";
import type { Theme } from "@/project/config";

import type { ClipDocument, VisualDocument } from "./types";
import { documentDuration } from "./types";

/**
 * The **project** as data: a whole video, not one clip — and the one thing the
 * runtime plays.
 *
 * A clip document says what happens inside one composition. This says how those
 * compositions are laid against each other to make the finished thing — and it
 * is the same idea one level up, so it reads the same way: rows placed at times,
 * evaluated rather than played.
 *
 * ### One list of tracks
 *
 * A {@link ClipDocument} is a still, a composition *or* an audio document, and a
 * composition already carries both picture and sound — so there is one list for
 * all of it, not a second one for sound.
 *
 * **Array position is paint order**, first entry at the back, exactly as
 * position in a `fill` array is. A background is the first track; an overlay is
 * the last; a cross-dissolve is two tracks whose spans overlap and whose clips
 * fade themselves.
 */
export interface ProjectDocument {
    kind: "project";
    /** The format it was written in — see `migrate.ts`. Absent is format 0, every document written before the field existed. */
    formatVersion?: number;
    /** Human-readable project name. */
    name: string;
    /** Target frame rate. Defaults to 60. */
    fps?: number;
    /** Output canvas dimensions in pixels. Defaults to 1920×1080. */
    viewport?: Size2D;
    /** Visual design tokens (colors, typography) available to every clip. */
    theme?: Theme;
    /**
     * Every clip, placed. **Array position is paint order** — the first entry is
     * at the back.
     */
    tracks: Track[];
}

/**
 * One clip, placed on the project timeline.
 *
 * The clip document is **inline**, not referenced by id. A shared id would deduplicate JSON and
 * cost an id space, a resolution step and a dangling-reference failure mode — and
 * it would not buy what it looks like it buys, because the content that actually
 * repeats in an edit mostly has to *differ* per placement (a lower third with
 * different text, a chapter card with a different label).
 */
export interface Track {
    /**
     * Stable identity, so a host can address, reorder and diff one row — and so
     * the runtime can keep a track's built tree across an edit that leaves its
     * clip untouched.
     */
    id: string;
    /** Display label. */
    name?: string;
    /** What plays: a still, a composition, or sound. */
    clip: ClipDocument;
    /**
     * Second on the **project** timeline at which this clip's own clock reads 0.
     * Authored, never derived from the row above it, so a clip's start cannot
     * move because a neighbour changed. Defaults to 0.
     */
    startAt?: number;
    /**
     * Seconds this clip occupies. **Required.**
     *
     * So a project's length is arithmetic over its tracks rather than something
     * measured out of a media file or a timeline — a three-minute music bed
     * cannot silently make a thirty-second edit three minutes long. Longer than
     * the document holds its last frame; shorter cuts it off, which is also what
     * lets a **still**, a document with no length at all, be a backdrop.
     */
    duration: number;
}

/** Narrows an unknown document to a project. */
export function isProjectDocument(doc: unknown): doc is ProjectDocument {
    return typeof doc === "object" && doc !== null && (doc as ProjectDocument).kind === "project";
}

/**
 * The project a session plays, from either document it can open.
 *
 * A lone still or composition becomes the only track of a project around it.
 * Viewport and fps describe the output rather than the clip, so they come from
 * the caller.
 */
export function asProjectDocument(
    doc: ProjectDocument | VisualDocument,
    output: { name?: string; viewport?: Size2D; fps?: number } = {},
): ProjectDocument {
    if (isProjectDocument(doc)) return doc;
    return {
        kind: "project",
        ...(doc.formatVersion !== undefined && { formatVersion: doc.formatVersion }),
        name: output.name ?? "Untitled",
        fps: output.fps,
        viewport: output.viewport,
        theme: doc.theme,
        tracks: [{ id: "clip", clip: doc, duration: documentDuration(doc) }],
    };
}

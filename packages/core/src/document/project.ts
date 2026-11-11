import type { Size2D } from "@/attributes/layout/size";
import type { Theme } from "@/project/config";

import type { ClipDocument, VisualDocument } from "./types";
import { documentDuration } from "./types";

/**
 * The project as data: a whole video, the one thing the runtime plays. It is the clip document's idea one
 * level up: rows placed at times, evaluated rather than played.
 *
 * One list of tracks serves picture and sound, since a {@link ClipDocument} is a still, a composition or an
 * audio document and a composition already carries both. Array position is paint order, first entry at the
 * back, as in a `fill` array: a background is the first track, an overlay the last, a cross-dissolve two
 * tracks whose spans overlap and whose clips fade themselves.
 */
export interface ProjectDocument {
    kind: "project";
    /** Absent is format 0 (written before the field existed); see `migrate.ts`. */
    formatVersion?: number;
    name: string;
    /** Target frame rate. Defaults to 60. */
    fps?: number;
    /** Output canvas dimensions in pixels. Defaults to 1920×1080. */
    viewport?: Size2D;
    theme?: Theme;
    /** Array position is paint order; the first entry is at the back. */
    tracks: Track[];
}

/**
 * One clip placed on the project timeline. The clip document is inline, not referenced by id: a shared id
 * would cost an id space, a resolution step and a dangling-reference failure mode, and would not buy
 * deduplication, since repeated content mostly differs per placement (a lower third with different text).
 */
export interface Track {
    /**
     * Stable identity, so the runtime can keep a track's built tree across an edit that leaves its clip untouched.
     */
    id: string;
    name?: string;
    clip: ClipDocument;
    /**
     * Second on the project timeline at which this clip's own clock reads 0. Authored, never derived from the row
     * above, so a start cannot move because a neighbour changed.
     */
    startAt?: number;
    /**
     * Required, so a project's length is arithmetic over its tracks rather than measured out of a media file: a
     * three-minute music bed cannot silently stretch a thirty-second edit. Longer than the document holds its last
     * frame; shorter cuts it off, which is also what lets a still (no length at all) be a backdrop.
     */
    duration: number;
}

export function isProjectDocument(doc: unknown): doc is ProjectDocument {
    return typeof doc === "object" && doc !== null && (doc as ProjectDocument).kind === "project";
}

/**
 * A lone still or composition becomes the only track of a project around it. Viewport and fps describe the
 * output, not the clip, so they come from the caller.
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

import type { Track } from "@/document/project";
import type { NodeSpan } from "@/document/types";
import { clipFrameToTime, clipTimeToFrame } from "./frame-time";

/** One track's span on the project timeline. `endFrame` is inclusive. */
export interface TrackSpan {
    id: string;
    /** Also paint order: first is at the back. */
    index: number;
    startFrame: number;
    endFrame: number;
}

/**
 * Rounded up, so a length off a frame boundary covers its last partial frame, and never less than one, so a
 * still is drawn.
 */
export function trackFrameCount(seconds: number, fps: number): number {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return 1;
    return Math.max(1, Math.ceil(clipTimeToFrame(seconds, fps)));
}

/**
 * A start rounds to the nearest frame while a length rounds up: a start is a point, and flooring it would put
 * every track a frame early.
 */
export function placeTracks(tracks: readonly Track[], fps: number): TrackSpan[] {
    return tracks.map((track, index) => {
        const startFrame = Math.max(0, Math.round(clipTimeToFrame(track.startAt ?? 0, fps)));
        return { id: track.id, index, startFrame, endFrame: startFrame + trackFrameCount(track.duration, fps) - 1 };
    });
}

/** Not the sum of their lengths, since gaps and overlaps are both legal. */
export function totalFramesOf(spans: readonly { endFrame: number }[]): number {
    let total = 0;
    for (const span of spans) total = Math.max(total, span.endFrame + 1);
    return total;
}

export function spansCovering(spans: readonly TrackSpan[], frame: number): TrackSpan[] {
    return spans.filter(span => frame >= span.startFrame && frame <= span.endFrame);
}

/** Clamped, so a frame held past the end shows where the track stops. */
export function frameTime(frame: number, fps: number, duration: number): number {
    return Math.min(clipFrameToTime(frame, fps), duration);
}

/** `null` when it covers none. */
export function spanFrames(
    span: Readonly<NodeSpan>,
    fps: number,
    frameCount: number,
): { startFrame: number; endFrame: number } | null {
    const last = frameCount - 1;
    const at = (frame: number) => frameTime(frame, fps, Infinity);

    let startFrame = Math.min(last + 1, Math.max(0, Math.ceil(span.start * fps)));
    while (startFrame > 0 && at(startFrame - 1) >= span.start) startFrame--;
    while (startFrame <= last && at(startFrame) < span.start) startFrame++;

    let endFrame = last;
    if (span.end !== Infinity) {
        endFrame = Math.max(-1, Math.min(last, Math.ceil(span.end * fps)));
        while (endFrame >= 0 && at(endFrame) >= span.end) endFrame--;
        while (endFrame < last && at(endFrame + 1) < span.end) endFrame++;
    }
    return startFrame <= endFrame ? { startFrame, endFrame } : null;
}

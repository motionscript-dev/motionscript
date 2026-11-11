export type FrameSpec =
    | { kind: 'frame'; frame: number }
    | { kind: 'first' }
    | { kind: 'last' };

/** A few ulps at any frame count a clip can reach. */
const FRAME_TOLERANCE = 1e-9;

/**
 * `frame * (1 / fps)`, not `frame / fps`: the two disagree in the last bit, and every frame-to-time conversion
 * must be this one so a span boundary falls on the same side of a frame wherever it is asked.
 */
export function clipFrameToTime(frame: number, fps: number): number {
    return frame * (1 / fps);
}

/**
 * Within float error of a whole frame is that frame: `123 * (1 / 60)` times `60` is `122.99999999999999`, and
 * a floor or ceil of that is a frame off.
 */
export function clipTimeToFrame(seconds: number, fps: number): number {
    const frame = seconds * fps;
    const nearest = Math.round(frame);
    return Math.abs(frame - nearest) <= FRAME_TOLERANCE * Math.max(1, Math.abs(frame)) ? nearest : frame;
}

export function frameSpecAtTime(seconds: number, fps: number): FrameSpec {
    return { kind: 'frame', frame: Math.round(clipTimeToFrame(seconds, fps)) };
}

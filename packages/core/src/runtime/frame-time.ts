/**
 * Which frame a still addresses: an explicit project frame index, the
 * timeline's first frame, or its last.
 */
export type FrameSpec =
    | { kind: 'frame'; frame: number }
    | { kind: 'first' }
    | { kind: 'last' };

/** How far a product may sit from a whole frame and still count as on it — a few ulps at any frame count a clip can reach. */
const FRAME_TOLERANCE = 1e-9;

/**
 * The clip time of `frame`, in seconds.
 *
 * `frame * (1 / fps)`, not `frame / fps`: the two disagree in the last bit, and
 * every frame-to-time conversion has to be this one, so a span boundary falls on
 * the same side of a frame wherever it is asked.
 */
export function clipFrameToTime(frame: number, fps: number): number {
    return frame * (1 / fps);
}

/**
 * The (fractional) frame at `seconds`.
 *
 * A time that lands within float error of a whole frame is that frame:
 * `123 * (1 / 60)` times `60` is `122.99999999999999`, and a floor or a ceil of
 * that is a frame off. Anything further from a frame boundary is left as it is.
 */
export function clipTimeToFrame(seconds: number, fps: number): number {
    const frame = seconds * fps;
    const nearest = Math.round(frame);
    return Math.abs(frame - nearest) <= FRAME_TOLERANCE * Math.max(1, Math.abs(frame)) ? nearest : frame;
}

/** The {@link FrameSpec} for the whole frame nearest `seconds`. */
export function frameSpecAtTime(seconds: number, fps: number): FrameSpec {
    return { kind: 'frame', frame: Math.round(clipTimeToFrame(seconds, fps)) };
}

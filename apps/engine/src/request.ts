import { parseFrameSelector, parseImageFormat, toFrameSpec } from '@motionscript/headless';
import { HttpError } from './errors.js';

/**
 * Query parameters, validated.
 *
 * Kept apart from the server so a bad value fails here with the engine's own
 * `INVALID_OPTION` (which the server answers as a 400) rather than reaching
 * the page and coming back as a 500 or as bytes labelled as something else.
 */

/** A number parameter; absent or empty yields `undefined`. */
export function parseNumber(value: string | null): number | undefined {
    if (value === null || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new HttpError(400, `Not a number: ${value}`);
    return parsed;
}

/**
 * `at=` as a frame the bridge can address.
 *
 * `first`, `last`, a frame index (`42`) or a time in seconds (`2.5s`, `1s`),
 * parsed by the engine's own selector grammar and converted with the fps the
 * scenes render at. Absent means the last frame.
 */
export function parseFrameParam(raw: string | null, fps: number): number | 'first' | 'last' {
    if (raw === null || raw === '') return 'last';
    const spec = toFrameSpec(parseFrameSelector(raw), fps);
    return spec.kind === 'frame' ? spec.frame : spec.kind;
}

/** `format=` and the media type its bytes are labelled with. */
export function parseFormatParam(raw: string | null): { format: 'png' | 'jpeg'; mimeType: string } {
    const { format, mimeType } = parseImageFormat(raw);
    return { format, mimeType };
}

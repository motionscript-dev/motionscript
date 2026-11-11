/**
 * Every failure the engine surfaces carries one of these codes, so a service can map it onto a response without
 * pattern-matching on message text: `PROJECT_NOT_FOUND` (not a Motion Script project, 400/404), `INVALID_OPTION` (400),
 * `UNKNOWN_SCENE` (400), `START_FAILED` (entry failed to bundle or load, 500), `BRIDGE_TIMEOUT` (page never installed the
 * bridge, 500), `BRIDGE_INCOMPATIBLE` (bridge lacks a method, e.g. a stale cached bundle, 500), `RENDER_FAILED` (render
 * threw in the page, 500), `TIMEOUT` (504), `ABORTED` (the caller's `AbortSignal`, 499), `CLOSED` (engine closed with a
 * job pending, 503).
 */
export type EngineErrorCode =
    | 'PROJECT_NOT_FOUND'
    | 'INVALID_OPTION'
    | 'UNKNOWN_SCENE'
    | 'START_FAILED'
    | 'BRIDGE_TIMEOUT'
    | 'BRIDGE_INCOMPATIBLE'
    | 'RENDER_FAILED'
    | 'TIMEOUT'
    | 'ABORTED'
    | 'CLOSED';

/** An error raised by the engine, tagged with a stable {@link EngineErrorCode}. */
export class EngineError extends Error {
    override readonly name = 'EngineError';
    readonly code: EngineErrorCode;

    constructor(code: EngineErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.code = code;
    }
}

export function isEngineError(err: unknown): err is EngineError {
    return err instanceof EngineError;
}

/**
 * What a render issue is about:
 *
 * - `missing`: a feature the backend does not draw (`feature` names it).
 * - `shader`: a user shader that does not compile, or one that is not WGSL (an SkSL shader from an old document).
 * - `params`: a shader's uniforms and its `struct Params` disagree (a value with no member, a member with no value).
 * - `gpu`: a WebGPU validation or out-of-memory error.
 * - `device-lost`: the GPU device was lost; the backend is drawing on a new one.
 * - `crashed`: the backend itself failed and draws nothing more on this page.
 */
export type RenderIssueKind = "missing" | "shader" | "params" | "gpu" | "device-lost" | "crashed";

/** Something a frame drew without throwing but not as the document says. */
export interface RenderIssue {
    kind: RenderIssueKind;
    message: string;
    /** What is affected, as the backend names it (`blend:color-dodge`, `text:path`, `fill:shader`). */
    feature?: string;
    /** The node it was found on, when the backend knows. */
    nodeId?: string;
}

/** A backend's issue as a typed one; a bare string is the shader message backends reported before issues were typed. */
export function toRenderIssue(issue: RenderIssue | string): RenderIssue {
    return typeof issue === "string" ? { kind: "shader", message: issue } : issue;
}

/** One key per kind, feature and node: what an issue list is deduplicated by. */
export function renderIssueKey(issue: RenderIssue): string {
    return `${issue.kind}|${issue.feature ?? ""}|${issue.nodeId ?? ""}|${issue.feature ? "" : issue.message}`;
}

/**
 * The backend lost what it draws with while a render was under way, so the
 * frames already drawn cannot be trusted. Thrown by exports and stills on a
 * `device-lost` or `crashed` issue; `retryable` says whether the same render
 * can simply run again (the backend recovered on a new device).
 */
export class RenderBackendError extends Error {
    override readonly name = "RenderBackendError";
    readonly retryable: boolean;

    constructor(readonly issue: RenderIssue) {
        super(issue.message);
        this.retryable = issue.kind === "device-lost";
    }
}

/** Whether an issue means the frames drawn around it are not to be trusted. */
export function isFatalRenderIssue(issue: RenderIssue): boolean {
    return issue.kind === "device-lost" || issue.kind === "crashed";
}

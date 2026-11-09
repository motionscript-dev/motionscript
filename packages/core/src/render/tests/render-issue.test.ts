import { describe, expect, it } from "vitest";
import { isFatalRenderIssue, RenderBackendError, renderIssueKey, toRenderIssue } from "@/render/render-issue";

describe("render issues", () => {
    it("reads a bare string as a shader issue", () => {
        expect(toRenderIssue("does not compile")).toEqual({ kind: "shader", message: "does not compile" });
    });

    it("keys a feature issue by kind, feature and node, whatever its wording", () => {
        const a = renderIssueKey({ kind: "missing", feature: "text:path", nodeId: "t", message: "one" });
        expect(renderIssueKey({ kind: "missing", feature: "text:path", nodeId: "t", message: "two" })).toBe(a);
        expect(renderIssueKey({ kind: "missing", feature: "text:path", nodeId: "u", message: "one" })).not.toBe(a);
        expect(renderIssueKey({ kind: "gpu", message: "a" })).not.toBe(renderIssueKey({ kind: "gpu", message: "b" }));
    });

    it("makes a lost device a retryable failure and a crash a final one", () => {
        const lost = new RenderBackendError({ kind: "device-lost", message: "lost" });
        expect(lost).toBeInstanceOf(Error);
        expect(lost.name).toBe("RenderBackendError");
        expect(lost.retryable).toBe(true);
        expect(new RenderBackendError({ kind: "crashed", message: "panic" }).retryable).toBe(false);
        expect(isFatalRenderIssue({ kind: "device-lost", message: "" })).toBe(true);
        expect(isFatalRenderIssue({ kind: "missing", message: "" })).toBe(false);
    });
});

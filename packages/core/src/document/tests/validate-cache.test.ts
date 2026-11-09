import { describe, expect, it } from "vitest";

import type { ProjectDocument } from "../project";
import { effectiveSpan, effectiveSpans, type CompositionDocument, type TimedNodeSpec } from "../types";
import { validateDocument, validateProjectDocument } from "../validate";

function timed(id: string, parentId: string | null, span: { startAt?: number; endAt?: number } = {}): TimedNodeSpec {
    return { id, type: "rect", parentId, layerOrder: 0, props: {}, ...span };
}

function projectOf(...clips: CompositionDocument[]): ProjectDocument {
    return {
        kind: "project",
        name: "P",
        tracks: clips.map((clip, i) => ({ id: `t${i}`, duration: 1, clip })),
    };
}

describe("effectiveSpans", () => {
    const nodes = [
        timed("a", null, { startAt: 1, endAt: 8 }),
        timed("b", "a", { startAt: 0, endAt: 5 }),
        timed("c", "b", { startAt: 2 }),
        timed("d", "missing", { startAt: 3 }),
        timed("e", null),
    ];

    it("agrees with effectiveSpan for every row", () => {
        const spans = effectiveSpans(nodes);
        for (const node of nodes) expect(spans.get(node.id), node.id).toEqual(effectiveSpan(nodes, node.id));
        expect(spans.get("c")).toEqual({ start: 2, end: 5 });
        expect(spans.get("d")).toEqual({ start: 3, end: Infinity });
    });

    it("terminates on a parent cycle, agreeing with effectiveSpan", () => {
        const cyclic = [timed("x", "y", { startAt: 1 }), timed("y", "x", { endAt: 4 })];
        const spans = effectiveSpans(cyclic);
        expect(spans.get("x")).toEqual(effectiveSpan(cyclic, "x"));
        expect(spans.get("y")).toEqual(effectiveSpan(cyclic, "y"));
    });
});

describe("validateTimedDocument's target check", () => {
    it("still reads a target's span through its ancestors", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [timed("a", null, { startAt: 2 }), timed("b", "a")],
            commands: [{ id: "c", type: "to", targetId: "b", at: 1, args: {} }],
        };
        expect(validateDocument(doc).issues.map((i) => i.message))
            .toEqual([`command runs at 1s but its target "b" is not present until 2s.`]);
    });
});

describe("validateProjectDocument", () => {
    const clip = (): CompositionDocument => ({
        kind: "composition",
        nodes: [timed("box", null)],
        commands: [{ id: "c", type: "to", targetId: "box", at: 0, args: { x: 1 } }],
    });

    /**
     * Mutating a clip the validator has seen is exactly what a document's
     * identity contract rules out, which makes it the observable proof that the
     * clip was not walked a second time.
     */
    it("does not re-walk a clip it has already validated", () => {
        const kept = clip();
        expect(validateProjectDocument(projectOf(kept)).valid).toBe(true);

        kept.commands[0] = { ...kept.commands[0], targetId: "ghost" };
        expect(validateProjectDocument(projectOf(kept)).valid).toBe(true);

        const replaced = { ...kept };
        expect(validateProjectDocument(projectOf(replaced)).issues.map((i) => i.path))
            .toEqual(["tracks[0].clip.commands[0].targetId"]);
    });

    it("prefixes cached issues with whichever track carries the clip now", () => {
        const bad: CompositionDocument = { ...clip(), commands: [{ id: "c", type: "to", targetId: "ghost", at: 0, args: {} }] };
        expect(validateProjectDocument(projectOf(bad)).issues.map((i) => i.path))
            .toEqual(["tracks[0].clip.commands[0].targetId"]);
        expect(validateProjectDocument(projectOf(clip(), bad)).issues.map((i) => i.path))
            .toEqual(["tracks[1].clip.commands[0].targetId"]);
    });
});

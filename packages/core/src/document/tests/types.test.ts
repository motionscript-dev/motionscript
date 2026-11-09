import { describe, expect, it } from "vitest";

import type {
    AudioDocument,
    ClipDocument,
    CommandSpec,
    CompositionDocument,
    NodeSpec,
    StillDocument,
    TimedNodeSpec,
} from "../types";
import {
    commandSpan,
    documentDuration,
    effectiveSpan,
    effectiveSpanIn,
    effectiveSpans,
    hasTimeline,
    isAudioDocument,
    isCompositionDocument,
    isStillDocument,
    nodeSpan,
    ROOT_NODE_ID,
    untimed,
} from "../types";

const row = (id: string, parentId: string | null = null, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId, layerOrder: 0, props: {}, ...extra });

const cmd = (over: Partial<CommandSpec> = {}): CommandSpec =>
    ({ id: "c", type: "to", targetId: "a", at: 0, args: {}, ...over });

const still: StillDocument = { kind: "still", nodes: [] };
const composition: CompositionDocument = { kind: "composition", nodes: [], commands: [] };
const audio: AudioDocument = { kind: "audio", nodes: [], commands: [] };

describe("document kind narrowing", () => {
    it("tells a still from a composition", () => {
        expect(isStillDocument(still)).toBe(true);
        expect(isStillDocument(composition)).toBe(false);
        expect(isCompositionDocument(composition)).toBe(true);
        expect(isCompositionDocument(still)).toBe(false);
    });

    it("recognises an audio document, and only that", () => {
        expect(isAudioDocument(audio)).toBe(true);
        expect(isAudioDocument(composition)).toBe(false);
        expect(isAudioDocument(still)).toBe(false);
    });

    it("gives a clock to anything but a still", () => {
        expect(hasTimeline(still)).toBe(false);
        expect(hasTimeline(composition)).toBe(true);
        expect(hasTimeline(audio)).toBe(true);
    });

    it("narrows the type as well as the answer", () => {
        const clips: ClipDocument[] = [still, composition, audio];
        const lengths = clips.map((clip) => (hasTimeline(clip) ? clip.commands.length : -1));
        expect(lengths).toEqual([-1, 0, 0]);
    });
});

describe("nodeSpan", () => {
    it("reads an absent span as present for the whole clip", () => {
        expect(nodeSpan(row("a"))).toEqual({ start: 0, end: Infinity });
    });

    it("reads declared bounds, each independently", () => {
        expect(nodeSpan(row("a", null, { startAt: 2 }))).toEqual({ start: 2, end: Infinity });
        expect(nodeSpan(row("a", null, { endAt: 3 }))).toEqual({ start: 0, end: 3 });
        expect(nodeSpan(row("a", null, { startAt: 1, endAt: 4 }))).toEqual({ start: 1, end: 4 });
    });

    it("keeps an inverted span as written rather than repairing it", () => {
        expect(nodeSpan(row("a", null, { startAt: 5, endAt: 2 }))).toEqual({ start: 5, end: 2 });
    });
});

describe("effectiveSpan", () => {
    const nodes = [
        row("p", null, { startAt: 1, endAt: 6 }),
        row("c", "p", { startAt: 0, endAt: 9 }),
        row("g", "c", { startAt: 3 }),
    ];

    it("intersects a node's span with every ancestor's", () => {
        expect(effectiveSpan(nodes, "p")).toEqual({ start: 1, end: 6 });
        expect(effectiveSpan(nodes, "c")).toEqual({ start: 1, end: 6 });
        expect(effectiveSpan(nodes, "g")).toEqual({ start: 3, end: 6 });
    });

    it("is undefined for an id no row declares", () => {
        expect(effectiveSpan(nodes, "ghost")).toBeUndefined();
        expect(effectiveSpanIn(new Map(nodes.map((n) => [n.id, n])), "ghost")).toBeUndefined();
    });

    it("is empty when the spans never overlap", () => {
        const span = effectiveSpan([row("p", null, { endAt: 1 }), row("c", "p", { startAt: 2 })], "c")!;
        expect(span.start).toBe(2);
        expect(span.end).toBe(1);
    });

    it("stops at a parent no row declares", () => {
        expect(effectiveSpan([row("c", "missing", { startAt: 2 })], "c")).toEqual({ start: 2, end: Infinity });
    });

    it("terminates on a parent cycle", () => {
        const cyclic = [row("a", "b", { startAt: 1 }), row("b", "a", { startAt: 2 })];
        expect(effectiveSpan(cyclic, "a")).toEqual({ start: 2, end: Infinity });
        expect(effectiveSpan(cyclic, "b")).toEqual({ start: 2, end: Infinity });
    });
});

describe("effectiveSpans", () => {
    it("answers every row, each as effectiveSpan would", () => {
        const nodes = [
            row("p", null, { startAt: 1, endAt: 6 }),
            row("c", "p", { endAt: 4 }),
            row("g", "c", { startAt: 3 }),
            row("solo"),
        ];
        const spans = effectiveSpans(nodes);
        for (const n of nodes) expect(spans.get(n.id)).toEqual(effectiveSpan(nodes, n.id));
        expect(spans.get("g")).toEqual({ start: 3, end: 4 });
    });

    it("does not need the rows in parent-first order", () => {
        const nodes = [row("g", "c", { startAt: 3 }), row("c", "p"), row("p", null, { startAt: 2 })];
        expect(effectiveSpans(nodes).get("g")).toEqual({ start: 3, end: Infinity });
        expect(effectiveSpans(nodes).get("c")).toEqual({ start: 2, end: Infinity });
    });

    it("gives a node in a parent cycle the single-id answer instead of looping", () => {
        const cyclic = [row("a", "b", { startAt: 1 }), row("b", "a", { startAt: 2 })];
        const spans = effectiveSpans(cyclic);
        expect(spans.size).toBe(2);
        expect(spans.get("a")).toEqual(effectiveSpan(cyclic, "a"));
    });
});

describe("untimed", () => {
    it("drops the span and nothing else", () => {
        const timed: TimedNodeSpec = row("a", "p", { startAt: 1, endAt: 2, key: "k", layerOrder: 3, props: { x: 1 } });
        const plain: NodeSpec = untimed(timed);
        expect(plain).toEqual({ id: "a", type: "rect", parentId: "p", layerOrder: 3, key: "k", props: { x: 1 } });
        expect("startAt" in plain).toBe(false);
        expect("endAt" in plain).toBe(false);
    });

    it("leaves the row it was given alone", () => {
        const timed = row("a", null, { startAt: 1 });
        untimed(timed);
        expect(timed.startAt).toBe(1);
    });

    it("hands back an equal row for one that was never timed", () => {
        const plain = row("a");
        expect(untimed(plain)).toEqual(plain);
    });
});

describe("commandSpan", () => {
    it("is the duration for a command that does not loop", () => {
        expect(commandSpan(cmd({ duration: 2 }))).toBe(2);
        expect(commandSpan(cmd())).toBe(0);
    });

    it("multiplies a counted loop by its passes, the first included", () => {
        expect(commandSpan(cmd({ duration: 2, loop: { count: 0 } }))).toBe(2);
        expect(commandSpan(cmd({ duration: 2, loop: { count: 3 } }))).toBe(8);
        expect(commandSpan(cmd({ duration: 1.5, loop: { count: 1, direction: "alternate" } }))).toBe(3);
    });

    it("counts an unlimited loop as one pass, so it can never ask for a clip as long as it likes", () => {
        expect(commandSpan(cmd({ duration: 2, loop: { count: null } }))).toBe(2);
    });

    it("leaves a stamp a stamp, whatever it loops", () => {
        expect(commandSpan(cmd({ duration: 0, loop: { count: 5 } }))).toBe(0);
        expect(commandSpan(cmd({ loop: { count: 5 } }))).toBe(0);
    });

    it("floors a fractional count the way the loop does", () => {
        expect(commandSpan(cmd({ duration: 1, loop: { count: 2.7 } }))).toBe(3);
    });
});

describe("documentDuration", () => {
    it("is zero for a still, whatever else it carries", () => {
        expect(documentDuration(still)).toBe(0);
        expect(documentDuration({ ...still, nodes: [row("a")] })).toBe(0);
    });

    it("prefers a declared duration, even a shorter one than the commands", () => {
        const doc: CompositionDocument = { ...composition, duration: 1, commands: [cmd({ at: 0, duration: 5 })] };
        expect(documentDuration(doc)).toBe(1);
        expect(documentDuration({ ...composition, duration: 0 })).toBe(0);
    });

    it("ends at the last command's end", () => {
        const doc: CompositionDocument = {
            ...composition,
            commands: [cmd({ id: "a", at: 0, duration: 1 }), cmd({ id: "b", at: 2, duration: 0.5 })],
        };
        expect(documentDuration(doc)).toBe(2.5);
    });

    it("counts a counted loop's every pass and an unlimited one's first", () => {
        const counted: CompositionDocument = { ...composition, commands: [cmd({ at: 1, duration: 2, loop: { count: 2 } })] };
        const unlimited: CompositionDocument = { ...composition, commands: [cmd({ at: 1, duration: 2, loop: { count: null } })] };
        expect(documentDuration(counted)).toBe(7);
        expect(documentDuration(unlimited)).toBe(3);
    });

    it("reaches a node's arrival and its finite departure, but not an open end", () => {
        const doc: CompositionDocument = {
            ...composition,
            nodes: [row("a", null, { startAt: 4 }), row("b", null, { endAt: 2 }), row("c", null, { endAt: Infinity })],
        };
        expect(documentDuration(doc)).toBe(4);
        expect(documentDuration({ ...composition, nodes: [row("c", null, { endAt: Infinity })] })).toBe(0);
    });

    it("measures an audio document the same way", () => {
        expect(documentDuration({ ...audio, commands: [cmd({ at: 1, duration: 1 })] })).toBe(2);
        expect(documentDuration({ ...audio, duration: 9 })).toBe(9);
    });
});

describe("ROOT_NODE_ID", () => {
    it("is the empty string, a real id rather than a missing one", () => {
        expect(ROOT_NODE_ID).toBe("");
    });
});

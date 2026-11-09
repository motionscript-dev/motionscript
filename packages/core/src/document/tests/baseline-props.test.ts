import { describe, expect, it } from "vitest";

import { ClipInstance } from "@/runtime/clip-instance";
import { runtimeScope } from "@/runtime/document.fixtures";

import { documentDuration, type CompositionDocument } from "../types";

const DOC: CompositionDocument = {
    kind: "composition",
    nodes: [
        { id: "box", type: "rect", parentId: null, layerOrder: 0, props: { width: 100, height: 40, opacity: 0.5 } },
        { id: "late", type: "rect", parentId: null, layerOrder: 1, props: { width: 10, height: 10, x: 7 }, startAt: 2 },
    ],
    commands: [
        { id: "fade", type: "fadeTo", targetId: "box", at: 0, duration: 1, args: { opacity: 1 } },
        { id: "grow", type: "layoutTo", targetId: "box", at: 1, duration: 1, args: { width: 300 } },
        { id: "slide", type: "moveTo", targetId: "late", at: 2, duration: 1, args: { x: 90 } },
    ],
};

function built(): ClipInstance {
    const instance = new ClipInstance(DOC, documentDuration(DOC), runtimeScope());
    instance.build();
    return instance;
}

describe("baselineProps", () => {
    it("is what the row holds before its commands, at every time", () => {
        const instance = built();
        for (const time of [0, 0.5, 1.5, 3, 0.25]) {
            instance.evaluateAt(time);
            expect(instance.baselineProps("box"), `${time}s`).toMatchObject({ opacity: 0.5, width: 100, height: 40 });
        }
        instance.evaluateAt(3);
        expect(instance.node("box")).toMatchObject({ opacity: 1, width: 300 });
    });

    it("holds every prop the node has, defaults included", () => {
        const props = built().baselineProps("box");
        expect(props).toMatchObject({ x: 0, y: 0, rotation: 0, scale: 1 });
    });

    it("answers for a row that is not in the tree yet, and after it has moved", () => {
        const instance = built();
        instance.evaluateAt(0);
        expect(instance.baselineProps("late")).toMatchObject({ x: 7 });
        instance.evaluateAt(3);
        expect(instance.baselineProps("late")).toMatchObject({ x: 7 });
    });

    it("answers for the root, and not for an id no row has", () => {
        const instance = built();
        expect(instance.baselineProps("")).toBeDefined();
        expect(instance.baselineProps("nobody")).toBeUndefined();
    });
});

import { describe, expect, it } from "vitest";

import { nodePath, type NodeState, type TreeState, type WaveformInfo } from "../tree";

describe("nodePath", () => {
    it("is the bare index under the root, whose own path is empty", () => {
        expect(nodePath("", 0)).toBe("0");
        expect(nodePath("", 7)).toBe("7");
    });

    it("joins the parent's path and the child's index with a dot", () => {
        expect(nodePath("0", 2)).toBe("0.2");
        expect(nodePath("1.0", 3)).toBe("1.0.3");
        expect(nodePath("4.5.6", 0)).toBe("4.5.6.0");
    });

    it("keeps a multi-digit index whole", () => {
        expect(nodePath("12", 34)).toBe("12.34");
        expect(nodePath("", 120)).toBe("120");
    });

    it("builds a path one level at a time, the way a tree walk does", () => {
        let path = "";
        for (const index of [0, 2, 1]) path = nodePath(path, index);
        expect(path).toBe("0.2.1");
    });

    it("gives two siblings different paths and two cousins different ones too", () => {
        const paths = new Set([
            nodePath("", 0), nodePath("", 1),
            nodePath("0", 0), nodePath("0", 1),
            nodePath("1", 0), nodePath("1", 1),
        ]);
        expect(paths.size).toBe(6);
    });

    it("does not mistake a child's index for a deeper level", () => {
        // "1.2" is the third child of the second node; "12" is the thirteenth child of the root.
        expect(nodePath("1", 2)).not.toBe(nodePath("", 12));
    });

    it("is what a TreeState carries as its path, root included", () => {
        const root: TreeState = { id: "", path: "", type: "canvas2d", children: [] };
        const child: TreeState = { id: "a", path: nodePath(root.path, 0), type: "rect", children: [] };
        const grandchild: TreeState = { id: "b", path: nodePath(child.path, 3), type: "text", children: [] };
        root.children.push(child);
        child.children.push(grandchild);
        expect([root.path, child.path, grandchild.path]).toEqual(["", "0", "0.3"]);
    });
});

describe("the tree-state types", () => {
    it("describe a node with spans and waveforms optional", () => {
        const waveform: WaveformInfo = { src: "music.mp3", startTime: 1.5, endTime: null };
        const bare: TreeState = { id: "a", path: "0", type: "rect", children: [] };
        const full: TreeState = {
            id: "s",
            path: "1",
            type: "sound",
            meta: { muted: false },
            waveform: [waveform],
            startFrame: 30,
            endFrame: 90,
            children: [bare],
        };
        expect(bare.waveform).toBeUndefined();
        expect(bare.startFrame).toBeUndefined();
        expect(full.waveform?.[0].endTime).toBeNull();
        expect(full.children[0]).toBe(bare);
    });

    it("describe an override as the properties it applies", () => {
        const state: NodeState = { id: "a", type: "rect", properties: { x: 10, fill: "red" } };
        expect(Object.keys(state.properties)).toEqual(["x", "fill"]);
    });
});

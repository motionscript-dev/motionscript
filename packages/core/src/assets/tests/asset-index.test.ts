import { describe, expect, it } from "vitest";

import { AssetIndex, type AssetSegment } from "@/assets/asset-index";
import type { AssetDecl } from "@/assets/scope";
import type { LoaderFn } from "@/assets/record";

const image = (src: string): AssetDecl => ({ type: "image", src });

function seg(decl: AssetDecl, startFrame: number, endFrame: number): AssetSegment {
    const key = decl.type === "font" ? decl.family : decl.type === "loader" ? decl.key : decl.src;
    return { key, decl, startFrame, endFrame };
}

const keysOf = (delta: { keys: ReadonlySet<string> }): string[] => [...delta.keys].sort();

describe("AssetIndex", () => {
    it("reports a new owner's keys and records their windows", () => {
        const index = new AssetIndex(100);
        const delta = index.setOwner("a", [seg(image("photo.png"), 10, 20), seg(image("bg.png"), 0, Infinity)]);

        expect(keysOf(delta)).toEqual(["bg.png", "photo.png"]);
        expect(index.records().get("photo.png")).toEqual({
            type: "image", startFrame: 10, endFrame: 20, src: "photo.png",
        });
        expect(index.records().get("bg.png")).toMatchObject({ startFrame: 0, endFrame: 99 });
    });

    it("hands back an empty delta when an owner restates the same segments", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("photo.png"), 10, 20)]);
        const before = index.records().get("photo.png");

        const delta = index.setOwner("a", [seg(image("photo.png"), 10, 20)]);

        expect(delta.keys.size).toBe(0);
        expect(index.records().get("photo.png")).toBe(before);
    });

    it("unions a key's window across owners and shrinks it when one leaves", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("photo.png"), 10, 20)]);
        index.setOwner("b", [seg(image("photo.png"), 30, 40)]);

        expect(index.records().get("photo.png")).toMatchObject({ startFrame: 10, endFrame: 40 });
        expect([...index.owners("photo.png")].sort()).toEqual(["a", "b"]);

        const delta = index.removeOwner("b");
        expect(keysOf(delta)).toEqual(["photo.png"]);
        expect(index.records().get("photo.png")).toMatchObject({ startFrame: 10, endFrame: 20 });

        // A second owner inside the first's window changes nothing about the union.
        expect(index.setOwner("c", [seg(image("photo.png"), 12, 18)]).keys.size).toBe(0);
    });

    it("drops a key whose last owner goes", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("photo.png"), 10, 20)]);

        expect(keysOf(index.removeOwner("a"))).toEqual(["photo.png"]);
        expect(index.records().has("photo.png")).toBe(false);
        expect(index.owners("photo.png").size).toBe(0);
        expect(index.removeOwner("a").keys.size).toBe(0);
    });

    it("reports the old and new key when an owner swaps one asset for another", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("one.png"), 0, 10)]);

        const delta = index.setOwner("a", [seg(image("two.png"), 0, 10)]);

        expect(keysOf(delta)).toEqual(["one.png", "two.png"]);
        expect([...index.records().keys()]).toEqual(["two.png"]);
    });

    it("learns a missed frame, extends it on an adjacent one, and forgets it on setOwner", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("photo.png"), 10, 20)]);

        expect(keysOf(index.learn("a", image("late.png"), 50))).toEqual(["late.png"]);
        expect(keysOf(index.learn("a", image("late.png"), 51))).toEqual(["late.png"]);
        expect(index.records().get("late.png")).toMatchObject({ startFrame: 50, endFrame: 51 });
        // Inside the declared window: nothing to widen.
        expect(index.learn("a", image("photo.png"), 15).keys.size).toBe(0);
        expect(index.segmentsOf("a").map((s) => s.key)).toEqual(["photo.png", "late.png", "photo.png"]);

        const delta = index.setOwner("a", [seg(image("photo.png"), 10, 20)]);
        expect(keysOf(delta)).toEqual(["late.png"]);
        expect(index.records().has("late.png")).toBe(false);
        expect(index.segmentsOf("a")).toHaveLength(1);
    });

    it("learns for an owner the index has never seen", () => {
        const index = new AssetIndex(10);
        index.learn("ghost", image("photo.png"), 3);
        expect(index.records().get("photo.png")).toMatchObject({ startFrame: 3, endFrame: 3 });
        expect([...index.owners("photo.png")]).toEqual(["ghost"]);
    });

    it("clamps open and over-long windows to the frame count, and re-clamps when it changes", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("open.png"), 10, Infinity), seg(image("late.png"), 90, 95)]);
        index.setOwner("b", [seg(image("early.png"), 0, 5)]);

        expect(index.records().get("open.png")).toMatchObject({ endFrame: 99 });

        const shorter = index.setFrameCount(50);
        expect(keysOf(shorter)).toEqual(["late.png", "open.png"]);
        expect(index.records().get("open.png")).toMatchObject({ startFrame: 10, endFrame: 49 });
        expect(index.records().has("late.png")).toBe(false);

        const longer = index.setFrameCount(200);
        expect(keysOf(longer)).toEqual(["late.png", "open.png"]);
        expect(index.records().get("open.png")).toMatchObject({ endFrame: 199 });
        expect(index.records().get("late.png")).toMatchObject({ startFrame: 90, endFrame: 95 });

        expect(index.setFrameCount(200).keys.size).toBe(0);
    });

    it("shapes every record kind", () => {
        const load: LoaderFn = async () => { };
        const index = new AssetIndex(100);
        index.setOwner("a", [
            seg({ type: "video", src: "clip.mp4", trimStart: 1, trimEnd: 4 }, 0, 10),
            seg({ type: "font", family: "Inter", weight: 700 }, 0, 10),
            seg({ type: "loader", key: "lang:ts", load, gate: "render" }, 5, 10),
        ]);

        expect(index.records().get("clip.mp4")).toEqual({
            type: "video", startFrame: 0, endFrame: 10, src: "clip.mp4", trimStart: 1, trimEnd: 4,
        });
        expect(index.records().get("Inter")).toEqual({
            type: "font", startFrame: 0, endFrame: 10, fontWeight: 700, fontFamily: "Inter", src: "Inter",
        });
        expect(index.records().get("lang:ts")).toEqual({
            type: "loader", src: "lang:ts", startFrame: 5, endFrame: 10, load,
        });
    });

    it("reports a content change within an unchanged window", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg({ type: "video", src: "clip.mp4", trimStart: 0, trimEnd: 4 }, 0, 10)]);
        const delta = index.setOwner("a", [seg({ type: "video", src: "clip.mp4", trimStart: 2, trimEnd: 4 }, 0, 10)]);
        expect(keysOf(delta)).toEqual(["clip.mp4"]);
        expect(index.records().get("clip.mp4")).toMatchObject({ trimStart: 2 });
    });

    it("gates layout on fonts and on loaders any owner declared for layout", () => {
        const load: LoaderFn = async () => { };
        const index = new AssetIndex(100);
        index.setOwner("a", [
            seg(image("photo.png"), 0, 10),
            seg({ type: "font", family: "Inter", weight: 400 }, 0, 10),
            seg({ type: "loader", key: "grammar", load, gate: "render" }, 0, 10),
            seg({ type: "loader", key: "three:runtime", load, gate: "render" }, 0, 10),
        ]);
        expect(index.layoutGates().map((r) => r.src).sort()).toEqual(["Inter"]);

        index.setOwner("b", [seg({ type: "loader", key: "grammar", load, gate: "layout" }, 20, 30)]);
        expect(index.layoutGates().map((r) => r.src).sort()).toEqual(["Inter", "grammar"]);

        index.removeOwner("b");
        expect(index.layoutGates().map((r) => r.src)).toEqual(["Inter"]);
    });
});

describe("AssetIndex – the earliest segment speaks for a key", () => {
    const video = (trimStart: number, trimEnd: number): AssetDecl => ({ type: "video", src: "clip.mp4", trimStart, trimEnd });
    const font = (weight: number): AssetDecl => ({ type: "font", family: "Inter", weight });
    const loader = (load: LoaderFn): AssetDecl => ({ type: "loader", key: "grammar", load, gate: "render" });

    it("takes a video's trims from the owner whose window starts first", () => {
        const index = new AssetIndex(100);
        index.setOwner("late", [seg(video(0, 4), 30, 40)]);
        index.setOwner("early", [seg(video(2, 6), 5, 8)]);

        expect(index.records().get("clip.mp4")).toMatchObject({ startFrame: 5, endFrame: 40, trimStart: 2, trimEnd: 6 });

        // The union window is unchanged by order; the trims follow whoever starts first.
        index.removeOwner("early");
        expect(index.records().get("clip.mp4")).toMatchObject({ startFrame: 30, endFrame: 40, trimStart: 0, trimEnd: 4 });
    });

    it("takes a font's weight from the earliest segment, however the owners were added", () => {
        const index = new AssetIndex(100);
        index.setOwner("bold", [seg(font(700), 10, 20)]);
        index.setOwner("light", [seg(font(300), 0, 5)]);

        expect(index.records().get("Inter")).toMatchObject({ fontWeight: 300, startFrame: 0, endFrame: 20 });
    });

    it("takes a loader's function from the earliest segment", () => {
        const slow: LoaderFn = async () => { };
        const fast: LoaderFn = async () => { };
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(loader(slow), 10, 20)]);
        index.setOwner("b", [seg(loader(fast), 0, 5)]);

        expect(index.records().get("grammar")).toMatchObject({ load: fast, startFrame: 0, endFrame: 20 });
    });

    it("keeps the first owner's content when two segments start on the same frame", () => {
        const index = new AssetIndex(100);
        index.setOwner("first", [seg(video(1, 3), 10, 20)]);
        index.setOwner("second", [seg(video(5, 9), 10, 30)]);

        expect(index.records().get("clip.mp4")).toMatchObject({ trimStart: 1, trimEnd: 3, endFrame: 30 });
    });

    it("lets a learned segment that starts earlier take over the content", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(video(1, 3), 10, 20)]);
        index.learn("a", video(7, 9), 4);

        expect(index.records().get("clip.mp4")).toMatchObject({ startFrame: 4, trimStart: 7, trimEnd: 9 });
    });

    it("judges by the window left after clamping to the frame count", () => {
        const index = new AssetIndex(20);
        // Starts first, but wholly past the end of the clip, so it speaks for nothing.
        index.setOwner("beyond", [seg(video(9, 9), 50, 60)]);
        index.setOwner("inside", [seg(video(1, 2), 10, 15)]);

        expect(index.records().get("clip.mp4")).toMatchObject({ startFrame: 10, endFrame: 15, trimStart: 1 });
    });

    it("drops a segment whose end precedes its start, and a key left with none", () => {
        const index = new AssetIndex(100);
        const delta = index.setOwner("a", [seg(image("backwards.png"), 20, 10)]);
        expect(delta.keys.size).toBe(0);
        expect(index.records().size).toBe(0);
        expect([...index.ownerKeys()]).toEqual([]);
    });
});

describe("AssetIndex – declared segments and owners", () => {
    it("declaredSegmentsOf leaves out what the draw learned, which segmentsOf adds", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("photo.png"), 10, 20), seg(image("bg.png"), 0, 5)]);
        index.learn("a", image("late.png"), 50);

        expect(index.declaredSegmentsOf("a").map((s) => s.key).sort()).toEqual(["bg.png", "photo.png"]);
        expect(index.segmentsOf("a").map((s) => s.key).sort()).toEqual(["bg.png", "late.png", "photo.png"]);
    });

    it("declaredSegmentsOf is empty for an owner that has only learned, and for one the index has not seen", () => {
        const index = new AssetIndex(100);
        index.learn("ghost", image("photo.png"), 3);
        expect(index.declaredSegmentsOf("ghost")).toEqual([]);
        expect(index.segmentsOf("ghost")).toHaveLength(1);
        expect(index.declaredSegmentsOf("nobody")).toEqual([]);
        expect(index.segmentsOf("nobody")).toEqual([]);
    });

    it("declaredSegmentsOf returns every segment of a key an owner declares more than once", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("photo.png"), 0, 5), seg(image("photo.png"), 20, 25)]);
        expect(index.declaredSegmentsOf("a").map((s) => [s.startFrame, s.endFrame])).toEqual([[0, 5], [20, 25]]);
        // Two segments of one key are one record over the union.
        expect(index.records().get("photo.png")).toMatchObject({ startFrame: 0, endFrame: 25 });
    });

    it("ownerKeys lists every owner with segments, learned-only ones included, and drops removed ones", () => {
        const index = new AssetIndex(100);
        expect([...index.ownerKeys()]).toEqual([]);

        index.setOwner("a", [seg(image("one.png"), 0, 5)]);
        index.setOwner("b", [seg(image("two.png"), 0, 5)]);
        index.learn("c", image("three.png"), 2);
        expect([...index.ownerKeys()]).toEqual(["a", "b", "c"]);

        index.removeOwner("b");
        expect([...index.ownerKeys()]).toEqual(["a", "c"]);
    });

    it("setOwner with no segments forgets the owner entirely", () => {
        const index = new AssetIndex(100);
        index.setOwner("a", [seg(image("one.png"), 0, 5)]);
        const delta = index.setOwner("a", []);
        expect([...delta.keys]).toEqual(["one.png"]);
        expect([...index.ownerKeys()]).toEqual([]);
    });
});


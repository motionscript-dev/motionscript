import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { Rect } from "@/components/builtins/geometry/geometry";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { evaluatorFor, runtimeScope } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import { diffClip } from "../diff";
import { asProjectDocument } from "../project";
import { Registry } from "../registry";
import { commandSpan, documentDuration, type CommandSpec, type CompositionDocument } from "../types";
import { validateDocument } from "../validate";

const FPS = 30;
const VIEWPORT = { width: 200, height: 200 };
const registry = new Registry();

/** A one-node clip whose box slides 0 → 90 over `command`. */
function clipDoc(command: Partial<CommandSpec>, duration?: number): CompositionDocument {
    return {
        kind: "composition",
        nodes: [
            { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} },
            { id: "box", type: "rect", parentId: null, layerOrder: 0, props: { width: 20, height: 20, x: 0 } },
        ],
        commands: [{ id: "slide", type: "to", targetId: "box", at: 0, duration: 1, args: { x: 90 }, ...command }],
        ...(duration !== undefined && { duration }),
    };
}

function boxAt(doc: CompositionDocument, frame: number): number {
    const evaluator: StateEvaluator = evaluatorFor(
        asProjectDocument(doc, { fps: FPS, viewport: VIEWPORT }),
        { registry, assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }) },
    );
    evaluator.stateAt(frame);
    return evaluator.currentCanvas!.children.find((c): c is Rect => c instanceof Rect)!.x;
}

describe("commandSpan", () => {
    const slide: CommandSpec = { id: "s", type: "to", targetId: "box", at: 0, duration: 2, args: {} };

    it("is one pass with no loop, and every pass with a counted one", () => {
        expect(commandSpan(slide)).toBe(2);
        expect(commandSpan({ ...slide, loop: { count: 0 } })).toBe(2);
        expect(commandSpan({ ...slide, loop: { count: 2 } })).toBe(6);
    });

    it("counts one pass of an unlimited loop, so it cannot stretch the clip forever", () => {
        expect(commandSpan({ ...slide, loop: { count: null } })).toBe(2);
    });
});

describe("a looped command on a clip", () => {
    it("lengthens the clip it is on by the passes it adds", () => {
        expect(documentDuration(clipDoc({}))).toBe(1);
        expect(documentDuration(clipDoc({ loop: { count: 2 } }))).toBe(3);
    });

    it("replays the pass, so each repeat starts over from the value it began on", () => {
        const doc = clipDoc({ loop: { count: 2 } });

        expect(boxAt(doc, FPS / 2)).toBeCloseTo(45, 3);        // 0.5s — half of pass one
        expect(boxAt(doc, FPS + FPS / 2)).toBeCloseTo(45, 3);  // 1.5s — half of pass two
        expect(boxAt(doc, 3 * FPS)).toBeCloseTo(90, 3);        // 3s — held at the end
    });

    it("runs every pass backwards for `reverse`", () => {
        const doc = clipDoc({ loop: { direction: "reverse", count: 1 } });

        expect(boxAt(doc, 0)).toBeCloseTo(90, 3);
        expect(boxAt(doc, FPS / 2)).toBeCloseTo(45, 3);
        expect(boxAt(doc, FPS)).toBeCloseTo(90, 3);
    });

    it("bounces on `alternate`, ending an odd number of passes where it started", () => {
        const doc = clipDoc({ loop: { direction: "alternate", count: 1 } });

        expect(boxAt(doc, FPS)).toBeCloseTo(90, 3);      // 1s — the turn
        expect(boxAt(doc, 2 * FPS)).toBeCloseTo(0, 3);   // 2s — back home
    });

    it("hands the next command the value the whole loop ended on", () => {
        const doc: CompositionDocument = {
            ...clipDoc({ loop: { direction: "alternate", count: 1 } }),
            commands: [
                { id: "bounce", type: "to", targetId: "box", at: 0, duration: 1, args: { x: 90 }, loop: { direction: "alternate", count: 1 } },
                // Starts at 2s, where the bounce left the box back at 0 — so
                // halfway through this is 10, not 50.
                { id: "after", type: "to", targetId: "box", at: 2, duration: 1, args: { x: 20 } },
            ],
        };

        expect(boxAt(doc, 2 * FPS + FPS / 2)).toBeCloseTo(10, 3);
    });

    it("repeats an unlimited loop for the rest of the clip without extending it", () => {
        const doc = clipDoc({ loop: { count: null } }, 5);

        expect(documentDuration(doc)).toBe(5);
        expect(boxAt(doc, FPS / 2)).toBeCloseTo(45, 3);
        expect(boxAt(doc, 4 * FPS + FPS / 2)).toBeCloseTo(45, 3);  // 4.5s, still going
    });

    it("fills a single pass when nothing else says how long the clip is", () => {
        const doc = clipDoc({ loop: { count: null } });

        expect(documentDuration(doc)).toBe(1);
        expect(boxAt(doc, FPS / 2)).toBeCloseTo(45, 3);
    });

    it("wraps at a pass boundary rather than holding, which is what unlimited means", () => {
        // A counted loop is spent at its last pass's end and holds there; an
        // unlimited one is starting the next pass.
        expect(boxAt(clipDoc({ loop: { count: 1 } }), 2 * FPS)).toBeCloseTo(90, 3);
        expect(boxAt(clipDoc({ loop: { count: null } }, 2), 2 * FPS)).toBeCloseTo(0, 3);
    });

    it("does nothing to a stamp, which has no pass to repeat", () => {
        const doc = clipDoc({ type: "set", duration: 0, loop: { count: 4 } });

        expect(documentDuration(doc)).toBe(0);
        expect(boxAt(doc, FPS)).toBeCloseTo(90, 3);
    });
});

describe("validation", () => {
    const issuesOf = (loop: unknown) =>
        validateDocument(clipDoc({ loop } as Partial<CommandSpec>))
            .issues.filter((i) => i.path.startsWith("commands[0].loop"));

    it("accepts a loop that names a whole number of repeats, or null", () => {
        expect(issuesOf({ count: 0 })).toEqual([]);
        expect(issuesOf({ direction: "alternate", count: 3 })).toEqual([]);
        expect(issuesOf({ count: null })).toEqual([]);
        expect(issuesOf(undefined)).toEqual([]);
    });

    it("refuses a fractional, negative or non-numeric count", () => {
        expect(issuesOf({ count: 1.5 })).toHaveLength(1);
        expect(issuesOf({ count: -1 })).toHaveLength(1);
        expect(issuesOf({ count: "many" })).toHaveLength(1);
    });

    it("refuses a direction no pass can run in, and a loop that is not an object", () => {
        expect(issuesOf({ direction: "sideways", count: 1 })[0].path).toBe("commands[0].loop.direction");
        expect(issuesOf(7)[0].path).toBe("commands[0].loop");
    });
});

describe("diffClip", () => {
    it("sees a changed loop, which a rebuilt chain has to pick up", () => {
        const before = clipDoc({ loop: { count: 1 } });

        expect(diffClip(before, clipDoc({ loop: { count: 1 } })).commands.changed.size).toBe(0);
        expect(diffClip(before, clipDoc({ loop: { count: 2 } })).commands.changed.has("slide")).toBe(true);
        expect(diffClip(before, clipDoc({ loop: { direction: "alternate", count: 1 } })).commands.changed.has("slide")).toBe(true);
        expect(diffClip(before, clipDoc({})).commands.changed.has("slide")).toBe(true);
    });
});

describe("an unlimited loop evaluated past the clip's end", () => {
    const built = (duration: number) => {
        const clip = new TimelineClip(clipDoc({ loop: { count: null } }, duration), runtimeScope({ registry }));
        clip.build();
        const x = (seconds: number) => {
            clip.seek(seconds);
            return (clip.timeline.liveNode("box") as unknown as Rect).x;
        };
        return { clip, x };
    };

    it("is given the clip's length to fill", () => {
        const { clip } = built(2.5);
        const [placed] = clip.timeline.placedCommands();
        expect([placed.start, placed.duration]).toEqual([0, 2.5]);
    });

    it("holds the phase it reached at the end, not the one a wrapped clock would give", () => {
        const { x } = built(2.5);
        // 2.5s is half way through the third pass.
        expect(x(2.5)).toBeCloseTo(45, 9);
        expect(x(2.7)).toBeCloseTo(45, 9);
        expect(x(100)).toBeCloseTo(45, 9);
    });

    it("is still turning right up to the end", () => {
        const { x } = built(2.5);
        expect(x(2.4)).toBeCloseTo(36, 9);
        expect(x(0.25)).toBeCloseTo(22.5, 9);
    });

    it("comes back to the same frame when the playhead returns", () => {
        const { x } = built(2.5);
        const early = x(1.25);
        x(9);
        expect(x(1.25)).toBe(early);
    });

    it("fills only what is left after its own start", () => {
        const clip = new TimelineClip(clipDoc({ at: 1, loop: { count: null } }, 4), runtimeScope({ registry }));
        clip.build();
        const [placed] = clip.timeline.placedCommands();
        expect([placed.start, placed.duration]).toEqual([1, 3]);
    });
});

describe("a looped command's placed record", () => {
    it("carries the loop's whole span as its duration, not one pass", () => {
        const clip = new TimelineClip(clipDoc({ loop: { count: 2 } }), runtimeScope({ registry }));
        clip.build();
        const [placed] = clip.timeline.placedCommands();
        expect(placed.duration).toBe(3);
        expect(placed.spec.duration).toBe(1);
        expect(placed.start).toBe(0);
    });

    it("keeps the inner command's writes", () => {
        const clip = new TimelineClip(clipDoc({ loop: { direction: "alternate", count: 3 } }), runtimeScope({ registry }));
        clip.build();
        const [placed] = clip.timeline.placedCommands();
        const writes = [...placed.writes].map((slot) => slot._name);
        expect(placed.duration).toBe(4);
        expect(writes).toEqual(["x"]);
    });

    it("reports a counted loop of zero repeats as the plain command", () => {
        const clip = new TimelineClip(clipDoc({ loop: { count: 0 } }), runtimeScope({ registry }));
        clip.build();
        expect(clip.timeline.placedCommands()[0].duration).toBe(1);
    });

    it("reports a looped stamp as the stamp it is", () => {
        const clip = new TimelineClip(clipDoc({ type: "set", duration: 0, loop: { count: 4 } }), runtimeScope({ registry }));
        clip.build();
        expect(clip.timeline.placedCommands()[0].duration).toBe(0);
    });
});

import { describe, expect, it } from "vitest";
import { Registry } from "@/document/registry";
import type { CommandSpec, CompositionDocument, TimedNodeSpec } from "@/document/types";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";

const Bulb = component2d({
    key: "bulb",
    state: { level: Types.number(1), hue: Types.number(0) },
    commands: {
        enter: { args: {}, entrance: true, run: (timeline) => timeline.animate((t) => ({ level: t })) },
        grow: { args: {}, run: (timeline) => timeline.animate((t) => ({ level: t })) },
        dimTo: { args: ["level"] },
        shiftTo: { args: ["hue"] },
    },
});

const registry = () => new Registry({ nodes: { bulb: Bulb.node } as never });

function documentOf(commands: CommandSpec[], node: Partial<TimedNodeSpec> = {}): CompositionDocument {
    return {
        kind: "composition",
        nodes: [{ id: "b", type: "bulb", parentId: null, layerOrder: 0, props: {}, ...node }],
        commands,
    } as CompositionDocument;
}

const cmd = (id: string, type: string, at: number, duration: number, args: Record<string, unknown> = {}): CommandSpec =>
    ({ id, type, targetId: "b", at, duration, args }) as CommandSpec;

function built(doc: CompositionDocument): TimelineClip {
    const clip = new TimelineClip(doc, runtimeScope({ registry: registry() }));
    clip.build();
    return clip;
}

/** The bulb's props at `t`, through the held path and checked against the observed reference. */
function at(clip: TimelineClip, t: number): { level: number; hue: number } | undefined {
    clip.seek(t);
    const read = () => {
        const bulb = clip.canvas.children.find((c) => c.id === "b") as { properties: { level: number; hue: number } } | undefined;
        return bulb && { level: bulb.properties.level, hue: bulb.properties.hue };
    };
    const held = read();
    clip.timeline.evaluateAt(t, () => { });
    expect(held, `held and observed at ${t}`).toEqual(read());
    return held;
}

describe("entrance commands", () => {
    it("hold their first frame from the moment the node arrives", () => {
        const clip = built(documentOf([cmd("e", "enter", 2, 1)], { startAt: 1 }));
        expect(at(clip, 0.5)).toBeUndefined();
        expect(at(clip, 1)?.level).toBe(0);
        expect(at(clip, 1.5)?.level).toBe(0);
        expect(at(clip, 2.5)?.level).toBeCloseTo(0.5);
        expect(at(clip, 4)?.level).toBe(1);
        expect(clip.timeline.placedCommands()[0].holdFrom).toBe(1);
    });

    it("leave a command without the flag showing the node at rest until it starts", () => {
        const clip = built(documentOf([cmd("g", "grow", 2, 1)]));
        expect(at(clip, 1)?.level).toBe(1);
        expect(clip.timeline.placedCommands()[0].holdFrom).toBe(2);
    });

    it("hold through a command that writes other slots", () => {
        const clip = built(documentOf([cmd("s", "shiftTo", 0, 1, { hue: 10 }), cmd("e", "enter", 2, 1)]));
        expect(at(clip, 0.5)).toEqual({ level: 0, hue: 5 });
        expect(at(clip, 1.5)).toEqual({ level: 0, hue: 10 });
    });

    it("stop at the end of an earlier command on a slot they write", () => {
        const clip = built(documentOf([cmd("d", "dimTo", 0, 1, { level: 0.5 }), cmd("e", "enter", 2, 1)]));
        expect(at(clip, 0.5)?.level).toBeCloseTo(0.75);
        expect(at(clip, 1.5)?.level).toBe(0);
        expect(clip.timeline.placedCommands()[1].holdFrom).toBe(1);
    });

    it("do not hold when an earlier writer is still running at their start", () => {
        const clip = built(documentOf([cmd("d", "dimTo", 0, 3, { level: 0.5 }), cmd("e", "enter", 2, 1)]));
        expect(clip.timeline.placedCommands()[1].holdFrom).toBe(2);
        expect(at(clip, 1.5)?.level).toBeCloseTo(0.75);
    });

    it("keep their hold right across an update that moves a neighbour", () => {
        const before = documentOf([cmd("d", "dimTo", 0, 1, { level: 0.5 }), cmd("e", "enter", 2, 1)]);
        const after = documentOf([cmd("d", "dimTo", 0, 0.5, { level: 0.5 }), cmd("e", "enter", 2, 1)]);
        const clip = built(before);
        expect(clip.update(after)).not.toBeNull();
        const fresh = built(after);
        expect(clip.timeline.placedCommands()[1].holdFrom).toBe(0.5);
        for (const t of [0.25, 0.75, 1.5, 2.5]) expect(at(clip, t), `at ${t}`).toEqual(at(fresh, t));
    });

    it("are reported by the registry", () => {
        const commands = registry().node("bulb")!.commands;
        expect(commands.get("enter")?.entrance).toBe(true);
        expect(commands.get("grow")?.entrance).toBeUndefined();
    });
});

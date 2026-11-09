import { describe, expect, it } from "vitest";
import { Registry } from "@/document/registry";
import type { CommandSpec, CompositionDocument, TimedNodeSpec } from "@/document/types";
import { sampleTree } from "@/components/trees/node/node-walk";
import { NullRenderContext } from "@/render/null-render-context";
import { documentKeyTimes, TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";

const Lamp = component2d({
    key: "lamp",
    state: { ...Paint.state, ...Flow.state, ...Corners.state, brightness: Types.number(0, { min: 0, max: 1 }), glow: Types.number(0, { private: true }) },
    commands: {
        ...Paint.commands,
        dimTo: { args: ["brightness"] },
        slide: { args: ["x", "y"] },
        sweep: (timeline) => timeline.sequence([timeline.tween({ brightness: 1 }), timeline.wait(0.2), timeline.tween({ brightness: 0.25, x: 40 })]),
        pulse: {
            args: { peak: Types.number(1) },
            run: (timeline, state) => timeline.animate((t) => ({ glow: timeline.args.peak * Math.sin(Math.PI * t), brightness: state.brightness * (1 - t / 2) })),
        },
        // Marked only while every leaf is: `fadeTo` on a child is a class command.
        wave: (timeline, _state, children) => timeline.stagger(children.map((c) => c.to({ y: 30 })), { overlap: 0.5 }),
        fadeKids: (timeline, _state, children) => timeline.together(children.map((c) => c.run("fadeTo", { opacity: 0.2 }))),
        // Held ahead of its start as well as after it.
        rise: { args: {}, entrance: true, run: (timeline) => timeline.together([timeline.animate(() => ({ brightness: 0 }), { eased: false }), timeline.tween({ brightness: 1 })]) },
    },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Corners.rect(ctx.size, state)),
});

const registry = () => new Registry({ nodes: { lamp: Lamp.node } as never });

/** Deterministic, so a failure reproduces from its seed. */
function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Lamps with class rects inside, and a random mix of marked and unmarked commands on both. */
function documentOf(seed: number): CompositionDocument {
    const rand = random(seed);
    const nodes: TimedNodeSpec[] = [];
    const lamps = ["a", "b", "c"];
    lamps.forEach((id, i) => {
        nodes.push({ id, type: "lamp", parentId: null, layerOrder: i, props: { width: 200, height: 80, fill: "white", flow: "horizontal", gap: 4 } });
        for (let k = 0; k < 2; k++) nodes.push({ id: `${id}${k}`, type: "rect", parentId: id, layerOrder: k, props: { width: 20, height: 20 } });
    });
    const kinds: { type: string; args: () => Record<string, unknown>; lamp: boolean }[] = [
        { type: "dimTo", args: () => ({ brightness: Math.round(rand() * 10) / 10 }), lamp: true },
        { type: "slide", args: () => ({ x: Math.round(rand() * 100), y: Math.round(rand() * 50) }), lamp: true },
        { type: "fillTo", args: () => (rand() < 0.5 ? "red" : "blue") as never, lamp: true },
        { type: "progressTo", args: () => ({ end: rand() }), lamp: true },
        { type: "sweep", args: () => ({}), lamp: true },
        { type: "pulse", args: () => ({ peak: rand() }), lamp: true },
        { type: "wave", args: () => ({}), lamp: true },
        { type: "fadeKids", args: () => ({}), lamp: true },
        { type: "flash", args: () => ({ portion: 0.3 }), lamp: true },
        { type: "rise", args: () => ({}), lamp: true },
        // Unmarked, on the same slots.
        { type: "to", args: () => ({ x: Math.round(rand() * 100) }), lamp: true },
        { type: "fadeTo", args: () => ({ opacity: rand() }), lamp: true },
        { type: "to", args: () => ({ y: Math.round(rand() * 40) }), lamp: false },
    ];
    const commands: CommandSpec[] = [];
    let at = 0;
    for (let i = 0; i < 25; i++) {
        at += rand() < 0.3 ? 0 : rand() * 0.6;
        const kind = kinds[Math.floor(rand() * kinds.length)];
        const lamp = lamps[Math.floor(rand() * lamps.length)];
        const targetId = kind.lamp ? lamp : `${lamp}${Math.floor(rand() * 2)}`;
        commands.push({
            id: `c${i}`, type: kind.type, targetId, at: Math.round(at * 30) / 30,
            duration: rand() < 0.15 ? 0 : Math.round(rand() * 45) / 30, args: kind.args() as Record<string, unknown>,
        });
    }
    return { kind: "composition", nodes, commands } as CompositionDocument;
}

/** Every node's props, and every lamp's private glow. */
function state(clip: TimelineClip): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const walk = (node: { id: string; properties: object; children: readonly unknown[] }) => {
        out[node.id] = { ...node.properties, glow: (node as { glow?: number }).glow };
        for (const child of node.children) walk(child as never);
    };
    walk(clip.canvas as never);
    return out;
}

describe("held commands", () => {
    it("evaluate every time exactly as running every command does", () => {
        for (let seed = 1; seed <= 40; seed++) {
            const doc = documentOf(seed);
            const clip = new TimelineClip(doc, runtimeScope({ registry: registry() }));
            clip.build();
            expect((clip.timeline as unknown as { _settled: unknown })._settled, `seed ${seed}`).not.toBeNull();
            const rand = random(seed * 31);
            const times = [...documentKeyTimes(doc), ...Array.from({ length: 12 }, () => rand() * clip.timeline.duration)]
                .sort(() => rand() - 0.5);
            for (const t of times) {
                clip.attach(t);
                clip.timeline.syncPresence(t);
                clip.timeline.evaluateAt(t);
                const heldState = state(clip);
                // The observed path still restores whole nodes and runs every started command: the reference.
                clip.timeline.evaluateAt(t, () => { });
                expect(heldState, `seed ${seed} at ${t}`).toEqual(state(clip));
                // A frame between evaluations, so anything but a command writing a prop would show at the next.
                clip.layout();
                sampleTree(clip.canvas);
                clip.canvas.render(new NullRenderContext());
            }
        }
    });

    it("marks a composed command only when every piece in it settles", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [
                { id: "a", type: "lamp", parentId: null, layerOrder: 0, props: {} },
                { id: "a0", type: "rect", parentId: "a", layerOrder: 0, props: {} },
            ],
            commands: [
                { id: "w", type: "wave", targetId: "a", at: 0, duration: 1, args: {} },
                { id: "f", type: "fadeKids", targetId: "a", at: 1, duration: 1, args: {} },
            ],
        } as CompositionDocument;
        const clip = new TimelineClip(doc, runtimeScope({ registry: registry() }));
        clip.build();
        const index = (clip.timeline as unknown as { _settled: { _replayed: readonly number[] } })._settled;
        expect(index._replayed).toEqual([1]);
    });
});

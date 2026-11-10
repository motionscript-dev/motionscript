import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestAssetCatalog } from "@/assets/catalog";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import { sampleTree } from "@/components/trees/node/node-walk";
import { RecordingContext } from "@/components/trees/tests/recording-context.fixtures";
import { documentKeyTimes, TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";
import { migrateDocument } from "../migrate";
import type { ProjectDocument } from "../project";
import { Registry } from "../registry";
import type { CommandSpec, CompositionDocument, TimedNodeSpec, VisualDocument } from "../types";
import { jsonFiles, manifestFor, releases, root } from "./corpus.fixtures";

// Held evaluation against the reference (`evaluateAt(t, onWrite)` restores every
// animated node and runs every started command): what each draws and what each
// node holds must not differ at any time, in any order.

const Lamp = component2d({
    key: "lamp",
    state: { ...Paint.state, ...Flow.state, ...Corners.state, brightness: Types.number(0, { min: 0, max: 1 }), glow: Types.number(0, { private: true }) },
    commands: {
        ...Paint.commands,
        dimTo: { args: ["brightness"] },
        sweep: (timeline) => timeline.sequence([timeline.tween({ brightness: 1 }), timeline.wait(0.2), timeline.tween({ brightness: 0.25, x: 40 })]),
        pulseGlow: {
            args: { peak: Types.number(1) },
            run: (timeline, state) => timeline.animate((t) => ({ glow: timeline.args.peak * Math.sin(Math.PI * t), brightness: state.brightness * (1 - t / 2) })),
        },
        // Unmarked: a child's class command run as a piece.
        fadeKids: (timeline, _state, children) => timeline.together(children.map((c) => c.run("fadeTo", { opacity: 0.2 }))),
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

/**
 * Laid-out rows of rects, a lamp with children, a node-ref follower and a text
 * that comes and goes, under a random mix of held and unheld commands: class
 * commands, component commands (some marked by the factory, some not), `save`
 * and `restore`, expression args, loops, an entrance, variable and root commands.
 */
function mixedDocument(seed: number): CompositionDocument {
    const rand = random(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
    const round = (n: number, step = 1) => Math.round(n / step) * step;
    const nodes: TimedNodeSpec[] = [];
    const rects: string[] = [];
    for (let r = 0; r < 3; r++) {
        nodes.push({ id: `r${r}`, type: "rect", parentId: null, layerOrder: r, props: { y: r * 60 - 120, flow: "horizontal", gap: 4, width: "hug", height: 30, fill: "#334" } });
        for (let k = 0; k < 3; k++) {
            const id = `r${r}_${k}`;
            rects.push(id);
            const bound = k === 1 && r === 0 ? { opacity: "=[g]" } : k === 2 && r === 1 ? { rotation: "=[g]*90" } : {};
            nodes.push({ id, type: "rect", parentId: `r${r}`, layerOrder: k, props: { width: 10 + k * 5, height: 20, fill: "white", ...bound } });
        }
    }
    nodes.push({ id: "L", type: "lamp", key: "lamp", parentId: null, layerOrder: 3, props: { x: 200, width: 120, height: 60, fill: "red", flow: "horizontal", gap: 2 } });
    for (let k = 0; k < 2; k++) nodes.push({ id: `L${k}`, type: "rect", parentId: "L", layerOrder: k, props: { width: 20, height: 20 } });
    nodes.push({ id: "e", type: "ellipse", parentId: null, layerOrder: 4, props: { width: 30, height: 30, x: "=[lamp.x]-150", fill: "blue" } });
    nodes.push({ id: "t", type: "text", parentId: null, layerOrder: 5, startAt: 0.5, endAt: 2.5, props: { text: "hi", y: 150 } });

    const held: { type: string; target: () => string | null; args: () => Record<string, unknown> }[] = [
        { type: "to", target: () => pick(rects), args: () => ({ x: round(rand() * 60) }) },
        { type: "set", target: () => pick(rects), args: () => ({ rotation: round(rand() * 90) }) },
        { type: "moveTo", target: () => pick(["e", "L", ...rects]), args: () => ({ x: round(rand() * 100), y: round(rand() * 40) }) },
        { type: "fadeTo", target: () => pick([...rects, "L", "t"]), args: () => ({ opacity: round(rand(), 0.1) }) },
        { type: "rotateTo", target: () => pick([...rects, "e"]), args: () => ({ rotation: round(rand() * 180 - 90) }) },
        { type: "scaleTo", target: () => pick([...rects, "L"]), args: () => ({ scale: round(0.5 + rand(), 0.1) }) },
        { type: "layoutTo", target: () => pick(rects), args: () => ({ width: round(5 + rand() * 30) }) },
        { type: "pulse", target: () => pick(rects), args: () => ({ factor: 1.3 }) },
        { type: "wiggle", target: () => pick(rects), args: () => ({ angle: 10, turns: 2 }) },
        { type: "fillTo", target: () => pick(rects), args: () => ({ fill: pick(["red", "#0f0", "white"]) }) },
        { type: "progressTo", target: () => pick(rects), args: () => ({ end: round(rand(), 0.1) }) },
        { type: "variableTo", target: () => "g", args: () => ({ value: round(rand(), 0.1) }) },
        { type: "zoomTo", target: () => null, args: () => ({ zoom: round(0.8 + rand() * 0.4, 0.1) }) },
        { type: "headingTo", target: () => null, args: () => ({ heading: round(rand() * 20 - 10) }) },
    ];
    const other: typeof held = [
        { type: "save", target: () => pick(rects), args: () => ({}) },
        { type: "restore", target: () => pick(rects), args: () => ({}) },
        { type: "set", target: () => pick(rects), args: () => ({ x: "=[g]*30" }) },
        { type: "dimTo", target: () => "L", args: () => ({ brightness: round(rand(), 0.1) }) },
        { type: "sweep", target: () => "L", args: () => ({}) },
        { type: "pulseGlow", target: () => "L", args: () => ({ peak: round(rand(), 0.1) }) },
        { type: "fadeKids", target: () => "L", args: () => ({}) },
        { type: "rise", target: () => "L", args: () => ({}) },
        { type: "fillTo", target: () => "L", args: () => ({ fill: pick(["red", "#ff0"]) }) },
    ];
    const commands: CommandSpec[] = [];
    let at = 0;
    for (let i = 0; i < 40; i++) {
        at += rand() < 0.3 ? 0 : rand() * 0.25;
        const kind = rand() < 0.65 ? pick(held) : pick(other);
        const args = kind.args();
        const command: CommandSpec = {
            id: `c${i}`, type: kind.type, targetId: kind.target(), at: round(at, 1 / 30),
            duration: rand() < 0.15 ? 0 : round(rand() * 1.5, 1 / 30), args: kind.type === "fillTo" ? args.fill as never : args,
        };
        if (rand() < 0.1 && command.duration! > 0) command.loop = { count: 1 + Math.floor(rand() * 2), direction: pick(["normal", "alternate"] as const) };
        if (rand() < 0.2) command.easing = { kind: pick(["in", "out", "inOut"] as const), args: "cubic" };
        commands.push(command);
    }
    return { kind: "composition", nodes, commands, variables: [{ id: "g", value: 0.5 }] } as CompositionDocument;
}

/** Everything one frame of `clip` holds and draws at `t`. */
function frameAt(clip: TimelineClip, t: number, reference: boolean) {
    clip.attach(t);
    clip.timeline.syncPresence(t);
    if (reference) clip.timeline.evaluateAt(t, () => { });
    else clip.timeline.evaluateAt(t);
    clip.layout();
    sampleTree(clip.canvas);
    const ctx = new RecordingContext();
    clip.canvas.render(ctx);
    const props: Record<string, unknown> = {};
    const walk = (node: { id: string; properties: object; children: readonly unknown[] }) => {
        props[node.id] = { ...node.properties, glow: (node as { glow?: number }).glow };
        for (const child of node.children) walk(child as never);
    };
    walk(clip.canvas as never);
    return {
        props,
        events: ctx.events,
        transforms: ctx.transforms,
        states: ctx.states,
        ops: ctx.graphics.map((g) => g.ops()),
        clips: ctx.clips.map((c) => c.ops()),
        cameras: ctx.cameras,
        effects: ctx.effects,
    };
}

/** Key times and the doubles either side of each, plus random times, shuffled. */
function timesOf(doc: VisualDocument, duration: number, rand: () => number): number[] {
    const times = new Set<number>();
    for (const t of documentKeyTimes(doc)) {
        times.add(t);
        times.add(t + 1e-9);
        if (t > 0) times.add(t - 1e-9);
    }
    for (let i = 0; i < 16; i++) times.add(rand() * (duration + 0.5));
    return [...times].sort(() => rand() - 0.5);
}

function expectSameFrames(doc: VisualDocument, scope: Parameters<typeof runtimeScope>[0], seed: number, label: string): void {
    const held = new TimelineClip(doc, runtimeScope(scope));
    const reference = new TimelineClip(doc, runtimeScope(scope));
    held.build();
    reference.build();
    const rand = random(seed);
    for (const t of timesOf(doc, held.timeline.duration, rand)) {
        expect(frameAt(held, t, false), `${label} at ${t}`).toEqual(frameAt(reference, t, true));
    }
}

describe("held evaluation draws what running every command draws", () => {
    it("in mixed scenes", { timeout: 60_000 }, () => {
        for (let seed = 1; seed <= 30; seed++) {
            const doc = mixedDocument(seed);
            expectSameFrames(doc, { registry: registry() }, seed * 17, `seed ${seed}`);
        }
    });

    it("holds most of a mixed scene's commands", () => {
        const clip = new TimelineClip(mixedDocument(7), runtimeScope({ registry: registry() }));
        clip.build();
        const index = (clip.timeline as unknown as { _settled: { holds(i: number): boolean } | null })._settled!;
        const placed = clip.timeline.placedCommands();
        const heldCount = placed.filter((_, i) => index.holds(i)).length;
        expect(heldCount).toBeGreaterThan(placed.length / 2);
    });

    describe("in every saved document", () => {
        const strict = new Registry({ strict: true });
        for (const release of releases) {
            for (const file of jsonFiles(join(root, release))) {
                it(`${release}/${relative(join(root, release), file).replaceAll("\\", "/")}`, () => {
                    const { document } = migrateDocument(JSON.parse(readFileSync(file, "utf8")) as ProjectDocument);
                    const assets = new ManifestAssetCatalog(manifestFor(document));
                    document.tracks.forEach(({ clip }, k) => {
                        if (clip.kind !== "composition") return;
                        expectSameFrames(clip, { registry: strict, assets, viewport: document.viewport }, k + 1, `track ${k}`);
                    });
                });
            }
        }
    });
});

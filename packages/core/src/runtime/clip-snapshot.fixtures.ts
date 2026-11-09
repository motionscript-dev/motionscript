/**
 * Test-only helpers for checking an in-place timeline update against a fresh
 * build of the same document: a harness that builds, evaluates and updates a
 * timeline the way `ClipInstance` does, a per-path snapshot of the tree, and a
 * registry that counts constructions.
 */
import { expect } from "vitest";

import { Registry, type NodeConstructor } from "@/document/registry";
import { ClipTimeline } from "@/document/timeline";
import type { TimelinePatch } from "@/document/timeline-patch";
import { documentDuration, isStillDocument, nodeSpan, ROOT_NODE_ID, type VisualDocument } from "@/document/types";
import { Ellipse, Rect } from "@/components/builtins/geometry/geometry";
import type { Node2D } from "@/components/trees/2d/node2d";
import type { Node } from "@/components/trees/node/node";
import { sampleTree } from "@/components/trees/node/node-walk";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { DefaultTextStyle, Text } from "@/components/builtins/text/text";
import type { RuntimeScope } from "@/runtime/clip-instance";
import { runtimeScope } from "@/runtime/document.fixtures";
import { ContextMap } from "@/util/context";

/**
 * Every time a document can change — a command's start or end, a node's arrival or
 * departure — plus `0` and its end, sorted.
 */
export function documentKeyTimes(doc: VisualDocument): number[] {
    const duration = documentDuration(doc);
    const times = new Set<number>([0, duration]);
    if (!isStillDocument(doc)) {
        for (const command of doc.commands) {
            times.add(command.at);
            times.add(command.at + (command.duration ?? 0));
        }
    }
    for (const node of doc.nodes) {
        if (node.id === ROOT_NODE_ID) continue;
        const span = nodeSpan(node);
        times.add(span.start);
        if (Number.isFinite(span.end)) times.add(span.end);
    }
    return [...times].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
}

/** What {@link snapshotClip} drives: a `ClipInstance`, or a {@link TimelineClip}. */
export interface SnapshotSource {
    readonly canvas: Node;
    attach(seconds: number): void;
    evaluateAt(seconds: number): void;
    layout(): void;
}

/** A timeline over its canvas, driven the way `ClipInstance` drives one. */
export class TimelineClip implements SnapshotSource {
    readonly canvas: Canvas2D;
    readonly timeline: ClipTimeline;

    constructor(doc: VisualDocument, readonly scope: RuntimeScope = runtimeScope()) {
        const { width, height } = scope.viewport;
        this.canvas = new Canvas2D({ id: ROOT_NODE_ID, width, height, flow: "freeform" });
        this.timeline = new ClipTimeline(doc, scope.registry, this.canvas);
    }

    build(): void {
        this.attach(0);
        this.timeline.build();
        this.settle();
        this.timeline.compile(() => this.settle());
        this.layout();
    }

    /** The update `ClipInstance.update` performs: `null` when the plan says rebuild. */
    update(next: VisualDocument): TimelinePatch | null {
        const patch = this.timeline.planUpdate(next);
        if (!patch) return null;
        this.attach(0);
        this.timeline.applyUpdate(patch, () => this.settle(), () => this.settle());
        this.layout();
        return patch;
    }

    evaluateAt(seconds: number): void {
        this.timeline.syncPresence(seconds);
        this.timeline.evaluateAt(seconds);
    }

    /** Attach, evaluate and lay out, as a frame seek does. */
    seek(seconds: number): void {
        this.attach(seconds);
        this.evaluateAt(seconds);
        this.layout();
    }

    attach(seconds: number): void {
        this.canvas.attach({ assets: this.scope.assets, context: ContextMap.EMPTY, time: seconds });
    }

    layout(): void {
        const { width, height } = this.scope.viewport;
        this.canvas.layout({ x: 0, y: 0, width, height }, this.scope.measurer);
    }

    private settle(): void {
        sampleTree(this.canvas);
        this.layout();
    }
}

export interface NodeSnapshot {
    className: string;
    /** Only for a document row; a composite's own children carry a per-instance UUID. */
    id?: string;
    mounted: boolean;
    properties: Record<string, unknown>;
    layoutBounds?: { x: number; y: number; width: number; height: number };
}

export interface ClipSnapshot {
    time: number;
    nodes: Record<string, NodeSnapshot>;
    variables: Record<string, unknown>;
}

/** The tree at each time, by structural path (`""`, `"0"`, `"0.2"`), plus every variable's value. */
export function snapshotClip(clip: SnapshotSource, times: readonly number[]): ClipSnapshot[] {
    const timeline = (clip as { timeline?: ClipTimeline }).timeline ?? (clip as unknown as { _timeline: ClipTimeline })._timeline;
    return times.map((time) => {
        clip.attach(time);
        clip.evaluateAt(time);
        clip.layout();
        const nodes: Record<string, NodeSnapshot> = {};
        const walk = (node: Node, path: string) => {
            const properties = { ...node.properties } as Record<string, unknown>;
            delete properties.id;
            const bounds = (node as { layoutBounds?: NodeSnapshot["layoutBounds"] }).layoutBounds;
            nodes[path] = {
                className: node.className,
                ...(timeline.liveNode(node.id) === node && { id: node.id }),
                mounted: node.mounted,
                properties,
                ...(bounds && { layoutBounds: { ...bounds } }),
            };
            node._allChildren.forEach((child, i) => walk(child, path === "" ? String(i) : `${path}.${i}`));
        };
        walk(clip.canvas, "");
        const variables: Record<string, unknown> = {};
        for (const spec of timeline.variables()) variables[spec.id] = timeline.variableValue(spec.id);
        return { time, nodes, variables };
    });
}

/** Every `step` seconds over `[0, duration]`, each key time, and a hair either side of each. */
export function sampleTimes(duration: number, step = 0.1, keyTimes: readonly number[] = []): number[] {
    const times = new Set<number>();
    for (let k = 0; k * step <= duration + 1e-9; k++) times.add(Number((k * step).toFixed(6)));
    for (const t of keyTimes) {
        for (const at of [t - 1e-3, t, t + 1e-3]) {
            if (at >= 0 && at <= duration) times.add(at);
        }
    }
    return [...times].sort((a, b) => a - b);
}

const CONSTRUCTED = new WeakMap<Registry, string[]>();

/**
 * A registry whose rect, ellipse, text and default-text-style types log the id
 * of every instance they construct. Subclasses, so the registry no longer treats
 * their props as layout-neutral — a counted update may replay more than a plain one.
 */
export function countingRegistry(): { registry: Registry; constructed: string[] } {
    const constructed: string[] = [];
    type Concrete = new (props?: Record<string, unknown>) => Node2D;
    const counted = (Base: Concrete): NodeConstructor => class Counted extends Base {
        constructor(props?: Record<string, unknown>) {
            super(props);
            constructed.push(this.id);
        }
    };
    const registry = new Registry();
    registry.addNode("rect", counted(Rect.node as unknown as Concrete), { replace: true });
    registry.addNode("ellipse", counted(Ellipse.node as unknown as Concrete), { replace: true });
    registry.addNode("text", counted(Text.node as unknown as Concrete), { replace: true });
    registry.addNode("default-text-style", counted(DefaultTextStyle.node as unknown as Concrete), { replace: true });
    CONSTRUCTED.set(registry, constructed);
    return { registry, constructed };
}

export interface IncrementalOptions {
    registry?: Registry;
    /** Assert the plan asks for a rebuild instead of comparing. */
    expectRebuild?: boolean;
    /** Times `prev` is evaluated at before the update, so the update starts from a used tree. */
    dirtyAt?: readonly number[];
}

export interface IncrementalResult {
    patch: TimelinePatch | null;
    /** Ids constructed by the update, when the registry came from {@link countingRegistry}. */
    constructed: string[];
    incremental: TimelineClip;
    fresh?: TimelineClip;
}

/**
 * Build `prev`, use it, update it to `next`, and require every sampled frame to
 * match a fresh build of `next`.
 */
export function expectIncrementalMatchesFresh(
    prev: VisualDocument,
    next: VisualDocument,
    options: IncrementalOptions = {},
): IncrementalResult {
    const registry = options.registry ?? new Registry();
    const incremental = new TimelineClip(prev, runtimeScope({ registry }));
    incremental.build();
    const prevDuration = documentDuration(prev);
    const dirtyAt = options.dirtyAt ?? [prevDuration * 0.6, prevDuration, prevDuration * 0.25, prevDuration * 0.8];
    for (const t of dirtyAt) incremental.seek(t);

    const log = CONSTRUCTED.get(registry);
    const before = log?.length ?? 0;
    const patch = incremental.update(next);
    const constructed = log ? log.slice(before) : [];

    if (options.expectRebuild) {
        expect(patch, "planned a rebuild").toBeNull();
        return { patch, constructed, incremental };
    }
    expect(patch, "planned an in-place update").not.toBeNull();

    const fresh = new TimelineClip(next, runtimeScope({ registry }));
    fresh.build();
    const duration = documentDuration(next);
    const times = sampleTimes(duration, 0.1, documentKeyTimes(next));
    const actual = snapshotClip(incremental, times);
    const expected = snapshotClip(fresh, times);
    for (let i = 0; i < times.length; i++) {
        expect(actual[i], `at ${times[i]}s`).toEqual(expected[i]);
    }
    // Backwards too: an update that left hidden state behind shows up on a reverse seek.
    const reversed = [...times].reverse();
    const actualBack = snapshotClip(incremental, reversed);
    const expectedBack = snapshotClip(fresh, reversed);
    for (let i = 0; i < reversed.length; i++) {
        expect(actualBack[i], `seeking back to ${reversed[i]}s`).toEqual(expectedBack[i]);
    }
    return { patch, constructed, incremental, fresh };
}

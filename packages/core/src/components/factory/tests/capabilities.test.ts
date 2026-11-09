import { describe, expect, it } from "vitest";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { Node2D } from "@/components/trees/2d/node2d";
import { laidOut, recorded } from "@/components/trees/tests/recording-context.fixtures";
import { easeIn } from "@/tween/ease/constants";
import type { ChildView, NodeView } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import { Rect } from "@/components/builtins/geometry/geometry";
import { OrbitCamera } from "@/components/builtins/layout/layout";

type Ctor = new (props?: Record<string, unknown>) => Node2D;
const build = (component: unknown, props: Record<string, unknown> = {}) => new (component as Ctor)(props);

/** A plot: its children's `x`/`y` are graph units, ten pixels each, from its centre. */
const Plot = component2d({
    key: "capPlot",
    state: { unit: 10 },
    layout: (box, state, children) => children.map((c) => ({
        x: 0, y: 0, ...c.measure({}),
        plane: { toOffset: (x: number, y: number) => ({ x: x * state.unit, y: y * state.unit }), toCoords: (x: number, y: number) => ({ x: x / state.unit, y: y / state.unit }) },
    })),
    plane: (box, state) => ({ toOffset: (x, y) => ({ x: x * state.unit, y: y * state.unit }), toCoords: (x, y) => ({ x: x / state.unit, y: y / state.unit }) }),
});

describe("child planes", () => {
    it("place a child by its x/y in the parent's units", () => {
        const child = build(Rect, { id: "c", x: 2, y: 3, width: 4, height: 4 });
        laidOut(build(Plot, { id: "p", width: 200, height: 200, children: [child] }), { x: 0, y: 0, width: 200, height: 200 });
        expect({ ...child._offset() }).toEqual({ x: 20, y: 30 });
    });

    it("answer for a child not added yet", () => {
        const plot = laidOut(build(Plot, { id: "p", width: 200, height: 200, unit: 5 }), { x: 0, y: 0, width: 200, height: 200 });
        expect(plot._planeOf(null)?.toCoords(10, 20)).toEqual({ x: 2, y: 4 });
    });
});

const Arrow = component2d({
    key: "capArrow",
    state: { head: Types.point({ x: 10, y: 0 }), scale: 2 },
    handles: {
        head: { at: (state) => ({ x: state.head.x * state.scale, y: state.head.y * state.scale }), value: (at: Vector2, state) => ({ x: at.x / state.scale, y: at.y / state.scale }) },
    },
    bounds: (size) => ({ x: 5, y: 0, width: size.width / 2, height: size.height }),
    render: (ctx) => ctx.draw(null),
});

describe("handles and bounds", () => {
    it("put an entry's handle where the spec says, and read a drop back as its value", () => {
        const arrow = laidOut(build(Arrow, { id: "a", width: 40, height: 20 }));
        expect(arrow._handles()).toEqual([{ prop: "head", at: { x: 20, y: 0 } }]);
        expect(arrow._handleValue("head", { x: 8, y: 4 })).toEqual({ x: 4, y: 2 });
        expect(arrow._handleValue("tail", { x: 8, y: 4 })).toBeNull();
    });

    it("select by the bounds the spec gives", () => {
        const arrow = laidOut(build(Arrow, { id: "a", width: 40, height: 20 }), { x: 0, y: 0, width: 40, height: 20 });
        expect(arrow._localBounds()).toEqual({ x: 5, y: 0, width: 20, height: 20 });
    });
});

let seen: NodeView | null = null;
const Follower = component2d({
    key: "capFollower",
    state: { target: Types.nodeRef() },
    render: (ctx, state) => {
        seen = state.target;
    },
});

describe("node references", () => {
    it("read as a view of the node named, where it stands in the reader's frame", () => {
        const follower = build(Follower, { id: "f", target: "dot", width: 10, height: 10 });
        const dot = build(Rect, { id: "dot", x: 30, y: -20, width: 10, height: 10, fill: "red" });
        const root = laidOut(build(Rect, { id: "root", width: 200, height: 200, children: [follower, dot] }), { x: 0, y: 0, width: 200, height: 200 });
        recorded(root);
        expect(seen?.id).toBe("dot");
        expect(seen?.frame.x).toBeCloseTo(30 - follower.x);
        expect((seen?.state as { fill: unknown[] }).fill.length).toBe(1);
    });

    it("read the referenced node's own references as views from where it stands", () => {
        const follower = build(Follower, { id: "f", target: "relay", width: 10, height: 10 });
        const relay = build(Follower, { id: "relay", target: "dot", x: 50, width: 10, height: 10 });
        const dot = build(Rect, { id: "dot", x: 80, y: 10, width: 10, height: 10, fill: "red" });
        laidOut(build(Rect, { id: "root", width: 200, height: 200, children: [follower, relay, dot] }), { x: 0, y: 0, width: 200, height: 200 });
        const seenByFollower = (follower as unknown as { _view: { target: NodeView } })._view.target;
        const relayed = (seenByFollower.state as { target: NodeView | null }).target;
        expect(relayed?.id).toBe("dot");
        // Where the dot stands from the relay, not from the follower.
        expect(relayed?.frame.x).toBeCloseTo(30);
        expect(relayed?.frame.y).toBeCloseTo(10);
        expect((seenByFollower.state as { width: unknown }).width).toBe(10);
    });

    it("read what the node has beyond its entries, as its cardinal points", () => {
        const follower = build(Follower, { id: "f", target: "dot", width: 10, height: 10 });
        const dot = build(Rect, { id: "dot", x: 30, y: -20, width: 10, height: 10 });
        recorded(laidOut(build(Rect, { id: "root", width: 200, height: 200, children: [follower, dot] }), { x: 0, y: 0, width: 200, height: 200 }));
        expect((seen?.state as { topLeft: Vector2 }).topLeft).toEqual(dot.topLeft);
        expect((seen?.state as object).constructor).toBe(dot.constructor);
    });

    it("read as null for no id, or one nobody has", () => {
        const follower = laidOut(build(Follower, { id: "f", target: "nobody" }));
        recorded(follower);
        expect(seen).toBeNull();
        (follower as unknown as { target: string }).target = "";
        recorded(follower);
        expect(seen).toBeNull();
    });
});

let clock: { measure?: number; layout?: number } = {};
const Clocked = component2d({
    key: "capClocked",
    measure: (measurer) => {
        clock.measure = measurer.time.total;
        return { width: 10, height: 10 };
    },
    layout: (box) => {
        clock.layout = box.time.total;
        return [];
    },
});

describe("layout's clock", () => {
    it("reaches measure and layout", () => {
        clock = {};
        const node = laidOut(build(Clocked, { id: "c" }));
        node.measure({ maxWidth: 100, maxHeight: 100 }, { measureText: () => ({ width: 0, height: 0 }) } as never);
        expect(typeof clock.measure).toBe("number");
        expect(typeof clock.layout).toBe("number");
    });
});

let reached: string[] = [];
let linear: number[] = [];
const Board = component2d({
    key: "capBoard",
    commands: {
        light: (timeline, state, children) => {
            // Parts nested one rect down, eased one by one over linear progress.
            reached = children.flatMap((row: ChildView) => row.children.map((part) => part.id));
            return timeline.animate((t) => {
                linear.push(t);
                return {};
            }, { eased: false });
        },
        mark: {
            args: { by: Types.number(1) },
            easing: easeIn(),
            run: (timeline) => {
                reached = [timeline.node.id, String(timeline.ease(0.5) < 0.5)];
                return timeline.wait(0);
            },
        },
    },
});

describe("commands", () => {
    it("reach parts nested in a child, and animate over linear progress when asked", () => {
        const board = laidOut(build(Board, {
            id: "b", children: [build(Rect, { id: "row", children: [build(Rect, { id: "p1" }), build(Rect, { id: "p2" })] })],
        }));
        linear = [];
        const command = (board as unknown as { light(a: object): { at(t: number): void } }).light({ duration: 1, easing: easeIn() });
        command.at(0.5);
        expect(reached).toEqual(["p1", "p2"]);
        expect(linear.at(-1)).toBeCloseTo(0.5);
    });

    it("run when called from code with nothing said", () => {
        const board = laidOut(build(Board, { id: "b" }));
        expect(() => (board as unknown as { mark(): unknown; light(): unknown }).mark()).not.toThrow();
        expect(() => (board as unknown as { light(): unknown }).light()).not.toThrow();
    });

    it("know their node and ease by their own easing when the row gives none", () => {
        const board = laidOut(build(Board, { id: "b" }));
        (board as unknown as { mark(a: object): unknown }).mark({ duration: 1 });
        expect(reached).toEqual(["b", "true"]);
    });

    it("read each child's size as it was last laid out", () => {
        let sizes: { width: number; height: number }[] = [];
        const Sizer = component2d({
            key: "capSizer",
            commands: {
                look: (timeline, state, children) => {
                    sizes = children.map((child: ChildView) => child.size);
                    return timeline.wait(0);
                },
            },
        });
        const sizer = laidOut(build(Sizer, {
            id: "s", width: 200, height: 200, children: [build(Rect, { id: "a", width: 30, height: 40 }), build(Rect, { id: "b", width: 50, height: 10 })],
        }), { x: 0, y: 0, width: 200, height: 200 });
        (sizer as unknown as { look(a: object): unknown }).look({ duration: 1 });
        expect(sizes).toEqual([{ width: 30, height: 40 }, { width: 50, height: 10 }]);
    });
});

let inSpace: boolean[] = [];
const Probe = component2d({
    key: "capProbe",
    render: (ctx) => {
        inSpace.push(ctx.inSpace);
    },
});

describe("ctx.inSpace", () => {
    it("is true under an orbit camera's space and false outside one", () => {
        inSpace = [];
        recorded(laidOut(build(Probe, { id: "alone", width: 10, height: 10 })));
        recorded(laidOut(build(OrbitCamera, { id: "cam", width: 200, height: 200, children: [build(Probe, { id: "in", width: 10, height: 10 })] }), { x: 0, y: 0, width: 200, height: 200 }));
        expect(inSpace[0]).toBe(false);
        expect(inSpace.at(-1)).toBe(true);
    });

    it("follows a parent that stops opening its space from one frame to the next", () => {
        const Lens = component2d({
            key: "capLens",
            state: { open: true },
            render: (ctx, state) => (state.open
                ? ctx.space({ perspective: 800, orbit: 0, elevation: 0, dolly: 0, lookAt: { x: 0, y: 0 }, zoom: 1, heading: 0, viewportX: 0, viewportY: 0 })
                : ctx.children()),
        });
        inSpace = [];
        const lens = laidOut(build(Lens, { id: "lens", width: 200, height: 200, children: [build(Probe, { id: "p", width: 10, height: 10 })] }), { x: 0, y: 0, width: 200, height: 200 });
        recorded(lens);
        expect(inSpace.at(-1)).toBe(true);
        (lens as unknown as { open: boolean }).open = false;
        recorded(lens);
        expect(inSpace.at(-1)).toBe(false);
        expect(lens._spaceCamera()).toBeNull();
    });
});

import { describe, expect, it, vi } from "vitest";
import { AssetDeclaration } from "@/assets/scope";
import { ManifestAssetCatalog } from "@/assets/catalog";
import { Registry } from "@/document/registry";

import { Graphics2D } from "@/render/graphics2d";
import type { Node2D } from "@/components/trees/2d/node2d";
import { laidOut } from "@/components/trees/tests/recording-context.fixtures";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import { Rect } from "@/components/builtins/geometry/geometry";
import * as Paint from "@/components/modules/paint";

const Gauge = component2d({
    key: "gauge",
    state: { ...Paint.state, value: Types.number(0, { min: 0, max: 1, unit: "%" }) },
    commands: { ...Paint.commands, fillUp: { args: ["value"] } },
    render: (ctx, state) => Paint.draw(ctx, state, new Graphics2D().ellipse({
        width: ctx.size.width, height: ctx.size.height, ratio: 0.75, startAngle: -90, sweep: 360 * state.value,
    })),
});

/** A custom layout: children fanned out on a circle, each turned to face outward. */
const RadialMenu = component2d({
    key: "radialMenu",
    state: {
        radius: Types.number(200, { min: 0 }),
        spread: Types.number(1, { min: 0, max: 1 }),
    },
    defaults: { width: "hug", height: "hug" },
    commands: { open: { args: ["spread"] } },
    measure: (measurer, state, children) => {
        const side = Math.max(0, ...children.map((c) => {
            const size = c.measure(measurer.max);
            return Math.max(size.width, size.height);
        }));
        const extent = 2 * state.radius + side;
        return { width: extent, height: extent };
    },
    layout: (box, state, children) => children.map((c, i) => {
        const angle = (i / Math.max(1, children.length)) * 360 * state.spread;
        const r = state.radius * state.spread;
        return {
            x: r * Math.cos((angle * Math.PI) / 180),
            y: r * Math.sin((angle * Math.PI) / 180),
            width: c.size.width,
            height: c.size.height,
            // Angles count counter-clockwise (y up); rotation turns clockwise on screen.
            rotation: -angle,
            opacity: state.spread,
        };
    }),
});

const build = (component: (props?: never) => unknown, props: Record<string, unknown>) => component(props as never) as Node2D;

describe("component2d is an ordinary node type to a registry", () => {
    const registry = new Registry({ nodes: { rectV2: Rect.node, gauge: Gauge.node } as never });

    it("describes its entries with their meaning", () => {
        const props = registry.describe("gauge")!.properties!;
        expect(props.value).toMatchObject({ default: 0, kind: "number", min: 0, max: 1, unit: "%" });
        // Built-in placement comes with the tree.
        expect(Object.keys(props)).toEqual(expect.arrayContaining(["x", "y", "width", "opacity", "fill", "stroke", "value"]));
    });

    it("publishes its commands beside the built-in ones", () => {
        const keys = [...registry.node("gauge")!.commands.keys()];
        expect(keys).toEqual(expect.arrayContaining(["fillUp", "flash", "progressTo", "moveTo", "fadeTo"]));
    });

    it("runs a command from a document's args", () => {
        const gauge = laidOut(build(Gauge, { width: 100, height: 100 }));
        const command = registry.nodeCommand("gauge", "fillUp")!(gauge, { value: 0.8 }, 1);
        command.at(0.5);
        expect((gauge as unknown as { value: number }).value).toBeCloseTo(0.4);
        command.at(1);
        expect((gauge as unknown as { value: number }).value).toBeCloseTo(0.8);
    });

    it("answers a paint command with a bare value", () => {
        const rect = laidOut(build(Rect, { width: 100, height: 100, fill: "red" }));
        (rect as unknown as { fillTo(a: object): { at(t: number): void } }).fillTo({ data: "blue", duration: 1 }).at(1);
        const blue = laidOut(build(Rect, { width: 100, height: 100, fill: "blue" }));
        const fills = (n: unknown) => (n as { fill: Record<string, unknown>[] }).fill;
        // A tween lands on an explicit full opacity where a written colour leaves it unset.
        expect(fills(rect)).toEqual(fills(blue).map((layer) => ({ ...layer, opacity: 1 })));
    });
});

describe("a custom layout", () => {
    const items = () => [0, 1, 2, 3].map((i) => new Rect({ id: `i${i}`, width: 40, height: 40 }));

    it("places each child where its layout says, y up from the centre", () => {
        const menu = laidOut(build(RadialMenu, { radius: 100, spread: 1, children: items() }), { x: 0, y: 0, width: 400, height: 400 });
        const boxes = menu.children.map((c) => (c as Node2D).layoutBounds);
        expect(boxes[0]).toMatchObject({ x: 100, width: 40, height: 40 });
        expect(boxes[0].y).toBeCloseTo(0);
        // 90° round: y up 100 is y down -100 in a layout rect.
        expect(boxes[1].x).toBeCloseTo(0);
        expect(boxes[1].y).toBeCloseTo(-100);
    });

    it("turns each child in its slot without touching the child's own props", () => {
        const menu = laidOut(build(RadialMenu, { radius: 100, spread: 0.5, children: items() }), { x: 0, y: 0, width: 400, height: 400 });
        const [first, second] = menu.children as Node2D[];
        expect(second._placement()).toMatchObject({ rotation: -45, opacity: 0.5, scale: 1 });
        expect(first._placement()!.rotation).toBeCloseTo(0);
        expect(second.rotation).toBe(0);
    });

    it("hugs the circle it draws", () => {
        const menu = build(RadialMenu, { radius: 100, children: items() });
        const size = menu.measure({ maxWidth: 1000, maxHeight: 1000 }, { measureText: () => ({ width: 0, height: 0 }) } as never);
        expect(size).toEqual({ width: 240, height: 240 });
    });

    it("opens with a tween of `spread`", () => {
        const menu = laidOut(build(RadialMenu, { spread: 0, children: items() }));
        const registry = new Registry({ nodes: [RadialMenu.node] as never });
        registry.nodeCommand("radialMenu", "open")!(menu, { spread: 1 }, 1).at(0.5);
        expect((menu as unknown as { spread: number }).spread).toBeCloseTo(0.5);
    });
});

describe("state", () => {
    const Lamp = component2d({
        key: "lamp",
        state: {
            brightness: Types.number(0, { min: 0, max: 1 }),
            label: "Lamp",
            flicker: Types.number(0, { private: true }),
        },
        defaults: { padding: 12, opacity: 0.5 },
        commands: {
            dimTo: { args: ["brightness"] },
            blink: {
                args: { times: Types.number(2, { min: 1, step: 1 }) },
                run: (timeline) => timeline.animate((t) => ({ flicker: Math.round(t * timeline.args.times) })),
            },
            sweep: (timeline) => timeline.sequence([timeline.tween({ brightness: 1 }), timeline.tween({ brightness: 0.25 })]),
        },
    });
    const registry = new Registry({ nodes: [Lamp.node] as never });

    it("keeps private entries out of what a host is told", () => {
        const keys = Object.keys(registry.describe("lamp")!.properties!);
        expect(keys).toEqual(expect.arrayContaining(["brightness", "label"]));
        expect(keys).not.toContain("flicker");
    });

    it("lets a command write a private entry", () => {
        const lamp = laidOut(build(Lamp, {}));
        registry.nodeCommand("lamp", "blink")!(lamp, {}, 1).at(1);
        expect((lamp as unknown as { flicker: number }).flicker).toBe(2);
    });

    it("applies an arg's default when the document leaves it out", () => {
        const lamp = laidOut(build(Lamp, {}));
        const command = registry.nodeCommand("lamp", "blink")!(lamp, { times: undefined }, 1);
        command.at(1);
        expect((lamp as unknown as { flicker: number }).flicker).toBe(2);
    });

    it("gives built-in entries new defaults", () => {
        const lamp = build(Lamp, {}) as Node2D & { padding: { left: number }; opacity: number };
        expect(lamp.padding.left).toBe(12);
        expect(lamp.opacity).toBe(0.5);
    });

    it("hands a default binding what the node was built with, which a later write leaves as it was", () => {
        const Echo = component2d({
            key: "echo",
            state: { level: 1, echo: 0, live: 0 },
            defaults: { echo: (_state, given) => (given.level as number | undefined ?? 0) * 10, live: (state) => state.level * 10 },
        });
        const echo = build(Echo, { level: 2 }) as Node2D & { level: number; echo: number; live: number };
        echo.set({ level: 3 } as never);
        expect([echo.echo, echo.live]).toEqual([20, 30]);
        expect((build(Echo, {}) as Node2D & { echo: number }).echo).toBe(0);
        expect((build(Echo, { echo: 5 }) as Node2D & { echo: number }).echo).toBe(5);
    });

    it("spreads a sequence across the command's span", () => {
        const lamp = laidOut(build(Lamp, {}));
        const command = registry.nodeCommand("lamp", "sweep")!(lamp, {}, 2);
        command.at(0.25);
        expect((lamp as unknown as { brightness: number }).brightness).toBeCloseTo(0.5);
        command.at(1);
        expect((lamp as unknown as { brightness: number }).brightness).toBeCloseTo(0.25);
    });
});

describe("load", () => {
    const grammar = async (): Promise<void> => { };
    const Listing = component2d({
        key: "listing",
        state: { language: "ts" },
        load: (loader, state) => loader.task(`grammar:${state.language}`, grammar, { before: "layout" }),
    });

    it("hands the scope one function for a task two nodes declare with the same one", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        try {
            const scope = new AssetDeclaration(new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }));
            new Listing({}).declareAssets(scope);
            new Listing({}).declareAssets(scope);
            expect(scope.declarations.get("grammar:ts")).toMatchObject({ type: "loader", gate: "layout" });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});

describe("a node made of other nodes", () => {
    const Card = component2d({ key: "builtCard", children: () => [Rect({ width: 40, height: 20 } as never)] });

    it("hugs them when given no size", () => {
        const card = build(Card, {});
        expect([card.width, card.height]).toEqual(["hug", "hug"]);
    });

    it("fills when given a flex, as any node does", () => {
        const card = build(Card, { flex: 1 });
        expect([card.width, card.height]).toEqual(["fill", "fill"]);
    });
});

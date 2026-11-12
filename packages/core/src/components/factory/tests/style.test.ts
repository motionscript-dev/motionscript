import { describe, expect, it } from "vitest";

import { asProjectDocument } from "@/document/project";
import { Registry } from "@/document/registry";
import type { CompositionDocument } from "@/document/types";
import { evaluatorFor } from "@/runtime/document.fixtures";
import { component2d } from "@/components/factory/component2d";
import type { NodeOf } from "@/components/factory/api";
import { Types } from "@/components/factory/types";

const Badge = component2d({
    key: "styledBadge",
    state: {
        label: "Hi",
        style: Types.style("badge", {
            colors: { palette: Types.palette(["red", "blue"]), ink: Types.fill("white") },
            text: { size: Types.number(20, { min: 8 }), curve: Types.oneOf(["smooth", "linear"]) },
        }, { presets: { night: { ink: "black", size: 30 } } }),
    },
});

type Badge = NodeOf<typeof Badge>;
const badge = (props: Record<string, unknown> = {}) => new Badge.node(props as never) as unknown as Badge;

describe("a style entry", () => {
    it("resolves every field from its defaults, flat", () => {
        const node = badge();
        expect(Object.keys(node.style)).toEqual(["palette", "ink", "size", "curve"]);
        expect(node.style.palette).toHaveLength(2);
        expect(node.style.size).toBe(20);
        expect(node.style.curve).toBe("smooth");
    });

    it("lays a partial over what it had and drops keys it does not declare", () => {
        const node = badge({ style: { size: 40 } });
        expect(node.style.size).toBe(40);
        expect(node.style.curve).toBe("smooth");
        node.set({ style: { curve: "linear", innerRadius: 0.5 } as never });
        expect(node.style.size).toBe(40);
        expect(node.style.curve).toBe("linear");
        expect("innerRadius" in node.style).toBe(false);
    });

    it("gives each node its own palette", () => {
        const a = badge();
        const b = badge();
        expect(a.style.palette).not.toBe(b.style.palette);
    });

    it("tweens numbers and fills, and steps a choice at the midpoint", () => {
        const style = Types.style("badge", { all: { size: Types.number(10), curve: Types.oneOf(["smooth", "linear"]), ink: Types.fill("black") } });
        const { mapper, tween } = style._def;
        const from = mapper!({ size: 10, curve: "smooth", ink: "black" }) as Record<string, unknown>;
        const to = mapper!({ size: 30, curve: "linear", ink: "white" }) as Record<string, unknown>;
        const early = tween!(from, to, 0.25) as Record<string, unknown>;
        const late = tween!(from, to, 0.75) as Record<string, unknown>;
        expect(early.size).toBe(15);
        expect(early.curve).toBe("smooth");
        expect(late.curve).toBe("linear");
        expect(early.ink).not.toEqual(from.ink);
        expect(early.ink).not.toEqual(to.ink);
    });

    it("describes its family, grouped fields with defaults, and presets", () => {
        const described = new Registry({ nodes: [Badge] }).describe("styledBadge")!.properties!.style;
        expect(described).toMatchObject({
            kind: "style",
            family: "badge",
            presets: { night: { ink: "black", size: 30 } },
        });
        const properties = described!.properties as Record<string, Record<string, unknown>>;
        expect(properties.palette).toMatchObject({ kind: "palette", group: "colors", default: ["red", "blue"] });
        expect(properties.ink).toMatchObject({ kind: "fills", group: "colors", default: "white" });
        expect(properties.size).toMatchObject({ kind: "number", group: "text", min: 8, default: 20 });
        expect(properties.curve).toMatchObject({ kind: "enum", options: ["smooth", "linear"], default: "smooth" });
    });

    it("refuses a field key declared in two groups", () => {
        expect(() => Types.style("x", { a: { size: 1 }, b: { size: 2 } })).toThrow(/two groups/);
    });

    it("tweens through a document's `to` command, field by field", () => {
        const registry = new Registry({ nodes: [Badge] });
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [{ id: "b", type: "styledBadge", parentId: null, layerOrder: 0, props: { style: { size: 10 } } }],
            commands: [{ id: "c1", type: "to", targetId: "b", at: 0, duration: 1, args: { style: { size: 30, curve: "linear" } } }],
        };
        const evaluator = evaluatorFor(asProjectDocument(doc, { fps: 10, viewport: { width: 100, height: 100 } }), { registry, fps: 10 });
        const badge = () => evaluator.currentCanvas!.children[0] as unknown as { style: { size: number; curve: string; ink: unknown } };
        evaluator.stateAt(0);
        expect(badge().style.size).toBe(10);
        evaluator.stateAt(5);
        expect(badge().style.size).toBeGreaterThan(10);
        expect(badge().style.size).toBeLessThan(30);
        evaluator.stateAt(10);
        expect(badge().style.size).toBe(30);
        expect(badge().style.curve).toBe("linear");
        expect(badge().style.ink).toBeDefined();
    });
});

const Caption = component2d({
    key: "typographyCaption",
    state: { look: Types.typography({ fontSize: 24, fontWeight: 500, fill: "white" }) },
});
type Caption = NodeOf<typeof Caption>;
const caption = (props: Record<string, unknown> = {}) => new Caption.node(props as never) as unknown as Caption;

describe("a typography entry", () => {
    it("lays a partial text style over its default, resolving the paint", () => {
        const node = caption({ look: { fontWeight: 700 } });
        expect(node.look).toMatchObject({ fontSize: 24, fontWeight: 700 });
        expect(node.look.fill).toEqual([{ type: "solid", color: [1, 1, 1, 1], opacity: 1 }].map((layer) => expect.objectContaining({ type: layer.type })));
    });

    it("keeps what a later partial leaves out", () => {
        const node = caption();
        node.set({ look: { fontFamily: "Inter" } });
        node.set({ look: { fontSize: 40 } });
        expect(node.look).toMatchObject({ fontFamily: "Inter", fontSize: 40, fontWeight: 500 });
    });

    it("describes itself with its default for a host's text controls", () => {
        const described = new Registry({ nodes: [Caption] }).describe("typographyCaption")!;
        expect(described.properties!.look).toMatchObject({ kind: "typography", default: { fontSize: 24, fontWeight: 500, fill: "white" } });
    });
});

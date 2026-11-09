import { describe, expect, it } from "vitest";

import { asProjectDocument } from "@/document/project";
import { migrateNodeProps } from "@/document/prop-evolution";
import { Registry } from "@/document/registry";
import type { CompositionDocument } from "@/document/types";
import { component2d } from "@/components/factory/component2d";
import { componentAudio } from "@/components/factory/component-audio";
import { component3d } from "@/components/factory/component3d";
import { Types } from "@/components/factory/types";
import { evaluatorFor } from "@/runtime/document.fixtures";

// Once `turns` (whole turns), now `angle` in degrees; `glow` gave way to `shadow`;
// `label` used to take a bare string and now takes `{ text }`.
const Dial = component2d({
    key: "evolvingDial",
    state: {
        angle: Types.number(0),
        glow: Types.number(0),
        label: Types.custom<{ text: string }>({ text: "" }),
    },
    renamed: { turns: "angle", tint: "glow" },
    deprecated: { glow: "Use `shadow` instead." },
    migrate: {
        turns: (value) => (value as number) * 360,
        label: (value) => (typeof value === "string" ? { text: value } : value),
    },
});

type Dial = { angle: number; glow: number; label: { text: string } };

const registry = new Registry({ nodes: [Dial] });
const row = (props: Record<string, unknown>) => ({ id: "d", type: "evolvingDial", parentId: null, layerOrder: 0, props });

describe("a component's prop evolution", () => {
    it("renames an old key, converting only what was stored under it", () => {
        const { props, changes } = migrateNodeProps(registry, "evolvingDial", { turns: 0.5 });
        expect(props).toEqual({ angle: 180 });
        expect(changes).toEqual([{ prop: "turns", message: '"turns" was renamed "angle".' }]);
        expect(migrateNodeProps(registry, "evolvingDial", { angle: 90 }).props).toEqual({ angle: 90 });
    });

    it("keeps the new key when a row sets both", () => {
        const { props, changes } = migrateNodeProps(registry, "evolvingDial", { turns: 1, angle: 45 });
        expect(props).toEqual({ angle: 45 });
        expect(changes[0].message).toMatch(/also sets; the old value was dropped/);
    });

    it("runs an entry's hook on every value, which leaves a current one alone", () => {
        expect(migrateNodeProps(registry, "evolvingDial", { label: "Hi" }).props).toEqual({ label: { text: "Hi" } });
        const current = { label: { text: "Hi" } };
        const again = migrateNodeProps(registry, "evolvingDial", current);
        expect(again.props).toBe(current);
        expect(again.changes).toEqual([]);
    });

    it("moves an expression under a rename but converts nothing inside it", () => {
        const { props, changes } = migrateNodeProps(registry, "evolvingDial", { turns: "=[spin]" });
        expect(props).toEqual({ angle: "=[spin]" });
        expect(changes.map((c) => c.message)).toEqual([
            '"turns" is an expression, so its value was left as written.',
            '"turns" was renamed "angle".',
        ]);
    });

    it("reports a deprecated prop a row still sets, without changing it", () => {
        const { props, deprecated } = migrateNodeProps(registry, "evolvingDial", { tint: 0.3 });
        expect(props).toEqual({ glow: 0.3 });
        expect(deprecated).toEqual([{ prop: "glow", message: "Use `shadow` instead." }]);
    });

    it("never mutates the props it is given, and passes an unknown or unchanged type through", () => {
        const given = Object.freeze({ turns: 1 });
        migrateNodeProps(registry, "evolvingDial", given);
        expect(given).toEqual({ turns: 1 });
        const props = { x: 1 };
        expect(migrateNodeProps(registry, "rect", props)).toEqual({ props, changes: [], deprecated: [] });
        expect(migrateNodeProps(registry, "ghost", props).props).toBe(props);
    });

    it("applies when a row is instantiated", () => {
        const dial = registry.instantiate(row({ turns: 0.25, label: "Go" })) as unknown as Dial;
        expect(dial.angle).toBe(90);
        expect(dial.label).toEqual({ text: "Go" });
    });

    it("applies to a document's rows, and to a `to` or `set` command's props", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [row({ turns: 0.25 })],
            variables: [{ id: "g", value: 0.5 }],
            commands: [
                { id: "c1", type: "to", targetId: "d", at: 0, duration: 1, args: { turns: 1 } },
                { id: "c2", type: "set", targetId: "d", at: 2, args: { tint: "=[g]" } },
            ],
        };
        const evaluator = evaluatorFor(asProjectDocument(doc, { fps: 10, viewport: { width: 100, height: 100 } }), { registry, fps: 10 });
        const dial = () => evaluator.currentCanvas!.children[0] as unknown as Dial;
        evaluator.stateAt(0);
        expect(dial().angle).toBe(90);
        evaluator.stateAt(10);
        expect(dial().angle).toBe(360);
        evaluator.stateAt(25);
        expect(dial().glow).toBe(0.5);
    });

    it("shows a host the renames and the deprecations", () => {
        const described = registry.describe("evolvingDial")!;
        expect(described.renamed).toEqual({ turns: "angle", tint: "glow" });
        expect(described.properties!.glow.deprecated).toBe("Use `shadow` instead.");
        expect(described.properties!.angle.deprecated).toBeUndefined();
        expect(registry.describe("rect")!.renamed).toBeUndefined();
    });

    it("is declared on every tree's factory", () => {
        const Light = component3d({ key: "evolvingLight", state: { power: Types.number(1) }, renamed: { intensity: "power" } });
        const Bed = componentAudio({ key: "evolvingBed", state: { gain: Types.number(1) }, renamed: { level: "gain" } });
        const both = new Registry({ nodes: [Light, Bed] });
        expect(migrateNodeProps(both, "evolvingLight", { intensity: 2 }).props).toEqual({ power: 2 });
        expect(migrateNodeProps(both, "evolvingBed", { level: 0.5 }).props).toEqual({ gain: 0.5 });
    });
});

describe("a spec's evolution fields", () => {
    const state = { angle: Types.number(0) };

    it("refuse a rename from a key that is still an entry, or onto one that is none", () => {
        expect(() => component2d({ key: "bad1", state, renamed: { angle: "x" } })).toThrow('bad1: "renamed.angle" is still an entry');
        expect(() => component2d({ key: "bad2", state, renamed: { turns: "spin" } })).toThrow('bad2: "renamed.turns" names "spin", which is no entry.');
    });

    it("refuse a deprecation or a hook that names nothing", () => {
        expect(() => component2d({ key: "bad3", state, deprecated: { nope: "x" } })).toThrow('bad3: "deprecated.nope" names no entry.');
        expect(() => component2d({ key: "bad4", state, migrate: { nope: (v) => v } })).toThrow('bad4: "migrate.nope" names neither');
    });

    it("may rename onto a built-in entry", () => {
        const Moved = component2d({ key: "moved", state, renamed: { left: "x" } });
        expect(migrateNodeProps(new Registry({ nodes: [Moved] }), "moved", { left: 3 }).props).toEqual({ x: 3 });
    });
});

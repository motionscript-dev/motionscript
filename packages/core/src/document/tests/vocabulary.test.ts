import { describe, expect, it } from "vitest";

import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";

import { Registry } from "../registry";
import { registryVocabulary, vocabularyBreaks, type RegistryVocabulary } from "../vocabulary";

const before: RegistryVocabulary = {
    commands: ["to", "glowTo"],
    nodes: {
        card: { properties: { radius: { kind: "number", default: 8 }, tint: { kind: "color", default: "red" } }, commands: ["flip", "fadeTo"] },
        badge: { properties: {}, commands: [] },
    },
};

describe("vocabularyBreaks", () => {
    it("names every removal and changed default, and nothing added", () => {
        const after: RegistryVocabulary = {
            commands: ["to", "spinTo"],
            nodes: {
                card: { properties: { radius: { kind: "number", default: 12 }, label: { kind: "text" } }, commands: ["fadeTo", "wave"] },
                ribbon: { properties: {}, commands: [] },
            },
        };
        expect(vocabularyBreaks(before, after)).toEqual([
            { name: "glowTo", what: "command removed" },
            { name: "card.radius", what: "default changed" },
            { name: "card.tint", what: "prop removed" },
            { name: "card.flip", what: "command removed" },
            { name: "badge", what: "node type removed" },
        ]);
        expect(vocabularyBreaks(before, before)).toEqual([]);
    });
});

describe("registryVocabulary", () => {
    it("records a type's props with their defaults, and its commands", () => {
        const Dial = component2d({ key: "vocabDial", state: { level: Types.number(3) }, commands: { spin: { args: ["level"] } } });
        const { nodes, commands } = registryVocabulary(new Registry({ nodes: [Dial] }));
        expect(nodes.vocabDial.properties.level).toEqual({ kind: "number", default: 3 });
        expect(nodes.vocabDial.commands).toContain("spin");
        expect(commands).toContain("variableTo");
        expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes);
    });
});

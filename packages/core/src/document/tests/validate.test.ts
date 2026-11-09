import { describe, expect, it } from "vitest";

import { Registry } from "../registry";
import { assertValidDocument, validateDocument, validateProjectDocument } from "../validate";
import type { CompositionDocument, StillDocument } from "../types";

/** Every issue's path, so a test asserts *where* the problem was found. */
const paths = (doc: unknown): string[] => validateDocument(doc).issues.map((i) => i.path);

describe("validateDocument", () => {
    it("accepts a well-formed still", () => {
        const doc: StillDocument = {
            kind: "still",
            nodes: [
                { id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} },
                { id: "b", type: "text", parentId: "a", layerOrder: 0, props: { text: "hi" } },
            ],
        };
        expect(validateDocument(doc)).toEqual({ valid: true, issues: [] });
    });

    it("accepts a well-formed composition", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, startAt: 0.5, endAt: 3, props: {} }],
            commands: [{ id: "c1", type: "to", targetId: "a", at: 1, duration: 1, args: { x: 10 } }],
        };
        expect(validateDocument(doc)).toEqual({ valid: true, issues: [] });
    });

    it("accepts a still's variables as fixed values", () => {
        const doc: StillDocument = {
            kind: "still",
            variables: [{ id: "unit", value: 8 }],
            nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, props: { x: "=[unit]*2" } }],
        };
        expect(validateDocument(doc)).toEqual({ valid: true, issues: [] });
    });

    it("rejects an unknown kind", () => {
        expect(paths({ kind: "video" })).toEqual(["kind"]);
    });

    it("reports every issue rather than stopping at the first", () => {
        const issues = validateDocument({
            kind: "still",
            nodes: [
                { id: "", type: "rect", parentId: null, layerOrder: 0, props: {} },
                { id: "b", type: "", parentId: null, layerOrder: "x", props: null },
            ],
        }).issues;
        expect(issues.length).toBeGreaterThan(3);
    });

    it("catches a parent that names no node", () => {
        expect(paths({
            kind: "still",
            nodes: [{ id: "a", type: "rect", parentId: "ghost", layerOrder: 0, props: {} }],
        })).toContain("nodes[0].parentId");
    });

    it("catches duplicate node ids", () => {
        expect(paths({
            kind: "still",
            nodes: [
                { id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} },
                { id: "a", type: "rect", parentId: null, layerOrder: 1, props: {} },
            ],
        })).toContain("nodes[1].id");
    });

    /**
     * A parent cycle would otherwise recurse until the stack overflows, with a
     * trace pointing at the layout engine rather than at the two rows involved.
     */
    it("catches a parent cycle", () => {
        const result = validateDocument({
            kind: "still",
            nodes: [
                { id: "a", type: "rect", parentId: "b", layerOrder: 0, props: {} },
                { id: "b", type: "rect", parentId: "a", layerOrder: 0, props: {} },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => /cycle/.test(i.message))).toBe(true);
    });

    it("catches a command whose target is no node", () => {
        expect(paths({
            kind: "composition",
            nodes: [],
            commands: [{ id: "c", type: "to", targetId: "ghost", at: 0, duration: 1, args: {} }],
        })).toEqual(["commands[0].targetId"]);
    });

    /** The rule a timeline editor breaks by dragging a tween before its node exists. */
    it("catches a command that runs before its target enters", () => {
        expect(paths({
            kind: "composition",
            nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, startAt: 2, props: {} }],
            commands: [{ id: "c1", type: "to", targetId: "a", at: 1, duration: 1, args: {} }],
        })).toEqual(["commands[0].at"]);
    });

    /** A child hangs off its parent, so it is not there before the parent is either. */
    it("reads a target's presence through its ancestors", () => {
        expect(paths({
            kind: "composition",
            nodes: [
                { id: "group", type: "rect", parentId: null, layerOrder: 0, startAt: 2, props: {} },
                { id: "child", type: "rect", parentId: "group", layerOrder: 0, props: {} },
            ],
            commands: [{ id: "c1", type: "to", targetId: "child", at: 1, duration: 1, args: {} }],
        })).toEqual(["commands[0].at"]);
    });

    it("catches a node declared twice", () => {
        const spec = { id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} };
        expect(paths({ kind: "composition", nodes: [spec, spec], commands: [] })).toContain("nodes[1].id");
    });

    /**
     * The tree and command checks run over the rows that passed their shape
     * check; an issue's path is still the row's place in the document.
     */
    describe("paths with a malformed row before the problem", () => {
        const bad = { id: "bad", type: "", parentId: null, layerOrder: 0, props: {} };
        const ok = (id: string, parentId: string | null) => ({ id, type: "rect", parentId, layerOrder: 0, props: {} });

        it("points a duplicate id at its own row", () => {
            expect(paths({ kind: "still", nodes: [bad, ok("a", null), ok("a", null)] })).toContain("nodes[2].id");
        });

        it("points a missing parent at its own row", () => {
            expect(paths({ kind: "still", nodes: [bad, ok("a", "ghost")] })).toContain("nodes[1].parentId");
        });

        it("points a parent cycle at a row that is in it", () => {
            const cyclic = paths({ kind: "still", nodes: [bad, ok("a", "b"), ok("b", "a")] });
            expect(cyclic).toContain("nodes[1].parentId");
            expect(cyclic).not.toContain("nodes[0].parentId");
        });

        it("points a command issue at its own row", () => {
            const malformed = { id: "", type: "to", targetId: "a", at: 0, duration: 1, args: {} };
            expect(paths({
                kind: "composition",
                nodes: [ok("a", null)],
                commands: [
                    malformed,
                    { id: "c1", type: "to", targetId: "ghost", at: 0, duration: 1, args: {} },
                    { id: "c2", type: "to", targetId: "a", at: 0, duration: 1, args: { x: "=[nope]" } },
                ],
            })).toEqual(expect.arrayContaining(["commands[0].id", "commands[1].targetId", "commands[2].args.x"]));
        });
    });

    it("rejects a span that ends before it starts, or one on the root", () => {
        expect(paths({
            kind: "composition",
            nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, startAt: 2, endAt: 2, props: {} }],
            commands: [],
        })).toEqual(["nodes[0].endAt"]);
        expect(paths({
            kind: "composition",
            nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, startAt: 1, props: {} }],
            commands: [],
        })).toEqual(["nodes[0]"]);
    });

    it("rejects a span on a still's node", () => {
        expect(paths({
            kind: "still",
            nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, endAt: 2, props: {} }],
        })).toEqual(["nodes[0]"]);
    });

    it("names where a retired command or field went", () => {
        const { issues } = validateDocument({
            kind: "composition",
            constants: [{ id: "g", kind: "number", value: 1 }],
            nodes: [],
            commands: [
                { id: "a", type: "add", targetId: null, at: 0, args: { id: "x", type: "rect", parentId: null, layerOrder: 0, props: {} } },
                { id: "v", type: "variable", targetId: null, at: 0, args: { id: "g", value: 0 } },
            ],
        });
        expect(issues.map((i) => i.path)).toEqual(["constants", "commands[0].type", "commands[1].type"]);
        expect(issues[1].message).toMatch(/row in `nodes`.*`startAt`/);
        expect(issues[2].message).toMatch(/declared in `variables`/);
    });

    it("rejects a negative or non-finite time", () => {
        expect(paths({
            kind: "composition",
            nodes: [],
            commands: [{ id: "c", type: "to", targetId: null, at: -1, args: {} }],
        })).toContain("commands[0].at");
        expect(paths({
            kind: "composition",
            nodes: [],
            commands: [{ id: "c", type: "to", targetId: null, at: Infinity, args: {} }],
        })).toContain("commands[0].at");
    });

    it("rejects an unknown easing kind", () => {
        expect(paths({
            kind: "composition",
            nodes: [],
            commands: [{
                id: "c", type: "to", targetId: null, at: 0,
                easing: { kind: "bouncy" }, args: {},
            }],
        })).toContain("commands[0].easing.kind");
    });
});

/**
 * `key` is the handle an expression names a node by — `"=[card.x]"` — so it has to
 * be unique, and it has to be spellable inside the brackets.
 */
describe("node keys", () => {
    const still = (...nodes: Array<Record<string, unknown>>) => ({
        kind: "still",
        nodes: nodes.map((n, i) => ({ id: `n${i}`, type: "rect", parentId: null, layerOrder: i, props: {}, ...n })),
    });
    const messages = (doc: unknown) => validateDocument(doc).issues.map((i) => i.message);

    it("accepts one key per node, and no key at all", () => {
        expect(validateDocument(still({ key: "card" }, {}, { key: "label" })).valid).toBe(true);
    });

    it("catches two nodes claiming one key", () => {
        const result = validateDocument(still({ key: "card" }, { key: "card" }));
        expect(result.issues.map((i) => i.path)).toEqual(["nodes[1].key"]);
        expect(result.issues[0].message).toMatch(/duplicate node key "card".*nodes\[0\]/);
    });

    it("rejects a key an expression could not spell", () => {
        expect(paths(still({ key: "a.b" }))).toEqual(["nodes[0].key"]);
        expect(paths(still({ key: "a]b" }))).toEqual(["nodes[0].key"]);
        expect(paths(still({ key: "" }))).toEqual(["nodes[0].key"]);
        expect(paths(still({ key: 7 }))).toEqual(["nodes[0].key"]);
    });

    /**
     * Keys are their own namespace: `[x]` is always a variable and `[x.p]` is
     * always a node, so the two can never be read for one another.
     */
    it("lets a key match a variable id", () => {
        expect(validateDocument({
            ...still({ key: "unit", props: { x: "=[unit]*2" } }),
            variables: [{ id: "unit", value: 8 }],
        }).valid).toBe(true);
    });

    it("catches a reference to a key nothing is keyed with", () => {
        expect(messages(still({ props: { x: "=[ghost.y]" } }))[0])
            .toMatch(/no node in this document is keyed "ghost"/);
    });

    it("says what is missing when a reference names a node but no prop", () => {
        expect(messages(still({ key: "card" }, { props: { x: "=[card]" } }))[0])
            .toMatch(/is a node key — a node is not a value, so name the prop too/);
    });

    it("rejects a reference deeper than one prop", () => {
        expect(messages(still({ key: "card" }, { props: { x: "=[card.padding.top]" } }))[0])
            .toMatch(/not a node reference — one is "\[key\.prop\]"/);
    });

    it("resolves a reference to another node's prop", () => {
        expect(validateDocument(still(
            { key: "card", props: { x: 10 } },
            { props: { x: "=[card.x]+20" } },
        )).valid).toBe(true);
    });
});

/**
 * Two props reading each other never crashes — `PropSlot.get` refuses to re-enter
 * and hands back the last value it settled on — which is exactly why it is caught
 * here rather than left to the runtime.
 */
describe("expression cycles", () => {
    const bound = (...props: Array<[string, Record<string, unknown>]>) => ({
        kind: "still",
        nodes: props.map(([key, p], i) =>
            ({ id: `n${i}`, type: "rect", parentId: null, layerOrder: i, key, props: p })),
    });
    const result = (doc: unknown) => validateDocument(doc);

    it("catches two props reading each other", () => {
        const { valid, issues } = result(bound(["a", { x: "=[b.y]" }], ["b", { y: "=[a.x]" }]));
        expect(valid).toBe(false);
        expect(issues.some((i) => /expression cycle a\.x → b\.y → a\.x/.test(i.message))).toBe(true);
    });

    it("catches a prop reading itself", () => {
        expect(result(bound(["a", { x: "=[a.x]+1" }])).valid).toBe(false);
    });

    it("catches a longer ring, and reports it once", () => {
        const { issues } = result(bound(
            ["a", { x: "=[b.x]" }], ["b", { x: "=[c.x]" }], ["c", { x: "=[a.x]" }],
        ));
        expect(issues.filter((i) => /expression cycle/.test(i.message))).toHaveLength(1);
    });

    /** Per prop, not per node: `a.x → b.y → a.z` settles, and a.z is a literal. */
    it("leaves a chain that passes through a node twice alone", () => {
        expect(result(bound(["a", { x: "=[b.y]", z: 5 }], ["b", { y: "=[a.z]" }])).valid).toBe(true);
    });

    it("catches a cycle a `set` command closes", () => {
        const { valid } = validateDocument({
            kind: "composition",
            nodes: [
                { id: "a", type: "rect", parentId: null, layerOrder: 0, key: "a", props: { x: "=[b.y]" } },
                { id: "b", type: "rect", parentId: null, layerOrder: 1, key: "b", props: {} },
            ],
            commands: [{ id: "c2", type: "set", targetId: "b", at: 0, args: { y: "=[a.x]" } }],
        });
        expect(valid).toBe(false);
    });
});

describe("validateDocument: audio rows", () => {
    const sound = (props: Record<string, unknown>, type = "sound") => ({
        kind: "audio", nodes: [{ id: "s", type, parentId: null, layerOrder: 0, startAt: 0, endAt: 4, props }], commands: [],
    });

    it("accepts ramps, effects and transitions as JSON", () => {
        expect(validateDocument(sound({
            src: "a.mp3",
            volume: { keys: [{ at: 0, value: 1 }, { at: 3, value: 0.3, ease: { kind: "inOut", args: "quad" } }, { before: 0, value: 0.2 }] },
            speed: 1.5,
            effects: [{ type: "lowpass", frequency: { keys: [{ before: 1, value: 20000 }, { before: 0, value: 400 }] }, q: 0.7 }],
            transitionIn: { duration: 0.5 },
            transitionOut: { duration: 1.2, curve: { kind: "custom", args: [{ x: 0, y: 0 }, { x: 0.4, y: 0.8 }, { x: 1, y: 1 }] } },
        }))).toEqual({ valid: true, issues: [] });
        expect(validateDocument(sound({ transitionOut: { duration: 2, curve: "equalPower" } }, "audioBus")).valid).toBe(true);
        expect(validateDocument(sound({ volume: "=0.5 * 2", speed: "=1 + 0.5" })).valid).toBe(true);
    });

    it("names the rename of `filters`", () => {
        expect(validateDocument(sound({ filters: [{ type: "gain", value: 2 }] })).issues)
            .toEqual([{ path: "nodes[0].props.filters", message: "audio `filters` was renamed to `effects`." }]);
    });

    it("finds a malformed ramp key", () => {
        expect(paths(sound({ volume: { keys: [{ value: 1 }, { at: 1, before: 1, value: 0 }, { at: -1, value: 0 }, { at: 1, value: "x" }] } }))).toEqual([
            "nodes[0].props.volume.keys[0]",
            "nodes[0].props.volume.keys[1]",
            "nodes[0].props.volume.keys[2]",
            "nodes[0].props.volume.keys[3].value",
        ]);
        expect(paths(sound({ speed: "fast" }))).toEqual(["nodes[0].props.speed"]);
        expect(paths(sound({ effects: [{ type: "echo", delay: { keys: [{ at: 0, value: 0.2, ease: { kind: "custom", args: "bouncy" } }] } }] })))
            .toEqual(["nodes[0].props.effects[0].delay.keys[0].ease.args"]);
    });

    it("refuses a speed ramp on a looping sound", () => {
        expect(paths(sound({ loop: true, speed: { keys: [{ at: 0, value: 1 }] } }))).toEqual(["nodes[0].props.speed"]);
    });

    it("refuses a malformed transition, and the keys it does not have yet", () => {
        expect(paths(sound({
            transitionIn: { duration: -1 },
            transitionOut: { duration: 1, curve: "fast", speed: 0 },
        }))).toEqual([
            "nodes[0].props.transitionIn.duration",
            "nodes[0].props.transitionOut.curve",
            "nodes[0].props.transitionOut.speed",
        ]);
    });

    it("leaves other node types' props alone", () => {
        expect(validateDocument({ kind: "still", nodes: [{ id: "a", type: "rect", parentId: null, layerOrder: 0, props: { filters: [], volume: "x" } }] }).valid).toBe(true);
    });
});

describe("validation against a registry", () => {
    const registry = new Registry();
    const doc: CompositionDocument = {
        kind: "composition",
        nodes: [
            { id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} },
            { id: "g", type: "ghost", parentId: null, layerOrder: 1, props: {} },
        ],
        variables: [{ id: "v", value: 0 }],
        commands: [
            { id: "c1", type: "moveTo", targetId: "a", at: 0, args: { x: 1 } },
            { id: "c2", type: "countTo", targetId: "a", at: 0, args: {} },
            { id: "c3", type: "anything", targetId: "g", at: 0, args: {} },
            { id: "c4", type: "zoomTo", targetId: null, at: 0, args: { zoom: 2 } },
            { id: "c5", type: "moveTo", targetId: "v", at: 0, args: {} },
            { id: "c6", type: "variableTo", targetId: "v", at: 0, args: { value: 1 } },
        ],
    };

    it("reports every node type and command the registry cannot build", () => {
        expect(validateDocument(doc, { registry }).issues).toEqual([
            { path: "nodes[1].type", message: 'node type "ghost" is not registered.' },
            { path: "commands[1].type", message: 'node type "rect" has no command "countTo".' },
            { path: "commands[4].type", message: '"moveTo" is not a variable command.' },
        ]);
    });

    it("checks only the format without one", () => {
        expect(validateDocument(doc).issues).toEqual([]);
    });

    it("reaches every clip of a project", () => {
        const project = { kind: "project", name: "P", tracks: [{ id: "t", duration: 1, clip: doc }] };
        expect(validateProjectDocument(project).valid).toBe(true);
        expect(validateProjectDocument(project, { registry }).issues.map((i) => i.path)).toEqual([
            "tracks[0].clip.nodes[1].type",
            "tracks[0].clip.commands[1].type",
            "tracks[0].clip.commands[4].type",
        ]);
    });

    it("knows a still's nodes too", () => {
        const still: StillDocument = { kind: "still", nodes: [{ id: "g", type: "ghost", parentId: null, layerOrder: 0, props: {} }] };
        expect(validateDocument(still, { registry }).issues.map((i) => i.path)).toEqual(["nodes[0].type"]);
    });
});

describe("assertValidDocument", () => {
    it("returns the document when it is valid", () => {
        const doc: StillDocument = { kind: "still", nodes: [] };
        expect(assertValidDocument(doc)).toBe(doc);
    });

    it("throws with every issue listed", () => {
        expect(() => assertValidDocument({ kind: "nope" }))
            .toThrow(/Invalid clip document/);
    });
});

/** Fields of a command row, as `checkCommandSpec` reads them. */
describe("command rows", () => {
    const row = { id: "a", type: "rect", parentId: null, layerOrder: 0, props: {} };
    const command = (over: Record<string, unknown> = {}) =>
        ({ id: "c", type: "to", targetId: "a", at: 0, duration: 1, args: {}, ...over });
    const doc = (...commands: unknown[]) => ({ kind: "composition", nodes: [row], commands });
    const issues = (d: unknown) => validateDocument(d).issues;

    describe("loop", () => {
        it("accepts an unlimited loop and a counted one with a direction", () => {
            expect(validateDocument(doc(
                command({ loop: { count: null } }),
                command({ id: "d", loop: { count: 2, direction: "alternate" } }),
                command({ id: "e", loop: { count: 0, direction: "reverse" } }),
            )).valid).toBe(true);
        });

        it("wants an object", () => {
            expect(issues(doc(command({ loop: 3 })))).toEqual([
                { path: "commands[0].loop", message: "loop must be an object with a `count`." },
            ]);
        });

        it("wants a count, because absent is not the same as null", () => {
            expect(paths(doc(command({ loop: {} })))).toEqual(["commands[0].loop.count"]);
            expect(paths(doc(command({ loop: { direction: "normal" } })))).toEqual(["commands[0].loop.count"]);
        });

        it.each([
            ["negative", -1],
            ["fractional", 1.5],
            ["a string", "2"],
            ["infinite", Infinity],
            ["not a number", Number.NaN],
        ])("rejects a count that is %s", (_, count) => {
            const found = issues(doc(command({ loop: { count } })));
            expect(found.map((i) => i.path)).toEqual(["commands[0].loop.count"]);
            expect(found[0].message).toMatch(/whole number of repeats >= 0, or null/);
        });

        it("names the directions it knows when given another", () => {
            const [issue] = issues(doc(command({ loop: { count: 1, direction: "sideways" } })));
            expect(issue.path).toBe("commands[0].loop.direction");
            expect(issue.message).toMatch(/one of normal, reverse, alternate \(got "sideways"\)/);
        });
    });

    describe("easing", () => {
        it("wants an object with a kind", () => {
            expect(paths(doc(command({ easing: "linear" })))).toEqual(["commands[0].easing"]);
            expect(paths(doc(command({ easing: null })))).toEqual(["commands[0].easing"]);
            const [issue] = issues(doc(command({ easing: {} })));
            expect(issue.path).toBe("commands[0].easing.kind");
            expect(issue.message).toMatch(/linear, in, out, inOut, custom \(got undefined\)/);
        });

        it("takes a custom ease's args as a curve or a registered key", () => {
            expect(validateDocument(doc(command({
                easing: { kind: "custom", args: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
            }))).valid).toBe(true);
            expect(validateDocument(doc(command({ easing: { kind: "custom", args: "wobble" } }))).valid).toBe(true);
        });

        it.each([
            ["a number", 5],
            ["an object", { x: 1 }],
            ["a one-point curve", [{ x: 0, y: 0 }]],
            ["a curve with a point that is not finite", [{ x: 0, y: 0 }, { x: 1, y: Infinity }]],
            ["a curve of strings", ["a", "b"]],
        ])("rejects a custom ease whose args are %s", (_, args) => {
            const found = issues(doc(command({ easing: { kind: "custom", args } })));
            expect(found.map((i) => i.path)).toEqual(["commands[0].easing.args"]);
            expect(found[0].message).toMatch(/args must be its curve/);
        });

        it("does not look at the args of the standard kinds", () => {
            // A family name is checked where the ease is built, not here.
            expect(validateDocument(doc(command({ easing: { kind: "in", args: "anything" } }))).valid).toBe(true);
        });

        // The validator and the build disagree about a `custom` ease with
        // no args, which validates here and throws when the clip compiles.
        it.todo("reports a custom ease with no args");
    });

    describe("shape", () => {
        it("wants an id, a type and an args object", () => {
            expect(paths(doc(command({ id: undefined })))).toEqual(["commands[0].id"]);
            expect(paths(doc(command({ id: "" })))).toEqual(["commands[0].id"]);
            expect(paths(doc(command({ type: undefined })))).toEqual(["commands[0].type"]);
            expect(paths(doc(command({ type: "" })))).toEqual(["commands[0].type"]);
            expect(paths(doc(command({ args: undefined })))).toEqual(["commands[0].args"]);
            expect(paths(doc(command({ args: [] })))).toEqual(["commands[0].args"]);
            expect(paths(doc(command({ args: null })))).toEqual(["commands[0].args"]);
        });

        it("wants a target that is a string or null, not absent", () => {
            expect(validateDocument(doc(command({ targetId: null }))).valid).toBe(true);
            expect(paths(doc(command({ targetId: undefined })))).toEqual(["commands[0].targetId"]);
            expect(paths(doc(command({ targetId: 5 })))).toEqual(["commands[0].targetId"]);
        });

        it("reports a row that is not an object, and goes on to the next", () => {
            expect(issues(doc(5, null, command()))).toEqual([
                { path: "commands[0]", message: "command must be an object." },
                { path: "commands[1]", message: "command must be an object." },
            ]);
        });

        it("reports a negative duration like a negative time", () => {
            expect(paths(doc(command({ duration: -1 })))).toEqual(["commands[0].duration"]);
            expect(validateDocument(doc(command({ duration: undefined }))).valid).toBe(true);
        });

        it("reports every field that is wrong in one row, at that row", () => {
            const found = paths(doc({ targetId: 3, at: -1, args: 1, loop: 9, easing: 2 }));
            expect(found).toEqual(expect.arrayContaining([
                "commands[0].id", "commands[0].type", "commands[0].targetId",
                "commands[0].at", "commands[0].args", "commands[0].easing", "commands[0].loop",
            ]));
        });
    });

    describe("ids", () => {
        it("catches a command id used twice, at the second", () => {
            const found = issues(doc(command(), command({ at: 1 })));
            expect(found).toEqual([{ path: "commands[1].id", message: 'duplicate command id "c".' }]);
        });

        it("keeps checking after a duplicate", () => {
            expect(paths(doc(command(), command(), command({ id: "d", targetId: "ghost" }))))
                .toEqual(["commands[1].id", "commands[2].targetId"]);
        });

        it("does not call a row that failed its shape check a duplicate of anything", () => {
            expect(paths(doc(command({ at: -1 }), command()))).toEqual(["commands[0].at"]);
        });
    });
});

describe("variable rows", () => {
    const issues = (variables: unknown) => validateDocument({ kind: "still", nodes: [], variables }).issues;

    it("wants an array of objects", () => {
        expect(issues({})).toEqual([{ path: "variables", message: "variables must be an array." }]);
        expect(issues([5])).toEqual([{ path: "variables[0]", message: "variable must be an object." }]);
        expect(issues([null, "g"]).map((i) => i.path)).toEqual(["variables[0]", "variables[1]"]);
    });

    it("wants a non-empty string id", () => {
        expect(issues([{ value: 1 }]).map((i) => i.path)).toEqual(["variables[0].id"]);
        expect(issues([{ id: "", value: 1 }]).map((i) => i.path)).toEqual(["variables[0].id"]);
        expect(issues([{ id: 3, value: 1 }]).map((i) => i.path)).toEqual(["variables[0].id"]);
    });

    it("refuses a `]` in an id, which no expression could spell", () => {
        const [issue] = issues([{ id: "a]b", value: 1 }]);
        expect(issue.path).toBe("variables[0].id");
        expect(issue.message).toMatch(/cannot contain "\]"/);
    });

    it("wants a name, when present, to be a string", () => {
        expect(issues([{ id: "g", value: 1, name: "Gain" }])).toEqual([]);
        expect(issues([{ id: "g", value: 1, name: 5 }]).map((i) => i.path)).toEqual(["variables[0].name"]);
    });

    it("wants a lerp, when present, to be a string", () => {
        expect(issues([{ id: "g", value: 1, lerp: "color" }])).toEqual([]);
        expect(issues([{ id: "g", value: 1, lerp: 5 }]).map((i) => i.path)).toEqual(["variables[0].lerp"]);
        // Whether the key is registered is the build's question, not the validator's.
        expect(issues([{ id: "g", value: 1, lerp: "never-registered" }])).toEqual([]);
    });

    it("requires the value to be present, whatever it holds", () => {
        expect(issues([{ id: "g" }]).map((i) => i.path)).toEqual(["variables[0].value"]);
        for (const value of [0, "", null, false, [], {}, "text"]) {
            expect(issues([{ id: "g", value }])).toEqual([]);
        }
    });

    it("refuses a formula as a value but not a doubled `=`", () => {
        expect(issues([{ id: "g", value: "=[h]" }]).map((i) => i.path)).toEqual(["variables[0].value"]);
        expect(issues([{ id: "g", value: "==literal" }])).toEqual([]);
    });

    it("reports each bad row at its own index", () => {
        expect(issues([{ id: "a", value: 1 }, { id: "b" }, 7, { id: "c", value: 1, name: 1 }]).map((i) => i.path))
            .toEqual(["variables[1].value", "variables[2]", "variables[3].name"]);
    });

    // An id with `.` validates, though `[a.b]` reads as the
    // prop `b` of a node keyed `a` and so can never name this variable.
    it.todo("refuses a `.` in a variable id");
});

describe("a node row's id", () => {
    it("must be a string", () => {
        expect(paths({ kind: "still", nodes: [{ id: 5, type: "rect", parentId: null, layerOrder: 0, props: {} }] }))
            .toEqual(["nodes[0].id"]);
        expect(paths({ kind: "still", nodes: [{ type: "rect", parentId: null, layerOrder: 0, props: {} }] }))
            .toEqual(["nodes[0].id"]);
    });

    it("must sit on a row that is an object", () => {
        expect(validateDocument({ kind: "still", nodes: [5, null, []] }).issues.map((i) => i.path))
            .toEqual(["nodes[0]", "nodes[1]", "nodes[2]"]);
    });
});

describe("what a document is", () => {
    const only = (doc: unknown) => validateDocument(doc).issues;

    it("must be an object", () => {
        for (const doc of [null, undefined, [], "still", 3, true]) {
            expect(only(doc)).toEqual([{ path: "", message: "document must be an object." }]);
        }
    });

    it("must say what kind it is", () => {
        expect(only({})).toEqual([{
            path: "kind",
            message: 'kind must be "still", "composition" or "audio" (got undefined).',
        }]);
        expect(only({ kind: 1 })[0].message).toMatch(/\(got 1\)/);
        expect(only({ kind: "project" })[0].path).toBe("kind");
    });

    it("must hold its nodes in an array, whatever the kind", () => {
        expect(paths({ kind: "still" })).toEqual(["nodes"]);
        expect(paths({ kind: "still", nodes: {} })).toEqual(["nodes"]);
        expect(paths({ kind: "composition", commands: [] })).toEqual(["nodes"]);
        expect(paths({ kind: "audio", nodes: "x", commands: [] })).toEqual(["nodes"]);
    });

    it("must hold a composition's commands in an array", () => {
        for (const commands of [undefined, {}, "to", 3]) {
            expect(only({ kind: "composition", nodes: [], commands }))
                .toEqual([{ path: "commands", message: "commands must be an array." }]);
        }
        expect(paths({ kind: "audio", nodes: [] })).toEqual(["commands"]);
    });

    it("gives a still no commands at all, empty or not", () => {
        for (const commands of [[], [{ id: "c", type: "to", targetId: null, at: 0, args: {} }]]) {
            const found = only({ kind: "still", nodes: [], commands });
            expect(found).toHaveLength(1);
            expect(found[0].path).toBe("commands");
            expect(found[0].message).toMatch(/no timeline, so no commands/);
        }
        // Absent and explicitly undefined are the same thing.
        expect(only({ kind: "still", nodes: [], commands: undefined })).toEqual([]);
    });

    it("sends constants to variables on a still and on a composition alike", () => {
        for (const kind of ["still", "composition", "audio"]) {
            const found = only({ kind, nodes: [], commands: kind === "still" ? undefined : [], constants: [] });
            expect(found.map((i) => i.path)).toEqual(["constants"]);
            expect(found[0].message).toMatch(/merged into `variables`/);
        }
    });

    it("wants an audio document's root to be a bus", () => {
        const [issue] = only({
            kind: "audio",
            nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} }],
            commands: [],
        });
        expect(issue.path).toBe("nodes[0]");
        expect(issue.message).toMatch(/type: "audioBus"/);
    });

    it("wants a declared duration to be a time", () => {
        expect(paths({ kind: "composition", nodes: [], commands: [], duration: -1 })).toEqual(["duration"]);
        expect(paths({ kind: "audio", nodes: [], commands: [], duration: Infinity })).toEqual(["duration"]);
        expect(validateDocument({ kind: "composition", nodes: [], commands: [], duration: 0 }).valid).toBe(true);
    });

    // The early return on a non-array `commands` leaves the node rows
    // unchecked, so a document with both mistakes reports only the first.
    it.todo("goes on to check nodes and variables when `commands` is not an array");
});

describe("assertValidDocument", () => {
    it("lists every issue with its path, one to a line", () => {
        let message = "";
        try {
            assertValidDocument({ kind: "composition", nodes: [{ id: 5 }], commands: [] });
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toMatch(/^Invalid clip document:\n/);
        expect(message).toMatch(/\n {2}nodes\[0\]\.id: id must be a string\./);
        expect(message.split("\n").length).toBeGreaterThan(3);
    });

    it("names the root when the path is empty", () => {
        expect(() => assertValidDocument(null)).toThrow(/ {2}<root>: document must be an object\./);
    });

    // The error is a plain `Error` whose text is the only place the issues live.
    it.todo("throws a typed error that carries its issues");
});

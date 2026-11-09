import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import { ClipInstance } from "@/runtime/clip-instance";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { evaluatorFor, precompFor, runtimeScope } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import { asProjectDocument } from "../project";
import { Registry, type VariableLerp } from "../registry";
import type { AudioDocument, CommandSpec, CompositionDocument, NodeSpec, VisualDocument, StillDocument, VariableSpec } from "../types";
import { documentDuration } from "../types";
import { validateDocument } from "../validate";

const FPS = 30;
const VIEWPORT = { width: 200, height: 200 };

// The vocabulary this file's documents compile against. An engine builds
// one of these; a test builds its own, and nothing is shared between files.
const registry = new Registry();

function node(id: string, props: Record<string, unknown>, parent: string | null = null, order = 0): NodeSpec {
    return { id, type: "rect", parentId: parent, layerOrder: order, props };
}

/** A lone document, opened the way a session opens one: the only track of a project. */
const opened = (doc: VisualDocument) => asProjectDocument(doc, { fps: FPS, viewport: VIEWPORT });

function evaluatorOver(doc: VisualDocument): StateEvaluator {
    return evaluatorFor(opened(doc), { registry });
}

function rects(evaluator: StateEvaluator): Rect[] {
    return evaluator.currentCanvas!.children.filter((c): c is Rect => c instanceof Rect);
}

function variable(id: string, value: unknown, lerp?: string): VariableSpec {
    return { id, value, ...(lerp ? { lerp } : {}) };
}

describe("expressions in a still", () => {
    it("binds a prop to a variable, arithmetic and all", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            variables: [variable("g", 2)],
            nodes: [node("box", { width: 10, height: 10, x: "=4[g]+3" })],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator)[0].x).toBe(11);
    });

    it("hands a lone reference over untouched, so a variable can be a colour", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            variables: [variable("brand", "rgba(255, 0, 0, 1)")],
            nodes: [node("box", { width: 10, height: 10, fill: "=[brand]" })],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator)[0].fill).toBeDefined();
    });

    it("reaches the layout pass, not just the prop", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            variables: [variable("w", 40)],
            nodes: [node("box", { width: "=[w]*2", height: 10 })],
        });
        evaluator.stateAt(0);
        // `layoutBounds` is protected, so a test reads it the way rect-node's own
        // suite does: what the layout pass resolved, not what the prop holds.
        expect((rects(evaluator)[0] as unknown as { layoutBounds: { width: number } }).layoutBounds.width).toBe(80);
    });

    it("reads an expression nested inside a compound prop", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            variables: [variable("g", 4)],
            nodes: [node("box", { width: 10, height: 10, padding: { top: "=[g]*10", left: 5 } })],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator)[0].padding).toEqual({ top: 40, left: 5, right: 0, bottom: 0 });
    });
});

describe("driving a composition from one variable", () => {
    /**
     * The case variables exist for: one tween, three nodes, each reading the
     * same value through a different formula.
     */
    const doc: CompositionDocument = {
        kind: "composition",
        variables: [variable("g", 0)],
        nodes: [
            node("a", { width: 10, height: 10, x: "=[g]" }),
            node("b", { width: 10, height: 10, x: "=[g]*2" }, null, 1),
            node("c", { width: 10, height: 10, x: "=100-[g]" }, null, 2),
        ],
        commands: [
            { id: "drive", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: 100 } },
        ],
    };

    it("moves every bound prop from one command", () => {
        const evaluator = evaluatorOver(doc);

        evaluator.stateAt(0);
        expect(rects(evaluator).map((r) => r.x)).toEqual([0, 0, 100]);

        evaluator.stateAt(FPS / 2); // t = 0.5s
        expect(rects(evaluator).map((r) => r.x)).toEqual([50, 100, 50]);

        evaluator.stateAt(FPS);
        expect(rects(evaluator).map((r) => r.x)).toEqual([100, 200, 0]);
    });

    it("stays a pure function of time — forwards, jumped to, and reached backwards agree", () => {
        const walked = evaluatorOver(doc);
        const jumped = evaluatorOver(doc);
        const backwards = evaluatorOver(doc);

        const target = 11;
        for (let f = 0; f <= target; f++) walked.stateAt(f);
        jumped.stateAt(target);
        backwards.stateAt(FPS);
        backwards.stateAt(0);
        backwards.stateAt(target);

        const read = (evaluator: StateEvaluator) => rects(evaluator).map((r) => r.x);
        expect(read(jumped)).toEqual(read(walked));
        expect(read(backwards)).toEqual(read(walked));
    });

    it("holds the declared value before the tween and the landed one after it", () => {
        const evaluator = evaluatorOver({
            ...doc,
            duration: 3,
            commands: doc.commands.map((c) =>
                c.id === "drive" ? { ...c, at: 1 } : c),
        });

        evaluator.stateAt(FPS / 2);      // before the tween starts
        expect(rects(evaluator)[0].x).toBe(0);

        evaluator.stateAt(FPS * 2 + 15); // long after it ends
        expect(rects(evaluator)[0].x).toBe(100);
    });

    it("eases the variable, not each bound prop", () => {
        const evaluator = evaluatorOver({
            ...doc,
            commands: doc.commands.map((c) =>
                c.id === "drive" ? { ...c, easing: { kind: "in", args: "quad" } } as CommandSpec : c),
        });
        evaluator.stateAt(FPS / 2);
        // easeInQuad at t=0.5 is 0.25, and `b` reads `[g]*2`.
        expect(rects(evaluator).map((r) => r.x)).toEqual([25, 50, 75]);
    });
});

describe("variable commands", () => {
    it("chains: a second tween starts where the first left the variable", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            variables: [variable("g", 0)],
            nodes: [node("a", { width: 10, height: 10, x: "=[g]" })],
            commands: [
                { id: "t1", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: 50 } },
                { id: "t2", type: "variableTo", targetId: "g", at: 1, duration: 1, args: { value: 80 } },
            ],
        });

        evaluator.stateAt(FPS);
        expect(rects(evaluator)[0].x).toBeCloseTo(50, 3);
        evaluator.stateAt(FPS + FPS / 2);
        expect(rects(evaluator)[0].x).toBeCloseTo(65, 3);
    });

    it("stamps with `variableSet`, ignoring duration", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            duration: 2,
            variables: [variable("g", 0)],
            nodes: [node("a", { width: 10, height: 10, x: "=[g]" })],
            commands: [
                { id: "s", type: "variableSet", targetId: "g", at: 1, duration: 1, args: { value: 42 } },
            ],
        });

        evaluator.stateAt(FPS - 1);
        expect(rects(evaluator)[0].x).toBe(0);
        evaluator.stateAt(FPS);
        expect(rects(evaluator)[0].x).toBe(42);
    });

    it("snaps a non-numeric variable by default, and blends one told to", () => {
        const build = (lerp?: string) => evaluatorOver({
            kind: "composition",
            variables: [variable("c", "rgb(0, 0, 0)", lerp)],
            nodes: [node("a", { width: 10, height: 10, fill: "=[c]" })],
            commands: [
                { id: "t", type: "variableTo", targetId: "c", at: 0, duration: 1, args: { value: "rgb(255, 255, 255)" } },
            ],
        });
        /** The red channel of the node's first (solid) fill layer, 0–1. */
        const red = (evaluator: StateEvaluator) =>
            (rects(evaluator)[0].fill as unknown as { color: number[] }[])[0].color[0];

        // No declared lerp and a non-numeric value: hold `from` until it lands.
        const stepped = build();
        stepped.stateAt(FPS / 2);
        expect(red(stepped)).toBe(0);
        stepped.stateAt(FPS);
        expect(red(stepped)).toBe(1);

        const blended = build("color");
        blended.stateAt(FPS / 2);
        expect(red(blended)).toBeCloseTo(0.5, 2);
    });

    it("takes a per-command lerp override", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            variables: [variable("g", 0)],
            nodes: [node("a", { width: 10, height: 10, x: "=[g]" })],
            commands: [
                { id: "t", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: 100, lerp: "step" } },
            ],
        });

        evaluator.stateAt(FPS / 2);
        expect(rects(evaluator)[0].x).toBe(0);   // stepped: no midpoint
        evaluator.stateAt(FPS);
        expect(rects(evaluator)[0].x).toBe(100);
    });

    it("binds a prop partway through with `set`", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            duration: 2,
            variables: [variable("g", 70)],
            nodes: [node("a", { width: 10, height: 10, x: 5 })],
            commands: [
                { id: "bind", type: "set", targetId: "a", at: 1, args: { x: "=[g]" } },
            ],
        });

        evaluator.stateAt(0);
        expect(rects(evaluator)[0].x).toBe(5);
        evaluator.stateAt(FPS);
        expect(rects(evaluator)[0].x).toBe(70);
    });
});

describe("refusals", () => {
    /**
     * The message a build failure reports. AssetTimeline records a throwing clip in
     * `buildErrors` rather than letting it escape — a host shows it in an errors
     * panel — so that is where a refusal is read from.
     */
    const buildError = (doc: CompositionDocument): string =>
        precompFor(opened(doc), { registry }).run().buildErrors.map((e) => e.message).join("\n");

    it("refuses an expression as a tween destination, and says what to do instead", () => {
        expect(buildError({
            kind: "composition",
            variables: [variable("g", 1)],
            nodes: [node("a", { width: 10, height: 10 })],
            commands: [
                { id: "t", type: "to", targetId: "a", at: 0, duration: 1, args: { x: "=[g]" } },
            ],
        })).toMatch(/not tween destinations/);
    });

    it("refuses a command targeting a variable nothing declares", () => {
        expect(buildError({
            kind: "composition",
            nodes: [node("a", { width: 10, height: 10 })],
            commands: [
                { id: "t", type: "variableTo", targetId: "ghost", at: 0, duration: 1, args: { value: 1 } },
            ],
        })).toMatch(/does not declare/);
    });

    it("refuses an unregistered lerp key, naming the variable", () => {
        expect(buildError({
            kind: "composition",
            variables: [variable("g", 0, "bezier")],
            nodes: [node("a", { width: 10, height: 10 })],
            commands: [],
        })).toMatch(/Unknown variable lerp "bezier" \(variable "g"\)/);
    });
});

describe("validation", () => {
    const issues = (doc: unknown) => validateDocument(doc).issues.map((i) => `${i.path}: ${i.message}`);

    it("reports an expression naming a variable nothing declares", () => {
        const doc: StillDocument = {
            kind: "still",
            variables: [variable("g", 1)],
            nodes: [node("box", { x: "=[h]+1" })],
        };
        expect(issues(doc)).toEqual([
            expect.stringContaining('nodes[0].props.x: expression references "[h]"'),
        ]);
    });

    it("reports a formula that does not parse, with its position", () => {
        const doc: StillDocument = { kind: "still", nodes: [node("box", { x: "=4[g" })] };
        expect(issues(doc)[0]).toMatch(/nodes\[0\]\.props\.x: unclosed/);
    });

    it("reports a variable declared twice", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            variables: [variable("g", 0), variable("g", 1)],
            nodes: [],
            commands: [],
        };
        expect(issues(doc)[0]).toMatch(/variables\[1\]\.id: duplicate variable id "g"/);
    });

    it("points a document declaring `constants` at `variables`", () => {
        const doc = { kind: "still", constants: [{ id: "g", kind: "number", value: 0 }], nodes: [] };
        expect(issues(doc)[0]).toMatch(/constants: constants were merged into `variables`/);
    });

    it("reports a variable id that is already a node id", () => {
        const doc: StillDocument = {
            kind: "still",
            variables: [variable("box", 0)],
            nodes: [node("box", { x: 1 })],
        };
        expect(issues(doc)[0]).toMatch(/already a node id/);
    });

    it("reports an expression used as a variable's own value", () => {
        const doc: StillDocument = {
            kind: "still",
            variables: [variable("g", "=[h]")],
            nodes: [],
        };
        expect(issues(doc)[0]).toMatch(/variables\[0\]\.value: a variable holds a value/);
    });

    it("does not ask a variable target to be present", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            variables: [variable("g", 0)],
            nodes: [{ ...node("a", { x: "=[g]" }), startAt: 1 }],
            commands: [
                { id: "t", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: 1 } },
            ],
        };
        expect(validateDocument(doc).valid).toBe(true);
    });
});

/** The variable layer read straight off a built timeline, for what no prop shows. */
describe("variable values over time", () => {
    const sized = (id: string): NodeSpec => node(id, { width: 10, height: 10 });
    const clipOver = (doc: CompositionDocument, reg: Registry = registry) => {
        const clip = new TimelineClip(doc, runtimeScope({ registry: reg }));
        clip.build();
        const value = (id: string, seconds: number) => {
            clip.seek(seconds);
            return clip.timeline.variableValue(id);
        };
        return { clip, value };
    };
    const drive = (id: string, to: unknown, extra: Partial<CommandSpec> = {}, args: Record<string, unknown> = {}): CommandSpec =>
        ({ id: "drive", type: "variableTo", targetId: id, at: 0, duration: 1, args: { value: to, ...args }, ...extra });

    describe("vector2 and vector3", () => {
        it("blends a point per axis under the vector2 lerp", () => {
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("p", { x: 0, y: 10 }, "vector2")],
                nodes: [sized("a")],
                commands: [drive("p", { x: 10, y: 0 })],
            });
            expect(value("p", 0)).toEqual({ x: 0, y: 10 });
            expect(value("p", 0.25)).toEqual({ x: 2.5, y: 7.5 });
            expect(value("p", 1)).toEqual({ x: 10, y: 0 });
        });

        it("blends a 3D point per axis under the vector3 lerp", () => {
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("p", { x: 0, y: 0, z: 4 }, "vector3")],
                nodes: [sized("a")],
                commands: [drive("p", { x: 10, y: 20, z: 0 })],
            });
            expect(value("p", 0.5)).toEqual({ x: 5, y: 10, z: 2 });
            expect(value("p", 1)).toEqual({ x: 10, y: 20, z: 0 });
        });

        it("snaps an object without a lerp instead of blending keys that merely share a name", () => {
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("p", { x: 0, y: 10 })],
                nodes: [sized("a")],
                commands: [drive("p", { x: 10, y: 0 })],
            });
            expect(value("p", 0.5)).toEqual({ x: 0, y: 10 });
            expect(value("p", 1)).toEqual({ x: 10, y: 0 });
        });
    });

    describe("the color lerp", () => {
        const color = registry.lerp("color")!;

        it("formats its result as rgba() with channels rounded to 0-255", () => {
            expect(color("rgb(0, 0, 0)", "rgb(255, 255, 255)", 0.5)).toBe("rgba(128, 128, 128, 1)");
            expect(color("#ff0000", "#0000ff", 1 / 3)).toBe("rgba(170, 0, 85, 1)");
            expect(color("red", "blue", 0.5)).toBe("rgba(128, 0, 128, 1)");
        });

        it("lands exactly on both ends", () => {
            expect(color("rgb(10, 20, 30)", "rgb(200, 150, 100)", 0)).toBe("rgba(10, 20, 30, 1)");
            expect(color("rgb(10, 20, 30)", "rgb(200, 150, 100)", 1)).toBe("rgba(200, 150, 100, 1)");
        });

        it("blends alpha and trims it to four decimals", () => {
            expect(color("rgba(255, 0, 0, 0.25)", "rgba(255, 0, 0, 1)", 0.5)).toBe("rgba(255, 0, 0, 0.625)");
            expect(color("#ff000080", "#0000ff", 0.5)).toBe("rgba(128, 0, 128, 0.751)");
        });

        it("reads the opacity suffix a colour string may carry", () => {
            expect(color("white/10", "black", 0.5)).toBe("rgba(128, 128, 128, 0.55)");
        });

        it("clamps each channel when an easing overshoots", () => {
            expect(color("rgb(0, 0, 0)", "rgb(255, 255, 255)", 1.5)).toBe("rgba(255, 255, 255, 1)");
            expect(color("rgb(0, 0, 0)", "rgb(255, 255, 255)", -0.5)).toBe("rgba(0, 0, 0, 1)");
            expect(color("rgb(100, 100, 100)", "rgb(200, 200, 200)", 3)).toBe("rgba(255, 255, 255, 1)");
        });

        // Channels are clamped, alpha is not, so an overshooting easing
        // hands a fill an alpha above 1 (`rgba(255, 0, 0, 1.5)`).
        it.todo("clamps alpha as it clamps each channel when an easing overshoots");

        it("drives a fill through a document", () => {
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("c", "rgb(0, 0, 0)", "color")],
                nodes: [sized("a")],
                commands: [drive("c", "rgb(255, 255, 255)")],
            });
            expect(value("c", 0.5)).toBe("rgba(128, 128, 128, 1)");
        });
    });

    describe("the numeric lerps", () => {
        it("overshoots rather than clamps, so an easing may spring past its target", () => {
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("g", 0)],
                nodes: [sized("a")],
                commands: [drive("g", 100, { easing: { kind: "out", args: { type: "back", overshoot: 4 } } })],
            });
            expect(value("g", 0.5)).toBeGreaterThan(100);
            expect(value("g", 1)).toBeCloseTo(100, 9);
        });

        it("extrapolates the vector lerps past 1 and below 0", () => {
            const lerp2 = registry.lerp("vector2")!;
            const lerp3 = registry.lerp("vector3")!;
            expect(lerp2({ x: 0, y: 10 }, { x: 10, y: 0 }, 1.5)).toEqual({ x: 15, y: -5 });
            expect(lerp3({ x: 0, y: 0, z: 4 }, { x: 10, y: 20, z: 0 }, -1)).toEqual({ x: -10, y: -20, z: 8 });
            expect(registry.lerp("number")!(0, 10, 2)).toBe(20);
        });

        it("holds `from` until exactly 1 for step, then `to`, and stays on `to` past it", () => {
            const step = registry.lerp("step")!;
            expect(step("a", "b", 0.99)).toBe("a");
            expect(step("a", "b", 1)).toBe("b");
            expect(step("a", "b", 1.5)).toBe("b");
            expect(step("a", "b", -1)).toBe("a");
        });
    });

    describe("variableTo with a loop", () => {
        const looped = (loop: CommandSpec["loop"]) => clipOver({
            kind: "composition",
            duration: 4,
            variables: [variable("g", 0)],
            nodes: [sized("a")],
            commands: [drive("g", 100, { loop })],
        });

        it("starts each pass over from the value the first one began on", () => {
            const { value } = looped({ count: 1 });
            expect(value("g", 0.5)).toBe(50);
            // At the turn it is the start of pass two, not the end of pass one.
            expect(value("g", 1)).toBe(0);
            expect(value("g", 1.5)).toBe(50);
            expect(value("g", 2)).toBe(100);
            expect(value("g", 3)).toBe(100);
        });

        it("runs back and forth under alternate", () => {
            const { value } = looped({ count: 1, direction: "alternate" });
            expect(value("g", 0.5)).toBe(50);
            expect(value("g", 1)).toBe(100);
            expect(value("g", 1.5)).toBe(50);
            expect(value("g", 2)).toBe(0);
        });

        it("fills the clip when unlimited", () => {
            const { value } = looped({ count: null });
            expect(value("g", 3.5)).toBe(50);
            expect(value("g", 0.25)).toBe(25);
        });

        it("reads the same whichever way the playhead came", () => {
            const { value } = looped({ count: 2 });
            const forward = [0.25, 1.25, 2.25, 3].map((t) => value("g", t));
            const back = [3, 2.25, 1.25, 0.25].map((t) => value("g", t)).reverse();
            expect(back).toEqual(forward);
        });

        it("hands the next command the value the loop ended on", () => {
            const { value } = clipOver({
                kind: "composition",
                duration: 5,
                variables: [variable("g", 0)],
                nodes: [sized("a")],
                commands: [
                    drive("g", 100, { loop: { count: 1, direction: "alternate" } }),
                    { id: "after", type: "variableTo", targetId: "g", at: 2, duration: 1, args: { value: 50 } },
                ],
            });
            // The alternating pair ends back at 0, so the next leg starts from there.
            expect(value("g", 2.5)).toBe(25);
        });
    });

    describe("a lerp named in the command", () => {
        it("fails the build when it names nothing registered", () => {
            const doc = (lerp: unknown): CompositionDocument => ({
                kind: "composition",
                variables: [variable("g", 0)],
                nodes: [sized("a")],
                commands: [drive("g", 1, {}, { lerp })],
            });
            expect(() => clipOver(doc("bezier"))).toThrow('A "lerp" param must name a registered lerp (variable "g"), got "bezier".');
            expect(() => clipOver(doc(5))).toThrow(/got 5\. Registered: color, number, step, vector2, vector3\./);
            expect(() => clipOver(doc(true))).toThrow(/got true\./);
        });

        it("overrides the variable's own for that one tween", () => {
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("c", "rgb(0, 0, 0)", "step")],
                nodes: [sized("a")],
                commands: [drive("c", "rgb(255, 255, 255)", {}, { lerp: "color" })],
            });
            expect(value("c", 0.5)).toBe("rgba(128, 128, 128, 1)");
        });
    });

    describe("a lerp the registry was given", () => {
        const squared: VariableLerp = (from, to, t) => (from as number) + ((to as number) - (from as number)) * t * t;
        const typewriter: VariableLerp = (_from, to, t) => (to as string).slice(0, Math.ceil((to as string).length * t));

        it("drives a variable declared with it, added after construction", () => {
            const custom = new Registry().addLerp("squared", squared);
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("g", 0, "squared")],
                nodes: [sized("a")],
                commands: [drive("g", 100)],
            }, custom);
            expect(value("g", 0.5)).toBe(25);
            expect(value("g", 1)).toBe(100);
        });

        it("drives one seeded through RegistryOptions.lerps, over a value that is not a number", () => {
            const custom = new Registry({ lerps: { typewriter } });
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("line", "", "typewriter")],
                nodes: [sized("a")],
                commands: [drive("line", "hello")],
            }, custom);
            expect(value("line", 0.4)).toBe("he");
            expect(value("line", 1)).toBe("hello");
        });

        it("can be named by one command over a variable that declared none", () => {
            const custom = new Registry({ lerps: { squared } });
            const { value } = clipOver({
                kind: "composition",
                variables: [variable("g", 0)],
                nodes: [sized("a")],
                commands: [drive("g", 100, {}, { lerp: "squared" })],
            }, custom);
            expect(value("g", 0.5)).toBe(25);
        });

        it("is unknown to a registry that was not given it", () => {
            const doc: CompositionDocument = {
                kind: "composition",
                variables: [variable("g", 0, "squared")],
                nodes: [sized("a")],
                commands: [],
            };
            expect(() => clipOver(doc)).toThrow(/Unknown variable lerp "squared" \(variable "g"\)/);
        });
    });

    describe("a variable on an audio document", () => {
        const audio: AudioDocument = {
            kind: "audio",
            duration: 2,
            variables: [variable("level", 0.2)],
            nodes: [
                { id: "", type: "audioBus", parentId: null, layerOrder: 0, props: { volume: "=[level]" } },
                { id: "s", type: "sound", parentId: null, layerOrder: 0, props: { src: "a.mp3", volume: "=[level]/2" } },
            ],
            commands: [{ id: "up", type: "variableTo", targetId: "level", at: 0, duration: 1, args: { value: 1 } }],
        };

        function built() {
            const clip = new ClipInstance(audio, documentDuration(audio), runtimeScope({ registry }));
            clip.build();
            const read = (seconds: number) => {
                clip.attach(seconds);
                clip.evaluateAt(seconds);
                const [bus] = clip.canvas.childrenAudio;
                return { bus: bus.volume as number, sound: (bus.childrenAudio[0] as unknown as { volume: number }).volume };
            };
            return { clip, read };
        }

        it("drives a bus and a sound from one tween", () => {
            const { read } = built();
            expect(read(0)).toEqual({ bus: 0.2, sound: 0.1 });
            const half = read(0.5);
            expect(half.bus).toBeCloseTo(0.6, 9);
            expect(half.sound).toBeCloseTo(0.3, 9);
            expect(read(1)).toEqual({ bus: 1, sound: 0.5 });
        });

        it("is a pure function of time on audio too", () => {
            const { read } = built();
            const early = read(0.25);
            read(1.5);
            expect(read(0.25)).toEqual(early);
        });

        it("is validated like any clip's variables", () => {
            expect(validateDocument(audio).valid).toBe(true);
            expect(validateDocument({ ...audio, variables: [variable("level", 0.2), variable("level", 1)] }).valid).toBe(false);
            expect(validateDocument({
                ...audio,
                nodes: [{ id: "s", type: "sound", parentId: null, layerOrder: 0, props: { src: "a.mp3", volume: "=[ghost]" } }],
            }).issues.map((i) => i.path)).toEqual(["nodes[0].props.volume"]);
        });
    });
});

describe("what a command's variable is restored to", () => {
    const sized = (id: string, props: Record<string, unknown> = {}): NodeSpec => node(id, { width: 10, height: 10, ...props });
    const built = (doc: CompositionDocument) => {
        const clip = new TimelineClip(doc, runtimeScope({ registry }));
        clip.build();
        return clip;
    };

    it("never touches a variable that no command writes", () => {
        const clip = built({
            kind: "composition",
            variables: [variable("fixed", 4), variable("moving", 0)],
            nodes: [sized("a")],
            commands: [{ id: "t", type: "variableTo", targetId: "moving", at: 0, duration: 1, args: { value: 10 } }],
        });
        clip.seek(0);
        clip.timeline.variableSlot("fixed")!.set(99);
        clip.timeline.variableSlot("moving")!.set(99);

        clip.seek(0);
        // The one a command writes is put back before every evaluation; the other has no baseline to put back to.
        expect(clip.timeline.variableValue("moving")).toBe(0);
        expect(clip.timeline.variableValue("fixed")).toBe(99);
    });

    it("never restores a node that only formulas drive, but does restore one a command writes", () => {
        const clip = built({
            kind: "composition",
            variables: [variable("g", 2)],
            nodes: [
                sized("formula", { x: "=[g]*2" }),
                sized("tweened", { x: "=[g]*2", y: 0 }),
            ],
            commands: [{ id: "t", type: "to", targetId: "tweened", at: 0, duration: 1, args: { y: 10 } }],
        });
        const formula = clip.timeline.liveNode("formula") as unknown as Rect;
        const tweened = clip.timeline.liveNode("tweened") as unknown as Rect;
        clip.seek(0);
        expect([formula.x, tweened.x]).toEqual([4, 4]);

        // Overwrite both bindings from outside, as an editor holding an override would.
        formula.set({ x: 42 });
        tweened.set({ x: 42 });
        clip.seek(0);
        expect(formula.x).toBe(42);
        expect(tweened.x).toBe(4);
    });

    it("keeps following the variable after it is restored", () => {
        const clip = built({
            kind: "composition",
            variables: [variable("g", 2)],
            nodes: [sized("a", { x: "=[g]*2", y: 0 })],
            commands: [
                { id: "move", type: "to", targetId: "a", at: 0, duration: 1, args: { y: 10 } },
                { id: "drive", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: 6 } },
            ],
        });
        const a = clip.timeline.liveNode("a") as unknown as Rect;
        clip.seek(1);
        expect(a.x).toBe(12);
        clip.seek(0);
        expect(a.x).toBe(4);
    });
});

describe("a formula in a variable command", () => {
    const buildError = (doc: CompositionDocument): string =>
        precompFor(opened(doc), { registry }).run().buildErrors.map((e) => e.message).join("\n");
    const doc = (command: Partial<CommandSpec>): CompositionDocument => ({
        kind: "composition",
        variables: [variable("g", 1), variable("h", 2)],
        nodes: [node("a", { width: 10, height: 10 })],
        commands: [{ id: "t", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: "=[h]" }, ...command }],
    });

    it("is refused by the build, which says what to do instead", () => {
        expect(buildError(doc({}))).toMatch(/Command t \("variableTo"\) carries an expression at args\.value: "=\[h\]"/);
        expect(buildError(doc({}))).toMatch(/not tween destinations/);
        expect(buildError(doc({ type: "variableSet" }))).toMatch(/Command t \("variableSet"\) carries an expression/);
    });

    it("names an undeclared variable in the validator, as it does anywhere", () => {
        const found = validateDocument(doc({ args: { value: "=[ghost]" } })).issues;
        expect(found.map((i) => i.path)).toEqual(["commands[0].args.value"]);
    });

    it("reads a literal `==` as the string it escapes", () => {
        expect(buildError(doc({ args: { value: "==h" } }))).toBe("");
    });

    // A formula naming a declared variable passes validation here and
    // only fails when the clip builds.
    it.todo("reports a formula in a non-binding command's args as a validation issue");
});

describe("the retired commands", () => {
    const buildError = (doc: CompositionDocument): string =>
        precompFor(opened(doc), { registry }).run().buildErrors.map((e) => e.message).join("\n");

    it("explains `add` and `variable` at build as it does `remove`", () => {
        const comp = (type: string): CompositionDocument => ({
            kind: "composition",
            nodes: [node("a", { width: 10, height: 10 })],
            commands: [{ id: "c", type, targetId: "a", at: 0, args: {} }],
        });
        expect(buildError(comp("add"))).toMatch(/Node type "rect" has no command "add".*A node is a row in `nodes`, entering at its `startAt`\./);
        expect(buildError(comp("variable"))).toMatch(/has no command "variable".*A variable is declared in `variables`\./);
        expect(buildError(comp("remove"))).toMatch(/has no command "remove".*A node leaves at its `endAt`\./);
    });

    it("lists what the type does publish alongside the hint", () => {
        const message = buildError({
            kind: "composition",
            nodes: [node("a", { width: 10, height: 10 })],
            commands: [{ id: "c", type: "add", targetId: "a", at: 0, args: {} }],
        });
        expect(message).toMatch(/It publishes: .*fadeTo/);
    });
});

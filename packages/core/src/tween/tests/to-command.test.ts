import { describe, expect, it } from "vitest";

import { declareMembers, property } from "@/attributes/properties/decorator";
import { Node2D, type Node2DProps } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { attached } from "@/components/trees/node/node.fixtures";
import type { EasingFunction } from "@/tween/ease/type";
import type { TweenStepper } from "@/tween/stepper";
import { toCommand, type AnimationTarget } from "@/tween/to-command";

/** A target that hands out a recording stepper per `_prepareStep` call. */
function fakeTarget() {
    const prepared: Array<{ props: unknown; duration: number; easing?: EasingFunction; seeks: number[]; advances: number[] }> = [];
    const target: AnimationTarget<{ x: number }> = {
        _prepareStep(props, duration, easing): TweenStepper {
            const record = { props, duration, easing, seeks: [] as number[], advances: [] as number[] };
            prepared.push(record);
            return {
                seek: (e) => { record.seeks.push(e); },
                advance: (dt) => { record.advances.push(dt); return false; },
            };
        },
    };
    return { target, prepared };
}

describe("ToCommand", () => {
    it("prepares lazily, on the first `at`, and reuses that stepper after", () => {
        const { target, prepared } = fakeTarget();
        const cmd = toCommand(target, { x: 10 }, 2);
        expect(prepared).toHaveLength(0);

        cmd.at(0.25);
        cmd.at(0.5);
        cmd.at(1);
        expect(prepared).toHaveLength(1);
        expect(prepared[0].seeks).toEqual([0.5, 1, 2]);
    });

    it("hands the target its props, duration and easing as built", () => {
        const { target, prepared } = fakeTarget();
        const easing: EasingFunction = (t) => t;
        const props = { x: 10 };
        toCommand(target, props, 3, easing).at(0);
        expect(prepared[0].props).toBe(props);
        expect(prepared[0].duration).toBe(3);
        expect(prepared[0].easing).toBe(easing);
    });

    it("seeks in seconds, clamping the normalized time", () => {
        const { target, prepared } = fakeTarget();
        const cmd = toCommand(target, { x: 1 }, 4);
        cmd.at(-1);
        cmd.at(9);
        expect(prepared[0].seeks).toEqual([0, 4]);
    });

    it("returns an empty frame, because it applies through the target", () => {
        const { target } = fakeTarget();
        expect(toCommand(target, { x: 1 }, 1).at(0.5)).toEqual({});
    });

    it("gives every `_stepper()` its own prepared stepper, apart from the one `at` uses", () => {
        const { target, prepared } = fakeTarget();
        const cmd = toCommand(target, { x: 1 }, 1);

        cmd.at(0.5);
        const a = cmd._stepper();
        const b = cmd._stepper();
        expect(prepared).toHaveLength(3);

        // Driving one leaves the others where they were.
        a.seek(0.1);
        a.advance(0.2);
        b.seek(0.9);
        expect(prepared[0].seeks).toEqual([0.5]);
        expect(prepared[1].seeks).toEqual([0.1]);
        expect(prepared[1].advances).toEqual([0.2]);
        expect(prepared[2].seeks).toEqual([0.9]);
    });

    it("keeps `at`'s stepper out of a later `_stepper()`", () => {
        const { target, prepared } = fakeTarget();
        const cmd = toCommand(target, { x: 1 }, 1);
        const stepper = cmd._stepper();
        cmd.at(1);
        // Two steppers, not one shared: preparing is what snapshots `from`.
        expect(prepared).toHaveLength(2);
        stepper.seek(0.25);
        expect(prepared[0].seeks).toEqual([0.25]);
        expect(prepared[1].seeks).toEqual([1]);
    });
});

describe("ToCommand on a real node", () => {
    it("snapshots `from` the first time `at` runs, not when it is built", () => {
        const node = attached(new Rect({ width: 10, height: 10, x: 0 }));
        const cmd = node.to({ data: { x: 100 }, duration: 1 });

        node.x = 40;                       // after the command was built, before it ran
        cmd.at(0);
        expect(node.x).toBe(40);
        cmd.at(0.5);
        expect(node.x).toBe(70);
    });

    it("keeps that `from` for every later `at`, whatever the node holds in between", () => {
        const node = attached(new Rect({ width: 10, height: 10, x: 0 }));
        const cmd = node.to({ data: { x: 100 }, duration: 1 });

        cmd.at(0.5);                       // snapshots from = 0
        node.x = 500;
        cmd.at(0.5);
        expect(node.x).toBe(50);
        cmd.at(0.25);
        expect(node.x).toBe(25);
    });

    it("lets a fresh stepper take its own `from` from where the node is now", () => {
        const node = attached(new Rect({ width: 10, height: 10, x: 0 }));
        const cmd = node.to({ data: { x: 100 }, duration: 1 });

        cmd.at(0.5);
        node.x = 20;
        const stepper = cmd._stepper();
        stepper.seek(0.5);
        expect(node.x).toBe(60);

        // `at` still answers from its own snapshot.
        cmd.at(0.5);
        expect(node.x).toBe(50);
    });

    it("applies the easing to what it writes", () => {
        const node = attached(new Rect({ width: 10, height: 10, x: 0 }));
        const cmd = node.to({ data: { x: 100 }, duration: 1, easing: (t) => t * t });
        cmd.at(0.5);
        expect(node.x).toBe(25);
    });
});

/**
 * `Node._prepareStep` decides, key by key, how a `to` moves a prop: a custom tween
 * function, a numeric cell written directly, a numeric prop behind a mapper written
 * through its setter, a string that snaps at the end, or nothing.
 */
describe("_prepareStep routing", () => {
    const clamp10 = (v: number) => Math.min(Math.max(v, 0), 10);

    interface DialProps extends Node2DProps {
        level: number;
        gain: number;
        capped: number;
        label: string;
        enabled: boolean;
        stepped: number;
        dbl: number;
        bounded: number;
        tag: string;
    }

    class Dial extends Node2D<DialProps> {
        declare level: number;
        declare gain: number;
        declare capped: number;
        declare label: string;
        declare enabled: boolean;
        declare stepped: number;
        // Not idempotent: mapping a stored value again moves it.
        declare dbl: number;
        declare bounded: number;
        declare tag: string;
    }

    declareMembers(Dial, {
        level: property({ default: 0 }),
        gain: property({ default: 0 }),
        capped: property({ default: 0, mapper: (v: number) => Math.min(Math.max(v, 0), 10) }),
        label: property({ default: "idle" }),
        enabled: property({ default: false }),
        stepped: property({ default: 0, tween: (a: number, b: number, t: number) => (t < 1 ? a : b) }),
        dbl: property({ default: 0, mapper: (v: number) => v * 2 }),
        bounded: property({ default: 0, mapper: clamp10, tween: (a: number, b: number, t: number) => clamp10(a + (b - a) * t) }),
        tag: property({ default: "", mapper: (v: string) => `${v}!` }),
    });

    const dial = () => attached(new Dial({}));
    const step = (node: Dial, to: Partial<DialProps>, duration = 1, easing?: EasingFunction) =>
        node._prepareStep(to, duration, easing);

    it("writes a plain numeric prop straight to its slot, interpolating", () => {
        const node = dial();
        const stepper = step(node, { level: 8, gain: -4 });
        stepper.seek(0.5);
        expect([node.level, node.gain]).toEqual([4, -2]);
        stepper.seek(1);
        expect([node.level, node.gain]).toEqual([8, -4]);
    });

    it("snaps a string at the end, and not before", () => {
        const node = dial();
        const stepper = step(node, { label: "done" });
        stepper.seek(0.99);
        expect(node.label).toBe("idle");
        stepper.seek(1);
        expect(node.label).toBe("done");
    });

    it("lands a snapped string on a seek past the end, as running to the end would", () => {
        const node = dial();
        step(node, { label: "done" }).seek(5);
        expect(node.label).toBe("done");

        const ran = dial();
        const stepper = step(ran, { label: "done" });
        stepper.seek(0);
        stepper.advance(0.5);
        expect(ran.label).toBe("idle");
        stepper.advance(0.5);
        expect(ran.label).toBe("done");
    });

    it("runs a prop's own tween function in stored space", () => {
        const node = dial();
        const stepper = step(node, { stepped: 7 });
        stepper.seek(0.5);
        expect(node.stepped).toBe(0);
        stepper.seek(1);
        expect(node.stepped).toBe(7);
    });

    it("tweens a numeric prop behind a mapper between stored values, as it does any other", () => {
        const node = dial();
        const stepper = step(node, { capped: 8 });
        stepper.seek(0.5);
        expect(node.capped).toBe(4);
        stepper.seek(1);
        expect(node.capped).toBe(8);
    });

    it("maps the destination before it interpolates towards it", () => {
        const node = dial();
        const stepper = step(node, { capped: 40 });   // mapped to 10 first
        stepper.seek(0.5);
        expect(node.capped).toBe(5);
    });

    it("ignores a boolean, which has nothing between its endpoints", () => {
        const node = dial();
        const stepper = step(node, { enabled: true });
        stepper.seek(1);
        expect(node.enabled).toBe(false);
    });

    it("ignores a key the node has no prop for", () => {
        const node = dial();
        const stepper = step(node, { nope: 5, level: 2 } as Partial<DialProps>);
        stepper.seek(1);
        expect((node as unknown as { nope?: number }).nope).toBeUndefined();
        expect(node.level).toBe(2);
    });

    it("applies the easing to every routed prop at once", () => {
        const node = dial();
        const stepper = step(node, { level: 10, capped: 10, label: "done" }, 2, (t) => t * t);
        stepper.seek(1);                      // halfway through, eased to a quarter
        expect(node.level).toBe(2.5);
        expect(node.capped).toBe(2.5);
        expect(node.label).toBe("idle");
        stepper.seek(2);
        expect(node.label).toBe("done");
    });

    it("lets a seek and a following advance agree about where the tween is", () => {
        const node = dial();
        const stepper = step(node, { level: 10 }, 2);
        stepper.seek(1);
        expect(stepper.advance(0.5)).toBe(false);
        expect(node.level).toBe(7.5);
        expect(stepper.advance(0.5)).toBe(true);
        expect(node.level).toBe(10);
    });

    it("treats a zero duration as already finished", () => {
        const node = dial();
        const stepper = step(node, { level: 3, label: "done" }, 0);
        stepper.seek(0);
        expect([node.level, node.label]).toEqual([3, "done"]);
        expect(stepper.advance(0)).toBe(true);
    });

    it("writes nothing on a node that is not mounted, but still takes its time", () => {
        const node = new Dial({});
        const stepper = step(node, { level: 9 }, 1);
        stepper.seek(0);
        expect(stepper.advance(0.4)).toBe(false);
        expect(stepper.advance(0.6)).toBe(true);
        expect(node.level).toBe(0);
    });

    describe("a mapper that is not idempotent", () => {
        it("maps the destination once, so the tween ends on the mapped value and is halfway to it midway", () => {
            const node = dial();
            const stepper = step(node, { dbl: 10 });
            stepper.seek(0.5);
            expect(node.dbl).toBe(10);
            stepper.seek(1);
            expect(node.dbl).toBe(20);
        });

        it("starts from what the prop stores, whatever the mapper would make of it", () => {
            const node = dial();
            node.dbl = 3;                          // stored 6
            const stepper = step(node, { dbl: 5 });   // stored 10
            stepper.seek(0);
            expect(node.dbl).toBe(6);
            stepper.seek(0.5);
            expect(node.dbl).toBe(8);
            stepper.seek(1);
            expect(node.dbl).toBe(10);
        });

        it("runs the mapper for the destination alone, however many steps it takes", () => {
            const node = dial();
            const stepper = step(node, { dbl: 10 });
            stepper.seek(0.25);
            stepper.advance(0.25);
            stepper.advance(0.5);
            expect(node.dbl).toBe(20);
        });

        it("maps a string destination once when it snaps", () => {
            const node = dial();
            const before = node.tag;               // the default went through the mapper too
            const stepper = step(node, { tag: "done" });
            stepper.seek(0.5);
            expect(node.tag).toBe(before);
            stepper.seek(1);
            expect(node.tag).toBe("done!");
        });
    });

    describe("a prop that must hold a range", () => {
        it("holds it under an overshooting ease when its tween clamps", () => {
            const node = dial();
            step(node, { bounded: 8 }, 1, (t) => t * 3).seek(0.5);   // asks for 12 midway
            expect(node.bounded).toBe(10);
        });

        it("is not held by its mapper alone — the mapper shapes the destination, and the tween the steps", () => {
            const node = dial();
            step(node, { capped: 8 }, 1, (t) => t * 3).seek(0.5);
            expect(node.capped).toBe(12);
        });
    });
});

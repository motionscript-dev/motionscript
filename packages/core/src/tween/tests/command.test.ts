import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import { attached } from "@/components/trees/node/node.fixtures";
import { commandParallel, commandSequence, driveCommand, isCommand, makeCommand, type Command, type CommandArgs } from "@/tween/command";
import { command, getCommandMeta } from "@/tween/command-decorator";
import { lerpNumber } from "@/tween/lerp";
import { generated } from "@/components/factory/tests/generated.fixtures";
import { declareMembers } from "@/attributes/properties/decorator";

const FPS = 30;
const DT = 1 / FPS;

/** Play `cmd` a frame at a time through its stepper, recording `read` each frame. */
function run<T>(cmd: Command<never>, read: () => T): T[] {
    const frames: T[] = [];
    const step = cmd._stepper();
    step.seek(0);
    frames.push(read());
    for (let guard = 0; guard < 1000; guard++) {
        if (step.advance(DT)) break;
        frames.push(read());
    }
    return frames;
}

class Widget extends generated(Rect) {
    slide(args: CommandArgs<{ to: number }> & { duration?: number }): Command<{ x: number }> {
        const from = this.x;
        const to = args.data?.to ?? 0;
        return this.command((t) => ({ x: lerpNumber(from, to, t) }), args.duration ?? 1, args.easing);
    }

    vanish(args: CommandArgs<Record<string, never>> & { duration?: number }): Command<{ opacity: number }> {
        const from = this.opacity;
        return this.command((t) => ({ opacity: lerpNumber(from, 0, t) }), args.duration ?? 1);
    }
}

declareMembers(Widget, {
    slide: command(),
    vanish: command({ name: "Fade out" }),
});

describe("Command", () => {
    it("evaluates at a time without having run to it", () => {
        const node = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const cmd = node.slide({ data: { to: 100 }, duration: 2 });

        // The whole point: frame N is available without frames 0..N-1.
        expect(cmd.at(0)).toEqual({ x: 0 });
        expect(cmd.at(0.5)).toEqual({ x: 50 });
        expect(cmd.at(1)).toEqual({ x: 100 });
        // And out of order, which a generator cannot do at all.
        expect(cmd.at(0.25)).toEqual({ x: 25 });
    });

    it("agrees frame-for-frame with running it", () => {
        // The invariant the whole design rests on. `_stepper` is *derived* from
        // `at`, so a host that seeks and a host that plays cannot drift — but only
        // if the derivation is right, which is what this pins.
        const running = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const frames = run(running.slide({ data: { to: 90 }, duration: 1 }) as Command<never>, () => running.x);

        const seeking = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const cmd = seeking.slide({ data: { to: 90 }, duration: 1 });
        const stepper = cmd._stepper();

        frames.forEach((expected, frame) => {
            stepper.seek(frame * DT);
            expect(seeking.x).toBeCloseTo(expected, 6);
        });
    });

    it("applies its frame as well as returning it, which is what a seeking host reads", () => {
        // A timeline evaluates by calling `at(t)` and discarding the return, so a
        // command that only described its frame would be inert under a seek while
        // working perfectly under `_stepper`.
        const node = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const cmd = node.slide({ data: { to: 100 }, duration: 2 });

        cmd.at(0.5);
        expect(node.x).toBeCloseTo(50, 6);
        cmd.at(0.25);
        expect(node.x).toBeCloseTo(25, 6);
    });

    it("clamps outside [0,1] rather than extrapolating", () => {
        const node = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const cmd = node.slide({ data: { to: 100 }, duration: 1 });

        expect(cmd.at(-1)).toEqual({ x: 0 });
        expect(cmd.at(5)).toEqual({ x: 100 });
    });

    it("applies easing inside, so callers pass raw normalized time", () => {
        const node = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const eased = node.slide({ data: { to: 100 }, duration: 1, easing: (t) => t * t });

        expect(eased.at(0.5)).toEqual({ x: 25 });
    });

    it("stamps a zero-duration command on its first frame", () => {
        // `at` is in *normalized* time, so `at(0)` is the start whatever the
        // duration — the collapse belongs to the driver, which has no time left
        // to spend and so lands on the end immediately.
        const node = attached(new Widget({ width: 10, height: 10, x: 0 }));
        const cmd = node.slide({ data: { to: 42 }, duration: 0 });

        expect(cmd.at(0)).toEqual({ x: 0 });
        expect(cmd.at(1)).toEqual({ x: 42 });

        const stepper = cmd._stepper();
        stepper.seek(0);
        expect(node.x).toBe(42);
        expect(stepper.advance(DT)).toBe(true);
    });

    it("is recognisable, so a host can tell it from a bare generator", () => {
        const node = attached(new Widget({ width: 10, height: 10 }));

        expect(isCommand(node.slide({ data: { to: 1 } }))).toBe(true);
        // `to()` is itself a Command now — no more AnimationBuilder in between.
        expect(isCommand(node.to({ data: { x: 1 }, duration: 1 }))).toBe(true);
    });
});

describe("command composition", () => {
    const target = { set: () => { } };

    const step = (from: number, to: number, duration: number): Command<{ v: number }> =>
        makeCommand<{ v: number }>(target, (t) => ({ v: lerpNumber(from, to, t) }), duration);

    it("sequences, holding a finished child at its end value", () => {
        const seq = commandSequence(target, step(0, 10, 1), step(10, 20, 1));

        expect(seq.duration).toBe(2);
        expect(seq.at(0)).toEqual({ v: 0 });
        expect(seq.at(0.25)).toEqual({ v: 5 });
        // Exactly at the handover: the first child is done, the second at zero.
        expect(seq.at(0.5)).toEqual({ v: 10 });
        expect(seq.at(0.75)).toEqual({ v: 15 });
        expect(seq.at(1)).toEqual({ v: 20 });
    });

    it("omits a sequenced child that has not started", () => {
        // A prop a later step writes should not exist yet — that is what lets a
        // host tell "not yet written" from "written back to its start value".
        const seq = commandSequence<{ v?: number; w?: number }>(
            target,
            makeCommand(target, () => ({ v: 1 }), 1),
            makeCommand(target, () => ({ w: 2 }), 1),
        );

        expect(seq.at(0.25)).toEqual({ v: 1 });
        expect(seq.at(0.75)).toEqual({ v: 1, w: 2 });
    });

    it("runs in parallel, ending with the longest", () => {
        const par = commandParallel<{ a?: number; b?: number }>(
            target,
            makeCommand(target, (t) => ({ a: t }), 1),
            makeCommand(target, (t) => ({ b: t }), 2),
        );

        expect(par.duration).toBe(2);
        // Halfway through the group: the short child has finished and holds, the
        // long one is at its own midpoint.
        expect(par.at(0.5)).toEqual({ a: 1, b: 0.5 });
    });
});

describe("command metadata", () => {
    it("lists a class's commands, inherited first", () => {
        const meta = getCommandMeta(attached(new Widget({ width: 1, height: 1 })));

        // Base classes first, then this class's own: the order a host would show
        // them in, general before specific. `Node` contributes the generic prop
        // tween, the save-stack rollback and the structural insert, `Node2D` the
        // transform, box and effect helpers and the two emphases, then the Rect
        // component its `Paint` commands, in the module's order.
        expect(meta.map(m => m.key)).toEqual([
            "to", "restore", "addChildAt",
            "moveTo", "fadeTo", "rotateTo", "scaleTo", "layoutTo", "pulse", "wiggle", "effectTo", "removeChildAt", "reparent",
            "fillTo", "strokeTo", "shadowTo", "overlayTo", "progressTo", "flash",
            "slide", "vanish",
        ]);
    });

    it("carries a display name only where one was given", () => {
        // Built-ins leave it unset — their names live in the host's i18n
        // catalogue, keyed by the command key. A package has nowhere else.
        const meta = getCommandMeta(attached(new Widget({ width: 1, height: 1 })));

        expect(meta.find(m => m.key === "slide")?.name).toBeUndefined();
        expect(meta.find(m => m.key === "vanish")?.name).toBe("Fade out");
    });

    it("lets a subclass redeclaration replace the inherited one, in the base position", () => {
        class Base { }
        command({ args: ["x"] })(Base.prototype, "go");
        command()(Base.prototype, "stay");
        class Sub extends Base { }
        command({ name: "Go", args: ["a", { key: "b", min: 0 }] })(Sub.prototype, "go");

        const meta = getCommandMeta(new Sub());
        expect(meta.map(m => m.key)).toEqual(["go", "stay"]);
        expect(meta[0]).toEqual({ key: "go", method: "go", name: "Go", args: ["a", { key: "b", min: 0 }] });
        expect(getCommandMeta(new Base())[0]).toEqual({ key: "go", method: "go", args: ["x"] });
    });

    it("records the method a command runs beside its key", () => {
        class Renamed extends Widget {
            glide(args: CommandArgs<{ to: number }> & { duration?: number }): Command<{ x: number }> {
                return this.slide(args);
            }
        }

        declareMembers(Renamed, {
            glide: command({ key: "swoop" }),
        });
        const meta = getCommandMeta(attached(new Renamed({ width: 1, height: 1 })));

        expect(meta.find(m => m.key === "slide")?.method).toBe("slide");
        expect(meta.find(m => m.key === "swoop")?.method).toBe("glide");
        expect(meta.some(m => m.key === "glide")).toBe(false);
    });
});

describe("Command on an unmounted node", () => {
    // A node that is not in the tree has no box, no surface and no timeline, so a
    // tween on it has nothing to be a tween *of*. It still has a duration, and a
    // generator that `yield*`s it is entitled to have that duration pass — so the
    // command runs its clock and writes nothing, rather than throwing (which
    // would abort the pass) or vanishing (which would shorten the scene).
    it("occupies its duration and writes nothing", () => {
        const node = new Widget({ width: 10, height: 10, x: 0 });
        const cmd = node.slide({ data: { to: 100 }, duration: 2 });

        expect(cmd.duration).toBe(2);
        expect(cmd.at(0.5)).toEqual({});
        expect(node.x).toBe(0);

        const frames = run(cmd as Command<never>, () => node.x);
        expect(frames.every(x => x === 0)).toBe(true);
        expect(frames.length).toBeGreaterThan(1);
    });

    it("leaves to() inert too", () => {
        const node = new Widget({ width: 10, height: 10, x: 0 });
        const step = node.to({ data: { x: 500 }, duration: 1 })._stepper();
        step.seek(0);
        for (let i = 0; i < 60 && !step.advance(DT); i++) { /* drain */ }
        expect(node.x).toBe(0);
    });
});

describe("isCommand", () => {
    it("rejects anything missing either half of the shape", () => {
        expect(isCommand(undefined)).toBe(false);
        expect(isCommand(null)).toBe(false);
        expect(isCommand(5)).toBe(false);
        expect(isCommand("at")).toBe(false);
        expect(isCommand({})).toBe(false);
        expect(isCommand({ duration: 1 })).toBe(false);
        expect(isCommand({ at: () => ({}) })).toBe(false);
        expect(isCommand({ at: "t", duration: 1 })).toBe(false);
        expect(isCommand({ at: () => ({}), duration: "1" })).toBe(false);
        expect(isCommand(() => ({}))).toBe(false);
    });

    it("does not need a stepper, so a bare `{ at, duration }` counts", () => {
        expect(isCommand({ at: () => ({}), duration: 0 })).toBe(true);
    });
});

describe("driveCommand", () => {
    it("hands `apply` the eased, clamped time and returns an empty frame", () => {
        const seen: number[] = [];
        const driven = driveCommand(2, (t) => seen.push(t), (t) => t * t);

        expect(driven.duration).toBe(2);
        expect(driven.at(0.5)).toEqual({});
        driven.at(-1);
        driven.at(7);
        // Clamped before the easing runs, so the easing never sees 7 or -1.
        expect(seen).toEqual([0.25, 0, 1]);
    });

    it("applies the raw clamped time when there is no easing", () => {
        const seen: number[] = [];
        const driven = driveCommand(1, (t) => seen.push(t));
        driven.at(0.3);
        driven.at(2);
        expect(seen).toEqual([0.3, 1]);
    });

    it("drives the same frames through its stepper", () => {
        const seen: number[] = [];
        const stepper = driveCommand(2, (t) => seen.push(t))._stepper();
        stepper.seek(1);
        expect(stepper.advance(0.5)).toBe(false);
        expect(stepper.advance(0.5)).toBe(true);
        expect(seen).toEqual([0.5, 0.75, 1]);
    });
});

describe("a stepper that has finished", () => {
    const sink = () => {
        const writes: number[] = [];
        return { writes, target: { set: (p: { v?: number }) => { if (p.v !== undefined) writes.push(p.v); } } };
    };

    it("keeps reporting done and keeps writing the end frame", () => {
        const { writes, target } = sink();
        const stepper = makeCommand<{ v: number }>(target, (t) => ({ v: t * 10 }), 1)._stepper();

        stepper.seek(0);
        expect(stepper.advance(0.5)).toBe(false);
        expect(stepper.advance(0.5)).toBe(true);
        expect(stepper.advance(0.5)).toBe(true);
        expect(stepper.advance(5)).toBe(true);
        expect(writes).toEqual([0, 5, 10, 10, 10]);
    });

    it("finishes a zero-duration command on its first advance, even by no time", () => {
        const { writes, target } = sink();
        const stepper = makeCommand<{ v: number }>(target, (t) => ({ v: t }), 0)._stepper();

        expect(stepper.advance(0)).toBe(true);
        expect(writes).toEqual([1]);
    });

    it("can be sought back after it finished", () => {
        const { writes, target } = sink();
        const stepper = makeCommand<{ v: number }>(target, (t) => ({ v: t * 10 }), 1)._stepper();

        expect(stepper.advance(2)).toBe(true);
        stepper.seek(0.5);
        expect(stepper.advance(0.25)).toBe(false);
        expect(writes).toEqual([10, 5, 7.5]);
    });
});

describe("command composition edge cases", () => {
    const target = { set: () => { } };

    it("holds a zero-duration child at the handover and carries on past it", () => {
        const seq = commandSequence<{ v?: number; flag?: number }>(
            target,
            makeCommand(target, (t) => ({ v: t * 10 }), 1),
            makeCommand(target, () => ({ flag: 1 }), 0),
            makeCommand(target, (t) => ({ v: 10 + t * 10 }), 1),
        );

        expect(seq.duration).toBe(2);
        expect(seq.at(0.25)).toEqual({ v: 5 });
        // Exactly at the handover the stamp has fired and the next child is at its zero.
        expect(seq.at(0.5)).toEqual({ v: 10, flag: 1 });
        expect(seq.at(0.75)).toEqual({ v: 15, flag: 1 });
        expect(seq.at(1)).toEqual({ v: 20, flag: 1 });
    });

    it("takes no time from a sequence of nothing but stamps", () => {
        const seq = commandSequence<{ a?: number }>(target, makeCommand(target, () => ({ a: 1 }), 0));
        expect(seq.duration).toBe(0);
        expect(seq.at(0)).toEqual({ a: 1 });
    });

    it("lets the later of two parallel commands win a shared prop, even once it has finished", () => {
        const par = commandParallel<{ v: string }>(
            target,
            makeCommand(target, () => ({ v: "long" }), 2),
            makeCommand(target, () => ({ v: "short" }), 1),
        );

        expect(par.duration).toBe(2);
        expect(par.at(0.25)).toEqual({ v: "short" });
        expect(par.at(1)).toEqual({ v: "short" });
    });

    it("writes what it computed to its target", () => {
        const written: unknown[] = [];
        const sink = { set: (p: unknown) => { written.push(p); } };
        const seq = commandSequence<{ v: number }>(sink, makeCommand({ set: () => { } }, (t) => ({ v: t }), 1));
        seq.at(0.5);
        expect(written).toEqual([{ v: 0.5 }]);
    });
});

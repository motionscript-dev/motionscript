import { describe, it, expect } from "vitest";
import { Node2D } from "@/components/trees/2d/node2d";
import { attached } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import type { BoxBounds } from "@/layout/bounds";

/**
 * `moveTo` aimed at another node: the destination is a point of that node's
 * box, read off the tree when the command is built and landed in the mover's
 * own parent space.
 */

const scope = new FakeMeasureContext();

class Tile extends Node2D {
    constructor(props?: ConstructorParameters<typeof Node2D>[0]) {
        super(props ?? {});
    }
    place(rect: BoxBounds): this {
        this.layout(rect, scope);
        return this;
    }
}

const CELL = { x: 0, y: 0, width: 400, height: 400 };

/** A root holding a 40×20 target, at (100, 50) unless told, and a 10×10 mover at the origin. */
function scene(at = { x: 100, y: 50 }) {
    const root = new Tile({ id: "root" });
    const target = new Tile({ id: "card", x: at.x, y: at.y });
    const mover = new Tile({ id: "mover" });
    root.add(target);
    root.add(mover);
    attached(root);
    root.place(CELL);
    target.place({ x: 0, y: 0, width: 40, height: 20 });
    mover.place({ x: 0, y: 0, width: 10, height: 10 });
    return { root, target, mover };
}

describe("moveTo onto another node", () => {
    it("lands on the target's centre when no anchor is named", () => {
        const { mover } = scene();
        mover.moveTo({ data: { target: "card" }, duration: 1 })._stepper().seek(1);

        expect(mover.x).toBeCloseTo(100, 6);
        expect(mover.y).toBeCloseTo(50, 6);
    });

    it("lands on a named anchor of the target's box", () => {
        const { mover } = scene();
        mover.moveTo({ data: { target: "card", targetAnchor: "topRight" }, duration: 1 })._stepper().seek(1);

        expect(mover.x).toBeCloseTo(120, 6);
        expect(mover.y).toBeCloseTo(60, 6);
    });

    it("takes an explicit point in the box's [-1, 1] y-up space", () => {
        const { mover } = scene();
        mover.moveTo({ data: { target: "card", targetAnchor: { x: 0.5, y: -1 } }, duration: 1 })._stepper().seek(1);

        expect(mover.x).toBeCloseTo(110, 6);
        expect(mover.y).toBeCloseTo(40, 6);
    });

    it("tweens there from wherever the node was", () => {
        const { mover } = scene();
        mover.set({ x: -20, y: 10 });
        mover.moveTo({ data: { target: "card" }, duration: 1 })._stepper().seek(0.5);

        expect(mover.x).toBeCloseTo(40, 6);
        expect(mover.y).toBeCloseTo(30, 6);
    });

    it("lands in world space across two differently transformed parents", () => {
        const root = new Tile({ id: "root" });
        const home = new Tile({ id: "home", x: -80, y: 30, rotation: 90, scale: 2 });
        const away = new Tile({ id: "away", x: 120, y: -40, rotation: -30 });
        const target = new Tile({ id: "card", x: 25, y: 10, rotation: 15 });
        const mover = new Tile({ id: "mover", x: 5 });
        root.add(home);
        root.add(away);
        home.add(mover);
        away.add(target);
        attached(root);
        root.place(CELL);
        home.place({ x: 0, y: 0, width: 100, height: 100 });
        away.place({ x: 0, y: 0, width: 100, height: 100 });
        target.place({ x: 0, y: 0, width: 60, height: 30 });
        mover.place({ x: 0, y: 0, width: 10, height: 10 });

        mover.moveTo({ data: { target: "card", targetAnchor: "bottomLeft" }, duration: 1 })._stepper().seek(1);

        const landed = mover.global.center;
        const aimed = target.global.bottomLeft;
        expect(landed.x).toBeCloseTo(aimed.x, 6);
        expect(landed.y).toBeCloseTo(aimed.y, 6);
    });

    it("stays put when the target is not in the tree", () => {
        const { mover } = scene();
        mover.set({ x: 7, y: 9 });
        mover.moveTo({ data: { target: "missing" }, duration: 1 })._stepper().seek(1);

        expect([mover.x, mover.y]).toEqual([7, 9]);
    });

    it("refuses a target and an x/y destination together", () => {
        const { mover } = scene();
        expect(() => mover.moveTo({ data: { target: "card", x: 10 }, duration: 1 })).toThrow(/not both/);
    });
});

describe("moveTo along a path onto another node", () => {
    it("turns and scales the path about its start until its end lands on the target", () => {
        // A 100-long horizontal run aimed at a point straight above its start and
        // twice as far: a quarter turn and a doubling.
        const { mover } = scene({ x: 0, y: 200 });

        const step = mover.moveTo({ data: { path: "M 0 0 L 100 0", target: "card" }, duration: 1 })._stepper();
        step.seek(0);
        expect(mover.x).toBeCloseTo(0, 6);
        expect(mover.y).toBeCloseTo(0, 6);
        step.seek(0.5);
        expect(mover.x).toBeCloseTo(0, 6);
        expect(mover.y).toBeCloseTo(100, 6);
        step.seek(1);
        expect(mover.x).toBeCloseTo(0, 6);
        expect(mover.y).toBeCloseTo(200, 6);
    });

    it("walks the path exactly as written when it already ends on the target", () => {
        const { mover } = scene();
        const curve = "M 0 0 C 0 80 100 80 100 50";
        const free = scene().mover;
        const aimed = mover.moveTo({ data: { path: curve, target: "card" }, duration: 1 })._stepper();
        const plain = free.moveTo({ data: { path: curve }, duration: 1 })._stepper();

        for (const t of [0, 0.3, 0.7, 1]) {
            aimed.seek(t);
            plain.seek(t);
            expect(mover.x).toBeCloseTo(free.x, 6);
            expect(mover.y).toBeCloseTo(free.y, 6);
        }
    });

    it("translates a closed path, which has no chord to turn", () => {
        const { mover } = scene();
        mover.moveTo({ data: { path: "M 0 0 L 10 0 L 10 10 Z", target: "card" }, duration: 1 })._stepper().seek(1);

        expect(mover.x).toBeCloseTo(100, 6);
        expect(mover.y).toBeCloseTo(50, 6);
    });

    it("walks the path as written when the target is not in the tree", () => {
        const { mover } = scene();
        mover.moveTo({ data: { path: "M 0 0 L 30 40", target: "missing" }, duration: 1 })._stepper().seek(1);

        expect(mover.x).toBeCloseTo(30, 6);
        expect(mover.y).toBeCloseTo(40, 6);
    });
});

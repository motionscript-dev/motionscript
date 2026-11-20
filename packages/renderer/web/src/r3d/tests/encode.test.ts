import { describe, expect, it } from "vitest";
import { Graphics3D, Mat, Scene3D, type Material3D } from "@motionscript/core";

import { encodeScene3D, GeometryTable, VERSION } from "../encode";

const encode = (material: Material3D) =>
    encodeScene3D(new Scene3D().draw(new Graphics3D().box({ width: 1, material })));
const bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0];

describe("encodeScene3D", () => {
    it("writes polygonOffset as flag 2048 and two trailing material floats", () => {
        const plain = encode(Mat.basic({ color: "#fff" }));
        const offset = encode(Mat.basic({ color: "#fff", polygonOffset: true, polygonOffsetFactor: 1.25, polygonOffsetUnits: 3.5 }));
        expect(offset[1]).toBe(VERSION);
        expect(offset.length).toBe(plain.length);
        const diff = [...plain.keys()].filter((k) => plain[k] !== offset[k]);
        expect(diff).toHaveLength(3);
        expect(offset[diff[0]] - plain[diff[0]]).toBe(2048);
        expect(diff[2]).toBe(diff[1] + 1);
        expect([offset[diff[1]], offset[diff[2]]]).toEqual([bits(1.25), bits(3.5)]);
    });
});

describe("an extrusion", () => {
    const star = "M 0 1 L 0.26 0.36 L 0.95 0.31 L 0.43 -0.14 L 0.59 -0.81 L 0 -0.45 L -0.59 -0.81 L -0.43 -0.14 L -0.95 0.31 L -0.26 0.36 Z";
    const scene = (depth: number) => new Scene3D().draw(new Graphics3D().mesh({ type: "extrude", path: star, depth }, Mat.standard({ color: "#fff" })));

    it("is drawn as the buffer core evaluates, not reported unsupported", () => {
        const report = { unsupported: new Set<string>() };
        const words = encodeScene3D(scene(0.4), report);
        expect(report.unsupported.size).toBe(0);
        expect(words.length).toBeGreaterThan(200);
    });

    it("is sent once and drawn by reference while it stays the same", () => {
        const table = new GeometryTable();
        const first = encodeScene3D(scene(0.4), undefined, undefined, table);
        const again = encodeScene3D(scene(0.4), undefined, undefined, table);
        const deeper = encodeScene3D(scene(0.8), undefined, undefined, table);
        expect(again.length).toBeLessThan(first.length / 4);
        expect(deeper.length).toBeGreaterThan(first.length / 2);
    });
});

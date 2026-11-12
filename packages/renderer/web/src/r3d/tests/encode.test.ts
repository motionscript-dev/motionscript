import { describe, expect, it } from "vitest";
import { Graphics3D, Mat, Scene3D, type Material3D } from "@motionscript/core";

import { encodeScene3D, VERSION } from "../encode";

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

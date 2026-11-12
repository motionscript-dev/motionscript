import { describe, expect, it } from "vitest";

import { pathKey } from "../backend-wgpu";

const path = (points: number[]) => ({ verbs: new Uint8Array([0, 1]), points: new Float32Array(points) });

describe("pathKey", () => {
    it("tells a path from its mirror through the origin", () => {
        expect(pathKey(path([-100, 40, 100, 40]))).not.toBe(pathKey(path([100, -40, -100, -40])));
        expect(pathKey(path([-380, 120, 380, 120]))).not.toBe(pathKey(path([380, -120, -380, -120])));
    });

    it("gives equal paths one key", () => {
        expect(pathKey(path([1, 2, 3, 4]))).toBe(pathKey(path([1, 2, 3, 4])));
    });
});

import { Effects, type EdgesEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<EdgesEffect>({
    type: "edges",
    surface: "shader",
    params: { strength: "param", kernel: "param", colored: "param" },
    prepare: (e) => (e.strength > 0 ? {} : null),
    // Edges light up one tap (a device px) past the silhouette.
    extras: () => ({ reach: 1 }),
    cases: () => [
        Effects.edges().list[0],
        Effects.edges({ strength: 2, kernel: "prewitt", colored: true }).list[0],
        Effects.edges({ strength: 1.5, kernel: "laplacian" }).list[0],
    ],
});

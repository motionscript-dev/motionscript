import { definePort } from "./_pack.ts";

// The authored 4×5 matrix as is.
export default definePort<{ type: "colorMatrix"; matrix: ArrayLike<number> }>({
    type: "colorMatrix",
    surface: "filter",
    params: {
        matrix: { type: { array: 20, of: "f32" }, value: (e) => Array.from(e.matrix).slice(0, 20) },
    },
    cases: () => [],
});

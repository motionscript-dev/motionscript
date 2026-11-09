import { definePort } from "./_pack.ts";

// Scale alpha by `amount` (clamped to 0-1).
export default definePort<{ type: "alpha"; amount: number }>({
    type: "alpha",
    surface: "filter",
    params: {
        matrix: { type: { array: 20, of: "f32" }, value: (e) => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, Math.max(0, Math.min(1, e.amount)), 0] },
    },
    cases: () => [],
});

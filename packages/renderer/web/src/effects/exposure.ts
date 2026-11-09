import { definePort } from "./_pack.ts";

// Scale rgb by `amount`.
export default definePort<{ type: "exposure"; amount: number }>({
    type: "exposure",
    surface: "filter",
    params: {
        matrix: { type: { array: 20, of: "f32" }, value: (e) => [e.amount, 0, 0, 0, 0, 0, e.amount, 0, 0, 0, 0, 0, e.amount, 0, 0, 0, 0, 0, 1, 0] },
    },
    cases: () => [],
});

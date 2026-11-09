import { describe, expect, it } from "vitest";

import { renderSettled, SETTLE_PASSES } from "@/runtime/settle";

/** Reports pending work for the first `pendingFor` warms, then nothing. */
function fakeAdapter(pendingFor: number) {
    const adapter = {
        warms: 0,
        async warmPendingDecodes(): Promise<boolean> {
            adapter.warms++;
            return adapter.warms <= pendingFor;
        },
    };
    return adapter;
}

describe("renderSettled", () => {
    it("renders once when the first render leaves nothing pending", async () => {
        const adapter = fakeAdapter(0);
        let renders = 0;

        const outcome = await renderSettled(() => renders++, adapter, () => true);

        expect(outcome).toBe("settled");
        expect(renders).toBe(1);
        expect(adapter.warms).toBe(1);
    });

    it("re-renders after every warm that did work, and stops at the first that did none", async () => {
        const adapter = fakeAdapter(2);
        let renders = 0;

        const outcome = await renderSettled(() => renders++, adapter, () => true);

        expect(outcome).toBe("settled");
        expect(renders).toBe(3);
        expect(adapter.warms).toBe(3);
    });

    it("gives up after SETTLE_PASSES renders on an adapter that never settles", async () => {
        const adapter = fakeAdapter(Infinity);
        let renders = 0;

        const outcome = await renderSettled(() => renders++, adapter, () => true);

        expect(outcome).toBe("exhausted");
        expect(renders).toBe(SETTLE_PASSES);
    });

    it("draws nothing for a request that was superseded before it started", async () => {
        const adapter = fakeAdapter(0);
        let renders = 0;

        const outcome = await renderSettled(() => renders++, adapter, () => false);

        expect(outcome).toBe("superseded");
        expect(renders).toBe(0);
        expect(adapter.warms).toBe(0);
    });

    it("stops re-rendering once a newer request takes over mid-warm", async () => {
        let current = true;
        const adapter = {
            async warmPendingDecodes(): Promise<boolean> {
                current = false;
                return true;
            },
        };
        let renders = 0;

        const outcome = await renderSettled(() => renders++, adapter, () => current);

        expect(outcome).toBe("superseded");
        expect(renders).toBe(1);
    });
});

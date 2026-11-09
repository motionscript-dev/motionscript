import { describe, expect, it } from "vitest";

import { observeSlots, slotLabel, unobserved, type SlotObserver } from "@/props/observer";
import { _observer, PropSlot } from "@/props/slot";

/** Records every report as `"read a"` / `"write a"`, by the slot's label. */
function recorder(): SlotObserver & { log: string[] } {
    const log: string[] = [];
    return {
        log,
        read: (slot) => log.push(`read ${slotLabel(slot)}`),
        write: (slot) => log.push(`write ${slotLabel(slot)}`),
        clock: (host) => log.push(`clock ${host.id}`),
    };
}

describe("observeSlots", () => {
    it("records get, set, bind and unbind", () => {
        const slot = new PropSlot(1, null, "a");
        const obs = recorder();
        observeSlots(obs, () => {
            slot.get();
            slot.set(2);
            slot.bind(() => 3);
            slot.unbind();
        });
        // `unbind` freezes what the binding computes, which is a read of its own.
        expect(obs.log).toEqual(["read a", "write a", "write a", "write a", "read a"]);
    });

    it("records restoreFrom as the write it goes through", () => {
        const slot = new PropSlot(1, null, "a");
        const plain = slot.snapshot();
        slot.bind(() => 5);
        const bound = slot.snapshot();

        const obs = recorder();
        observeSlots(obs, () => {
            slot.restoreFrom(plain);
            slot.restoreFrom(bound);
        });
        expect(obs.log).toEqual(["write a", "write a"]);
    });

    it("records a bound slot's reads transitively, under the read that ran it", () => {
        const source = new PropSlot(10, null, "source");
        const derived = new PropSlot(0, null, "derived");
        derived.bind(() => source.get() * 2);

        const obs = recorder();
        const value = observeSlots(obs, () => derived.get());
        expect(value).toBe(20);
        expect(obs.log).toEqual(["read derived", "read source"]);
    });

    it("reports a read when it snapshots a bound slot, and none for a plain one", () => {
        const plain = new PropSlot(1, null, "plain");
        const bound = new PropSlot(0, null, "bound");
        bound.bind(() => 5);

        const obs = recorder();
        observeSlots(obs, () => {
            plain.snapshot();
            bound.snapshot();
        });
        // A bound slot's snapshot carries what it computes, so it has to read it.
        expect(obs.log).toEqual(["read bound"]);
    });

    it("records a self-reading binding's re-entry without recursing", () => {
        const slot = new PropSlot(4, null, "a");
        slot.bind(() => slot.get() + 1);
        const obs = recorder();
        expect(observeSlots(obs, () => slot.get())).toBe(5);
        expect(obs.log).toEqual(["read a", "read a"]);
    });

    it("lets an inner scope shadow an outer one, and restores it after", () => {
        const a = new PropSlot(1, null, "a");
        const outer = recorder();
        const inner = recorder();
        observeSlots(outer, () => {
            a.get();
            observeSlots(inner, () => a.set(2));
            a.get();
            unobserved(() => a.get());
        });
        expect(outer.log).toEqual(["read a", "read a"]);
        expect(inner.log).toEqual(["write a"]);
        expect(_observer).toBeNull();
    });

    it("restores the previous observer when the scope throws", () => {
        const obs = recorder();
        expect(() => observeSlots(obs, () => { throw new Error("boom"); })).toThrow("boom");
        expect(_observer).toBeNull();
    });

    it("reports nothing with no observer", () => {
        const obs = recorder();
        const slot = new PropSlot(1, null, "a");
        slot.get();
        slot.set(2);
        observeSlots(obs, () => { });
        slot.bind(() => 1);
        expect(obs.log).toEqual([]);
    });
});

describe("slotLabel", () => {
    it("prefixes a hosted slot with its host's id", () => {
        expect(slotLabel(new PropSlot(0, { id: "card" }, "x"))).toBe("card.x");
        expect(slotLabel(new PropSlot(0, null, "var:g"))).toBe("var:g");
        expect(slotLabel(new PropSlot(0))).toBe("");
    });
});

import { describe, expect, it } from "vitest";
import type { Node2D } from "@/components/trees/2d/node2d";
import { laidOut, recorded } from "@/components/trees/tests/recording-context.fixtures";
import { createContext } from "@/util/context";
import { provides } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";

const Unit = createContext(1, "inheritEntriesUnit");
let read: number[] = [];

/** Written inline, as an author would: `use` is typed by the option, with no annotation. */
const Tick = component2d({
    key: "inheritEntriesTick",
    state: {
        unit: Types.number(1, { inherit: (use) => use(Unit) }),
        label: Types.text("", { inherit: (use, given) => `${String(given.id)}:${use(Unit)}` }),
        shown: Types.boolean(true, { private: true, inherit: (use) => use(Unit) > 0 }),
    },
    render: (ctx, state) => {
        read.push(state.unit);
    },
});

const Ruler = component2d({ key: "inheritEntriesRuler", state: { unit: 10 }, provide: (state) => [provides(Unit, state.unit)] });

describe("an entry's inherit option", () => {
    it("reads the nearest provider's value, typed inline", () => {
        read = [];
        const tick = new (Tick as unknown as new (p: object) => Node2D)({ id: "t", width: 10, height: 10 });
        recorded(laidOut(new (Ruler as unknown as new (p: object) => Node2D)({ id: "r", unit: 4, width: 50, height: 50, children: [tick] }), { x: 0, y: 0, width: 50, height: 50 }));
        expect(read.at(-1)).toBe(4);
        expect((tick as unknown as { label: string }).label).toBe("t:4");
    });
});
